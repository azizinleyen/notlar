// ============================================================================
//  FAZ 5 — Kisiler & Sirketler otomatik cikarimi.
//
//  Kaynaklar (guvenilirlik sirasi):
//    1) Takvim katilimcilari  -> en guvenilir (takvimde adi geciyor)
//    2) Transkript/ham not icindeki e-posta adresleri
//    3) LLM cikarimi          -> DELIL ZORUNLU (uydurma engeli)
//
//  LLM basarisiz/anahtarsizsa 1+2 yine calisir (yerel yedek = sezgisel).
// ============================================================================

import type Database from 'better-sqlite3'
import type { ExtractPeopleResult } from '@shared/types'
import * as repo from '../db/repo'
import { foldForId, rawNotesToPlain } from '@shared/text'
import { llmOptionsFor, resolveLlmProvider } from '../llm'
import { extractJsonObject } from '../llm/util'
import { buildScopedContext } from '../llm/scoped'
import {
  findEmails,
  mergeExtractions,
  type ExtractedPerson,
  type MergeInput
} from '../people/extract'

export interface ExtractProgress {
  noteId: string
  stage: 'queued' | 'gathering' | 'calling' | 'saving' | 'done' | 'error'
  message: string
  detail?: string
}

export interface ExtractDeps {
  db: Database.Database
  onProgress?: (p: ExtractProgress) => void
  log?: (m: string) => void
}

const EXTRACT_SYSTEM = [
  'Bir toplantı transkriptinden KİŞİ ve ŞİRKET bilgisi çıkarıyorsun.',
  '',
  'Kurallar:',
  '(1) YALNIZCA metinde geçen kişileri yaz. Metinde adı geçmeyen kimseyi yazma.',
  '(2) Her kişi için "evidence" alanına metinde GEÇEN kısa bir alıntı yaz (birebir, en az 15 karakter).',
  '    Alıntı metinde birebir bulunmazsa kaydın geçersiz sayılır.',
  '(3) Unvan (title) yalnızca açıkça söylenmişse yaz; tahmin etme.',
  '(4) Şirket adı yalnızca açıkça söylenmiş ya da e-posta alan adından belli ise yaz.',
  '(5) Kendi adın olan kullanıcıyı ("Ben") kişi olarak EKLEME.',
  '(6) Konuşmacı etiketleri (Sarah, James gibi) metinde geçen gerçek kişilerdir; ekleyebilirsin.',
  '(7) Emin değilsen o kaydı hiç yazma. Boş liste döndürmek sorun değil.',
  '',
  'Çıktı YALNIZCA şu JSON olsun:',
  '{',
  '  "people": [ { "name": "Sarah Jones", "email": null, "title": "Ürün Yöneticisi", "company": "Acme", "evidence": "birebir alıntı" } ],',
  '  "companies": [ { "name": "Acme", "domain": "acme.com", "evidence": "birebir alıntı" } ]',
  '}'
].join('\n')

