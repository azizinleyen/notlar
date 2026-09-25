#!/usr/bin/env node
/**
 * seed-demo.mjs — Tasarim/gorsel dogrulama icin ornek veri yazar.
 * (Mockup'taki "Morning standup" senaryosuna benzer icerik.)
 *
 * Kullanim:  npm run seed:demo
 * Geri alma: npm run db:reset
 *
 * Not: Gercek notlarinizla karismamasi icin once db:reset calistirin.
 * Bu script better-sqlite3 kullanmaz; Node'un yerlesik node:sqlite modulunu kullanir.
 */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const dbDir = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'notlar', 'db')
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
const dbPath = join(dbDir, 'notlar.db')
const schemaPath = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'db', 'schema.sql')

const db = new DatabaseSync(dbPath)
db.exec(readFileSync(schemaPath, 'utf8'))

const id = randomUUID()
const started = new Date()
started.setHours(9, 0, 0, 0)
const ended = new Date(started.getTime() + 30 * 60000)

db.prepare(
  'INSERT INTO notes (id, title, started_at, ended_at, source, status) VALUES (?, ?, ?, ?, ?, ?)'
).run(id, 'Sabah stand-up', started.toISOString(), ended.toISOString(), 'manual', 'ready')

db.prepare('INSERT OR REPLACE INTO raw_notes (note_id, content_md) VALUES (?, ?)').run(
  id,
  [
    '- Backend API neredeyse hazır, uç durumlar (edge case) üzerinde çalışıyoruz',
    '- Dashboard arayüzü %80 tamam',
    '- Tasarım ekibiyle yeni akış için hızlı bir senkron yaptık',
    '- Veritabanı taşıma işi gelecek hafta planlandı',
    '- Müşteriye güncellenen gereksinimler için geri dönüş yapmalıyım'
  ].join('\n')
)

const msgs = [
  ['system', 'Sarah', 'Kısaca özetleyeyim: backend API neredeyse hazır, sadece birkaç uç durum kaldı.'],
  ['mic', 'Ben', 'Harika. Dashboard arayüzü nasıl gidiyor?'],
  ['system', 'James', 'Dashboard arayüzü yaklaşık %80 tamam. Son birkaç bileşeni bugün bitiriyoruz.'],
  ['mic', 'Ben', 'Mükemmel. Veritabanı taşıma işi ne durumda?'],
  ['system', 'Elif', 'O gelecek hafta planlandı. Kesin tarihi netleşince paylaşacağız.'],
  ['mic', 'Ben', "Müşterinin güncellenen gereksinimleriyle ilgili bir gelişme var mı?"],
  ['system', 'Deniz', 'Bu sabah hızlı bir senkron yaptık. Büyük ölçüde hemfikiriz, ufak değişiklikler var.']
]
const ins = db.prepare(
  'INSERT INTO transcripts (id, note_id, channel, speaker_label, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
)
let t = 2000
for (const [channel, speaker, text] of msgs) {
  ins.run(randomUUID(), id, channel, speaker, text, t, t + 1800)
  t += 2600
}

const enh = randomUUID()
db.prepare(
  'INSERT INTO enhanced_notes (id, note_id, content_md, template_id, model, version) VALUES (?, ?, ?, ?, ?, 1)'
).run(
  enh,
  id,
  [
    '## Özet',
    '- Backend geliştirmesi rayında; uç durumlar çözülüyor.',
    '- Dashboard arayüzü %80 tamam.',
    '- Tasarım ekibiyle yeni akışta uzlaşma olumlu.',
    '- Veritabanı taşıma gelecek haftaya planlandı.',
    '- Güncellenen gereksinimler için müşteriye dönüş gerekiyor.',
    '',
    '## Kararlar',
    '- Mevcut API yapısıyla devam edilecek.',
    '- Mevcut tasarım sistemi korunacak.',
    '- Veritabanı taşıma gelecek hafta yapılacak.',
    '',
    '## Sonraki Adımlar',
    '- Backend uç durumlarını kapat (James).',
    '- Dashboard güncellemelerini tamamla (James).',
    '- Yeni akışı tasarım ekibiyle teyit et (Ben).',
    '- Müşteri geri dönüşü için hazırlık yap (Ben).'
  ].join('\n'),
  'meeting',
  'demo-seed'
)

const cit = db.prepare(
  'INSERT INTO citations (id, enhanced_note_id, sentence_ref, source_type, source_id, excerpt) VALUES (?, ?, ?, ?, ?, ?)'
)
cit.run(randomUUID(), enh, 'ozet:1', 'raw_note', id, 'Backend API neredeyse hazır, uç durumlar üzerinde çalışıyoruz')
cit.run(randomUUID(), enh, 'kararlar:1', 'transcript', null, 'Kısaca özetleyeyim: backend API neredeyse hazır.')
cit.run(randomUUID(), enh, 'sonraki-adimlar:4', 'raw_note', id, 'Müşteriye güncellenen gereksinimler için geri dönüş yapmalıyım')

console.log('Demo not olusturuldu:', id)
console.log('DB:', dbPath)
db.close()