#!/usr/bin/env node
/**
 * test-ics.mts — ICS ayristirici + RRULE genisletme testleri.
 * Harici test cercevesi yok; Node'un yerlesik TS tip-siyirma ozelligi kullanilir.
 * Kullanim: node scripts/test-ics.mts
 */
import { parseIcsWindow, unfoldIcs, parseIcsDate, parseRRule, expandRecurrence, unescapeText } from '../src/main/calendar/ics.ts'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

console.log('\n[1] Satir katlama (unfold)')
{
  const CRLF = String.fromCharCode(13, 10)
  const raw = ['SUMMARY:Merhaba', ' dunya', 'DTSTART:20260101T090000Z'].join(CRLF)
  const lines = unfoldIcs(raw)
  check('katlanmis satir birlestirildi', lines[0] === 'SUMMARY:Merhabadunya', JSON.stringify(lines[0]))
  check('satir sayisi 2', lines.length === 2, String(lines.length))
  const raw2 = ['SUMMARY:A', '  B'].join(CRLF)
  check('tek bosluk silinir, fazlasi korunur', unfoldIcs(raw2)[0] === 'SUMMARY:A B', JSON.stringify(unfoldIcs(raw2)[0]))
}

console.log('\n[2] Metin kacisi')
{
  check('virgul kacisi', unescapeText('a\\, b') === 'a, b')
  check('yeni satir kacisi', unescapeText('a\\nb') === 'a\nb')
  check('noktali virgul', unescapeText('a\\;b') === 'a;b')
  check('ters bolu', unescapeText('C:\\\\yol') === 'C:\\yol')
}

console.log('\n[3] Tarih ayristirma')
{
  const utc = parseIcsDate('20260925T090000Z', {})
  check('UTC tarih', utc?.date.toISOString() === '2026-09-25T09:00:00.000Z', utc?.date.toISOString())
  check('UTC modu', utc?.mode === 'utc')

  const local = parseIcsDate('20260925T090000', { TZID: 'Europe/Istanbul' })
  check('TZID yerel saat olarak yorumlandi', local?.date.getHours() === 9, String(local?.date.getHours()))
  check('yerel modu', local?.mode === 'local')

  const allDay = parseIcsDate('20260925', { VALUE: 'DATE' })
  check('tum gun etkinligi', allDay?.allDay === true && allDay?.date.getDate() === 25)

  check('bozuk tarih null', parseIcsDate('bozuk', {}) === null)
}

console.log('\n[4] RRULE ayristirma')
{
  const r = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=6;WKST=MO')
  check('freq', r?.freq === 'WEEKLY')
  check('interval', r?.interval === 2)
  check('byDay [1,3,5]', JSON.stringify(r?.byDay) === '[1,3,5]', JSON.stringify(r?.byDay))
  check('count', r?.count === 6)
  check('gecersiz FREQ -> null', parseRRule('INTERVAL=2') === null)
}

console.log('\n[5] Haftalik tekrar genisletme (Pzt/Car/Cum, 3 hafta)')
{
  const dtstart = new Date(Date.UTC(2026, 8, 21, 9, 0, 0)) // 21 Eyl 2026 = Pazartesi
  const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6')
  const from = new Date(Date.UTC(2026, 8, 1))
  const to = new Date(Date.UTC(2026, 9, 31))
  const occ = expandRecurrence(dtstart, rule, 'utc', from, to, new Set())
  const days = occ.map((d) => d.toISOString().slice(0, 10) + ' ' + 'SMTWTFS'[d.getUTCDay()])
  check('6 olusum uretildi (COUNT=6)', occ.length === 6, String(occ.length))
  check(
    'tarihler dogru',
    JSON.stringify(days) ===
      JSON.stringify(['2026-09-21 M', '2026-09-23 W', '2026-09-25 F', '2026-09-28 M', '2026-09-30 W', '2026-10-02 F']),
    JSON.stringify(days)
  )
}

console.log('\n[6] INTERVAL=2 gunluk + UNTIL')
{
  const dtstart = new Date(Date.UTC(2026, 8, 21, 9, 0, 0))
  const rule = parseRRule('FREQ=DAILY;INTERVAL=2;UNTIL=20260927T000000Z')
  const occ = expandRecurrence(dtstart, rule, 'utc', new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 30)), new Set())
  check('3 olusum (21,23,25)', occ.length === 3, JSON.stringify(occ.map((d) => d.toISOString().slice(0, 10))))
}

