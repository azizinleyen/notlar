#!/usr/bin/env node
/**
 * db-reset.mjs — Yerel veritabanini siler (tum notlar/transkriptler/ayarlar).
 * Uyari: Geri alinamaz. Uygulama kapaliyken calistirin.
 *
 * Kullanim: npm run db:reset
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dbDir = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'notlar', 'db')
if (!existsSync(dbDir)) {
  console.log('Silinecek veritabani yok:', dbDir)
  process.exit(0)
}
for (const f of ['notlar.db', 'notlar.db-wal', 'notlar.db-shm']) {
  const target = join(dbDir, f)
  if (existsSync(target)) {
    rmSync(target)
    console.log('Silindi:', target)
  }
}
console.log('Veritabani sifirlandi. Uygulama bir sonraki acilista semayi yeniden kuracak.')