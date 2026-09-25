import { groqProvider } from './groq'
import type { SttProvider } from './types'

// Saglayici registry'si. Faz 2+'ta deepgram / whisper.cpp / assemblyai eklenir.
const registry = new Map<string, SttProvider>([[groqProvider.id, groqProvider]])

export function registerProvider(p: SttProvider): void {
  registry.set(p.id, p)
}

export function resolveProvider(id: string | undefined | null): SttProvider {
  const provider = id ? registry.get(id) : undefined
  if (!provider) return groqProvider
  return provider
}

export function listProviders(): Array<Pick<SttProvider, 'id' | 'label' | 'requiresApiKey' | 'defaultModel'>> {
  return [...registry.values()].map((p) => ({
    id: p.id,
    label: p.label,
    requiresApiKey: p.requiresApiKey,
    defaultModel: p.defaultModel
  }))
}

export type { SttProvider, SttResult, SttSegment, SttOptions } from './types'