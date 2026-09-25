import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { closeDatabase, getDb, initDatabase, lazyDb } from './db'
import * as repo from './db/repo'
import { makeApiKeyResolver, registerDisplayMediaHandler, registerIpcHandlers } from './ipc'
import { importAudioFile } from './services/importAudio'
import { simulateLive } from './dev/simulateLive'
import { CalendarScheduler } from './calendar'
import { TriggerDetector } from './detect'
import { RecordingNotifier } from './notify/window'
import { AutoRecordManager } from './services/autoRecord'
import { OsNotifier } from './notify/os'
import { checkEncryptionConsistency } from './services/security'
import { runCryptoTest } from './dev/cryptoTest'
import { IPC } from '@shared/types'
import type { RecordingEvent, TriggerEvent } from '@shared/types'

// ---------------------------------------------------------------------------
//  .env ARAMA SIRASI (gercek sorunun cozumu)
//
//  NEDEN: Kurulu .exe, proje kokundeki .env'i GOREMIYORDU. Paketlenmis
//  uygulamada `app.getAppPath()` = resources/app.asar oldugu icin orada .env
//  yok; `dotenv.config()` ise calisma klasorune bakiyordu. Sonuc: kurulu
//  surumde ne STT ne LLM anahtari bulunuyor, "API key yok" deniyordu.
//
//  Artik sirayla denenir (ilk bulunan kazanir, sonrakiler mevcut degerleri
//  EZMEZ — dotenv varsayilan davranisi):
//    1) proje koku            (.env)               -> gelistirme
//    2) kullanici profili     (%APPDATA%\notlar)  -> kurulu surum icin onerilen
//    3) calisma klasoru       (cwd/.env)           -> tasinabilir surum
//
//  NOT: Anahtari .env'e koymak ZORUNLU DEGIL; Ayarlar > AI not uretimi
//  bolumunden de girilebilir (ayarlar tablosuna yazilir, oncelik ondadir).
// ---------------------------------------------------------------------------
loadEnv({ path: join(app.getAppPath(), '.env') })          // 1) proje koku
try {
  loadEnv({ path: join(app.getPath('userData'), '.env') }) // 2) kullanici profili
} catch {
  /* userData henuz hazir degilse yoksay */
}
loadEnv()                                                  // 3) calisma klasoru

const log = (m: string): void => console.log(m)

let mainWindow: BrowserWindow | null = null
let pendingCliImport: string | null = null
let pendingSimulate: string | null = null
let pendingSimulateTrigger: string | null = null
let detectOnce = false

let notifier: RecordingNotifier
let detector: TriggerDetector
let autoRecord: AutoRecordManager
let scheduler: CalendarScheduler
let osNotifier: OsNotifier

function argValue(flag: string): string | null {
  const pref = `${flag}=`
  const hit = process.argv.find((a) => a.startsWith(pref))
  if (hit) return hit.slice(pref.length).trim().replace(/^"|"$/g, '')
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].trim()
  return null
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

/** Gelistirme/otomasyon: `electron . --import="C:\...\ses.wav"` */
async function runCliImport(filePath: string): Promise<void> {
  const db = getDb()
  const result = await importAudioFile(
    { db, apiKey: makeApiKeyResolver() },
    { filePath, channel: 'mic', language: 'auto' },
    (p) => {
      log(`[import:${p.stage}] ${p.message}${p.detail ? ' -> ' + p.detail : ''}`)
      const w = mainWindow
      if (w && !w.isDestroyed()) w.webContents.send(IPC.importProgress, p)
    }
  )
  log('[import] sonuc: ' + JSON.stringify(result).slice(0, 300))
}

/** Gelistirme: canli kaydi eldeki bir WAV ile simule eder. */
async function runSimulate(filePath: string): Promise<void> {
  const db = getDb()
  const send = (e: RecordingEvent): void => {
    const w = mainWindow
    if (w && !w.isDestroyed()) w.webContents.send(IPC.recordingEvent, e)
  }
  await simulateLive(
    { db, apiKey: makeApiKeyResolver() },
    { filePath, channel: 'mic', language: 'auto', onEvent: send, log: (m) => log('[sim] ' + m) }
  )
}

