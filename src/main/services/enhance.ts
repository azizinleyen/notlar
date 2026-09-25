// ============================================================================
//  FAZ 4 — Zenginlestirme servisi.
//
//  Akis: ham not + kanal etiketli transkript + takvim baglami
//        -> prompt (llm/prompt.ts, SAF fonksiyonlar)
//        -> LLM (llm/*)
//        -> JSON dogrulama + kaynak cozumu
//        -> enhanced_notes + citations (version artar)
//
//  Basarisizlikta: note.status='failed' + fail_reason (arayuzde "yeniden dene").
// ============================================================================

import type Database from 'better-sqlite3'
import type { EnhancedNote, NoteDetail } from '@shared/types'
import { rawNotesToPlain } from '@shared/text'
import { correctText } from './jargon'
import * as repo from '../db/repo'
import { listLlmProviders, llmOptionsFor, resolveLlmProvider } from '../llm'
import { localProvider } from '../llm/local'
import { extractJsonObject } from '../llm/util'
import {
  buildSystemPrompt,
  buildUserPrompt,
  normalizePayload,
  payloadToMarkdown,
  resolveCitations
} from '../llm/prompt'

export interface EnhanceProgress {
  noteId: string
  stage: 'queued' | 'building' | 'calling' | 'parsing' | 'saving' | 'done' | 'error'
  message: string
  detail?: string
  provider?: string
  model?: string
}

export interface EnhanceDeps {
  db: Database.Database
  onProgress?: (p: EnhanceProgress) => void
  log?: (m: string) => void
}

export interface EnhanceResult {
  ok: boolean
  enhanced?: EnhancedNote
  version?: number
  citations?: number
  droppedCitations?: number
  provider?: string
  model?: string
  error?: string
  /** Yerel yedege dusuldu mu (LLM hatasi sonrasi) */
  usedFallback?: boolean
}

function templatePromptFor(db: Database.Database, templateId: string | null | undefined): string {
  const id = templateId && templateId !== 'auto' ? templateId : ''
  if (!id) return ''
  const row = db.prepare('SELECT prompt_body FROM templates WHERE id = ?').get(id) as
    | { prompt_body: string }
    | undefined
  return row?.prompt_body ?? ''
}

/**
 * Bir notu zenginlestirir. `templateId` verilmezse ayarlardaki varsayilan sablon.
 */
