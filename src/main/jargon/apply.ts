// ============================================================================
//  FAZ 7 — Jargon sozlugu (SAF fonksiyonlar).
//
//  Iki is yapar:
//   1) STT IPUCU: dogru terimleri Whisper'a "prompt" olarak verir; boylece
//      ozel isimler/markalar bastan dogru yazilir (en etkili yontem).
//   2) DUZELTME: transkriptte yanlis yazilmis bicimi dogrusuyla degistirir
//      (or. "grog" -> "Groq", "hipo" -> "HiPPO").
//
//  KRITIK: yalnizca TAM KELIME eslesmesi yapilir. Aksi halde "api" -> "API"
//  kurali "capital" kelimesinin icini bozardi.
// ============================================================================

import { foldForId } from '@shared/text'

export interface JargonRule {
  term: string
  replacement: string
}

export interface JargonApplyResult {
  text: string
  /** Kac kez degistirildi (kural basina sayim icin) */
  counts: Map<string, number>
  total: number
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Jargon kurallarini uygular — TEK GECIS.
 *
 * DIKKAT (gercek hata): Kurallari sirayla uygulamak ZINCIRLEME bozulmaya yol
 * aciyordu: {"acme" -> "ACME"} ve {"acme corp" -> "Acme Corporation"} kurallari
 * varken, "acme corp" once "Acme Corporation" oluyor, sonra "Acme" tekrar
 * eslesip "ACME Corporation"a donusuyordu.
 * Cozum: tum terimler TEK bir regex alternasyonunda (uzun once) eslesir ve
 * eslesen metin BIR KEZ degistirilir; uretilen metin yeniden taranmaz.
 *
 * Eslesme kurali: TAM KELIME (Unicode-aware sinirlar). Aksi halde "api" -> "API"
 * kurali "capital" kelimesinin icini bozardi.
 */
export function applyJargon(text: string, rules: JargonRule[]): JargonApplyResult {
  const counts = new Map<string, number>()
  const out = text ?? ''
  if (!out || !rules || rules.length === 0) return { text: out, counts, total: 0 }

  // Gecerli kurallar: bos olmayan, kendini degistirmeyen terimler
  const usable = rules
    .map((r) => ({ term: (r.term ?? '').trim(), replacement: (r.replacement ?? '').trim() }))
    .filter((r) => r.term && r.replacement && r.term !== r.replacement)

  if (usable.length === 0) return { text: out, counts, total: 0 }

  // Uzun terimler once denenir (alternation sirasi onemli)
  const sorted = [...usable].sort((a, b) => b.term.length - a.term.length)

  // Terimleri bir kez kacisla; eslesince hangi kuralin vurdugunu bulmak icin
  // normalize edilmis (kucuk harf) bir harita tutariz.
  const lookup = new Map<string, { term: string; replacement: string }>()
  for (const r of sorted) lookup.set(foldForId(r.term), r)

  const pattern = sorted.map((r) => escapeRegex(r.term)).join('|')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu')

  let total = 0
  const result = out.replace(re, (match) => {
    const rule = lookup.get(foldForId(match))
    if (!rule) return match
    counts.set(rule.term, (counts.get(rule.term) ?? 0) + 1)
    total++
    return rule.replacement
  })

  return { text: result, counts, total }
}

/**
 * Whisper'a verilecek ipucu metni.
 * Terim + dogru yazim listesi; Whisper bunlari tanima egiliminde olur.
 * Cok uzun ipucu Whisper'i yaniltir; bu yuzden sinirlanir (~700 karakter).
 */
export function buildSttHint(rules: JargonRule[], extra?: string | null): string {
  const parts: string[] = []
  for (const r of rules ?? []) {
    const term = r.term.trim()
    const rep = r.replacement.trim()
    if (rep) parts.push(rep)
    else if (term) parts.push(term)
  }
  const base = (extra ?? '').trim()
  const merged = [...new Set([...parts, ...(base ? [base] : [])])].join(', ')
  return merged.slice(0, 700)
}

/**
 * Model yanitindaki (AI uretimi) terimleri de duzeltir.
 * Boyut siniri: cok uzun metinde regex maliyeti artmasin.
 */
export function applyJargonToMarkdown(md: string, rules: JargonRule[]): string {
  if (!md) return md
  return applyJargon(md, rules).text
}