// ============================================================================
//  LLM (not uretimi) takilabilir arayuz.
//  Yeni saglayici eklemek icin bu arayuzu uygulayip registry'ye kaydetmek yeter.
// ============================================================================

export interface LlmMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmCompletionRequest {
  system: string
  user: string
  /** Uzun toplantilarda cevap icin daha fazla yer birakmak adina artirilabilir */
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  onProgress?: (msg: string) => void
}

export interface LlmCompletionResult {
  text: string
  model: string
  provider: string
  /** Kaba token kullanimi (saglayici veriyorsa) */
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface LlmProvider {
  id: string
  label: string
  requiresApiKey: boolean
  defaultModel: string
  /** Ornek/filtre icin one cikan modeller (Ayarlar'da oneri olarak gosterilir) */
  suggestedModels: string[]
  baseUrlEnvVar?: string
  apiKeyEnvVar: string
  complete(req: LlmCompletionRequest, opts: LlmRuntimeOptions): Promise<LlmCompletionResult>
  /** Saglayici model listesi sunuyorsa (OpenAI-uyumlu /models) */
  listModels?(opts: LlmRuntimeOptions): Promise<string[]>
}

export interface LlmRuntimeOptions {
  apiKey?: string
  model?: string
  /** OpenAI-uyumlu saglayicilarda ozel taban adres */
  baseUrl?: string
}

/** Arayuzde gosterilen saglayici ozeti */
export interface LlmProviderInfo {
  id: string
  label: string
  requiresApiKey: boolean
  defaultModel: string
  suggestedModels: string[]
  hasApiKey: boolean
}