// ============================================================================
//  FAZ 5 — Brief: toplanti oncesi 2-3 maddelik KISISEL ozet.
//
//  Baglam: takvim etkinligi + (kisi/sirket ile ilgili) GECMIS notlar.
//  Yerel yedek: gecmis notlarin acik kalan maddelerinden sezgisel cikarim.
// ============================================================================

import type Database from 'better-sqlite3'
import type { BriefItem, BriefResult } from '@shared/types'
import * as repo from '../db/repo'
import { rawNotesToPlain } from '@shared/text'
import { llmOptionsFor, resolveLlmProvider } from '../llm'
import { extractJsonObject } from '../llm/util'
import {
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
  buildScopedContext,
  normalizeBriefPayload,
  resolveScopedCitations,
  type ScopedNoteInput
} from '../llm/scoped'

export interface BriefDeps {
  db: Database.Database
  onProgress?: (m: string) => void
  log?: (m: string) => void
}

export interface BriefTarget {
  /** Bu kisinin gecmis notlarini da ekle */
  personId?: string | null
  /** Bu sirketin gecmis notlarini da ekle */
  companyId?: string | null
  /** Bu notu (varsa takvim etkinligiyle) baglam al */
  noteId?: string | null
  /** Takvim etkinligi (varsa) */
  eventId?: string | null
}

/** Ozet icin kac gecmis not kullanilir */
const MAX_PAST_NOTES = 8

function noteToInput(db: Database.Database, noteId: string): ScopedNoteInput | null {
  const d = repo.getNoteDetail(db, noteId)
  if (!d) return null
  return {
    noteId: d.note.id,
    title: d.note.title,
    startedAt: d.note.started_at,
    source: d.note.source,
    transcript: repo.transcriptTextOf(db, noteId),
    rawNotes: rawNotesToPlain(d.raw_notes_md),
    enhanced: d.enhanced?.content_md ?? ''
  }
}

/** Yerel yedek: gecmis notlarin en somut maddelerini toplar. */
export function localBrief(notes: ScopedNoteInput[], limit = 3): BriefItem[] {
  const items: BriefItem[] = []
  for (const n of notes) {
    const lines = [n.enhanced, n.rawNotes]
      .join('\n')
      .split('\n')
      .map((l) => l.replace(/^([-*•]|\d+\.|#+)\s*/, '').trim())
      .filter((l) => l.length > 18 && !/^(özet|ozet|ana konular|kararlar|risk|sonraki adımlar)$/i.test(l))
    for (const line of lines) {
      if (items.length >= limit) break
      if (items.some((i) => i.text === line)) continue
      items.push({ text: line, note_id: n.noteId, note_title: n.title, source_type: 'previous_note' })
    }
    if (items.length >= limit) break
  }
  return items
}

export async function buildBrief(deps: BriefDeps, target: BriefTarget): Promise<BriefResult> {
  const { db } = deps
  const log = (m: string): void => deps.log?.(m)

  // 1) Baglam notlarini topla (kendisi haric, en yeniden eskiye)
  const ids: string[] = []
  const pushId = (id: string): void => {
    if (id !== target.noteId && !ids.includes(id)) ids.push(id)
  }
  if (target.personId) for (const l of repo.listPersonNotes(db, target.personId)) pushId(l.note_id)
  if (target.companyId) for (const l of repo.listCompanyNotes(db, target.companyId)) pushId(l.note_id)

  // Takvim etkinliginden katilimci -> o kisilerin notlari
  const evId = target.eventId ?? null
  if (evId) {
    const ev = repo.getCalendarEventRow(db, evId)
    if (ev) {
      for (const name of ev.participants) {
        const person = repo.listPeople(db).find((p) => p.name === name)
        if (person) for (const l of repo.listPersonNotes(db, person.id)) pushId(l.note_id)
      }
    }
  }

  const notes: ScopedNoteInput[] = []
  for (const id of ids.slice(0, MAX_PAST_NOTES)) {
    const input = noteToInput(db, id)
    if (input) notes.push(input)
  }

  const events = evId ? repo.getCalendarEventRow(db, evId) : null
  const eventForPrompt = events
    ? { title: events.title, start_at: events.start_at, participants: events.participants }
    : null

  // 2) Gecmis yoksa: mevcut notun ham notlarindan yerel taslak (Faz 1 davranisi)
  if (notes.length === 0) {
    const current = target.noteId ? noteToInput(db, target.noteId) : null
    const items = current ? localBrief([current], 3) : []
    return {
      ok: true,
      items,
      provider: null,
      model: null,
      usedFallback: true,
      error: items.length === 0 ? 'Brief için geçmiş not yok' : undefined
    }
  }

  const settings = repo.getAllSettings(db)
  const llm = resolveLlmProvider(settings.llm_provider)
  const opts = llmOptionsFor(db, llm)

  const ctx = buildScopedContext(notes)
  const system = buildBriefSystemPrompt(settings.language)
  const user = buildBriefUserPrompt({ block: ctx.block }, eventForPrompt)

  if (llm.requiresApiKey && !opts.apiKey) {
    return {
      ok: true,
      items: localBrief(notes, 3),
      provider: null,
      model: null,
      usedFallback: true,
      error: 'LLM anahtarı yok — yerel taslak gösteriliyor'
    }
  }

  try {
    deps.onProgress?.(`${llm.label} ile brief hazırlanıyor...`)
    const res = await llm.complete({ system, user, maxTokens: 900, temperature: 0.2 }, opts)
    const payload = normalizeBriefPayload(extractJsonObject(res.text))
    // Kaynak dogrulama: yalnizca gercek [N#] etiketine dayanan kaynaklar kabul edilir
    const resolved = resolveScopedCitations(
      (payload.items ?? []).map((i) => ({ source: i.source ?? '', excerpt: i.excerpt ?? undefined })),
      ctx.index
    )
    const byNoteId = new Map(resolved.citations.map((c) => [c.note_id, c]))
    const noteIdByToken = new Map<string, { id: string; title: string }>()
    for (const [token, hit] of ctx.index.entries()) noteIdByToken.set('N' + token.replace(/^N+/, ''), hit)

    const items: BriefItem[] = (payload.items ?? [])
      .filter((i) => i.text.length > 0)
      .slice(0, 3)
      .map((i) => {
        const token = ('N' + (i.source ?? '')).replace(/[^N0-9]/gi, '').replace(/^N+/, 'N')
        const hit = noteIdByToken.get(token)
        return {
          text: i.text,
          note_id: hit?.id ?? null,
          note_title: hit?.title ?? null,
          source_type: hit && byNoteId.has(hit.id) ? 'previous_note' : hit ? 'previous_note' : null
        }
      })

    log(`[brief] ${items.length} madde (${res.provider}/${res.model}), ${notes.length} not tarandı`)
    return {
      ok: true,
      items: items.length > 0 ? items : localBrief(notes, 3),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`[brief] LLM hatasi, yerel taslak: ${message}`)
    return {
      ok: true,
      items: localBrief(notes, 3),
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    }
  }
}