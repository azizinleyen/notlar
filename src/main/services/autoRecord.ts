// ============================================================================
//  FAZ 3 - Otomatik kayit orkestrasyonu.
//
//  Akis:
//    [Tetikleyici]  (takvim zamani | mikrofon kullanimi | uygulama acilisi)
//          |
//          v
//    handleTrigger(): not olustur -> bildirim penceresi ("Kayit basladi --
//          Duraklat / Iptal") -> renderer'a 'autoStart' komutu
//          |
//          v
//    renderer ses kaynaklarini acar ve recordingStart IPC'sini cagirir
//          |
//          v
//    watchdog (2 sn): yanlis tetikleme korumasi / sessizlikte durdurma /
//          uygulama kapaninca durdurma
// ============================================================================

import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { IPC, type Channel, type RecorderCommand, type RecordingStartRequest, type TriggerEvent, type TriggerKind } from '@shared/types'
import * as repo from '../db/repo'
import type { RecordingNotifier, NotifyAction } from '../notify/window'
import type { TriggerDetector } from '../detect'
import { appDedupeKey, checkTriggerAlive } from '../detect/rules'
import { linkAttendeesOnly } from './people'

/** Renderer kaydi baslatmazsa bu sure sonunda vazgecilir */
const RENDERER_START_TIMEOUT_MS = 20_000
const TICK_MS = 2000

interface Pending {
  noteId: string
  title: string
  createdAt: number
}

interface ActiveState {
  noteId: string
  title: string
  reason: string
  kind: TriggerKind
  triggerApp: string | null
  triggerKey: string | null
  auto: boolean
  startedAt: number
  lastActivityAt: number
  transcriptCount: number
  paused: boolean
}

export interface AutoRecordDeps {
  db: Database.Database
  getMainWindow: () => BrowserWindow | null
  notifier: RecordingNotifier
  detector: TriggerDetector
  log?: (m: string) => void
}

/** Tetiklemeyi kullaniciya anlatan kisa metin. */
function describeTrigger(t: TriggerEvent): string {
  const label = t.app ? t.app.replace(/\.exe$/i, '') : ''
  if (t.kind === 'call') return `${label} görüşme başlattı`
  if (t.kind === 'app') return `${label} açıldı`
  return 'Takvim etkinliği başladı'
}

export class AutoRecordManager {
  private pending: Pending | null = null
  private state: ActiveState | null = null
  private timer: NodeJS.Timeout | null = null
  private lastTrigger: TriggerEvent | null = null

  constructor(private deps: AutoRecordDeps) {}

  private log(msg: string): void {
    this.deps.log?.(msg)
  }

  get isBusy(): boolean {
    return Boolean(this.state || this.pending)
  }

  /** Teshis: gozcunun ic durumu (Ayarlar > Tanilama). */
  debugState(): Record<string, unknown> {
    const st = this.state
    const now = Date.now()
    return {
      pending: this.pending
        ? { noteId: this.pending.noteId, ageMs: now - this.pending.createdAt }
        : null,
      active: st
        ? {
            noteId: st.noteId,
            auto: st.auto,
            paused: st.paused,
            kind: st.kind,
            triggerApp: st.triggerApp,
            elapsedMs: now - st.startedAt,
            idleMs: now - st.lastActivityAt,
            transcriptCount: st.transcriptCount
          }
        : null,
      timerRunning: this.timer !== null
    }
  }

  get activeNoteId(): string | null {
    return this.state?.noteId ?? this.pending?.noteId ?? null
  }

