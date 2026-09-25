// ============================================================================
//  FAZ 6 — Sohbet (chat): cok turlu, kalici, kaynakli.
//
//  Kapsamlar: note | person | company | all
//  Her asistan mesaji, dayandigi notlara KAYNAK baglar ([N#] -> note_id).
//  Anti-halusinasyon kurali Faz 5 ile ayni: bilgi yoksa "Notlarinizda bu
//  bilgi yok" denir, tahmin yurutulmez.
// ============================================================================

import type Database from 'better-sqlite3'
import type { AskCitationDto, ChatMessageDto, ChatScopeKind } from '@shared/types'
import * as repo from '../db/repo'
import { getMessages, insertChatMessage, notesForScopeApi } from './chatStore'
import { rawNotesToPlain } from '@shared/text'
import { llmOptionsFor, resolveLlmProvider } from '../llm'
import { extractJsonObject } from '../llm/util'
import {
  buildChatSystemPrompt,
  buildScopedContext,
  normalizeAskPayload,
  resolveScopedCitations,
  type ScopedNoteInput
} from '../llm/scoped'

export { listThreads, createThread, ensureThread, deleteThread, getMessages } from './chatStore'

export interface ChatDeps {
  db: Database.Database
  onProgress?: (m: string) => void
  log?: (m: string) => void
}

// --- kapsam notlarini toplama ---------------------------------------------

export function notesForScope(
  db: Database.Database,
  kind: ChatScopeKind,
  scopeId: string | null,
  limit: number
): string[] {
  return notesForScopeApi(db, kind, scopeId, limit)
}

function noteToInput(db: Database.Database, id: string): ScopedNoteInput | null {
  const d = repo.getNoteDetail(db, id)
  if (!d) return null
  return {
    noteId: d.note.id,
    title: d.note.title,
    startedAt: d.note.started_at,
    source: d.note.source,
    transcript: repo.transcriptTextOf(db, id),
    rawNotes: rawNotesToPlain(d.raw_notes_md),
    enhanced: d.enhanced?.content_md ?? ''
  }
}

// --- ana akis --------------------------------------------------------------

export interface SendOptions {
  /** Once kullanici mesaji olarak kaydedilecek metin */
  question: string
}

/**
 * Sohbete bir tur ekler: kullanici mesaji + asistan cevabi (kaynakli).
 * Gecmis turlar da prompt'a eklenir (cok turlu baglam).
 */