/**
 * Gelistirme/otomasyon: otomatik tetikleme akisini elle atesler.
 * `electron . --simulate-trigger=call` | `=calendar`
 * (Bildirim penceresi + renderer'in kaydi baslatmasi dahil TUM akis calisir.)
 */
async function runSimulateTrigger(kind: string): Promise<void> {
  const db = getDb()
  const isCal = kind === 'calendar'

  let event: TriggerEvent
  if (isCal) {
    const upcoming = repo.listUpcomingCalendarEvents(db, new Date(Date.now() - 3600_000).toISOString(), 1)
    const ev = upcoming[0]
    event = {
      kind: 'calendar',
      reason: `calendar:${ev?.id ?? 'manual-test'}`,
      title: ev?.title ?? 'Takvim tetiklemesi (test)',
      calendarEventId: ev?.id,
      participants: ev?.participants ?? ['Test Katılımcı'],
      detectedAt: new Date().toISOString()
    }
  } else {
    event = {
      kind: 'call',
      reason: 'call:Zoom.exe',
      title: 'Zoom',
      app: 'Zoom.exe',
      detectedAt: new Date().toISOString()
    }
  }
  log(`[test] tetikleme enjekte ediliyor: ${event.reason}`)
  await autoRecord.handleTrigger(event)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'Notlar',
    backgroundColor: '#f6f5f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // KRITIK: pencere arka planda/ikon halindeyken zamanlayicilar kisilmasin.
      // Kayit parcasi gonderen setInterval buna bagli; kapali olsa toplanti
      // sirasinda (pencere arkada) transkript akisi dururdu.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // CLI isleri, arayuz 'renderer:ready' sinyali verene kadar bekletilir.
  pendingCliImport = argValue('--import')
  pendingSimulate = argValue('--simulate-live')
  pendingSimulateTrigger = argValue('--simulate-trigger')
  detectOnce = hasFlag('--detect-once')
}

/**
 * TEK ORNEK KILIDI.
 *
 * NEDEN: Uygulama artik masaustu kisayolundan baslatiliyor; kullanici iki kez
 * tikladiginda (veya sabirsizca cift tikladiginda) IKINCI bir surec aciliyordu.
 * Iki surec ayni SQLite (SQLCipher) dosyasina yazar -> "database is locked",
 * yarim yazim ve WAL karisikligi riski. Tek kilitle ikinci baslatma mevcut
 * pencereyi one getirir.
 */
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('[app] zaten calisan bir ornek var; bu surec kapaniyor')
  app.quit()
}

app.on('second-instance', () => {
  const w = mainWindow
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
})

