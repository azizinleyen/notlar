// ============================================================================
//  Tespit kurallari — SAF fonksiyonlar (yan etkisi yok, test edilebilir).
//
//  IKI KURAL (ikisi de KENAR-TETIKLEMELI, yani yalnizca "yeni" olayda atesler):
//    A) ARAMA  : izin listesindeki bir uygulama mikrofonu kullanmaya BASLADI
//    B) UYGULAMA: izin listesindeki bir uygulama yeni ACILDI (veya toplanti
//                 basligi kazandi)
//  Kenar tetikleme olmasi sart: aksi halde uygulama acik kaldigi surece
//  tekrar tekrar kayit acilirdi.
//
//  TEKILLESTIRME ANAHTARI UYGULAMA BAZLI: 'call:Zoom.exe' ile 'app:Zoom.exe'
//  ayni anahtara ('zoom') duser; boylece arama kaydi bittikten hemen sonra
//  ayni uygulama icin uygulama tetiklemesi ateslenmez (bkz. test-rules.mts).
// ============================================================================

import {
  KNOWN_MEETING_TITLE_MARKERS,
  type MicUser,
  type ProcessInfo,
  type TriggerEvent,
  type TriggerKind
} from '@shared/types'

/**
 * Bilinen uygulamalarin TAKMA ADLARI.
 * Neden gerekli: kullanicinin izin listesindeki etiket ("Microsoft Teams") ile
 * gercek exe adi ("ms-teams.exe") birebir ayni degildir. Bu tablo olmadan
 * Teams icin mikrofon tetiklemesi hic calismazdi.
 */
export const APP_ALIASES: Array<{ label: string; aliases: string[] }> = [
  { label: 'Microsoft Teams', aliases: ['ms-teams.exe', 'teams.exe', 'ms-teamsupdate.exe', 'teams'] },
  { label: 'Zoom', aliases: ['zoom.exe', 'zoomhybridconf.exe', 'zoom'] },
  { label: 'Google Meet', aliases: ['meet', 'googlemeet'] },
  { label: 'Discord', aliases: ['discord.exe', 'discord'] },
  { label: 'Skype', aliases: ['skype.exe', 'skypeapp.exe', 'skype'] },
  { label: 'Slack', aliases: ['slack.exe', 'slack'] },
  { label: 'WhatsApp', aliases: ['whatsapp.exe', 'whatsapp.root.exe', 'whatsapp'] },
  { label: 'Telegram', aliases: ['telegram.exe', 'telegram'] },
  { label: 'Webex', aliases: ['webex.exe', 'webexmta.exe', 'ciscowebexstart.exe', 'webex'] },
  { label: 'Jitsi', aliases: ['jitsi.exe'] },
  { label: 'GoTo Meeting', aliases: ['gotomeeting.exe', 'g2mstart.exe'] },
  { label: 'BlueJeans', aliases: ['bluejeans.exe'] },
  { label: 'FaceTime', aliases: ['facetime.exe'] }
]

/** "Microsoft Teams" -> "microsoftteams", "Zoom.exe" -> "zoom" */
export function normalizeLabel(input: string): string {
  return (input ?? '')
    .toLocaleLowerCase('en')
    .replace(/\.exe$/i, '')
    .replace(/[\s._-]/g, '')
    .trim()
}

function basename(path: string): string {
  return (path ?? '').split(/[\\/]/).pop() ?? ''
}

// Takma ad indeksi: normalize edilmis ad -> kanonik etiket
const ALIAS_TO_CANON = new Map<string, string>()
for (const entry of APP_ALIASES) {
  const canon = normalizeLabel(entry.label)
  ALIAS_TO_CANON.set(canon, canon)
  for (const alias of entry.aliases) ALIAS_TO_CANON.set(normalizeLabel(alias), canon)
}

/** Bilinen bir uygulamaya aitse kanonik (normalize) etiketini doner. */
export function canonicalApp(name: string): string | null {
  return ALIAS_TO_CANON.get(normalizeLabel(basename(name))) ?? null
}

