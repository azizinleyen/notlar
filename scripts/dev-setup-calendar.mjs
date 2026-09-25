#!/usr/bin/env node
/**
 * dev-setup-calendar.mjs — Takvim tetiklemesi icin test ortami kurar.
 *
 * Yaptigi:
 *  1) Test .ics dosyasi yazar (RRULE'li katilimcili etkinlik + katilimcisiz etkinlik)
 *  2) Ayarlari UPSERT eder (calendar_source, auto_start_calendar, sync araligi)
 *  3) Notlari ve takvim onbellegini temizler
 *
 * Kullanim:  node scripts/dev-setup-calendar.mjs [baslangicaKalanSaniye]
 * NOT: Ayarlari yazmak icin INSERT ... ON CONFLICT kullanilir; cunku bazi
 *      anahtarlar yalnizca kod tarafindaki varsayilanlarda bulunur ve duz
 *      UPDATE 0 satir etkiler.
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const inSeconds = Number(process.argv[2] ?? 55)
const dbPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'notlar', 'db', 'notlar.db')
const icsPath = join(process.cwd(), '.tmp-test-takvim.ics')

const now = new Date()
const start = new Date(now.getTime() + inSeconds * 1000)
const start2 = new Date(now.getTime() + (inSeconds + 20) * 1000)

const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const dows = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Notlar//Test//TR',
  'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT',
  'UID:standup-test-1@notlar',
  'SUMMARY:Haftalik urun stand-up\\, ekip',
  'DESCRIPTION:Test etkinligi. Gundem:\\n- Sprint durumu\\n- Engeller',
  'LOCATION:Google Meet',
  `DTSTART:${z(start)}`,
  `DTEND:${z(new Date(start.getTime() + 30 * 60000))}`,
  `RRULE:FREQ=WEEKLY;BYDAY=${dows[start.getUTCDay()]};COUNT=4`,
  'ORGANIZER;CN=Deniz Yilmaz:mailto:deniz@firma.com',
  'ATTENDEE;CN=Sarah Jones;EMAIL=sarah@firma.com:mailto:sarah@firma.com',
  'ATTENDEE;CN=James Lee;EMAIL=james@firma.com:mailto:james@firma.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:focus-block-1@notlar',
  'SUMMARY:Odaklanma blogu (katilimcisiz)',
  `DTSTART:${z(start2)}`,
  `DTEND:${z(new Date(start2.getTime() + 60 * 60000))}`,
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

writeFileSync(icsPath, ics, 'utf8')

const db = new DatabaseSync(dbPath)
const upsert = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
)
upsert.run('calendar_source', icsPath)
upsert.run('auto_start_calendar', 'participants')
upsert.run('calendar_sync_minutes', '15')
upsert.run('trigger_cooldown_seconds', '10')
db.exec('DELETE FROM notes')
db.exec('DELETE FROM calendar_events_cache')
db.close()

console.log('ICS      :', icsPath)
console.log('stand-up :', start.toISOString(), '(katilimcili, RRULE haftalik)')
console.log('odak blogu:', start2.toISOString(), '(katilimcisiz -> atlanmali)')
console.log('simdi    :', now.toISOString())
console.log('ayarlar  : calendar_source + participants + cooldown=10 yazildi')