app.whenReady().then(() => {
  if (!gotTheLock) return
  initDatabase()
  registerDisplayMediaHandler()

  // Uzun omurlu bilesenler GEC RESOLVE eden referans alir: sifreleme
  // acma/kapama sonrasi da dogru baglantiya erisirler.
  const db = lazyDb()

  // --- FAZ 3 bilesenleri ---
  // Bildirim penceresi eylemleri IPC uzerinden gelir (bkz. ipc.ts -> notify:action)
  notifier = new RecordingNotifier()
  detector = new TriggerDetector({
    db,
    onTrigger: (e) => void autoRecord.handleTrigger(e),
    isRecordingActive: () => autoRecord.isBusy,
    log
  })
  autoRecord = new AutoRecordManager({
    db,
    getMainWindow: () => mainWindow,
    notifier,
    detector,
    log
  })

  scheduler = new CalendarScheduler({
    db,
    onTrigger: (e) => void autoRecord.handleTrigger(e),
    onSynced: (res) => {
      // Arka plan senkronu sonrasi arayuz takvimi tazelensin (yoksa sidebar
      // uygulama acilisindaki bos listeyle kalir).
      const w = mainWindow
      if (w && !w.isDestroyed()) w.webContents.send(IPC.calendarUpdated, res)
    },
    isRecordingActive: () => autoRecord.isBusy,
    log
  })

  ipcMain.handle(IPC.rendererReady, async () => {
    if (hasFlag('--db-crypto-test')) {
      runCryptoTest((m) => console.log(m))
    }

    // Arayuz hazir: algilayici + takvim zamanlayicisi baslasin
    detector.start()
    scheduler.start()

    if (detectOnce) {
      detectOnce = false
      const settings = repo.getAllSettings(db)
      const result = await detector.probe()
      log('[detect] ayarlar: call=' + settings.auto_start_call + ' app=' + settings.auto_start_apps)
      log('[detect] izin listesi: ' + JSON.stringify(settings.allowed_apps))
      log('[detect] aktif mikrofon kullanicilari: ' + JSON.stringify(result.activeMicLabels))
      log('[detect] izinli mic kullanicisi: ' + String(result.allowedMicUser))
      log('[detect] izinli uygulama: ' + String(result.allowedApp))
      log('[detect] tetikleme: ' + (result.event ? result.event.reason : 'yok'))
    }

    if (pendingCliImport) {
      const file = pendingCliImport
      pendingCliImport = null
      void runCliImport(file)
    }
    if (pendingSimulate) {
      const file = pendingSimulate
      pendingSimulate = null
      void runSimulate(file)
    }
    if (pendingSimulateTrigger) {
      const kind = pendingSimulateTrigger
      pendingSimulateTrigger = null
      setTimeout(() => void runSimulateTrigger(kind), 800)
    }
    return true
  })

  // --- FAZ 7: OS bildirimleri + CSP ---
  // Windows'ta bildirimlerin gorunmesi icin AppUserModelId ZORUNLU.
  try {
    app.setAppUserModelId('com.kisisel.notlar')
  } catch {
    /* yoksay */
  }
  osNotifier = new OsNotifier(() => mainWindow)
  {
    const settings = repo.getAllSettings(db)
    osNotifier.setEnabled(Boolean(settings.os_notifications))
    console.log(
      `[os] bildirim destegi=${osNotifier.isSupported} aktif=${settings.os_notifications}`
    )
  }

  // Icerik Guvenligi Politikasi: yerel uygulama, uzak kaynak YOK.
  // 'unsafe-inline' stiller icin gerekli (Tailwind + TipTap inline style uretir);
  // script icin GEREKLI DEGIL, bu yuzden script-src yalnizca 'self'.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "font-src 'self' data:; " +
            "media-src 'self' blob: mediastream:; " +
            "connect-src 'self' https://api.groq.com https://api.openai.com https://openrouter.ai https://api.anthropic.com ws://localhost:* http://localhost:*; " +
            "object-src 'none'; " +
            "base-uri 'none'; " +
            "form-action 'none'; " +
            "frame-ancestors 'none'"
        ]
      }
    })
  })

  // DIKKAT: IPC.settingsSet handler'i YALNIZCA ipc.ts'te kayitlidir.
  // Ikinci kez kaydetmek "Attempted to register a second handler" hatasi verip
  // registerIpcHandlers'i cokertiyordu (tum kanallar kayitdisi kaliyordu).
  // Turev durum senkronu, ipc.ts'in cagirdigi onSettingsChanged ile yapilir.
  registerIpcHandlers(() => mainWindow, {
    autoRecord,
    scheduler,
    detector,
    notifier,
    osNotifier,
    onSettingsChanged: (next) => osNotifier?.setEnabled(Boolean(next.os_notifications))
  })
  // Sifreleme tutarlilik kontrolu (sessiz bozulma yerine acik uyari)
  const cryptoCheck = checkEncryptionConsistency()
  if (!cryptoCheck.ok) console.error('[security] ' + cryptoCheck.message)
  else console.log('[security] sifreleme durumu tutarli')

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  try {
    detector?.stop()
    scheduler?.stop()
    autoRecord?.dispose()
    const stuck = repo.finalizeStuckRecordings(getDb())
    if (stuck > 0) log(`[db] ${stuck} yarim kayit 'ready' yapildi`)
  } catch {
    /* DB kapali olabilir */
  }
  closeDatabase()
})