import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { SttOptions, SttProvider, SttResult, SttSegment } from './types'

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MAX_BYTES = 25 * 1024 * 1024 // Groq ucretsiz katman dosya limiti

interface GroqVerboseJson {
  text?: string
  language?: string
  duration?: number
  segments?: Array<{ start: number; end: number; text: string }>
}

export const groqProvider: SttProvider = {
  id: 'groq',
  label: 'Groq Whisper (large-v3-turbo)',
  requiresApiKey: true,
  defaultModel: 'whisper-large-v3-turbo',

  async transcribe(filePath: string, opts: SttOptions): Promise<SttResult> {
    const apiKey = opts.apiKey?.trim()
    if (!apiKey) throw new Error('GROQ_API_KEY tanimli degil. .env dosyasini veya Ayarlar > API anahtari bolumunu kontrol edin.')

    const size = statSync(filePath).size
    if (size > MAX_BYTES) {
      throw new Error(`Dosya cok buyuk (${(size / 1048576).toFixed(1)} MB). Groq limiti 25 MB.`)
    }

    const model = opts.model || this.defaultModel
    opts.onProgress?.(`Ses okunuyor (${(size / 1024).toFixed(0)} KB)...`)
    const buf = readFileSync(filePath)

    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buf)]), basename(filePath))
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    if (opts.language && opts.language !== 'auto') form.append('language', opts.language)
    if (opts.prompt) form.append('prompt', opts.prompt)

    opts.onProgress?.('Groq Whisper API\'ye gonderiliyor...')

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: opts.signal
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Groq API hatasi ${res.status} ${res.statusText}: ${body.slice(0, 400)}`)
    }

    const json = (await res.json()) as GroqVerboseJson
    const segments: SttSegment[] = (json.segments ?? []).map((s) => ({
      start_ms: Math.round(s.start * 1000),
      end_ms: Math.round(s.end * 1000),
      text: (s.text ?? '').trim()
    }))

    const text = (json.text ?? '').trim()
    // Segment gelmezse tek parca olarak dondur (kisa kayitlarda olur)
    const finalSegments: SttSegment[] =
      segments.length > 0 ? segments : text ? [{ start_ms: 0, end_ms: Math.round((json.duration ?? 0) * 1000), text }] : []

    return {
      text,
      language: json.language,
      duration_ms: json.duration ? Math.round(json.duration * 1000) : undefined,
      segments: finalSegments,
      provider: this.id,
      model
    }
  }
}