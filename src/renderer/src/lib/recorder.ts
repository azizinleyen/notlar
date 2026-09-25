// ============================================================================
//  Canli kayit yoneticisi (FAZ 2)
//
//  Iki bagimsiz kanal yakalar:
//    mic    -> mikrofon  : BEN        (yesil balon, sagda)
//    system -> loopback  : KARSI TARAF(gri balon, solda)
//
//  Akis: MediaStream -> ScriptProcessorNode -> ~5 sn'lik PCM16 (16 kHz) ->
//        main surece gonderilir -> STT -> transkript satirlari.
//
//  Ham ses hicbir yerde TUTULMAZ; yalnizca bellekte bir sonraki parca gonderilene
//  kadar bekler. Diske yazan tek sey main taraftaki gecici WAV'dir (islem sonunda silinir).
//
//  Not: ScriptProcessorNode "deprecated" olarak isaretlidir ama Chromium 130'da
//  sorunsuz calisir ve tek dosyalik kurulum saglar. Ileride AudioWorklet'e
//  tasinabilir (durum makinesi ayni kalir).
// ============================================================================

import type { Channel } from '@shared/types'
import { levelToBar, resampleFloat, rmsFloat, toInt16 } from './audio'

const TARGET_RATE = 16000

export interface CaptureCallbacks {
  onChunk: (channel: Channel, pcm16: Int16Array, offsetMs: number, seq: number) => Promise<void>
  onLevel: (channel: Channel, bar: number) => void
  onError?: (channel: Channel, message: string) => void
}

interface CaptureConfig {
  chunkMs: number
  minChunkMs: number
  silenceRms: number
  tailCheckMs: number
}

class ChannelCapture {
  readonly channel: Channel
  private ctx: AudioContext
  private cfg: CaptureConfig
  private cb: CaptureCallbacks

  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null

  private pending: Float32Array[] = []
  private pendingCount = 0
  private arrivedSamples = 0
  private seq = 0
  private rawLevel = 0
  private busy = false
  private paused = false
  private inFlight: Promise<void> | null = null

  constructor(channel: Channel, ctx: AudioContext, cfg: CaptureConfig, cb: CaptureCallbacks) {
    this.channel = channel
    this.ctx = ctx
    this.cfg = cfg
    this.cb = cb
  }

  attach(stream: MediaStream): void {
    this.source = this.ctx.createMediaStreamSource(stream)
    // 4096 ornek ≈ 85 ms @48k: makul gecikme, dusuk CPU.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (ev: AudioProcessingEvent): void => {
      if (this.paused) return
      const input = ev.inputBuffer.getChannelData(0)
      const copy = new Float32Array(input.length)
      copy.set(input)
      this.pending.push(copy)
      this.pendingCount += copy.length
      this.arrivedSamples += copy.length
      this.rawLevel = rmsFloat(copy)
    }
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0 // duyulmasin; yalnizca grafigin calismasi icin gerekli
    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  setPaused(v: boolean): void {
    this.paused = v
    if (v) this.rawLevel = 0
  }

  /** Metre degeri (0..1) */
  level(): number {
    return this.paused ? 0 : levelToBar(this.rawLevel)
  }

  private takePending(): Float32Array {
    if (this.pending.length === 0) return new Float32Array(0)
    let total = 0
    for (const p of this.pending) total += p.length
    const merged = new Float32Array(total)
    let at = 0
    for (const p of this.pending) {
      merged.set(p, at)
      at += p.length
    }
    this.pending = []
    this.pendingCount = 0
    return merged
  }

  /** Parcanin son ~tailCheckMs'i sessiz mi? (erken flush karari) */
  private tailSilent(srcRate: number): boolean {
    const tailLen = Math.floor((this.cfg.tailCheckMs / 1000) * srcRate)
    if (this.pendingCount < tailLen || tailLen === 0) return false
    let need = tailLen
    let sum = 0
    let count = 0
    for (let i = this.pending.length - 1; i >= 0 && need > 0; i--) {
      const arr = this.pending[i]
      const take = Math.min(arr.length, need)
      for (let j = arr.length - take; j < arr.length; j++) {
        sum += arr[j] * arr[j]
        count++
      }
      need -= take
    }
    return count > 0 && Math.sqrt(sum / count) < this.cfg.silenceRms
  }

  /**
   * Parca gonderim kararini verir ve gerekirse gonderir.
   * `force` = kayit durduruluyor, kalan ses hemen islenir.
   */
  async tick(force = false): Promise<void> {
    if (this.busy) return
    const srcRate = this.ctx.sampleRate
    const pendingMs = (this.pendingCount / srcRate) * 1000
    if (pendingMs < (force ? 200 : this.cfg.minChunkMs)) return
    if (!force && pendingMs < this.cfg.chunkMs && !this.tailSilent(srcRate)) return

    const merged = this.takePending()
    if (merged.length === 0) return

    // Sessiz parcayi hic gonderme: hem API kotasini hem halusinasyonu onler.
    if (rmsFloat(merged) < this.cfg.silenceRms) {
      if (force) this.cb.onLevel(this.channel, 0)
      return
    }

    const startSample = this.arrivedSamples - merged.length
    const offsetMs = Math.round((startSample / srcRate) * 1000)
    const resampled = resampleFloat(merged, srcRate, TARGET_RATE)
    const pcm16 = toInt16(resampled)
    this.seq += 1

    this.busy = true
    this.inFlight = (async () => {
      try {
        await this.cb.onChunk(this.channel, pcm16, offsetMs, this.seq)
      } catch (err) {
        this.cb.onError?.(this.channel, err instanceof Error ? err.message : String(err))
      } finally {
        this.busy = false
        this.inFlight = null
      }
    })()
    await this.inFlight
  }