export async function extractPeopleForNote(
  deps: ExtractDeps,
  noteId: string
): Promise<ExtractPeopleResult> {
  const { db } = deps
  const emit = (p: ExtractProgress): void => deps.onProgress?.(p)
  const log = (m: string): void => deps.log?.(m)

  const detail = repo.getNoteDetail(db, noteId)
  if (!detail) return { ok: false, people_added: 0, companies_added: 0, links_added: 0, dropped: 0, provider: null, model: null, usedFallback: false, error: 'Not bulunamadi' }

  emit({ noteId, stage: 'gathering', message: 'Kişiler taranıyor...' })

  const transcriptText = repo.transcriptTextOf(db, noteId)
  const rawNotes = rawNotesToPlain(detail.raw_notes_md)
  const calendarText = detail.calendar_event
    ? [detail.calendar_event.title, detail.calendar_event.location ?? ''].join('\n')
    : ''
  const sourceText = [transcriptText, rawNotes, calendarText].filter(Boolean).join('\n')

  // 1) Sezgisel kesifler
  const emails = findEmails(sourceText).map((e) => {
    const idx = sourceText.indexOf(e.email)
    const lineStart = sourceText.lastIndexOf('\n', idx) + 1
    const lineEnd = sourceText.indexOf('\n', idx)
    const evidence = sourceText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim()
    return { email: e.email, evidence: evidence || e.email }
  })

  const attendees = detail.calendar_event?.participants ?? []

  // 2) LLM cikarimi (opsiyonel; basarisizsa sezgisel yeter)
  let llmPeople: MergeInput['llmPeople'] = []
  let llmCompanies: MergeInput['llmCompanies'] = []
  let provider: string | null = null
  let model: string | null = null
  let usedFallback = false
  let llmError: string | undefined

  const settings = repo.getAllSettings(db)
  const llm = resolveLlmProvider(settings.llm_provider)
  const opts = llmOptionsFor(db, llm)

  if (!transcriptText.trim() && !rawNotes.trim()) {
    emit({ noteId, stage: 'error', message: 'Kişi çıkarılacak içerik yok' })
    return {
      ok: false,
      people_added: 0,
      companies_added: 0,
      links_added: 0,
      dropped: 0,
      provider: null,
      model: null,
      usedFallback: false,
      error: 'Not içeriği boş'
    }
  }

  if (llm.requiresApiKey && !opts.apiKey) {
    usedFallback = true
    llmError = 'LLM anahtarı yok — yalnızca sezgisel çıkarım (takvim + e-posta)'
  } else {
    try {
      emit({ noteId, stage: 'calling', message: `${llm.label} ile kişiler çıkarılıyor...` })
      const ctx = buildScopedContext([
        {
          noteId,
          title: detail.note.title,
          startedAt: detail.note.started_at,
          source: detail.note.source,
          transcript: transcriptText,
          rawNotes,
          enhanced: ''
        }
      ])
      const user = [
        `NOT: ${detail.note.title}`,
        detail.calendar_event ? `TAKVİM KATILIMCILARI: ${attendees.join(', ')}` : '',
        '',
        '### İÇERİK',
        ctx.block
      ]
        .filter(Boolean)
        .join('\n')

      const res = await llm.complete(
        { system: EXTRACT_SYSTEM, user, maxTokens: 1500, temperature: 0 },
        opts
      )
      const parsed = extractJsonObject(res.text) as {
        people?: MergeInput['llmPeople']
        companies?: MergeInput['llmCompanies']
      }
      llmPeople = parsed.people ?? []
      llmCompanies = parsed.companies ?? []
      provider = res.provider
      model = res.model
    } catch (err) {
      usedFallback = true
      llmError = err instanceof Error ? err.message : String(err)
      log(`[people] LLM hatasi, sezgisel mod: ${llmError}`)
    }
  }

  // 3) Birlestir + dogrula
  const merged = mergeExtractions({
    attendees,
    emails,
    llmPeople,
    llmCompanies,
    calendarText,
    sourceText
  })

  emit({ noteId, stage: 'saving', message: 'Kaydediliyor...' })

  // 4) Yaz (sirket tekrarlari cikarim sonunda birlestirilir; ID'ler stabil kalir)
  let companiesAdded = 0
  const companyIdByName = new Map<string, string>()
  for (const c of merged.companies) {
    const before = repo.listCompanies(db).length
    const id = repo.upsertCompany(db, c.name, c.domain)
    if (id) companyIdByName.set(foldForId(c.name), id)
    if (repo.listCompanies(db).length > before) companiesAdded++
  }

  let peopleAdded = 0
  let linksAdded = 0
  const seenIds = new Set<string>()
  for (const p of merged.people) {
    const before = repo.listPeople(db).length
    // Sirket ID'si haritadan gelebilir ama dedupe onu silmis olabilir;
    // FK hatasi yerine null yazmak icin varligini dogrulariz.
    const mappedId = p.company ? companyIdByName.get(foldForId(p.company)) ?? null : null
    const companyId = mappedId && repo.getCompany(db, mappedId) ? mappedId : null
    const personId = repo.upsertPersonByName(db, p.name, {
      email: p.email,
      title: p.title,
      companyId,
      noteId // ayni notta gecen "Sarah" ile "Sarah Jones" birlestirilsin
    })
    if (repo.listPeople(db).length > before) peopleAdded++
    // Ayni kisi iki kez gelirse yalnizca bir baglanti yaz
    if (seenIds.has(personId)) continue
    seenIds.add(personId)
    // Takvim katilimcisi ise rol 'participant', aksi halde 'mentioned'
    const role = p.origin === 'attendee' ? 'participant' : 'mentioned'
    repo.linkNotePerson(db, noteId, personId, role, p.evidence)
    linksAdded++
  }

  // 5) Tekrarlari birlestir (people yazildiktan SONRA: ID'ler artik kullanilmiyor)
  try {
    repo.dedupeCompanies(db)
    repo.dedupePeople(db)
  } catch (err) {
    log(`[people] dedupe atlandi: ${err instanceof Error ? err.message : String(err)}`)
  }

  log(
    `[people] ${noteId}: kisi=${merged.people.length} (yeni ${peopleAdded}, baglanti=${linksAdded}) ` +
      `sirket=${merged.companies.length} (yeni ${companiesAdded}) atilan=${merged.dropped} ` +
      `isimler=[${merged.people.map((p) => p.name).join(', ')}]`
  )
  emit({ noteId, stage: 'done', message: 'Kişiler güncellendi' })

  return {
    ok: true,
    people_added: peopleAdded,
    companies_added: companiesAdded,
    links_added: linksAdded,
    dropped: merged.dropped,
    provider,
    model,
    usedFallback,
    error: llmError
  }
}

/** Takvim katilimcilarini (LLM'siz, aninda) nota baglar. */
export function linkAttendeesOnly(
  db: Database.Database,
  noteId: string,
  attendees: string[]
): { people: number; companies: number } {
  if (attendees.length === 0) return { people: 0, companies: 0 }
  const merged = mergeExtractions({
    attendees,
    emails: [],
    llmPeople: [],
    llmCompanies: [],
    calendarText: attendees.join('\n'),
    sourceText: attendees.join('\n')
  })
  const companyIdByName = new Map<string, string>()
  for (const c of merged.companies) {
    const id = repo.upsertCompany(db, c.name, c.domain)
    if (id) companyIdByName.set(foldForId(c.name), id)
  }
  for (const p of merged.people) {
    const mappedId = p.company ? companyIdByName.get(foldForId(p.company)) ?? null : null
    const companyId = mappedId && repo.getCompany(db, mappedId) ? mappedId : null
    const personId = repo.upsertPersonByName(db, p.name, {
      email: p.email,
      title: null,
      companyId,
      noteId
    })
    repo.linkNotePerson(db, noteId, personId, 'participant', p.evidence)
  }
  return { people: merged.people.length, companies: merged.companies.length }
}

export type { ExtractedPerson }