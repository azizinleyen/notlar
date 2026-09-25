// ============================================================================
//  FAZ 7 — Saklama suresi (retention) temizligi.
//
//  Ayarlardaki `retention_days` > 0 ise, bu sureden ESKI notlar silinir.
//  Guvenlik: silmeden once otomatik yedek alinir (yanlis ayar veri kaybina
//  yol acmasin).
// ============================================================================

import type Database from 'better-sqlite3'
import type { RetentionResult } from '@shared/types'
import * as repo from '../db/repo'
import { backupDatabase, pruneBackups } from './security'

export interface RetentionDeps {
  db: Database.Database
  log?: (m: string) => void
}

export function runRetention(deps: RetentionDeps, opts?: { dryRun?: boolean }): RetentionResult {
  const { db } = deps
  const settings = repo.getAllSettings(db)
  const days = Math.max(0, Math.floor(settings.retention_days ?? 0))
  const total = repo.listNotes(db, { limit: 100000 }).length

  if (days === 0) {
    // 0 = suresiz sakla (varsayilan)
    return { deleted: 0, kept: total, retentionDays: 0 }
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString()
  const stale = db
    .prepare('SELECT id, title FROM notes WHERE started_at < ? ORDER BY started_at ASC')
    .all(cutoff) as Array<{ id: string; title: string }>

  if (stale.length === 0) {
    deps.log?.(`[retention] silinecek not yok (esik: ${cutoff})`)
    return { deleted: 0, kept: total, retentionDays: days }
  }

  if (opts?.dryRun) {
    return { deleted: stale.length, kept: total - stale.length, retentionDays: days }
  }

  // Veri kaybina karsi once yedek
  try {
    backupDatabase('pre-retention')
    pruneBackups(5)
  } catch (err) {
    deps.log?.(`[retention] yedek alinamadi: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tx = db.transaction(() => {
    for (const n of stale) repo.deleteNote(db, n.id)
  })
  tx()

  deps.log?.(`[retention] ${stale.length} not silindi (${days} gunden eski)`)
  return { deleted: stale.length, kept: total - stale.length, retentionDays: days }
}

/** Tum verileri siler (ayarlar korunur). Silmeden once yedek alinir. */
export function deleteAllData(db: Database.Database): { deletedNotes: number; backupPath?: string } {
  const notes = repo.listNotes(db, { limit: 100000 })
  let backupPath: string | undefined
  try {
    backupPath = backupDatabase('pre-delete-all') ?? undefined
    pruneBackups(3)
  } catch {
    /* yedek alinamazsa da devam: kullanici acikca istedi */
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM notes').run()
    db.prepare('DELETE FROM chat_messages').run()
    db.prepare('DELETE FROM chat_threads').run()
    db.prepare('DELETE FROM people').run()
    db.prepare('DELETE FROM companies').run()
    db.prepare('DELETE FROM tags').run()
    db.prepare('DELETE FROM note_tags').run()
    db.prepare('DELETE FROM note_people').run()
  })
  tx()
  return { deletedNotes: notes.length, backupPath }
}