  /** Bekleyen sesi gonder(me)den atar (iptal yolu). */
  discardPending(): void {
    this.pending = []
    this.pendingCount = 0
    this.rawLevel = 0
  }

  async drain(): Promise<void> {
    if (this.inFlight) await this.inFlight.catch(() => undefined)
  }

  destroy(): void {
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
      this.sink?.disconnect()
    } catch {
      /* yoksay */
    }
    if (this.processor) this.processor.onaudioprocess = null
    this.processor = null
    this.source = null
    this.sink = null
  }
}

export interface StartOptions {
  micStream: MediaStream | null
  systemStream: MediaStream | null
  chunkMs?: number
  minChunkMs?: number
  silenceRms?: number
  onChunk: CaptureCallbacks['onChunk']
  onLevel: CaptureCallbacks['onLevel']
  onError?: CaptureCallbacks['onError']
}

export class LiveRecorder {
  private ctx: AudioContext | null = null
  private captures: ChannelCapture[] = []
  private timer: number | null = null
  private streams: MediaStream[] = []
  private pausedFlag = false
  private accumulatedMs = 0
  private resumedAt = 0
  private active = false

  get channels(): Channel[] {
    return this.captures.map((c) => c.channel)
  }

  get isActive(): boolean {
    return this.active
  }

  get isPaused(): boolean {
    return this.pausedFlag
  }

  /** Kayit suresi (duraklatilan sureler sayilmaz) */
  elapsedMs(): number {
    if (!this.active) return this.accumulatedMs
    if (this.pausedFlag) return this.accumulatedMs
    return this.accumulatedMs + (Date.now() - this.resumedAt)
  }

  levels(): Record<Channel, number> {
    const out: Record<Channel, number> = { mic: 0, system: 0 }
    for (const c of this.captures) out[c.channel] = c.level()
    return out
  }

  async start(opts: StartOptions): Promise<Channel[]> {
    if (this.active) throw new Error('Kayit zaten suruyor')

    const cfg: CaptureConfig = {
      chunkMs: opts.chunkMs ?? 5000,
      minChunkMs: opts.minChunkMs ?? 1500,
      silenceRms: opts.silenceRms ?? 0.004,
      tailCheckMs: 700
    }
    const cb: CaptureCallbacks = {
      onChunk: opts.onChunk,
      onLevel: opts.onLevel,
      onError: opts.onError
    }

    // Tum kanallar ayni AudioContext'i paylasir: ornekleme hizi tek, senkron kolay.
    this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    if (opts.micStream) {
      const c = new ChannelCapture('mic', this.ctx, cfg, cb)
      c.attach(opts.micStream)
      this.captures.push(c)
      this.streams.push(opts.micStream)
    }
    if (opts.systemStream) {
      const c = new ChannelCapture('system', this.ctx, cfg, cb)
      c.attach(opts.systemStream)
      this.captures.push(c)
      this.streams.push(opts.systemStream)
    }
    if (this.captures.length === 0) throw new Error('Hicbir ses kanali acilamadi')

    this.pausedFlag = false
    this.accumulatedMs = 0
    this.resumedAt = Date.now()
    this.active = true

    // Parca kontrolu ve seviye metresi ayni zamanlayicidan beslenir.
    this.timer = window.setInterval(() => {
      for (const c of this.captures) {
        void c.tick(false)
        cb.onLevel(c.channel, c.level())
      }
    }, 150)

    return this.channels
  }

  pause(): void {
    if (!this.active || this.pausedFlag) return
    this.accumulatedMs += Date.now() - this.resumedAt
    this.pausedFlag = true
    for (const c of this.captures) c.setPaused(true)
  }

  resume(): void {
    if (!this.active || !this.pausedFlag) return
    this.pausedFlag = false
    this.resumedAt = Date.now()
    for (const c of this.captures) c.setPaused(false)
  }

  /**
   * Kaydi bitirir ve kaynaklari kapatir.
   * @param opts.flush true (varsayilan): bekleyen ses son bir parca olarak islenir (Durdur).
   *                   false: bekleyen ses ATILIR (Iptal) — boylece iptal edilen kayittan
   *                   transkript olusmaz ve bos not silinebilir.
   */
  async stop(opts?: { flush?: boolean }): Promise<void> {
    if (!this.active) return
    const flush = opts?.flush ?? true
    if (!this.pausedFlag) this.accumulatedMs += Date.now() - this.resumedAt
    this.active = false

    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }

    // Bekleyen sesi gonder (duraklatilmissa veya iptal ediliyorsa gonderilmez).
    if (flush && !this.pausedFlag) {
      for (const c of this.captures) await c.tick(true)
      for (const c of this.captures) await c.drain()
    } else {
      for (const c of this.captures) c.discardPending()
    }

    for (const c of this.captures) c.destroy()
    this.captures = []
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop())
    this.streams = []
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }
}

let singleton: LiveRecorder | null = null

export function getRecorder(): LiveRecorder {
  if (!singleton) singleton = new LiveRecorder()
  return singleton
}