/** exe yolunu/adini bir izin-listesi etiketiyle eslestirir (takma adlar dahil). */
export function exeMatchesLabel(exeOrPath: string, label: string): boolean {
  const exeNorm = normalizeLabel(basename(exeOrPath))
  const labNorm = normalizeLabel(label)
  if (!exeNorm || !labNorm) return false
  if (exeNorm === labNorm) return true

  const canonExe = canonicalApp(exeNorm)
  const canonLab = canonicalApp(labNorm)
  if (canonExe && canonLab) return canonExe === canonLab

  // Alt dizgi toleransi: kisa adlar ve surum ekleri icin ("steam"/"steamwebhelper")
  return exeNorm.includes(labNorm) || labNorm.includes(exeNorm)
}

/** Tecrube: 'foo.exe' -> 'foo' (izgara/soğuma anahtari) */
export function appDedupeKey(name: string | null | undefined): string {
  if (!name) return ''
  const norm = normalizeLabel(basename(name))
  return canonicalApp(norm) ?? norm
}

export function isKnownMeetingExe(exe: string): boolean {
  return canonicalApp(exe) !== null
}

export function titleLooksLikeMeeting(title: string): boolean {
  const t = (title ?? '').toLocaleLowerCase('en')
  return (KNOWN_MEETING_TITLE_MARKERS as readonly string[]).some((m) => t.includes(m))
}

/** Kendi uygulamamizin exe'si (kendi kaydirmizi tetiklememek icin haric tutulur). */
export function isSelfExe(exe: string): boolean {
  const e = (exe ?? '').toLocaleLowerCase('en')
  return e === 'electron.exe' || e === 'notlar.exe' || e.endsWith('\\notlar.exe')
}

export interface DetectInput {
  micUsers: MicUser[]
  processes: ProcessInfo[]
  allowedApps: string[]
  /** Onceki taramanin aktif mikrofon yollari (kenar tetikleme icin) */
  prevActiveMicPaths: string[]
  /** Onceki taramanin surec adlari (kenar tetikleme icin) */
  prevProcessNames: string[]
  /** Su an kayit suruyorsa tetikleme yapilmaz */
  recordingActive: boolean
  /** Soguma suresindeki uygulama anahtarlari (appDedupeKey) */
  quietKeys: Set<string>
  /** Ayarlar: arama (mikrofon kullanimi) tetiklemesi acik mi */
  callEnabled: boolean
  /** Ayarlar: uygulama acilisi tetiklemesi acik mi */
  appEnabled: boolean
}

