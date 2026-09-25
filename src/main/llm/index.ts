import type { LlmProvider, LlmRuntimeOptions } from './types'
import type { LlmProviderInfo } from '@shared/types'
import { makeOpenAiCompatProvider } from './openaiCompat'
import { localProvider } from './local'
import * as repo from '../db/repo'
import type Database from 'better-sqlite3'

// --- saglayicilar ----------------------------------------------------------

/**
 * Groq: hem Whisper (STT) hem Llama tabanli LLM sunar ve OpenAI-uyumludur.
 * Bu yuzden varsayilan LLM saglayicisi Groq'dur — kullanicinin zaten var olan
 * GROQ_API_KEY'i ile Faz 4 hemen calisir.
 */
const groq = makeOpenAiCompatProvider({
  id: 'groq',
  label: 'Groq (Llama / GPT-OSS)',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKeyEnvVar: 'GROQ_API_KEY',
  // DIKKAT: model adlari saglayicida degisir. Bu liste Groq'un GERCEK
  // /v1/models yanitindan alinmistir (Ayarlar > "Saglayicidan cek" ile
  // guncel listeyi cekebilirsin). Metin uretimi icin uygun olanlar:
  defaultModel: 'openai/gpt-oss-120b',
  suggestedModels: [
    'openai/gpt-oss-120b', // 131k baglam - uzun toplantilar icin tercih edilen
    'openai/gpt-oss-20b', // 131k baglam - daha hizli/ucuz
    'qwen/qwen3.8-27b', // 131k baglam
    'allam-2-7b' // 4k baglam - yalnizca kisa notlar
  ]
})

const openai = makeOpenAiCompatProvider({
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnvVar: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini',
  suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']
})

const openrouter = makeOpenAiCompatProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  defaultModel: 'google/gemini-2.0-flash-001',
  suggestedModels: [
    'google/gemini-2.0-flash-001',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.3-70b-instruct'
  ]
})

/**
 * Anthropic: OpenAI-uyumlu DEGIL. Su an icin OpenAI-uyumlu bir gecit
 * (proxy) uzerinden kullanilabilir; dogrudan Messages API destegi sonraki
 * adimda eklenebilir. Ayni arayuzun arkasinda oldugu icin arayuz kodu degismez.
 */
const anthropic = makeOpenAiCompatProvider({
  id: 'anthropic',
  label: 'Anthropic (OpenAI-uyumlu gecit uzerinden)',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  defaultModel: 'claude-3-5-sonnet-latest',
  suggestedModels: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']
})

const registry = new Map<string, LlmProvider>(
  [groq, openai, openrouter, anthropic, localProvider].map((p) => [p.id, p])
)

export function registerLlmProvider(p: LlmProvider): void {
  registry.set(p.id, p)
}

export function resolveLlmProvider(id: string | undefined | null): LlmProvider {
  if (id) {
    const hit = registry.get(id)
    if (hit) return hit
  }
  return groq
}

/** API anahtarinin nereden geldigini de dondurur (arayuzde gosterilir). */
export interface LlmKeyInfo {
  key: string
  source: 'settings' | 'env' | null
}

/**
 * Anahtar cozumleyici.
 * ONCELIK: Ayarlar tablosu (Ayarlar ekranindan girilen) > ortam degiskeni (.env).
 * Ayarlar once gelir; boylece kullanici arayuzden anahtarini degistirdiginde
 * eski .env degeri onu EZMEZ.
 */
export function llmKeyInfo(db: Database.Database, provider: LlmProvider): LlmKeyInfo {
  const fromSettings = repo.getSettingRaw(db, `${provider.id}_api_key`)
  if (fromSettings && fromSettings.trim()) return { key: fromSettings.trim(), source: 'settings' }
  const fromEnv = provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : ''
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim(), source: 'env' }
  return { key: '', source: null }
}

export function llmOptionsFor(db: Database.Database, provider: LlmProvider): LlmRuntimeOptions {
  return {
    apiKey: llmKeyInfo(db, provider).key,
    baseUrl: repo.getSettingRaw(db, `${provider.id}_base_url`) || undefined,
    model: repo.getSettingRaw(db, `${provider.id}_model`) || undefined
  }
}

/** "gsk_6eHsaMVCtIRi…kgIn" biciminde onizleme (anahtari tam gostermeyiz). */
export function maskKey(key: string | null | undefined): string {
  const k = (key ?? '').trim()
  if (!k) return ''
  if (k.length <= 14) return '••••••'
  return `${k.slice(0, 10)}…${k.slice(-4)}`
}

export function listLlmProviders(db: Database.Database): LlmProviderInfo[] {
  return [...registry.values()].map((p) => {
    const info = llmKeyInfo(db, p)
    return {
      id: p.id,
      label: p.label,
      requiresApiKey: p.requiresApiKey,
      defaultModel: p.defaultModel,
      suggestedModels: p.suggestedModels,
      hasApiKey: Boolean(info.key),
      maskedKey: maskKey(info.key),
      keySource: info.source
    }
  })
}

export type { LlmProvider, LlmRuntimeOptions, LlmCompletionResult } from './types'