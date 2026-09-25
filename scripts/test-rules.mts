#!/usr/bin/env node
/**
 * test-rules.mts — Tespit/tetikleme kurallarinn birim testleri (saf fonksiyonlar).
 *
 * @shared alias'i Node'da cozulemedigi icin once esbuild ile paketlenir:
 *   npm run test:rules
 */
import {
  appDedupeKey,
  checkTriggerAlive,
  evaluateSnapshot,
  exeMatchesLabel,
  isKnownMeetingExe,
  isSelfExe,
  labelForExe,
  normalizeLabel,
  titleLooksLikeMeeting
} from '../src/main/detect/rules.ts'
import type { MicUser, ProcessInfo } from '@shared/types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? ' -> ' + extra : ''))
  }
}

const mic = (exePath: string, active = true): MicUser => {
  const exe = exePath.split('\\').pop() ?? exePath
  return { exePath, exe, active, startAt: '2026-09-24T21:00:00.000Z', stopAt: active ? null : '2026-09-24T21:10:00.000Z' }
}
const proc = (name: string, title = ''): ProcessInfo => ({ name, pid: 1, title })

const BASE = {
  allowedApps: ['Zoom', 'Microsoft Teams', 'Discord', 'Google Meet'],
  prevActiveMicPaths: [] as string[],
  prevProcessNames: [] as string[],
  recordingActive: false,
  quietKeys: new Set<string>(),
  callEnabled: true,
  appEnabled: true
}

console.log('\n[1] Etiket normalizasyonu')
{
  check('"Microsoft Teams" -> microsoftteams', normalizeLabel('Microsoft Teams') === 'microsoftteams')
  check('"Zoom.exe" -> zoom', normalizeLabel('Zoom.exe') === 'zoom')
  check('"ms-teams" -> msteams', normalizeLabel('ms-teams') === 'msteams')
  check('bos metin', normalizeLabel('') === '')
}

console.log('\n[2] exe <-> etiket eslesmesi')
{
  check('Zoom <-> Zoom.exe', exeMatchesLabel('Zoom.exe', 'Zoom'))
  check('Zoom <-> tam yol', exeMatchesLabel('C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe', 'Zoom'))
  check('Microsoft Teams <-> ms-teams.exe', exeMatchesLabel('ms-teams.exe', 'Microsoft Teams'))
  check('Microsoft Teams <-> Teams.exe', exeMatchesLabel('Teams.exe', 'Microsoft Teams'))
  check('Google Meet <-> chrome.exe (eslesMEMELI)', !exeMatchesLabel('chrome.exe', 'Google Meet'))
  check('Discord <-> Discord.exe', exeMatchesLabel('Discord.exe', 'Discord'))
  check('bos etiket eslesmez', !exeMatchesLabel('Zoom.exe', ''))
}

console.log('\n[3] Bilinen toplanti uygulamalari / baslik isaretleri')
{
  check('zoom.exe bilinen', isKnownMeetingExe('zoom.exe'))
  check('notepad.exe bilinen degil', !isKnownMeetingExe('notepad.exe'))
  check('"Meeting - Google Meet" baslik', titleLooksLikeMeeting('Sprint - Google Meet'))
  check('"meet.google.com" baslik', titleLooksLikeMeeting('meet.google.com/abc-defg'))
  check('"Belgeler - Word" degil', !titleLooksLikeMeeting('Belge1 - Word'))
  check('kendi exe\'miz electron.exe', isSelfExe('electron.exe'))
  check('kendi exe\'miz notlar.exe', isSelfExe('C:\\dev\\Notlar\\Notlar.exe'))
}

console.log('\n[4] etiket -> gorunen ad')
{
  check('izin listesindeki etiket tercih edilir', labelForExe('ms-teams.exe', ['Microsoft Teams']) === 'Microsoft Teams')
  check('listede yoksa exe adi', labelForExe('unknownapp.exe', []) === 'unknownapp')
}

