// ============================================================================
//  PROMPT KURULUMU + KAYNAK ESLESTIRME  — SAF FONKSIYONLAR (test edilebilir)
//
//  NEDEN NUMARALI ETIKETLER: LLM'den UUID istemek guvenilmez (uzun, kopyalarken
//  bozulur). Bunun yerine transkript satirlarina [T1], [T2]; kullanici notlarina
//  [N1]; takvim baglamina [C1] etiketleri veririz. Model yalnizca "T12" der;
//  biz de bunu gercek transcripts.id'ye deterministik olarak cozeriz.
// ============================================================================

import type { CalendarEventMeta, Channel, TranscriptSegment } from '@shared/types'

export interface PromptContext {
  noteTitle: string
  language: string
  templatePrompt: string
  calendarEvent: CalendarEventMeta | null
  rawNotesMd: string
  transcripts: TranscriptSegment[]
}

/** Numara -> gercek kaynak kimligi eslemesi */
export interface SourceIndex {
  /** 'T1' -> transcripts.id */
  transcripts: Map<string, { id: string; channel: Channel; speaker: string; text: string; start_ms: number }>
  /** 'N1' -> null (ham not; kaynak kimligi note_id'dir) */
  rawNoteTokens: Map<string, { line: string; index: number }>
  /** 'C1' -> takvim etkinlik kimligi */
  calendar: { token: string; eventId: string; label: string } | null
}

export interface RawCitation {
  ref?: string
  source?: string
  excerpt?: string
}

export interface ResolvedCitation {
  sentence_ref: string
  source_type: 'transcript' | 'raw_note' | 'calendar'
  source_id: string | null
  excerpt: string | null
}

export interface ResolveResult {
  citations: ResolvedCitation[]
  /** Gecersiz oldugu icin atilan kaynak sayisi (teshis icin) */
  dropped: number
  /** Atilan kaynaklarin nedenleri */
  reasons: string[]
}

// --- yardimcilar -----------------------------------------------------------