export interface DetectResult {
  event: TriggerEvent | null
  /** Bu taramadaki aktif mikrofon kullanicilari (izin listesinden bagimsiz, teshis icin) */
  activeMicLabels: string[]
  /** Izin listesiyle eslesen aktif mikrofon kullanicisi var mi */
  allowedMicUser: string | null
  /** Izin listesiyle eslesen toplanti uygulamasi var mi */
  allowedApp: string | null
  /** Bu taramadaki tum surec adlari (bir sonraki kenar karsilastirmasi icin) */
  processNames: string[]
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Surec listesinden toplanti uygulamasi izi tasiyan kayitlari secer. */
function meetingCandidates(processes: ProcessInfo[]): ProcessInfo[] {
  return processes.filter((p) => !isSelfExe(`${p.name}.exe`) && Boolean(p.name))
}

export function evaluateSnapshot(input: DetectInput): DetectResult {
  const { micUsers, processes, allowedApps, callEnabled, appEnabled } = input

  const activeMic = micUsers.filter((m) => m.active && !isSelfExe(m.exe))
  const activeMicLabels = activeMic.map((m) => m.exePath)
  const processNames = processes.map((p) => p.name)

  // Izin listesindeki uygulama mikrofonu kullaniyor mu?
  const allowedMic = activeMic.find((m) => allowedApps.some((a) => exeMatchesLabel(m.exe, a)))
  const allowedMicUser = allowedMic ? allowedMic.exePath : null

  // Izin listesindeki toplanti uygulamasi ACIK mi?
  const allowedProc =
    meetingCandidates(processes).find(
      (p) =>
        allowedApps.some((a) => exeMatchesLabel(`${p.name}.exe`, a)) ||
        titleLooksLikeMeeting(p.title)
    ) ?? null
  const allowedApp = allowedProc ? `${allowedProc.name}.exe` : null

  const result: DetectResult = {
    event: null,
    activeMicLabels,
    allowedMicUser,
    allowedApp,
    processNames
  }

  // Kayit zaten suruyorsa yeni tetikleme yok.
  if (input.recordingActive) return result

  const prevMic = new Set(input.prevActiveMicPaths.map((p) => p.toLocaleLowerCase('en')))
  const prevProcs = new Set(input.prevProcessNames.map((p) => p.toLocaleLowerCase('en')))
  const quiet = input.quietKeys

  // --- KURAL A: ARAMA (kenar: mikrofonu KULLANMAYA BASLADI) ----------------
  if (callEnabled && allowedMic) {
    const key = appDedupeKey(allowedMic.exe)
    const isNew = !prevMic.has(allowedMic.exePath.toLocaleLowerCase('en'))
    if (isNew && !quiet.has(key)) {
      result.event = {
        kind: 'call' as TriggerKind,
        reason: `call:${allowedMic.exe}`,
        title: labelForExe(allowedMic.exe, allowedApps),
        app: allowedMic.exe,
        detectedAt: nowIso()
      }
      return result
    }
  }

  // --- KURAL B: UYGULAMA (kenar: uygulama YENI ACILDI) --------------------
  if (appEnabled && allowedProc) {
    const key = appDedupeKey(`${allowedProc.name}.exe`)
    const isNewProc = !prevProcs.has(allowedProc.name.toLocaleLowerCase('en'))
    if (isNewProc && !quiet.has(key)) {
      result.event = {
        kind: 'app' as TriggerKind,
        reason: `app:${allowedProc.name}.exe`,
        title: labelForExe(`${allowedProc.name}.exe`, allowedApps),
        app: `${allowedProc.name}.exe`,
        detectedAt: nowIso()
      }
      return result
    }
  }

  return result
}

/** exe -> kullaniciya gosterilecek ad (izin listesindeki etiket tercih edilir). */
export function labelForExe(exe: string, allowedApps: string[]): string {
  const match = allowedApps.find((a) => exeMatchesLabel(exe, a))
  if (match) return match
  const base = basename(exe)
  return base.replace(/\.exe$/i, '')
}

export interface AliveCheck {
  alive: boolean
  reason: 'no-trigger-app' | 'process-missing' | 'mic-inactive' | 'ok'
  processCount: number
  activeMicCount: number
}

/**
 * Kaydi tetikleyen uygulama/gorusme hala "canli" mi?
 *  - exe surecte var mi? (uygulama kapanmasi)
 *  - mic tabanli tetiklemede: uygulama hala mikrofonu kullaniyor mu? (gorusme bitti)
 */
export function checkTriggerAlive(
  triggerApp: string | null,
  kind: TriggerKind | null,
  snapshot: { micUsers: MicUser[]; processes: ProcessInfo[] }
): AliveCheck {
  const base = {
    processCount: snapshot.processes.length,
    activeMicCount: snapshot.micUsers.filter((m) => m.active).length
  }
  if (!triggerApp) return { alive: true, reason: 'no-trigger-app', ...base }

  const inProcesses = snapshot.processes.some(
    (p) => exeMatchesLabel(`${p.name}.exe`, triggerApp) || exeMatchesLabel(triggerApp, `${p.name}.exe`)
  )
  if (!inProcesses) return { alive: false, reason: 'process-missing', ...base }

  if (kind === 'call') {
    const micActive = snapshot.micUsers.some((m) => m.active && exeMatchesLabel(m.exe, triggerApp))
    if (!micActive) return { alive: false, reason: 'mic-inactive', ...base }
  }
  return { alive: true, reason: 'ok', ...base }
}

export function triggerStillAlive(
  triggerApp: string | null,
  kind: TriggerKind | null,
  snapshot: { micUsers: MicUser[]; processes: ProcessInfo[] }
): boolean {
  return checkTriggerAlive(triggerApp, kind, snapshot).alive
}