// ============================================================================
//  STT (Speech-to-Text) takilabilir arayuz
//  Yeni saglayici eklemek icin bu arayuzu uygulayip registry'ye kaydetmek yeter.
// ============================================================================

export interface SttSegment {
  start_ms: number
  end_ms: number
  text: string
}

export interface SttResult {
  text: string
  language?: string
  duration_ms?: number
  segments: SttSegment[]
  provider: string
  model: string
}

export interface SttOptions {
  apiKey?: string
  model?: string
  /** 'auto' veya ISO kod ('tr','en',...) */
  language?: string
  /** Jargon/ozel isim sozlugu ipucu (Whisper prompt) */
  prompt?: string
  signal?: AbortSignal
  onProgress?: (msg: string) => void
}

export interface SttProvider {
  id: string
  label: string
  requiresApiKey: boolean
  defaultModel: string
  transcribe(filePath: string, opts: SttOptions): Promise<SttResult>
}