  // -----------------------------------------------------------------------
  //  1) Tetikleme -> not olustur, bildir, renderer'i baslat
  // -----------------------------------------------------------------------
  async handleTrigger(t: TriggerEvent): Promise<void> {
    if (this.isBusy) {
      this.log(`[auto] zaten meşgul, tetikleme yok sayildi: ${t.reason}`)
      return
    }

    const { db } = this.deps
    const settings = repo.getAllSettings(db)

    const source = t.kind === 'calendar' ? 'calendar' : 'call'
    const noteId = repo.createNote(db, { title: t.title, source, status: 'recording' })
    repo.setNoteTriggerReason(db, noteId, t.reason)

    if (t.kind === 'calendar' && t.calendarEventId) {
      repo.linkNoteToCalendarEvent(db, noteId, t.calendarEventId, t.title)
    }
    // Takvim katilimcilarini kisi olarak yaz (delil + sirket cikarimi ile).
    // Faz 5: sirketler e-posta alan adindan turetilir, delil kaydedilir.
    if (t.participants && t.participants.length > 0) {
      linkAttendeesOnly(db, noteId, t.participants)
    }

    this.lastTrigger = t
    this.pending = { noteId, title: t.title, createdAt: Date.now() }
    this.ensureTimer()

    // Bildirim: "Kayit basladi -- Duraklat / Iptal"
    this.deps.notifier.show({
      visible: true,
      noteId,
      title: 'Kayıt başladı',
      subtitle: `${describeTrigger(t)} • ${t.title}`,
      status: 'recording',
      startedAt: Date.now(),
      tone: 'record'
    })

    const command = {
      noteId,
      title: t.title,
      reason: t.reason,
      triggerApp: t.app,
      language: settings.language,
      micEnabled: true,
      systemEnabled: Boolean(settings.record_system_audio)
    }

    this.sendToRenderer(IPC.triggerAutoStart, command)
    this.log(`[auto] tetiklendi -> not ${noteId} (${describeTrigger(t)})`)
  }

  // -----------------------------------------------------------------------
  //  2) Renderer kaydi gercekten baslatti
  // -----------------------------------------------------------------------
  onRendererStarted(req: RecordingStartRequest): void {
    const pending = this.pending
    this.pending = null

    const kind: TriggerKind = pending && this.lastTrigger ? this.lastTrigger.kind : 'app'
    this.state = {
      noteId: req.noteId,
      title: pending?.title ?? 'Kayıt',
      reason: req.reason ?? '',
      kind,
      triggerApp: req.triggerApp ?? null,
      // Soguma anahtari UYGULAMA bazli: arama kaydi bittikten sonra ayni uygulama
      // icin uygulama tetiklemesi ateslenmesin (bkz. test-rules.mts).
      triggerKey: appDedupeKey(req.triggerApp ?? req.reason ?? null) || null,
      auto: Boolean(req.auto),
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      transcriptCount: 0,
      paused: false
    }
    this.deps.notifier.update({ status: 'recording', noteId: req.noteId })
    this.log(`[auto] renderer kaydi baslatti: ${req.noteId} (auto=${req.auto})`)
  }

  /** Renderer'in duraklat/devam durumu bildirimi */
  setPaused(paused: boolean): void {
    if (!this.state) return
    this.state.paused = paused
    this.state.lastActivityAt = Date.now()
    this.deps.notifier.update({ status: paused ? 'paused' : 'recording' })
  }

  // -----------------------------------------------------------------------
  //  3) Transkript uretildi -> sessizlik sayaci sifirlanir
  // -----------------------------------------------------------------------
  onSegments(noteId: string, count: number): void {
    if (!this.state || this.state.noteId !== noteId) return
    if (count > 0) {
      this.state.transcriptCount += count
      this.state.lastActivityAt = Date.now()
    }
  }

  // -----------------------------------------------------------------------
  //  4) Kayit bitti / iptal edildi
  // -----------------------------------------------------------------------
  onRendererStopped(noteId: string | null): void {
    const key = this.state?.triggerKey ?? null
    if (key) {
      const settings = repo.getAllSettings(this.deps.db)
      this.deps.detector.quietKey(key, Math.max(10, settings.trigger_cooldown_seconds) * 1000)
    }
    if (this.pending && (!noteId || this.pending.noteId === noteId)) {
      this.pending = null
    }
    if (this.state && (!noteId || this.state.noteId === noteId)) {
      this.state = null
    }
    this.deps.notifier.hide()
    this.stopTimerIfIdle()
    this.log('[auto] kayit durumu temizlendi')
  }

  // -----------------------------------------------------------------------
  //  5) Bildirim penceresi eylemleri
  // -----------------------------------------------------------------------
  handleAction(action: NotifyAction): void {
    const noteId = this.deps.notifier.noteId
    this.log(`[auto] bildirim eylemi: ${action}`)

    if (action === 'open') {
      const win = this.deps.getMainWindow()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        if (noteId) win.webContents.send(IPC.noteFocus, noteId)
      }
      this.deps.notifier.hide()
      // Kayit surer; ana penceredeki kayit cubugu kontrolu devralir
      return
    }

