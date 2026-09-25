// ============================================================================
//  FAZ 7 — Isletim sistemi bildirimleri.
//
//  NEDEN AYRI: Faz 3'teki bildirim penceresi "kayit basladi -- Duraklat/Iptal"
//  gibi EYLEM gerektiren durumlar icin. Buradaki ise eylem gerektirmeyen
//  bilgilendirmeler: "Notun hazir", "Kayit bitti", "Zenginlestirme hatasi".
//
//  Windows'ta:
//   - Bildirim gostermek icin app.setAppUserModelId() ZORUNLU, aksi halde
//     bildirim hic gorunmez (sessiz basarisizlik).
//   - Tiklama -> ana pencereyi one getir + ilgili notu ac.
// ============================================================================

import { Notification, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

export interface OsNotifyOptions {
  title: string
  body: string
  /** Tiklaninca acilacak not */
  noteId?: string | null
  silent?: boolean
}

export class OsNotifier {
  private enabled = true

  constructor(private getWindow: () => BrowserWindow | null) {}

  setEnabled(v: boolean): void {
    this.enabled = v
  }

  get isSupported(): boolean {
    try {
      return Notification.isSupported()
    } catch {
      return false
    }
  }

  show(opts: OsNotifyOptions): boolean {
    if (!this.enabled) return false
    try {
      if (!Notification.isSupported()) return false
      const n = new Notification({
        title: opts.title,
        body: opts.body.slice(0, 400),
        silent: opts.silent ?? false
      })
      n.on('click', () => {
        const w = this.getWindow()
        if (!w || w.isDestroyed()) return
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
        if (opts.noteId) w.webContents.send(IPC.noteFocus, opts.noteId)
      })
      n.show()
      return true
    } catch {
      return false
    }
  }
}