/** Ham notlari anlamli satirlara boler (bos satirlar ve saf alinti satirlari haric). */
export function rawNoteLines(md: string): string[] {
  return (md ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Markdown isaretlerini temizle (AI girdisine sade metin gitsin)
    .map((l) => l.replace(/^([-*•]|\d+\.|>)\s*/, '').trim())
    .filter((l) => l.length > 0)
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Kanal etiketli transkript blogu + [T#] etiketleri */
export function buildTranscriptBlock(segments: TranscriptSegment[]): {
  block: string
  index: SourceIndex['transcripts']
} {
  const index = new Map<string, { id: string; channel: Channel; speaker: string; text: string; start_ms: number }>()
  const lines: string[] = []
  segments.forEach((s, i) => {
    const token = `T${i + 1}`
    const speaker = s.speaker_label ?? (s.channel === 'mic' ? 'Ben' : 'Karşı taraf')
    const kind = s.channel === 'mic' ? 'MIKROFON' : 'SISTEM'
    index.set(token, {
      id: s.id,
      channel: s.channel,
      speaker,
      text: s.text,
      start_ms: s.start_ms
    })
    lines.push(`[${token}] (${kind}) ${speaker} ${fmtClock(s.start_ms)}: ${s.text}`)
  })
  return { block: lines.join('\n'), index }
}

/** Ham notlar blogu + [N#] etiketleri */
export function buildRawNotesBlock(md: string): {
  block: string
  index: SourceIndex['rawNoteTokens']
} {
  const index = new Map<string, { line: string; index: number }>()
  const lines = rawNoteLines(md)
  lines.forEach((line, i) => {
    index.set(`N${i + 1}`, { line, index: i })
  })
  return { block: lines.map((l, i) => `[N${i + 1}] ${l}`).join('\n'), index }
}

/** Takvim baglami blogu + [C1] etiketi */
export function buildCalendarBlock(ev: CalendarEventMeta | null): {
  block: string
  calendar: SourceIndex['calendar']
} {
  const index = ev ? { token: 'C1', eventId: ev.id, label: ev.title } : null
  if (!ev) {
    return { block: '(takvim etkinliği yok — elle başlatılan not)', calendar: index }
  }
  const lines = [
    '[C1] Takvim etkinliği:',
    `  Başlık: ${ev.title}`,
    `  Başlangıç: ${ev.start_at}`,
    ev.end_at ? `  Bitiş: ${ev.end_at}` : null,
    ev.location ? `  Konum: ${ev.location}` : null,
    ev.participants.length > 0 ? `  Katılımcılar: ${ev.participants.join(', ')}` : '  Katılımcılar: (yok)'
  ].filter((l): l is string => Boolean(l))
  return { block: lines.join('\n'), calendar: index }
}

// --- sistem mesaji ---------------------------------------------------------

export function buildSystemPrompt(language: string, templatePrompt: string): string {
  const langLine =
    language && language !== 'auto'
      ? `Yanıt dilini şu dile sabitle: ${language}.`
      : 'Dili, konuşmanın ve ham notların çoğunlukta olduğu dili kullan.'

  return [
    'Sen bir toplantı notu asistanısın.',
    'Sana (a) kanal etiketli toplantı transkripti, (b) kullanıcının ham notları ve',
    '(c) takvim etkinliği meta verisi verilecek.',
    '',
    'Görev: KULLANICININ HAM NOTLARINI ÇEKİRDEK ALARAK, transkriptten gelen bağlamla',
    'zenginleştirilmiş, madde işaretli, okunabilir bir not üret.',
    '',
    'Kurallar:',
    '(1) Yalnızca gerçekten söyleneni veya ham notta yazılanı yaz; halüsinasyon üretme.',
    '(2) Verilmeyen bir bilgiyi uydurma. Emin değilsen maddeyi hiç yazma.',
    '(3) Ham notlar çekirdektir: kullanıcının kendi maddeleri korunmalı, transkript onları',
    '    zenginleştirmeli. Ham notta olmayan önemli bir konu transkriptte geçiyorsa ekleyebilirsin.',
    '(4) Konuşma dili/küfür varsa SANSÜRLEME; olduğu gibi koru.',
    '(5) Özel isimleri, ürün adlarını ve terimleri transkriptte geçtiği şekilde yaz.',
    '(6) Özeti kısa tut (en fazla 4 madde).',
    '(7) Boş bölüm döndürme: ilgili madde yoksa o bölümü tamamen atla.',
    langLine,
    '',
    templatePrompt ? `EK TALİMAT (şablon): ${templatePrompt}` : '',
    '',
    'HER MADDE İÇİN KAYNAK ZORUNLUDUR. Kaynakları sana verilen etiketlerle belirt:',
    '  [T#] = transkript satırı ("source": "T12")',
    '  [N#] = kullanıcının ham not satırı ("source": "N3")',
    '  [C1] = takvim etkinliği ("source": "C1")',
    '',
    'Çıktı YALNIZCA şu JSON olsun (başka hiçbir metin yazma):',
    '{',
    '  "summary": "tek paragraf kısa özet",',
    '  "sections": [',
    '    { "heading": "Ana Konular", "items": ["madde 1", "madde 2"] },',
    '    { "heading": "Kararlar", "items": ["..."] },',
    '    { "heading": "Risk / Engel", "items": ["..."] }',
    '  ],',
    '  "next_steps": [ { "task": "...", "owner": "isim veya null", "due": "tarih veya null" } ],',
    '  "citations": [',
    '    { "ref": "Ana Konular#1", "source": "T12", "excerpt": "kaynak cümlenin kısa alıntısı" }',
    '  ]',
    '}',
    '',
    'Bölüm sırası: Özet, Ana Konular, Kararlar, Risk / Engel, Sonraki Adımlar.',
    'next_steps doluysa ayrıca "Sonraki Adımlar" bölümünü sections içinde de üret.',
    '"citations" içindeki "ref" şu biçimde olmalı: "<bölüm başlığı>#<madde sırası>" (1 tabanlı).',
    'Her madde için en az bir kaynak ver.'
  ]
    .filter((l) => l !== undefined)
    .join('\n')
}

// --- kullanici mesaji ------------------------------------------------------

export function buildUserPrompt(ctx: PromptContext): { user: string; index: SourceIndex } {
  const cal = buildCalendarBlock(ctx.calendarEvent)
  const raw = buildRawNotesBlock(ctx.rawNotesMd)
  const tr = buildTranscriptBlock(ctx.transcripts)

  const index: SourceIndex = {
    transcripts: tr.index,
    rawNoteTokens: raw.index,
    calendar: cal.calendar
  }

  const parts: string[] = [
    `NOT BAŞLIĞI: ${ctx.noteTitle}`,
    '',
    '### (c) TAKVİM ETKİNLİĞİ',
    cal.block,
    '',
    '### (b) KULLANICININ HAM NOTLARI (ÇEKİRDEK — önce bunları kapsa)',
    raw.block || '(ham not yok — yalnızca transkriptten üret)',
    ''
  ]

  if (ctx.transcripts.length === 0) {
    parts.push('### (a) TRANSKRİPT', '(transkript yok — yalnızca ham notlardan üret)')
  } else {
    parts.push(
      `### (a) TRANSKRİPT (${ctx.transcripts.length} satır, kanal etiketli; ben = MIKROFON, karşı taraf = SISTEM)`,
      tr.block
    )
  }

  return { user: parts.join('\n'), index }
}

// --- yanit -> kaynak eslestirme --------------------------------------------

function normalizeRef(ref: string): string {
  return (ref ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * LLM'in dondurdugu citations'i dogrular ve gercek kaynak kimliklerine cevirir.
 * Gecersiz kaynaklar (olmayan [T#], cozulemeyen source, bos ref) ATILIR ve sayilir —
 * boylece arayuzde asla "olu" bir buyutec gostermeyiz.
 */
export function resolveCitations(rawCitations: RawCitation[], index: SourceIndex): ResolveResult {
  const citations: ResolvedCitation[] = []
  const reasons: string[] = []
  let dropped = 0

  for (const raw of rawCitations ?? []) {
    const ref = normalizeRef(String(raw?.ref ?? ''))
    if (!ref || !ref.includes('#')) {
      dropped++
      reasons.push(`gecersiz ref: ${JSON.stringify(raw?.ref)}`)
      continue
    }

    const source = String(raw?.source ?? '').trim().toUpperCase()
    const excerpt = raw?.excerpt ? String(raw.excerpt).trim().slice(0, 400) : null

    if (/^T\d+$/.test(source)) {
      const hit = index.transcripts.get(source)
      if (!hit) {
        dropped++
        reasons.push(`bilinmeyen transkript etiketi: ${source}`)
        continue
      }
      citations.push({
        sentence_ref: ref,
        source_type: 'transcript',
        source_id: hit.id,
        excerpt: excerpt || hit.text.slice(0, 240)
      })
      continue
    }

    if (/^N\d+$/.test(source)) {
      const hit = index.rawNoteTokens.get(source)
      if (!hit) {
        dropped++
        reasons.push(`bilinmeyen ham not etiketi: ${source}`)
        continue
      }
      citations.push({
        sentence_ref: ref,
        source_type: 'raw_note',
        source_id: null, // ham notun kaynagi notun kendisidir; id'yi kayit sirasinda doldururuz
        excerpt: excerpt || hit.line.slice(0, 240)
      })
      continue
    }

    if (source === 'C1') {
      if (!index.calendar) {
        dropped++
        reasons.push('takvim etkinligi yok ama C1 kaynagi verildi')
        continue
      }
      citations.push({
        sentence_ref: ref,
        source_type: 'calendar',
        source_id: index.calendar.eventId,
        excerpt: excerpt || index.calendar.label.slice(0, 240)
      })
      continue
    }

    dropped++
    reasons.push(`taninmayan kaynak: ${JSON.stringify(raw?.source)}`)
  }

  return { citations, dropped, reasons }
}

// --- yanit sekli -----------------------------------------------------------

/**
 * Model, kaynak etiketlerini ([T1], [N2], [C1]) madde metnine de yazabiliyor.
 * Bunlar ayri `citations` alaninda zaten var; metinde tekrar gorunmemeli.
 */
export function stripSourceTokens(text: string): string {
  return (text ?? '')
    // [T1] / (N2) / (C1) gibi tum bicimleri temizle (model bazen parantez kullanir)
    .replace(/\s*[\[(]\s*(?:T|N|C)\d+\s*[\])]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

export interface LlmNoteSection {
  heading: string
  items: string[]
}

export interface LlmNextStep {
  task: string
  owner: string | null
  due: string | null
}

export interface LlmNotePayload {
  summary: string
  sections: LlmNoteSection[]
  next_steps: LlmNextStep[]
  citations: RawCitation[]
}

/** Model yanitini guvenli sekilde beklenen sekle cevirir (eksik alanlari tolere eder). */
export function normalizePayload(parsed: unknown): LlmNotePayload {
  const obj = (parsed ?? {}) as Record<string, unknown>

  const summary = typeof obj.summary === 'string' ? stripSourceTokens(obj.summary) : ''

  const sections: LlmNoteSection[] = []
  for (const s of Array.isArray(obj.sections) ? obj.sections : []) {
    const sec = s as Record<string, unknown>
    const heading = typeof sec.heading === 'string' ? sec.heading.trim() : ''
    const items = (Array.isArray(sec.items) ? sec.items : [])
      .map((i) => (typeof i === 'string' ? stripSourceTokens(i) : ''))
      .filter(Boolean)
    if (heading && items.length > 0) sections.push({ heading, items })
  }

  const nextSteps: LlmNextStep[] = []
  for (const n of Array.isArray(obj.next_steps) ? obj.next_steps : []) {
    if (typeof n === 'string') {
      const task = stripSourceTokens(n)
      if (task) nextSteps.push({ task, owner: null, due: null })
      continue
    }
    const ns = n as Record<string, unknown>
    const task = typeof ns.task === 'string' ? stripSourceTokens(ns.task) : ''
    if (!task) continue
    nextSteps.push({
      task,
      owner: typeof ns.owner === 'string' && ns.owner.trim() ? ns.owner.trim() : null,
      due: typeof ns.due === 'string' && ns.due.trim() ? ns.due.trim() : null
    })
  }

  const citations: RawCitation[] = (Array.isArray(obj.citations) ? obj.citations : []).map((c) => {
    const cc = c as Record<string, unknown>
    return {
      ref: typeof cc.ref === 'string' ? cc.ref : '',
      source: typeof cc.source === 'string' ? cc.source : '',
      excerpt: typeof cc.excerpt === 'string' ? cc.excerpt : undefined
    }
  })

  return { summary, sections, next_steps: nextSteps, citations }
}

/**
 * Dogrulanmis yuku markdown'a cevirir.
 * DIKKAT: Ayni donusum arayuz tarafinda da okunur (parseEnhanced), bu yuzden
 * bicim sabittir: "## Baslik" ve "- madde". Sonraki Adimlar maddeleri
 * "gorev — sorumlu — tarih" bicimindedir.
 */
export function payloadToMarkdown(payload: LlmNotePayload): string {
  const out: string[] = []

  if (payload.summary) {
    out.push('## Özet', `- ${payload.summary}`, '')
  }

  for (const sec of payload.sections) {
    out.push(`## ${sec.heading}`)
    for (const item of sec.items) out.push(`- ${item}`)
    out.push('')
  }

  // next_steps ayri tablo gibi degil, ayri bir bolum olarak da yazilir
  if (payload.next_steps.length > 0 && !payload.sections.some((s) => /sonraki/i.test(s.heading))) {
    out.push('## Sonraki Adımlar')
    for (const ns of payload.next_steps) {
      const bits = [ns.task]
      if (ns.owner) bits.push(`sorumlu: ${ns.owner}`)
      if (ns.due) bits.push(`tarih: ${ns.due}`)
      out.push(`- ${bits.join(' — ')}`)
    }
    out.push('')
  }

  return out.join('\n').trim()
}