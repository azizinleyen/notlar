// ============================================================================
//  "Kayit basladi — Duraklat / Iptal" bildirimi.
//
//  NEDEN AYRI PENCERE: Electron'un Notification API'si Windows'ta EYLEM
//  DUYMELERINI (butonlari) desteklemez. Spesifikasyonun istedigi
//  "Duraklat / Iptal" etkilesimi icin cercevesiz, her zaman ustte kucuk bir
//  pencere kullaniyoruz (sag alt koseye yerlestirilir).
// ============================================================================

import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/types'
import type { NotifyState } from '@shared/types'

const WIDTH = 384
const HEIGHT = 140
const MARGIN = 20

export type NotifyAction = 'pause' | 'resume' | 'stop' | 'cancel' | 'open'

export class RecordingNotifier {
  private win: BrowserWindow | null = null
  private state: NotifyState | null = null

  constructor() {}

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      title: 'Kayit',
      webPreferences: {
        preload: join(__dirname, '../preload/notify.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // Ekran koruyucu seviyesinde: tam ekran toplanti penceresinin ustunde kalir
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/notify.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/notify.html'))
    }

    win.on('closed', () => {
      this.win = null
    })
    return win
  }

  private position(win: BrowserWindow): void {
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const area = display.workArea
      win.setPosition(
        Math.round(area.x + area.width - WIDTH - MARGIN),
        Math.round(area.y + area.height - HEIGHT - MARGIN)
      )
    } catch {
      /* yoksay */
    }
  }

  private push(): void {
    if (this.win && !this.win.isDestroyed() && this.state) {
      this.win.webContents.send(IPC.notifyState, this.state)
    }
  }

  show(payload: NotifyState): void {
    this.state = payload
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.createWindow()
      this.win.webContents.once('did-finish-load', () => {
        this.push()
        if (this.win && !this.win.isDestroyed()) {
          this.position(this.win)
          this.win.showInactive() // odagi calmadan goster
        }
      })
    } else {
      this.position(this.win)
      this.win.showInactive()
      this.push()
    }
  }

  update(patch: Partial<NotifyState>): void {
    if (!this.state) return
    this.state = { ...this.state, ...patch }
    this.push()
  }

  hide(): void {
    // Arayuzun de temizlenmesi icin once "gorunmez" durumunu gonder, sonra gizle
    if (this.state && this.win && !this.win.isDestroyed()) {
      this.state = { ...this.state, visible: false }
      this.push()
    }
    this.state = null
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide()
    }
  }

  destroy(): void {
    this.state = null
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }

  get visible(): boolean {
    return Boolean(this.state?.visible)
  }

  get noteId(): string | null {
    return this.state?.noteId ?? null
  }
}