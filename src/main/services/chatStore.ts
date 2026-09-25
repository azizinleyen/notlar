// ============================================================================
//  FAZ 6 — Sohbet deposu (thread + mesaj).
//  recipes.ts ve chat.ts bunu paylasir; dairesel import olmamasi icin
//  cekirdek CRUD burada tutulur.
// ============================================================================

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AskCitationDto, ChatMessageDto, ChatScopeKind, ChatThreadDto } from '@shared/types'
import * as repo from '../db/repo'

export function listThreads(db: Database.Database, limit = 30): ChatThreadDto[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.scope_kind, t.scope_id, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id) AS message_count
         FROM chat_threads t ORDER BY t.updated_at DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: string
    title: string
    scope_kind: string
    scope_id: string | null
    created_at: string
    updated_at: string
    message_count: number
  }>
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    scope_kind: r.scope_kind as ChatScopeKind,
    scope_id: r.scope_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: r.message_count
  }))
}

export function createThread(
  db: Database.Database,
  scopeKind: ChatScopeKind,
  scopeId: string | null,
  title?: string
): string {
  const id = randomUUID()
  db.prepare('INSERT INTO chat_threads (id, title, scope_kind, scope_id) VALUES (?, ?, ?, ?)').run(
    id,
    title?.trim() || defaultTitle(db, scopeKind, scopeId),
    scopeKind,
    scopeId
  )
  return id
}

export function ensureThread(
  db: Database.Database,
  scopeKind: ChatScopeKind,
  scopeId: string | null,
  title?: string
): string {
  const existing = db
    .prepare(
      `SELECT id FROM chat_threads
        WHERE scope_kind = ? AND IFNULL(scope_id,'') = IFNULL(?,'')
        ORDER BY updated_at DESC LIMIT 1`
    )
    .get(scopeKind, scopeId) as { id: string } | undefined
  return existing?.id ?? createThread(db, scopeKind, scopeId, title)
}

function defaultTitle(db: Database.Database, kind: ChatScopeKind, id: string | null): string {
  if (kind === 'person' && id) return repo.getPerson(db, id)?.name ?? 'Kisi hakkinda'
  if (kind === 'company' && id) return repo.getCompany(db, id)?.name ?? 'Sirket hakkinda'
  if (kind === 'note' && id) return repo.getNoteDetail(db, id)?.note.title ?? 'Not hakkinda'
  return 'Tum notlarim'
}

export function deleteThread(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id)
}

export function getMessages(db: Database.Database, threadId: string): ChatMessageDto[] {
  const rows = db
    .prepare(
      `SELECT id, thread_id, role, content_md, citations_json, provider, model,
              used_fallback, scanned_notes, error, created_at
         FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(threadId) as Array<{
    id: string
    thread_id: string
    role: 'user' | 'assistant'
    content_md: string
    citations_json: string | null
    provider: string | null
    model: string | null
    used_fallback: number
    scanned_notes: number
    error: string | null
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    role: r.role,
    content_md: r.content_md,
    citations: r.citations_json ? (JSON.parse(r.citations_json) as AskCitationDto[]) : [],
    provider: r.provider,
    model: r.model,
    used_fallback: Boolean(r.used_fallback),
    scanned_notes: r.scanned_notes,
    error: r.error,
    created_at: r.created_at
  }))
}

export interface InsertMessageInput {
  threadId: string
  role: 'user' | 'assistant'
  contentMd: string
  citations?: AskCitationDto[]
  provider?: string | null
  model?: string | null
  usedFallback?: boolean
  scannedNotes?: number
  error?: string | null
}

export function insertChatMessage(db: Database.Database, msg: InsertMessageInput): ChatMessageDto {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO chat_messages
       (id, thread_id, role, content_md, citations_json, provider, model, used_fallback, scanned_notes, error)
     VALUES (@id, @threadId, @role, @contentMd, @citations, @provider, @model, @usedFallback, @scannedNotes, @error)`
  ).run({
    id,
    threadId: msg.threadId,
    role: msg.role,
    contentMd: msg.contentMd,
    citations: msg.citations && msg.citations.length > 0 ? JSON.stringify(msg.citations) : null,
    provider: msg.provider ?? null,
    model: msg.model ?? null,
    usedFallback: msg.usedFallback ? 1 : 0,
    scannedNotes: msg.scannedNotes ?? 0,
    error: msg.error ?? null
  })
  db.prepare("UPDATE chat_threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
    msg.threadId
  )
  return {
    id,
    thread_id: msg.threadId,
    role: msg.role,
    content_md: msg.contentMd,
    citations: msg.citations ?? [],
    provider: msg.provider ?? null,
    model: msg.model ?? null,
    used_fallback: Boolean(msg.usedFallback),
    scanned_notes: msg.scannedNotes ?? 0,
    error: msg.error ?? null,
    created_at: new Date().toISOString()
  }
}

/** Kapsam icin not kimlikleri (chat ve recipes ortak kullanir). */
export function notesForScopeApi(
  db: Database.Database,
  kind: 'note' | 'person' | 'company' | 'all',
  scopeId: string | null,
  limit: number
): string[] {
  if (kind === 'person' && scopeId)
    return repo.listPersonNotes(db, scopeId).map((l) => l.note_id).slice(0, limit)
  if (kind === 'company' && scopeId)
    return repo.listCompanyNotes(db, scopeId).map((l) => l.note_id).slice(0, limit)
  if (kind === 'note' && scopeId) return [scopeId]
  return repo.listNotes(db, { limit }).map((n) => n.id)
}