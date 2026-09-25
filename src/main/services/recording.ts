import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Database } from 'better-sqlite3'
import type {
  Channel,
  RecordingChunkRequest,
  RecordingChunkResult,
  TranscriptSegment
} from '@shared/types'
import * as repo from '../db/repo'
import { resolveProvider } from '../stt'
import { correctText, sttHintFor } from './jargon'
import { pcm16ToWav } from '../audio/wav'

export interface RecordingDeps {
  db: Database
  apiKey: () => string
  onSegment?: (noteId: string, segments: TranscriptSegment[]) => void
}

/**
 * Kanal basina son metinler. Whisper'a "prompt" olarak verilir; boylece
 * parcalar arasinda cumle/terim devamliligi korunur (isim, jargon).
 */
const liveContext = new Map<Channel, string>()

export function resetLiveContext(): void {
  liveContext.clear()
}

/** IPC'den gelen PCM baytlarini Int16Array'e cevirir (ArrayBuffer/Uint8Array/Buffer hepsi). */
function toPcm16(data: Uint8Array | ArrayBuffer): Int16Array {
  if (data instanceof ArrayBuffer) return new Int16Array(data)
  const u8 = data as Uint8Array
  // byteOffset'e saygi gostererek temiz bir kopya al
  const copy = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return new Int16Array(copy)
}

/**
 * FAZ 2 cekirdegi: tek bir canli ses parcasini yaziya doker ve DB'ye yazar.
 *
 * Onemli: ham ses yalnizca bu fonksiyonun omru boyunca gecici bir WAV dosyasinda
 * durur ve `finally` blogunda HER DURUMDA silinir. Kalici ses arsivi tutulmaz.
 */
export async function transcribeLiveChunk(
  deps: RecordingDeps,
  req: RecordingChunkRequest
): Promise<RecordingChunkResult> {
  const { db } = deps
  const pcm = toPcm16(req.pcm)

  // Cok kisa parcalar Whisper'da halusinasyona yol acar; hic gonderme.
  if (pcm.length < req.sampleRate * 0.3) return { ok: true, segments: [], skipped: true }

  const settings = repo.getAllSettings(db)
  const provider = resolveProvider(settings.stt_provider)
  const tmpFile = join(app.getPath('temp'), `notlar-live-${randomUUID()}.wav`)

  try {
    writeFileSync(tmpFile, pcm16ToWav(pcm, req.sampleRate))

    const result = await provider.transcribe(tmpFile, {
      apiKey: deps.apiKey(),
      model: settings.stt_model || provider.defaultModel,
      language: req.language || settings.language,
      // Iki ipucu birlestirilir: jargon sozlugu (dogru terimler) + kanal baglami
      prompt: [sttHintFor(db), liveContext.get(req.channel)].filter(Boolean).join(' ').slice(0, 900) || undefined
    })

    const fullText = result.text.trim()
    if (!fullText) return { ok: true, segments: [], skipped: true }

    // Parca ici zamanlar offset ile mutlak zamana cevrilir.
    // Jargon duzeltmesi (or. "grog" -> "Groq"); sayaclar guncellenir
    const rows = result.segments.length
      ? result.segments.map((s) => ({
          channel: req.channel,
          speaker_label: req.channel === 'mic' ? 'Ben' : 'Karsi taraf',
          text: correctText(db, s.text.trim() || fullText),
          start_ms: req.offsetMs + s.start_ms,
          end_ms: req.offsetMs + Math.max(s.end_ms, s.start_ms + 1)
        }))
      : [
          {
            channel: req.channel,
            speaker_label: req.channel === 'mic' ? 'Ben' : 'Karsi taraf',
            text: correctText(db, fullText),
            start_ms: req.offsetMs,
            end_ms: req.offsetMs + 1000
          }
        ]

    const inserted = repo.insertTranscriptsReturning(db, req.noteId, rows)

    // Devamlilik icin baglami guncelle (son ~400 karakter)
    const prev = liveContext.get(req.channel) ?? ''
    liveContext.set(req.channel, `${prev} ${fullText}`.trim().slice(-400))

    deps.onSegment?.(req.noteId, inserted)
    return { ok: true, segments: inserted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, segments: [], error: message }
  } finally {
    rmSync(tmpFile, { force: true }) // ham ses kalici olarak saklanmaz
  }
}