console.log('\n[5] ARAMA tetiklemesi (mikrofon kullanimi)')
{
  const r1 = evaluateSnapshot({
    ...BASE,
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom')]
  })
  check('izinli uygulama mic kullaniyor -> call tetikler', r1.event?.kind === 'call', JSON.stringify(r1.event))
  check('reason call:Zoom.exe', r1.event?.reason === 'call:Zoom.exe', r1.event?.reason)

  // Gercekte mic zaten aktifse Zoom da zaten surec listesindeydi -> ikisi de "yeni" degil
  const r2 = evaluateSnapshot({
    ...BASE,
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom')],
    prevActiveMicPaths: ['C:\\Apps\\Zoom\\Zoom.exe'],
    prevProcessNames: ['Zoom']
  })
  check('ONCEDEN aktifse tekrar tetiklemez', r2.event === null, JSON.stringify(r2.event))

  const r3 = evaluateSnapshot({
    ...BASE,
    micUsers: [mic('C:\\Program Files\\obs-studio\\obs64.exe')],
    processes: [proc('obs64')]
  })
  check('izin listesinde YOKSA tetiklemez', r3.event === null, JSON.stringify(r3.event))
  check('  (teshis icin aktif mic listesi dolu)', r3.activeMicLabels.length === 1)

  // Arama kurali kapali: mic aktif olsa bile ARAMA tetiklemesi olmamali.
  // (Zoom zaten acikti -> uygulama kurali da ateslenmez)
  const r4 = evaluateSnapshot({
    ...BASE,
    callEnabled: false,
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom')],
    prevProcessNames: ['Zoom']
  })
  check('ayar kapaliysa arama tetiklemez', r4.event === null, JSON.stringify(r4.event))

  const r5 = evaluateSnapshot({
    ...BASE,
    micUsers: [mic('C:\\dev\\Notlar\\node_modules\\electron\\dist\\electron.exe')],
    processes: [proc('electron')]
  })
  check('kendi uygulamamiz tetiklemez', r5.event === null, JSON.stringify(r5.event))

  const r6 = evaluateSnapshot({
    ...BASE,
    recordingActive: true,
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom')]
  })
  check('kayit surerken tetiklemez', r6.event === null)

  // Soguma anahtari artik UYGULAMA bazli (appDedupeKey)
  const r7 = evaluateSnapshot({
    ...BASE,
    quietKeys: new Set([appDedupeKey('Zoom.exe')]),
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom')],
    prevProcessNames: ['Zoom']
  })
  check('soguma suresindeyse tetiklemez', r7.event === null)
}

console.log('\n[6] UYGULAMA tetiklemesi')
{
  const r1 = evaluateSnapshot({
    ...BASE,
    micUsers: [],
    processes: [proc('Zoom', 'Zoom Meeting')]
  })
  check('izinli uygulama acik -> app tetikler', r1.event?.kind === 'app', JSON.stringify(r1.event))

  const r2 = evaluateSnapshot({
    ...BASE,
    appEnabled: false,
    micUsers: [],
    processes: [proc('Zoom')]
  })
  check('ayar kapaliysa uygulama tetiklemez', r2.event === null)

  const r3 = evaluateSnapshot({
    ...BASE,
    micUsers: [],
    processes: [proc('chrome', 'Sprint - Google Meet')]
  })
  check('tarayici basligi toplanti ise tetikler', r3.event?.kind === 'app', JSON.stringify(r3.event))

  const r4 = evaluateSnapshot({ ...BASE, micUsers: [], processes: [proc('notepad', 'notlar.txt')] })
  check('alakasiz surec tetiklemez', r4.event === null)
}

console.log('\n[6b] Takma ad cozumlemesi (gercek exe adlari)')
{
  check('ms-teams.exe -> microsoftteams', appDedupeKey('ms-teams.exe') === 'microsoftteams')
  check('Microsoft Teams -> microsoftteams', appDedupeKey('Microsoft Teams') === 'microsoftteams')
  check('teams.exe -> microsoftteams', appDedupeKey('TEAMS.EXE') === 'microsoftteams')
  check('Zoom.exe -> zoom', appDedupeKey('Zoom.exe') === 'zoom')
  check('zoomhybridconf.exe -> zoom', appDedupeKey('zoomhybridconf.exe') === 'zoom')
  check('bilinmeyen uygulama kendi adini korur', appDedupeKey('myapp.exe') === 'myapp')
  check('bos -> bos', appDedupeKey(null) === '')
}