export async function sendMessage(
  deps: ChatDeps,
  threadId: string,
  opts: SendOptions
): Promise<{ user: ChatMessageDto; assistant: ChatMessageDto }> {
  const { db } = deps
  const question = (opts.question ?? '').trim()
  if (!question) throw new Error('Soru bos')

  const thread = db
    .prepare('SELECT id, scope_kind, scope_id FROM chat_threads WHERE id = ?')
    .get(threadId) as { id: string; scope_kind: ChatScopeKind; scope_id: string | null } | undefined
  if (!thread) throw new Error('Sohbet bulunamadi')

  const userMsg = insertChatMessage(db, { threadId, role: 'user', contentMd: question })

  const settings = repo.getAllSettings(db)
  const limit = Math.max(1, Math.min(50, settings.chat_max_context_notes || 12))
  const ids = notesForScope(db, thread.scope_kind, thread.scope_id, limit)

  const notes: ScopedNoteInput[] = []
  for (const id of ids) {
    const input = noteToInput(db, id)
    if (input) notes.push(input)
  }

  const ctx = buildScopedContext(notes, { maxCharsPerNote: 3000, maxTotalChars: 20000 })
  const history = getMessages(db, threadId).slice(-9, -1) // son 4 tur (kullanici+asistan), yeni mesaj haric

  const llm = resolveLlmProvider(settings.llm_provider)
  const llmOpts = llmOptionsFor(db, llm)
  const system = buildChatSystemPrompt(settings.language)

  const historyBlock = history
    .map((m) => `${m.role === 'user' ? 'KULLANICI' : 'ASISTAN'}: ${m.content_md.slice(0, 1200)}`)
    .join('\n')

  const user = [
    '### NOTLAR',
    ctx.block || '(not yok)',
    '',
    historyBlock ? `### ONCEKI KONUSMA\n${historyBlock}` : '',
    '',
    '### SORU',
    question
  ]
    .filter((x) => x !== undefined)
    .join('\n')

  const finish = (payload: {
    answerMd: string
    citations: AskCitationDto[]
    provider: string | null
    model: string | null
    usedFallback: boolean
    error?: string | null
  }): ChatMessageDto =>
    insertChatMessage(db, {
      threadId,
      role: 'assistant',
      contentMd: payload.answerMd,
      citations: payload.citations,
      provider: payload.provider,
      model: payload.model,
      usedFallback: payload.usedFallback,
      scannedNotes: notes.length,
      error: payload.error ?? null
    })

  // LLM yoksa: yerel arama
  if (llm.requiresApiKey && !llmOpts.apiKey) {
    const local = localChatAnswer(db, question, thread.scope_kind, thread.scope_id, limit)
    const assistant = finish({
      answerMd: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      error: 'LLM anahtari yok — yerel arama gosteriliyor'
    })
    return { user: userMsg, assistant }
  }

  try {
    deps.onProgress?.(`${llm.label} yanitliyor...`)
    const res = await llm.complete({ system, user, maxTokens: 1800, temperature: 0.15 }, llmOpts)
    const payload = normalizeAskPayload(extractJsonObject(res.text))
    const resolved = resolveScopedCitations(payload.citations, ctx.index)
    deps.log?.(
      `[chat] kapsam=${thread.scope_kind} not=${notes.length} tur=${history.length} ` +
        `kaynak=${resolved.citations.length} atilan=${resolved.dropped}`
    )
    const assistant = finish({
      answerMd: payload.answer_md || 'Notlarinizda bu bilgi yok.',
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: 'previous_note' as const,
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    })
    return { user: userMsg, assistant }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.log?.(`[chat] LLM hatasi, yerel arama: ${message}`)
    const local = localChatAnswer(db, question, thread.scope_kind, thread.scope_id, limit)
    const assistant = finish({
      answerMd: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    })
    return { user: userMsg, assistant }
  }
}

/** Anahtarsiz/hatali durumda yerel anahtar-kelime aramasi. */
export function localChatAnswer(
  db: Database.Database,
  question: string,
  scopeKind: ChatScopeKind,
  scopeId: string | null,
  limit: number
): { answer_md: string; citations: AskCitationDto[] } {
  const terms = question
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3)
  if (terms.length === 0) return { answer_md: 'Notlarinizda bu bilgi yok.', citations: [] }

  const ids = notesForScope(db, scopeKind, scopeId, limit)
  const found: AskCitationDto[] = []
  for (const id of ids) {
    if (found.length >= 4) break
    const d = repo.getNoteDetail(db, id)
    if (!d) continue
    const lines = [
      ...repo.transcriptTextOf(db, id).split('\n'),
      ...rawNotesToPlain(d.raw_notes_md).split('\n'),
      ...(d.enhanced?.content_md ?? '').split('\n')
    ]
    const hit = lines.find((l) => {
      const low = l.toLocaleLowerCase('tr')
      return l.trim().length > 12 && terms.some((t) => low.includes(t))
    })
    if (hit) {
      found.push({
        note_id: id,
        note_title: d.note.title,
        source_type: 'previous_note',
        excerpt: hit.trim().slice(0, 240)
      })
    }
  }
  if (found.length === 0) return { answer_md: 'Notlarinizda bu bilgi yok.', citations: [] }
  return {
    answer_md: ['Notlarında bulunan ilgili satırlar:', ...found.map((c) => `- ${c.excerpt}`)].join('\n'),
    citations: found
  }
}