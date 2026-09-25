// ============================================================================
//  GELISTIRME ARACI: canli kaydi simule eder.
//  Gercek loopback yakalama olmadan, eldeki bir WAV dosyasini ~4 sn'lik
//  parcalara bolup AYNI canli transkripsiyon hattindan gecirir.
//  Boylece sema + STT + DB + arayuz canli akisi uctan uca dogrulanabilir.
//
//  Kullanim:  electron . --simulate-live="C:\yol\ses.wav"
// ============================================================================

import type { Channel, RecordingEvent } from '@shared/types'
import * as repo from '../db/repo'
import { downmixToMono, readWavPcm16, resampleLinear } from '../audio/wav'
import { resetLiveContext, transcribeLiveChunk, type RecordingDeps } from '../services/recording'

export interface SimulateOptions {
  filePath: string
  chunkSeconds?: number
  channel?: Channel
  language?: string
  onEvent: (e: RecordingEvent) => void
  log?: (msg: string) => void
}

export async function simulateLive(
  deps: RecordingDeps,
  opts: SimulateOptions
): Promise<{ noteId: string; chunks: number; segments: number }> {
  const { db } = deps
  const log = opts.log ?? ((): void => {})
  const chunkSeconds = opts.chunkSeconds ?? 4
  const channel: Channel = opts.channel ?? 'mic'
  const language = opts.language ?? 'auto'

  const wav = readWavPcm16(opts.filePath)
  const mono = downmixToMono(wav.pcm, wav.channels)
  const pcm = resampleLinear(mono, wav.sampleRate, 16000)
  log(`WAV okundu: ${(pcm.length / 16000).toFixed(1)} sn, ${wav.sampleRate} Hz -> 16000 Hz, kanal=${channel}`)

  const title = `Canli kayit (simulasyon) ${new Date().toLocaleTimeString('tr-TR')}`
  const noteId = repo.createNote(db, { title, source: 'manual', status: 'recording' })
  resetLiveContext()
  opts.onEvent({ type: 'started', noteId, title, external: true })

  const chunkSamples = Math.floor(16000 * chunkSeconds)
  let offset = 0
  let chunks = 0
  let segments = 0
  let seq = 0

  while (offset < pcm.length) {
    const slice = pcm.subarray(offset, Math.min(offset + chunkSamples, pcm.length))
    offset += slice.length
    seq += 1
    const offsetMs = Math.round(((offset - slice.length) / 16000) * 1000)

    const result = await transcribeLiveChunk(deps, {
      noteId,
      channel,
      seq,
      offsetMs,
      sampleRate: 16000,
      language,
      pcm: new Uint8Array(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength))
    })

    if (!result.ok) {
      log(`  parca ${seq} HATA: ${result.error}`)
      opts.onEvent({ type: 'status', noteId, status: 'failed', error: result.error })
      return { noteId, chunks, segments }
    }
    if (result.skipped) {
      log(`  parca ${seq} atlandi (sessiz/bos)`)
      continue
    }
    chunks += 1
    segments += result.segments.length
    opts.onEvent({ type: 'segments', noteId, segments: result.segments })
    log(
      `  parca ${seq} (+${offsetMs} ms) -> ${result.segments.length} satir: ` +
        result.segments.map((s) => JSON.stringify(s.text)).join(' | ')
    )
  }

  repo.setNoteStatus(db, noteId, 'ready')
  opts.onEvent({ type: 'status', noteId, status: 'ready' })
  log(`Simulasyon bitti: ${chunks} parca, ${segments} transkript satiri`)
  return { noteId, chunks, segments }
}