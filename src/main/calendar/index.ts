// ============================================================================
//  Takvim katmani: ICS kaynagini oku -> calendar_events_cache'e yaz -> saat
//  gelince tetikle.
//
//  Desteklenen kaynaklar (hepsi SALT OKUNUR):
//    - https://... .ics   (Google "gizli iCal adresi", Outlook "takvimi yayinla")
//    - webcal://...       (https'e cevrilir)
//    - Yerel dosya yolu   (C:\...\takvim.ics — disa aktarilmis/indirilmis takvim)
// ============================================================================

import { readFileSync, statSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { CalendarSyncResult, TriggerEvent } from '@shared/types'
import * as repo from '../db/repo'
import { parseIcsWindow } from './ics'

const PAST_DAYS = 1
const FUTURE_DAYS = 30
const PRUNE_OLDER_THAN_DAYS = 3
/** Etkinlik baslangicindan sonra bu kadar sure icinde hala tetiklenebilir (gec kalma payi) */
export const LATE_GRACE_MS = 2 * 60 * 1000

/** webcal:// -> https:// (ICS abonelik baglantilari boyle gelir) */
export function normalizeSource(source: string): string {
  const s = (source ?? '').trim()
  if (s.toLowerCase().startsWith('webcal://')) {
    return 'https://' + s.slice('webcal://'.length)
  }
  return s
}

export function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(normalizeSource(source))
}

export async function fetchIcsText(source: string): Promise<string> {
  const s = normalizeSource(source)
  if (!s) throw new Error('Takvim kaynagi tanimli degil (Ayarlar > Takvim)')
  if (isRemoteSource(s)) {
    const res = await fetch(s, {
      headers: { 'User-Agent': 'Notlar/0.1 (kisisel takvim, salt okunur)' },
      redirect: 'follow'
    })
    if (!res.ok) throw new Error(`Takvim indirilemedi: HTTP ${res.status} ${res.statusText}`)
    return await res.text()
  }
  if (!statSync(s, { throwIfNoEntry: false })) {
    throw new Error('Takvim dosyasi bulunamadi: ' + s)
  }
  return readFileSync(s, 'utf-8')
}

/** ICS'i indirir, ayristirir ve onbellege yazar. */
export async function syncCalendar(
  db: Database.Database,
  source: string
): Promise<CalendarSyncResult> {
  const src = normalizeSource(source)
  if (!src) return { ok: false, source: '', fetched: 0, stored: 0, upcoming: 0, error: 'Kaynak bos' }

  try {
    const text = await fetchIcsText(src)
    const now = new Date()
    const from = new Date(now.getTime() - PAST_DAYS * 86400000)
    const to = new Date(now.getTime() + FUTURE_DAYS * 86400000)

    const parsed = parseIcsWindow(text, from, to)

    const stored = repo.upsertCalendarEvents(
      db,
      parsed.map((e) => ({
        id: e.uid,
        calendarId: null,
        title: e.title,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
        location: e.location,
        description: e.description,
        participants: e.attendees,
        organizer: e.organizer,
        allDay: e.allDay
      }))
    )

    repo.pruneCalendarEvents(
      db,
      new Date(now.getTime() - PRUNE_OLDER_THAN_DAYS * 86400000).toISOString()
    )

    const upcoming = repo.listUpcomingCalendarEvents(db, now.toISOString(), 100).length
    return { ok: true, source: src, fetched: parsed.length, stored, upcoming }
  } catch (err) {
    return {
      ok: false,
      source: src,
      fetched: 0,
      stored: 0,
      upcoming: repo.countCalendarEvents(db),
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

// ---------------------------------------------------------------------------
//  Zamanlayici: etkinlik saati gelince tetikleme olayi uretir.
// ---------------------------------------------------------------------------

export interface CalendarSchedulerDeps {
  db: Database.Database
  onTrigger: (e: TriggerEvent) => void
  /** Senkron tamamlaninca cagrilir (arayuz takvimi tazeleyebilsin) */
  onSynced?: (result: CalendarSyncResult) => void
  isRecordingActive: () => boolean
  log?: (m: string) => void
}

export class CalendarScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastSyncAt = 0
  private busy = false

  constructor(private deps: CalendarSchedulerDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 20_000)
    // Ilk tur hemen: uygulama acilirken bugunun etkinlikleri yuklenmis olsun
    setTimeout(() => void this.tick(), 3_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private log(msg: string): void {
    this.deps.log?.(msg)
  }

  /** Elle "simdi senkronize et" */
  async syncNow(): Promise<CalendarSyncResult> {
    const settings = repo.getAllSettings(this.deps.db)
    const res = await syncCalendar(this.deps.db, settings.calendar_source)
    this.lastSyncAt = Date.now()
    return res
  }

  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const { db } = this.deps
      const settings = repo.getAllSettings(db)

      // 1) Periyodik senkron (kaynak tanimliysa)
      const intervalMs = Math.max(1, settings.calendar_sync_minutes) * 60_000
      if (settings.calendar_source && Date.now() - this.lastSyncAt > intervalMs) {
        this.lastSyncAt = Date.now()
        const res = await syncCalendar(db, settings.calendar_source)
        if (res.ok) {
          this.log(`[calendar] senkron: ${res.fetched} etkinlik, ${res.upcoming} yaklasan`)
          this.deps.onSynced?.(res)
        } else if (res.error) {
          this.log(`[calendar] senkron hatasi: ${res.error}`)
        }
      }

      // 2) Tetikleme
      if (settings.auto_start_calendar === 'off') return

      const now = new Date()
      const from = new Date(now.getTime() - LATE_GRACE_MS)
      const due = repo.findDueCalendarEvents(db, from.toISOString(), now.toISOString())

      for (const ev of due) {
        // Tum gun etkinlikleri toplanti degildir; isaretle ve gec.
        if (ev.all_day) {
          repo.markCalendarEventTriggered(db, ev.id)
          continue
        }
        // "sadece katilimcili toplantilar" kurali
        if (settings.auto_start_calendar === 'participants' && ev.participants.length === 0) {
          repo.markCalendarEventTriggered(db, ev.id)
          this.log(`[calendar] atlandi (katilimci yok): ${ev.title}`)
          continue
        }
        // Zaten kayit suruyorsa bu etkinligi isaretleme; grace suresi gecince
        // tekrar degerlendirilmez.
        if (this.deps.isRecordingActive()) {
          this.log(`[calendar] kayit suruyor, atlandi: ${ev.title}`)
          continue
        }

        repo.markCalendarEventTriggered(db, ev.id)
        this.deps.onTrigger({
          kind: 'calendar',
          reason: `calendar:${ev.id}`,
          title: ev.title,
          calendarEventId: ev.id,
          participants: ev.participants,
          detectedAt: new Date().toISOString()
        })
        this.log(`[calendar] TETIKLENDI: ${ev.title}`)
        break // tek seferde bir kayit
      }
    } catch (err) {
      this.log('[calendar] tick hatasi: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      this.busy = false
    }
  }
}