console.log('\n[7] Aylik tekrar + subat tasmasi korumasi')
{
  const dtstart = new Date(Date.UTC(2026, 0, 31, 10, 0, 0)) // 31 Ocak
  const rule = parseRRule('FREQ=MONTHLY;COUNT=4')
  const occ = expandRecurrence(dtstart, rule, 'utc', new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 11, 31)), new Set())
  const ds = occ.map((d) => d.toISOString().slice(0, 10))
  check('31 tasmasi atlandi (Subat yok)', !ds.includes('2026-03-03'), JSON.stringify(ds))
  check('ilk olusum 31 Ocak', ds[0] === '2026-01-31', JSON.stringify(ds))
}

console.log('\n[8] Tam ICS belgesi (EXDATE + kacis + tum gun + katilimcilar)')
{
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//TR//EN',
    'BEGIN:VEVENT',
    'UID:standup-1@test',
    'SUMMARY:Sabah stand-up\\, gunluk',
    'DESCRIPTION:Konu basliklari:\\n- API\\n- Arayuz',
    'LOCATION:Toplanti Odasi 3',
    'DTSTART;TZID=Europe/Istanbul:20260921T093000',
    'DTEND;TZID=Europe/Istanbul:20260921T094500',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6',
    'EXDATE;TZID=Europe/Istanbul:20260923T093000',
    'ORGANIZER;CN=Deniz:mailto:deniz@firma.com',
    'ATTENDEE;CN=Sarah Jones;EMAIL=sarah@firma.com:mailto:sarah@firma.com',
    'ATTENDEE;CN=James;EMAIL=james@firma.com:mailto:james@firma.com',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:tatil-1@test',
    'SUMMARY:Resmi Tatil',
    'DTSTART;VALUE=DATE:20261029',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  const from = new Date(2026, 8, 1, 0, 0, 0)
  const to = new Date(2026, 11, 31, 23, 59, 59)
  const events = parseIcsWindow(ics, from, to)
  const standup = events.filter((e) => e.title.includes('stand'))

  check('2 etkinlik turu bulundu', events.length >= 2, String(events.length))
  check('baslik kacisi cozuldu', standup[0]?.title === 'Sabah stand-up, gunluk', standup[0]?.title)
  check('aciklama cok satirli', (standup[0]?.description ?? '').includes('\n- API'), JSON.stringify(standup[0]?.description))
  check('konum okundu', standup[0]?.location === 'Toplanti Odasi 3')
  check('organizator CN', standup[0]?.organizer === 'Deniz', standup[0]?.organizer)
  check('2 katilimci', standup[0]?.attendees.length === 2, String(standup[0]?.attendees.length))
  check('EXDATE dislandi (23 Eyl yok)', !standup.some((e) => e.startAt.getDate() === 23), JSON.stringify(standup.map((e) => e.startAt.getDate())))
  // RFC 5545: COUNT, RRULE'un urettigi kumeyi sinirlar; EXDATE sonradan cikarilir.
  // Yani 6 olusum uretilir, 1'i EXDATE ile cikarilir -> 5 etkinlik kalir.
  check('COUNT=6 uretilip 1 EXDATE cikarildi -> 5', standup.length === 5, String(standup.length))
  const tatil = events.find((e) => e.title === 'Resmi Tatil')
  check('tum gun etkinligi', tatil?.allDay === true)
  check('kronolojik sirali', events.every((e, i) => i === 0 || events[i - 1].startAt <= e.startAt))
}

console.log('\n[9] Coklu EXDATE (virgullu liste)')
{
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:x@test',
    'SUMMARY:Gunluk',
    'DTSTART:20260921T090000Z',
    'RRULE:FREQ=DAILY;COUNT=5',
    'EXDATE:20260922T090000Z,20260923T090000Z',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const events = parseIcsWindow(ics, new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 30)))
  const ds = events.map((e) => e.startAt.toISOString().slice(0, 10))
  check('2 tarih dislandi -> 3 kaldi', events.length === 3, JSON.stringify(ds))
}

console.log('\n[10] Bozuk/bos girdi dayanikliligi')
{
  check('bos metin', parseIcsWindow('', new Date(), new Date()).length === 0)
  check('VEVENT yok', parseIcsWindow('BEGIN:VCALENDAR\r\nEND:VCALENDAR', new Date(), new Date()).length === 0)
  check('DTSTART yok olay atlanir', parseIcsWindow('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR', new Date(), new Date()).length === 0)
}

console.log(`\n===== SONUC: ${pass} gecti, ${fail} basarisiz =====`)
process.exit(fail === 0 ? 0 : 1)