console.log('\n[6c] Uygulama kurali KENAR tetiklemeli')
{
  const open = { ...BASE, micUsers: [], processes: [proc('Zoom')] }
  const again = { ...open, prevProcessNames: ['Zoom'] }
  check('ilk taramada (yeni acildi) tetikler', evaluateSnapshot(open).event?.kind === 'app')
  check('sonraki taramada tekrar tetiklemez', evaluateSnapshot(again).event === null)
}

console.log('\n[6d] Uygulama bazli soguma (call -> app ayni anahtar)')
{
  const zoom = { exe: 'C:\\Apps\\Zoom\\Zoom.exe' }
  const r1 = evaluateSnapshot({
    ...BASE,
    micUsers: [mic(zoom.exe)],
    processes: [proc('Zoom')],
    quietKeys: new Set([appDedupeKey('Zoom.exe')])
  })
  check('call sogumadayken tetiklemez', r1.event === null, JSON.stringify(r1.event))

  const r2 = evaluateSnapshot({
    ...BASE,
    micUsers: [],
    processes: [proc('Zoom')],
    quietKeys: new Set([appDedupeKey('Zoom.exe')])
  })
  check('app sogumadayken de tetiklemez', r2.event === null, JSON.stringify(r2.event))

  // ms-teams.exe ile Teams kaydi da ayni anahtari kullanmali
  const r3 = evaluateSnapshot({
    ...BASE,
    micUsers: [],
    processes: [proc('ms-teams')],
    quietKeys: new Set([appDedupeKey('Microsoft Teams')])
  })
  check('Teams etiketi <-> ms-teams.exe ayni soguma anahtari', r3.event === null, JSON.stringify(r3.event))
}

console.log('\n[7] Oncelik: arama > uygulama')
{
  const r = evaluateSnapshot({
    ...BASE,
    micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe')],
    processes: [proc('Zoom'), proc('Discord')]
  })
  check('ikisi de varsa call secilir', r.event?.kind === 'call', JSON.stringify(r.event))
}

console.log('\n[8] Kaynak hala canli mi? (otomatik durdurma)')
{
  const zoomMic = [mic('C:\\Apps\\Zoom\\Zoom.exe', true)]
  const zoomProc = [proc('Zoom')]

  check('surec + mic aktif -> canli', checkTriggerAlive('Zoom.exe', 'call', { micUsers: zoomMic, processes: zoomProc }).alive)
  check(
    'surec yok -> kapandi (process-missing)',
    checkTriggerAlive('Zoom.exe', 'call', { micUsers: zoomMic, processes: [] }).reason === 'process-missing'
  )
  check(
    'mic birakti -> gorusme bitti (mic-inactive)',
    checkTriggerAlive('Zoom.exe', 'call', { micUsers: [mic('C:\\Apps\\Zoom\\Zoom.exe', false)], processes: zoomProc })
      .reason === 'mic-inactive'
  )
  check(
    'uygulama tetiklemesinde mic gerekmez',
    checkTriggerAlive('Zoom.exe', 'app', { micUsers: [], processes: zoomProc }).alive
  )
  check('triggerApp yoksa canli sayilir', checkTriggerAlive(null, 'calendar', { micUsers: [], processes: [] }).alive)
  check(
    'tanilama sayilari donduruluyor',
    checkTriggerAlive('Zoom.exe', 'call', { micUsers: zoomMic, processes: zoomProc }).processCount === 1
  )
}

console.log(`\n===== SONUC: ${pass} gecti, ${fail} basarisiz =====`)
process.exit(fail === 0 ? 0 : 1)