export async function enhanceNote(
  deps: EnhanceDeps,
  noteId: string,
  templateId?: string | null
): Promise<EnhanceResult> {
  const { db } = deps
  const emit = (p: EnhanceProgress): void => deps.onProgress?.(p)
  const log = (m: string): void => deps.log?.(m)

  const detail: NoteDetail | null = repo.getNoteDetail(db, noteId)
  if (!detail) return { ok: false, error: 'Not bulunamadi' }

  const settings = repo.getAllSettings(db)
  const effectiveTemplate = templateId ?? settings.default_template

  if (detail.transcripts.length === 0 && !rawNotesToPlain(detail.raw_notes_md).trim()) {
    const msg = 'Zenginleştirilecek içerik yok (transkript ve ham not boş)'
    repo.setNoteStatus(db, noteId, 'failed', msg)
    emit({ noteId, stage: 'error', message: msg })
    return { ok: false, error: msg }
  }

  emit({ noteId, stage: 'building', message: 'Bağlam hazırlanıyor...' })
  repo.setNoteStatus(db, noteId, 'processing')

  const system = buildSystemPrompt(settings.language, templatePromptFor(db, effectiveTemplate))
  const { user, index } = buildUserPrompt({
    noteTitle: detail.note.title,
    language: settings.language,
    templatePrompt: templatePromptFor(db, effectiveTemplate),
    calendarEvent: detail.calendar_event,
    rawNotesMd: rawNotesToPlain(detail.raw_notes_md),
    transcripts: detail.transcripts
  })

  const provider = resolveLlmProvider(settings.llm_provider)
  const opts = llmOptionsFor(db, provider)

  log(
    `[enhance] ${noteId}: saglayici=${provider.id} model=${opts.model || provider.defaultModel} ` +
      `transkript=${detail.transcripts.length} hamNot=${detail.raw_notes_md.length}b`
  )

  let completion: { text: string; model: string; provider: string }
  let usedFallback = false

  const runProvider = async (
    p: typeof provider,
    o: typeof opts
  ): Promise<{ text: string; model: string; provider: string }> => {
    emit({ noteId, stage: 'calling', message: `${p.label} çağrılıyor...`, provider: p.id })
    const res = await p.complete(
      {
        system,
        user,
        maxTokens: 4000,
        temperature: 0.2,
        onProgress: (m) => emit({ noteId, stage: 'calling', message: m, provider: p.id })
      },
      o
    )
    return { text: res.text, model: res.model, provider: res.provider }
  }

  try {
    if (provider.requiresApiKey && !opts.apiKey) {
      throw new Error(
        `${provider.label} için API anahtarı yok. .env dosyasına ${provider.apiKeyEnvVar} ekleyin ` +
          'veya Ayarlar\'dan yerel çıkarımı seçin.'
      )
    }
    completion = await runProvider(provider, opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`[enhance] LLM hatasi: ${message}`)
    // Yedek: yerel cikarim (uydurma yok, kaynaklar gercek)
    emit({ noteId, stage: 'calling', message: 'LLM başarısız — yerel çıkarım deneniyor...', detail: message })
    try {
      completion = await runProvider(localProvider as never, {} as never)
      usedFallback = true
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2)
      repo.setNoteStatus(db, noteId, 'failed', message)
      emit({ noteId, stage: 'error', message: 'Zenginleştirme başarısız', detail: message })
      return { ok: false, error: message + ' | yedek de başarısız: ' + msg2 }
    }
  }

  emit({ noteId, stage: 'parsing', message: 'Yanıt işleniyor...', provider: completion.provider })

  let payload
  try {
    payload = normalizePayload(extractJsonObject(completion.text))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    repo.setNoteStatus(db, noteId, 'failed', message)
    emit({ noteId, stage: 'error', message: 'Model yanıtı çözümlenemedi', detail: message })
    return { ok: false, error: message }
  }

  const resolved = resolveCitations(payload.citations, index)
  // AI ciktisina da jargon duzeltmesi uygula (terim tutarliligi)
  const contentMd = correctText(db, payloadToMarkdown(payload))

  emit({ noteId, stage: 'saving', message: 'Not kaydediliyor...' })

  const version = repo.nextEnhancedVersion(db, noteId)
  repo.insertEnhancedNote(db, {
    noteId,
    contentMd,
    templateId: effectiveTemplate || null,
    model: `${completion.provider}:${completion.model}`,
    version,
    citations: resolved.citations.map((c) => ({ ...c, source_id: c.source_id }))
  })

  repo.setNoteStatus(db, noteId, 'ready')

  log(
    `[enhance] tamam: v${version} bolum=${payload.sections.length} next_steps=${payload.next_steps.length} ` +
      `kaynak=${resolved.citations.length} atilan=${resolved.dropped}`
  )

  const enhanced = repo.getEnhancedNote(db, noteId)
  emit({
    noteId,
    stage: 'done',
    message: 'Notun hazır',
    provider: completion.provider,
    model: completion.model
  })

  return {
    ok: true,
    enhanced: enhanced ?? undefined,
    version,
    citations: resolved.citations.length,
    droppedCitations: resolved.dropped,
    provider: completion.provider,
    model: completion.model,
    usedFallback
  }
}

export function describeLlm(db: Database.Database): Array<{ id: string; label: string; hasApiKey: boolean }> {
  return listLlmProviders(db).map((p) => ({ id: p.id, label: p.label, hasApiKey: p.hasApiKey }))
}