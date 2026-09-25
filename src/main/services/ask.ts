// ============================================================================
//  FAZ 5 — Kapsamli soru-cevap: kisi / sirket / tek not / tum notlar.
//
//  Ayni altyapi Faz 6'daki chat ekranini da besleyecek.
//  Anti-halusinasyon: kaynak [N#] etiketleriyle zorunlu; gecersiz kaynak atilir
//  ve "notlarinizda bu bilgi yok" demesi icin sistem mesajinda acikca istenir.
// ============================================================================

import type Database from 'better-sqlite3'
import type { AskCitationDto, AskRequest, AskResult } from '@shared/types'
import * as repo from '../db/repo'
import { rawNotesToPlain } from '@shared/text'
import { llmOptionsFor, resolveLlmProvider } from '../llm'
import { extractJsonObject } from '../llm/util'
import {
  buildAskSystemPrompt,
  buildScopedContext,
  normalizeAskPayload,
  resolveScopedCitations,
  type ScopedNoteInput
} from '../llm/scoped'

export interface AskDeps {
  db: Database.Database
  onProgress?: (m: string) => void
  log?: (m: string) => void
}

const MAX_NOTES = 12

/** Basit yerel arama: soru kelimelerini iceren notlari onceler (LLM yoksa). */
export function localSearchAnswer(
  db: Database.Database,
  question: string,
  limit = 4
): { answer_md: string; citations: AskCitationDto[] } {
  const terms = question
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3)
  if (terms.length === 0) return { answer_md: 'Notlarınızda bu bilgi yok.', citations: [] }

  const found: AskCitationDto[] = []
  // Ham not + zenginlestirilmis not + transkript satirlarinda ara
  const notes = repo.listNotes(db, { limit: 200 })
  for (const n of notes) {
    if (found.length >= limit) break
    const detail = repo.getNoteDetail(db, n.id)
    if (!detail) continue
    const lines = [
      ...repo.transcriptTextOf(db, n.id).split('\n'),
      ...rawNotesToPlain(detail.raw_notes_md).split('\n'),
      ...(detail.enhanced?.content_md ?? '').split('\n')
    ]
    const hit = lines.find((l) => {
      const low = l.toLocaleLowerCase('tr')
      return terms.some((t) => low.includes(t))
    })
    if (hit && hit.trim().length > 10) {
      found.push({
        note_id: n.id,
        note_title: n.title,
        source_type: 'previous_note',
        excerpt: hit.trim().slice(0, 240)
      })
    }
  }

  if (found.length === 0) return { answer_md: 'Notlarınızda bu bilgi yok.', citations: [] }
  const md = ['Notlarınızda bulunan ilgili satırlar:', ...found.map((c) => `- ${c.excerpt}`)].join('\n')
  return { answer_md: md, citations: found }
}

export async function askScoped(deps: AskDeps, req: AskRequest): Promise<AskResult> {
  const { db } = deps
  const log = (m: string): void => deps.log?.(m)
  const question = (req.question ?? '').trim()

  if (!question) {
    return {
      ok: false,
      answer_md: '',
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      scanned_notes: 0,
      error: 'Soru boş'
    }
  }

  // 1) Kapsama gore not kimlikleri
  let ids: string[] = []
  if (req.scope === 'person' && req.scopeId) {
    ids = repo.listPersonNotes(db, req.scopeId).map((l) => l.note_id)
  } else if (req.scope === 'company' && req.scopeId) {
    ids = repo.listCompanyNotes(db, req.scopeId).map((l) => l.note_id)
  } else if (req.scope === 'note' && req.scopeId) {
    ids = [req.scopeId]
  } else {
    ids = repo.listNotes(db, { limit: MAX_NOTES }).map((n) => n.id)
  }
  ids = ids.slice(0, MAX_NOTES)

  if (ids.length === 0) {
    return {
      ok: false,
      answer_md: 'Notlarınızda bu bilgi yok.',
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      scanned_notes: 0,
      error: 'Bu kapsamda not bulunamadı'
    }
  }

  const notes: ScopedNoteInput[] = []
  for (const id of ids) {
    const d = repo.getNoteDetail(db, id)
    if (!d) continue
    notes.push({
      noteId: d.note.id,
      title: d.note.title,
      startedAt: d.note.started_at,
      source: d.note.source,
      transcript: repo.transcriptTextOf(db, id),
      rawNotes: rawNotesToPlain(d.raw_notes_md),
      enhanced: d.enhanced?.content_md ?? ''
    })
  }

  const settings = repo.getAllSettings(db)
  const llm = resolveLlmProvider(settings.llm_provider)
  const opts = llmOptionsFor(db, llm)
  const ctx = buildScopedContext(notes)

  if (llm.requiresApiKey && !opts.apiKey) {
    const local = localSearchAnswer(db, question)
    return {
      ok: true,
      answer_md: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      scanned_notes: notes.length,
      error: 'LLM anahtarı yok — yerel arama gösteriliyor'
    }
  }

  const system = buildAskSystemPrompt(settings.language)
  const user = ['### NOTLAR', ctx.block, '', '### SORU', question].join('\n')

  try {
    deps.onProgress?.(`${llm.label} yanıtlıyor...`)
    const res = await llm.complete({ system, user, maxTokens: 1600, temperature: 0.1 }, opts)
    const payload = normalizeAskPayload(extractJsonObject(res.text))
    const resolved = resolveScopedCitations(payload.citations, ctx.index)
    log(
      `[ask] kapsam=${req.scope} not=${notes.length} kaynak=${resolved.citations.length} ` +
        `atilan=${resolved.dropped}`
    )
    return {
      ok: true,
      answer_md: payload.answer_md || 'Notlarınızda bu bilgi yok.',
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: 'previous_note' as const,
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false,
      scanned_notes: notes.length
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`[ask] LLM hatasi, yerel arama: ${message}`)
    const local = localSearchAnswer(db, question)
    return {
      ok: true,
      answer_md: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      scanned_notes: notes.length,
      error: message
    }
  }
}