    if (action === 'pause') {
      this.sendToRenderer(IPC.recorderCommand, 'pause' satisfies RecorderCommand)
      return
    }
    if (action === 'resume') {
      this.sendToRenderer(IPC.recorderCommand, 'resume' satisfies RecorderCommand)
      return
    }
    if (action === 'stop') {
      this.sendToRenderer(IPC.recorderCommand, 'stop' satisfies RecorderCommand)
      this.deps.notifier.hide()
      return
    }
    if (action === 'cancel') {
      this.sendToRenderer(IPC.recorderCommand, 'cancel' satisfies RecorderCommand)
      this.deps.notifier.hide()
    }
  }

  /** Uygulama kapanirken */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.deps.notifier.destroy()
  }

  // -----------------------------------------------------------------------
  //  watchdog
  // -----------------------------------------------------------------------
  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  private stopTimerIfIdle(): void {
    if (this.pending || this.state) return
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async cancelNote(noteId: string, message: string): Promise<void> {
    const detail = repo.getNoteDetail(this.deps.db, noteId)
    if (!detail || detail.transcripts.length === 0) {
      repo.deleteNote(this.deps.db, noteId)
    } else {
      repo.setNoteStatus(this.deps.db, noteId, 'ready')
    }
    this.log(`[auto] ${message}`)
    this.deps.notifier.hide()
    this.sendToRenderer(IPC.recorderCommand, 'cancel' satisfies RecorderCommand)
    this.sendToRenderer(IPC.appToast, { kind: 'info', message, noteId })
    this.pending = null
    this.state = null
    this.stopTimerIfIdle()
  }

  private async tick(): Promise<void> {
    try {
      await this.tickInner()
    } catch (err) {
      this.log('[auto] gozcu hatasi: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  private async tickInner(): Promise<void> {
    const { db } = this.deps
    const settings = repo.getAllSettings(db)

    // (a) Renderer kaydi hic baslatmadi -> vazgec
    if (this.pending && Date.now() - this.pending.createdAt > RENDERER_START_TIMEOUT_MS) {
      const p = this.pending
      this.log('[auto] renderer zamaninda baslatmadi, iptal ediliyor')
      await this.cancelNote(p.noteId, 'Kayıt başlatılamadı')
      return
    }

    const st = this.state
    if (!st) return

    const elapsed = Date.now() - st.startedAt
    const idle = Date.now() - st.lastActivityAt

    // (b) YANLIS TETIKLEME KORUMASI: ilk N saniyede hic ses/transkript yoksa iptal
    if (
      st.auto &&
      st.transcriptCount === 0 &&
      settings.auto_cancel_empty_seconds > 0 &&
      elapsed > settings.auto_cancel_empty_seconds * 1000
    ) {
      await this.cancelNote(st.noteId, 'Ses algılanmadı, kayıt iptal edildi')
      return
    }

    // (c) SESSIZLIK: uzun sure ses gelmezse durdur
    if (
      st.auto &&
      !st.paused &&
      settings.auto_stop_silence_seconds > 0 &&
      idle > settings.auto_stop_silence_seconds * 1000
    ) {
      this.log(`[auto] ${settings.auto_stop_silence_seconds} sn sessizlik, durduruluyor`)
      this.deps.notifier.update({
        visible: true,
        title: 'Kayıt durduruldu',
        subtitle: 'Sessizlik algılandı • not hazırlanıyor',
        tone: 'info'
      })
      this.sendToRenderer(IPC.recorderCommand, 'stop' satisfies RecorderCommand)
      return
    }

    // (d) UYGULAMA KAPANDI: kaydi tetikleyen uygulama/gorusme ortadan kalkti.
    // En az 3 sn beklenir; boylece uygulama listesi henuz tazelenmemisken
    // yanlislikla durdurma yapilmaz.
    if (st.auto && st.triggerApp && settings.auto_stop_on_app_close && elapsed > 3000) {
      const snapshot = this.deps.detector.snapshot
      if (snapshot) {
        const check = checkTriggerAlive(st.triggerApp, st.kind, snapshot)
        if (!check.alive) {
          this.log(
            `[auto] kaynak kayboldu (neden=${check.reason}, procs=${check.processCount}, aktifMic=${check.activeMicCount}, transkript=${st.transcriptCount})`
          )
        }
        if (!check.alive) {
        if (st.transcriptCount === 0) {
          // Hic konusma olmadan kaynak kayboldu -> yanlis tetikleme, notu sil
          await this.cancelNote(st.noteId, 'Kaynak kapandı, kayıt iptal edildi')
        } else {
          this.log(`[auto] ${st.triggerApp} kapandi/gorusme bitti, durduruluyor`)
          this.sendToRenderer(IPC.recorderCommand, 'stop' satisfies RecorderCommand)
        }
        }
      }
    }
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    const win = this.deps.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export type { Channel }