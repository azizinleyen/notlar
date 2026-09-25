// ============================================================================
//  OpenAI-uyumlu sohbet tamamlama (/chat/completions).
//  Tek uygulama, uc saglayiciyi besler: OpenAI, Groq, OpenRouter.
//  Hepsi ayni govde ve yanit sekline sahip; yalnizca taban adres + anahtar
//  ortam degiskeni farklidir.
// ============================================================================

import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  LlmRuntimeOptions
} from './types'
import { authHeaders } from './util'

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface ModelsResponse {
  data?: Array<{ id?: string }>
}

export interface OpenAiCompatConfig {
  id: string
  label: string
  baseUrl: string
  apiKeyEnvVar: string
  defaultModel: string
  suggestedModels: string[]
}

async function post(path: string, body: unknown, opts: LlmRuntimeOptions, signal?: AbortSignal): Promise<Response> {
  const url = `${(opts.baseUrl || '').replace(/\/+$/, '')}${path}`
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(opts.apiKey) },
    body: JSON.stringify(body),
    signal
  })
}

export function makeOpenAiCompatProvider(cfg: OpenAiCompatConfig): LlmProvider {
  return {
    id: cfg.id,
    label: cfg.label,
    requiresApiKey: true,
    defaultModel: cfg.defaultModel,
    suggestedModels: cfg.suggestedModels,
    apiKeyEnvVar: cfg.apiKeyEnvVar,

    async complete(req: LlmCompletionRequest, opts: LlmRuntimeOptions): Promise<LlmCompletionResult> {
      const apiKey = opts.apiKey?.trim()
      if (!apiKey) throw new Error(`${cfg.label}: API anahtari yok (${cfg.apiKeyEnvVar}).`)
      const model = opts.model || cfg.defaultModel
      const runtime: LlmRuntimeOptions = { ...opts, baseUrl: opts.baseUrl || cfg.baseUrl }

      req.onProgress?.(`${cfg.label} / ${model} cagriliyor...`)
      const res = await post(
        '/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user }
          ],
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 4000,
          // JSON cikisi isteyen modeller icin ipucu (desteklemeyenler yoksayar)
          response_format: { type: 'json_object' }
        },
        runtime,
        req.signal
      )

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `${cfg.label} hatasi ${res.status} ${res.statusText}: ${body.slice(0, 400)}${
            res.status === 404 ? `  (model adi gecersiz olabilir: "${model}")` : ''
          }`
        )
      }

      const json = (await res.json()) as ChatResponse
      const text = json.choices?.[0]?.message?.content ?? ''
      if (!text.trim()) throw new Error(`${cfg.label}: model bos yanit dondu`)

      return {
        text,
        model: json.model || model,
        provider: cfg.id,
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens
        }
      }
    },

    async listModels(opts: LlmRuntimeOptions): Promise<string[]> {
      const apiKey = opts.apiKey?.trim()
      if (!apiKey) return []
      const base = (opts.baseUrl || cfg.baseUrl).replace(/\/+$/, '')
      const res = await fetch(`${base}/models`, {
        headers: { Accept: 'application/json', ...authHeaders(apiKey) }
      })
      if (!res.ok) return []
      const json = (await res.json()) as ModelsResponse
      return (json.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id))
        .sort()
    }
  }
}