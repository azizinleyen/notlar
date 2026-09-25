// ============================================================================
//  WAV yardimcilari (harici bagimlilik YOK)
//  Canli kayitta mikrofon/sistem sesi PCM16'ya cevrilir, gecici WAV dosyasina
//  yazilir, STT'ye gonderilir ve islem sonunda SILINIR (ham ses saklanmaz).
// ============================================================================

import { readFileSync } from 'node:fs'

/** PCM16 (mono) -> 44 baytlik standart WAV dosyasi */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk boyutu
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)

  const data = Buffer.alloc(dataSize)
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], i * 2)
  return Buffer.concat([header, data])
}

export interface WavData {
  pcm: Int16Array
  sampleRate: number
  channels: number
}

/**
 * 16-bit PCM WAV okur (test/simulasyon icin). data chunk'i arar; diger
 * chunk'lari (LIST, fact vb.) atlar.
 */
export function readWavPcm16(filePath: string): WavData {
  const buf = readFileSync(filePath)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Gecersiz WAV dosyasi: RIFF basligi yok')
  }
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Gecersiz WAV dosyasi: WAVE yok')

  const audioFormat = buf.readUInt16LE(20)
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (audioFormat !== 1) throw new Error(`Desteklenmeyen WAV formati (${audioFormat}); yalnizca PCM`)
  if (bits !== 16) throw new Error(`Desteklenmeyen bit derinligi (${bits}); yalnizca 16-bit`)

  let offset = 12
  let dataStart = -1
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataStart = offset + 8
      dataSize = Math.min(size, buf.length - dataStart)
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (dataStart < 0) throw new Error('WAV icinde data chunk bulunamadi')

  const usable = dataSize - (dataSize % 2)
  const samples = usable / 2
  const raw = new Int16Array(samples)
  for (let i = 0; i < samples; i++) raw[i] = buf.readInt16LE(dataStart + i * 2)
  return { pcm: raw, sampleRate, channels }
}

/** Coklu kanali monoya indirir (ornekleri ortalama alir). */
export function downmixToMono(pcm: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return pcm
  const frames = Math.floor(pcm.length / channels)
  const out = new Int16Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c]
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)))
  }
  return out
}

/**
 * Dogrusal interpolasyonla yeniden ornekleme. Konusma icin yeterlidir;
 * fazla CPU harcamadan 48k -> 16k cevrimi saglar.
 */
export function resampleLinear(input: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate || input.length === 0) return input
  const ratio = srcRate / dstRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac)
  }
  return out
}

/** Int16 ornekleri 0..1 arasi float'a cevirir (RMS hesabi icin). */
export function rmsOfInt16(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768
    sum += v * v
  }
  return Math.sqrt(sum / pcm.length)
}