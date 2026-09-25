// ============================================================================
//  Tetikleme algilayicisi.
//
//  Yalnizca otomatik baslatma ACIKKEN ve 4 sn'de bir calisir; boylece
//  kapaliyken hicbir sistem maliyeti olmaz.
//
//  Tek kaynak PowerShell taramasi (mikrofon kullanicilari + surecler) hem
//  tetikleme karari hem de "kaydi tetikleyen uygulama hala acik mi" kontrolu
//  icin kullanilir.
// ============================================================================

import type Database from 'better-sqlite3'
import type { DetectSnapshot, TriggerEvent } from '@shared/types'
import * as repo from '../db/repo'
import { takeSnapshot } from './snapshot'
import { appDedupeKey, evaluateSnapshot, type DetectResult } from './rules'

const POLL_MS = 4000

export interface TriggerDetectorDeps {
  db: Database.Database
  onTrigger: (e: TriggerEvent) => void
  isRecordingActive: () => boolean
  log?: (m: string) => void
}

export class TriggerDetector {
  private timer: NodeJS.Timeout | null = null
  private lastSnapshot: DetectSnapshot | null = null
  private prevActiveMicPaths: string[] = []
  private prevProcessNames: string[] = []
  private quietUntil = new Map<string, number>()
  private busy = false
  private lastResult: DetectResult | null = null

  constructor(private deps: TriggerDetectorDeps) {}

  get snapshot(): DetectSnapshot | null {
    return this.lastSnapshot
  }

  get result(): DetectResult | null {
    return this.lastResult
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), POLL_MS)
    setTimeout(() => void this.tick(), 1500)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Bir tetikleyicinin tekrar ateslemesini engelle (soguma suresi). */
  quiet(reason: string, ms: number): void {
    this.quietUntil.set(reason, Date.now() + ms)
  }

  /** Tekilleştirme anahtari: 'call:Zoom.exe' veya 'app:zoom.exe' */
  static keyForApp(exe: string, kind: 'call' | 'app'): string {
    return `${kind}:${exe}`
  }

  private isQuiet(key: string): boolean {
    const until = this.quietUntil.get(key)
    if (until === undefined) return false
    if (until < Date.now()) {
      this.quietUntil.delete(key)
      return false
    }
    return true
  }

  /** Disaridan (or. kayit bitince) sogumaya alma. */
  quietKey(key: string, ms: number): void {
    this.quietUntil.set(key, Date.now() + ms)
  }

  /** Tek tarama yapip degerlendirir (teshis ekrani da kullanir). */
  async probe(): Promise<DetectResult> {
    const { db } = this.deps
    const settings = repo.getAllSettings(db)
    const snapshot = await takeSnapshot()
    this.lastSnapshot = snapshot

    const result = evaluateSnapshot({
      micUsers: snapshot.micUsers,
      processes: snapshot.processes,
      allowedApps: settings.allowed_apps ?? [],
      prevActiveMicPaths: this.prevActiveMicPaths,
      prevProcessNames: this.prevProcessNames,
      recordingActive: this.deps.isRecordingActive(),
      quietKeys: new Set(
        [...this.quietUntil.entries()].filter(([, until]) => until > Date.now()).map(([k]) => k)
      ),
      callEnabled: Boolean(settings.auto_start_call),
      appEnabled: Boolean(settings.auto_start_apps)
    })
    this.lastResult = result
    return result
  }

  private async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const { db } = this.deps
      const settings = repo.getAllSettings(db)

      // Otomatik baslatma tamamen kapaliysa hic tarama yapma (sifir maliyet)
      if (!settings.auto_start_call && !settings.auto_start_apps) {
        this.lastSnapshot = null
        this.lastResult = null
        return
      }

      const result = await this.probe()

      const eventKey = appDedupeKey(result.event?.app ?? null)
      if (result.event && !(eventKey ? this.isQuiet(eventKey) : false)) {
        const cooldown = Math.max(10, settings.trigger_cooldown_seconds) * 1000
        if (eventKey) this.quiet(eventKey, cooldown)
        this.deps.log?.(`[detect] TETIKLENDI: ${result.event.reason} (${result.event.title})`)
        this.deps.onTrigger(result.event)
      }

      // Baseline: bir sonraki turda "yeni" ancak gercekten yeni olani yakalar
      this.prevActiveMicPaths = result.activeMicLabels
      this.prevProcessNames = result.processNames
    } catch (err) {
      this.deps.log?.('[detect] hata: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      this.busy = false
    }
  }
}