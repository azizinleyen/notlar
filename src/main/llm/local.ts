// ============================================================================
//  YEREL (cevrimdisi) zenginlestirme saglayicisi — API anahtari GEREKMEZ.
//
//  Amac: (a) internet/anahtar yoksa da Faz 4 akisini calistirir hale getirmek,
//        (b) LLM cagrisi basarisiz oldugunda anlamli bir yedek sunmak.
//  Not: Bu bir dil modeli DEGILDIR; transkript + ham notlardan sezgisel olarak
//       bolumler cikarir. Uretilen kaynaklar gercektir (uydurma yok).
// ============================================================================

import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './types'

/** Konusma isaretlerinden karar/risk/aksiyon cumlesi ayiklar. */
const DECISION_HINTS = [
  'karar',
  'kararlaştır',
  'kararlastir',
  'yapacağız',
  'yapacagiz',
  'olacak',
  'kabul',
  'onayla',
  'anlaştık',
  'anlastik',
  'devam edeceğiz',
  'devam edecegiz',
  'we will',
  'we agreed',
  'decided',
  "let's",
  'approved'
]
const RISK_HINTS = [
  'risk',
  'engel',
  'sorun',
  'problem',
  'gecikme',
  'gecikiyor',
  'yetişmeyebilir',
  'yetismeyebilir',
  'blok',
  'blocked',
  'blocker',
  'issue',
  'concern',
  'delay',
  'endişe',
  'endise'
]
const ACTION_HINTS = [
  'yapacağım',
  'yapacagim',
  'takip',
  'göndereceğim',
  'gonderecegim',
  'hazırlayacağım',
  'hazirlayacagim',
  'bakacağım',
  'bakacagim',
  'ileteceğim',
  'iletecegim',
  'planla',
  'halledeceğim',
  'halledecegim',
  'will send',
  'will follow',
  'action item',
  'to-do',
  'todo',
  'yarın',
  'yarin',
  'gelecek hafta',
  'next week',
  'tomorrow'
]

function hasAny(text: string, hints: string[]): boolean {
  const t = text.toLocaleLowerCase('tr')
  return hints.some((h) => t.includes(h))
}

function extractBlock(user: string, header: string): string {
  const start = user.indexOf(header)
  if (start < 0) return ''
  const rest = user.slice(start + header.length)
  const nextHeader = rest.indexOf('\n### ')
  return (nextHeader >= 0 ? rest.slice(0, nextHeader) : rest).trim()
}

interface IndexedLine {
  token: string
  text: string
}

function parseIndexed(block: string, prefix: 'T' | 'N'): IndexedLine[] {
  const out: IndexedLine[] = []
  for (const line of block.split('\n')) {
    const m = new RegExp(`^\\[(${prefix}\\d+)\\]\\s*(.*)$`).exec(line.trim())
    if (!m) continue
    let text = m[2]
    if (prefix === 'T') {
      // "[T1] (MIKROFON) Ben 00:07: cumle" -> cumleyi al
      const idx = text.indexOf(': ')
      if (idx > 0) text = text.slice(idx + 2)
    }
    out.push({ token: m[1], text: text.trim() })
  }
  return out
}

export const localProvider: LlmProvider = {
  id: 'local',
  label: 'Yerel çıkarım (çevrimdışı, anahtar gerekmez)',
  requiresApiKey: false,
  defaultModel: 'heuristic-v1',
  suggestedModels: ['heuristic-v1'],
  apiKeyEnvVar: '',

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    req.onProgress?.('Yerel çıkarım yapılıyor...')

    const rawBlock = extractBlock(req.user, '### (b) KULLANICININ HAM NOTLARI')
    const trBlock = extractBlock(req.user, '### (a) TRANSKRİPT')
    const rawLines = parseIndexed(rawBlock, 'N')
    const trLines = parseIndexed(trBlock, 'T')

    const citations: Array<{ ref: string; source: string; excerpt: string }> = []
    const add = (heading: string, items: string[], refPrefix: string): void => {
      items.forEach((text, i) => {
        citations.push({ ref: `${heading}#${i + 1}`, source: refPrefix, excerpt: text.slice(0, 200) })
      })
    }

    // 1) OZET: ham notlarin ilk satirlari (kullanicinin cekirdegi) + ilk transkript satirlari
    const summaryBits = [
      ...rawLines.slice(0, 3).map((l) => l.text),
      ...trLines.slice(0, 2).map((l) => l.text)
    ].filter(Boolean)
    const summary = summaryBits.slice(0, 2).join(' ')

    // 2) ANA KONULAR: ham notlar + en uzun transkript cumleleri
    const topicItems = [
      ...rawLines.slice(0, 6).map((l) => ({ token: l.token, text: l.text })),
      ...trLines
        .filter((l) => l.text.length > 24)
        .sort((a, b) => b.text.length - a.text.length)
        .slice(0, 5)
    ].slice(0, 8)

    // 3) KARARLAR / RISK / SONRAKI ADIMLAR
    const allText = [...trLines, ...rawLines]
    const decisions = allText.filter((l) => hasAny(l.text, DECISION_HINTS)).slice(0, 6)
    const risks = allText.filter((l) => hasAny(l.text, RISK_HINTS)).slice(0, 6)
    const actions = allText.filter((l) => hasAny(l.text, ACTION_HINTS)).slice(0, 6)

    const sections: Array<{ heading: string; items: string[]; cites: typeof citations }> = []
    const mk = (heading: string, srcs: Array<{ token: string; text: string }>): void => {
      if (srcs.length === 0) return
      const items = srcs.map((s) => s.text)
      const before = citations.length
      add(heading, items, '')
      // token'lari dogru ata
      for (let i = 0; i < srcs.length; i++) citations[before + i].source = srcs[i].token
      sections.push({ heading, items, cites: citations.slice(before) })
    }

    mk('Ana Konular', topicItems)
    mk('Kararlar', decisions)
    mk('Risk / Engel', risks)
    mk('Sonraki Adımlar', actions)

    const nextSteps = actions.map((a) => ({ task: a.text, owner: null, due: null }))

    const payload = {
      summary,
      sections: sections.map((s) => ({ heading: s.heading, items: s.items })),
      next_steps: nextSteps,
      citations
    }

    return {
      text: JSON.stringify(payload),
      model: 'heuristic-v1',
      provider: 'local'
    }
  }
}