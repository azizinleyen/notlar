// Jargon deposu + entegrasyon (transkript duzeltme, STT ipucu).

import type Database from 'better-sqlite3'
import type { JargonEntry } from '@shared/types'
import * as repo from '../db/repo'
import { applyJargon, buildSttHint, type JargonRule } from '../jargon/apply'
import { slugForId } from '@shared/text'

export function listJargon(db: Database.Database): JargonEntry[] {
  const rows = db
    .prepare('SELECT id, term, replacement, note, enabled, hit_count FROM jargon ORDER BY term ASC')
    .all() as Array<{
    id: string
    term: string
    replacement: string
    note: string | null
    enabled: number
    hit_count: number
  }>
  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    replacement: r.replacement,
    note: r.note,
    enabled: r.enabled === 1,
    hit_count: r.hit_count
  }))
}

export function activeRules(db: Database.Database): JargonRule[] {
  const settings = repo.getAllSettings(db)
  if (!settings.jargon_enabled) return []
  return listJargon(db)
    .filter((j) => j.enabled && j.term.trim())
    .map((j) => ({ term: j.term, replacement: j.replacement }))
}

export function sttHintFor(db: Database.Database): string {
  const settings = repo.getAllSettings(db)
  const rules = settings.jargon_enabled ? activeRules(db) : []
  return buildSttHint(rules, settings.stt_prompt ?? '')
}

export function saveJargon(
  db: Database.Database,
  input: { id?: string; term: string; replacement: string; note?: string | null; enabled?: boolean }
): JargonEntry | null {
  const term = (input.term ?? '').trim()
  if (!term) return null
  const id = input.id?.trim() || `jr_${slugForId(term, 40).replace(/[^\p{L}\p{N}]+/gu, '_')}`
  db.prepare(
    `INSERT INTO jargon (id, term, replacement, note, enabled) VALUES (@id, @term, @replacement, @note, @enabled)
     ON CONFLICT(id) DO UPDATE SET
       term = excluded.term,
       replacement = excluded.replacement,
       note = excluded.note,
       enabled = excluded.enabled`
  ).run({
    id,
    term,
    replacement: (input.replacement ?? '').trim(),
    note: input.note?.trim() || null,
    enabled: input.enabled === false ? 0 : 1
  })
  return listJargon(db).find((j) => j.id === id) ?? null
}

export function deleteJargon(db: Database.Database, id: string): boolean {
  const res = db.prepare('DELETE FROM jargon WHERE id = ?').run(id)
  return res.changes > 0
}

export function bumpJargonHits(db: Database.Database, counts: Map<string, number>): void {
  const stmt = db.prepare('UPDATE jargon SET hit_count = hit_count + ? WHERE term = ?')
  const tx = db.transaction(() => {
    for (const [term, n] of counts) stmt.run(n, term)
  })
  tx()
}

/** Bir transkript metnini jargon kurallarina gore duzeltir (ve sayaci artirir). */
export function correctText(db: Database.Database, text: string): string {
  const rules = activeRules(db)
  if (rules.length === 0) return text
  const res = applyJargon(text, rules)
  if (res.total > 0) bumpJargonHits(db, res.counts)
  return res.text
}