// ============================================================================
//  FAZ 5 — Brief ve kapsamli soru-cevap icin SAF istem (prompt) kuruculari.
//
//  Kaynak etiketleri Faz 4 ile ayni mantik: [N#] = not kimligi.
//  Boylece LLM "N3" der, biz gercek note_id'ye deterministik cozeriz.
// ============================================================================

export interface ScopedNoteInput {
  noteId: string
  title: string
  startedAt: string
  source: string
  /** Kanall etiketli transkript metni (kirpilmis) */
  transcript: string
  rawNotes: string
  enhanced: string
}

/** 'N1' -> {not kimligi, baslik} */
export type ScopedIndex = Map<string, { id: string; title: string }>

function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

/** Baglami [N#] etiketli bloklara cevirir + ters indeks doner. */
export function buildScopedContext(
  notes: ScopedNoteInput[],
  opts?: { maxCharsPerNote?: number; maxTotalChars?: number }
): { block: string; index: ScopedIndex } {
  const perNote = opts?.maxCharsPerNote ?? 3500
  const total = opts?.maxTotalChars ?? 24000
  const index: ScopedIndex = new Map()
  const chunks: string[] = []
  let used = 0

  notes.forEach((n, i) => {
    if (used >= total) return
    const token = `N${i + 1}`
    index.set(token, { id: n.noteId, title: n.title })

    const parts: string[] = [`[${token}] ${n.title} — ${clock(n.startedAt)} (${n.source})`]
    if (n.rawNotes.trim()) parts.push(`  Ham notlar: ${n.rawNotes.trim().slice(0, perNote / 2)}`)
    if (n.enhanced.trim()) parts.push(`  Üretilmiş not: ${n.enhanced.trim().slice(0, perNote / 2)}`)
    if (n.transcript.trim()) parts.push(`  Transkript: ${n.transcript.trim().slice(0, perNote)}`)

    const chunk = parts.join('\n')
    if (used + chunk.length > total) {
      const room = total - used
      if (room > 400) chunks.push(chunk.slice(0, room) + '…')
      used = total
      return
    }
    chunks.push(chunk)
    used += chunk.length
  })

  return { block: chunks.join('\n\n'), index }
}

export function buildBriefSystemPrompt(language: string): string {
  const lang = language && language !== 'auto' ? `Yanıt dili: ${language}.` : 'Yanıt dilini notların diline uydur.'
  return [
    'Sen bir toplantı öncesi brifing asistanısın.',
    'Sana KULLANICININ GEÇMİŞ NOTLARI ve (varsa) YAKLAŞAN TAKVİM ETKİNLİĞİ verilecek.',
    '',
    'Görev: Bu toplantıya girmeden önce kullanıcının bilmesi gereken EN ÖNEMLİ 2-3 maddeyi yaz.',
    'Yani: geçmişte ne konuşulmuş, hangi kararlar alınmış, hangi konular AÇIK kalmış, neye dikkat etmeli.',
    '',
    'Kurallar:',
    '(1) Yalnızca verilen notlarda geçen bilgiyi kullan; halüsinasyon üretme.',
    '(2) En fazla 3 madde. Her madde tek cümle, somut ve eyleme dönük olsun.',
    '(3) Genel geçer tavsiye yazma ("iyi bir toplantı geçirin" gibi). Sadece bu kişi/şirket/toplantıya özel bilgi.',
    '(4) Bilgi yetersizse daha AZ madde yaz; uydurma. Hiç bilgi yoksa boş liste döndür.',
    '(5) Açık kalan konuları ve riskleri öne çıkar.',
    lang,
    '',
    'Çıktı YALNIZCA şu JSON olsun (başka metin yazma):',
    '{',
    '  "items": [',
    '    { "text": "madde", "source": "N2", "excerpt": "dayandığı kısa alıntı" }',
    '  ]',
    '}',
    '"source" alanına maddeyi dayandırdığın notun etiketini yaz (or. "N3"). Emin değilsen null yaz.'
  ].join('\n')
}

export function buildBriefUserPrompt(
  ctx: { block: string },
  event: { title: string; start_at: string; participants: string[] } | null
): string {
  const parts: string[] = []
  if (event) {
    parts.push(
      '### YAKLAŞAN TOPLANTI',
      `Başlık: ${event.title}`,
      `Zaman: ${clock(event.start_at)}`,
      event.participants.length ? `Katılımcılar: ${event.participants.join(', ')}` : 'Katılımcılar: (yok)',
      ''
    )
  } else {
    parts.push('### YAKLAŞAN TOPLANTI', '(takvim bilgisi yok — geçmiş notlara göre genel brifing)', '')
  }
  parts.push('### GEÇMİŞ NOTLAR', ctx.block || '(not yok)')
  return parts.join('\n')
}

export function buildAskSystemPrompt(language: string): string {
  const lang = language && language !== 'auto' ? `Yanıt dili: ${language}.` : 'Yanıt dilini sorunun diline uydur.'
  return [
    'Sen kullanıcının kendi notları üzerinde çalışan bir soru-cevap asistanısın.',
    'Sana kullanıcının notları ([N#] etiketli) ve bir SORU verilecek.',
    '',
    'Kurallar:',
    '(1) YALNIZCA verilen notlardaki bilgiyi kullan. Notlarda olmayan bir şeyi uydurma.',
    '(2) Bilgi notlarda yoksa açıkça "Notlarınızda bu bilgi yok" de. Tahmin yürütme.',
    '(3) Cevabı kısa ve madde madde yaz; gereksiz giriş cümlesi yazma.',
    '(4) Her iddiayı bir not etiketine dayandır ([N2] gibi).',
    '(5) Kullanıcının kendi ham notları varsa onlara öncelik ver.',
    lang,
    '',
    'Çıktı YALNIZCA şu JSON olsun (başka metin yazma):',
    '{',
    '  "answer_md": "cevap (markdown, madde işaretli olabilir)",',
    '  "citations": [ { "source": "N2", "excerpt": "dayandığı kısa alıntı" } ]',
    '}'
  ].join('\n')
}

/**
 * Sohbet icin sistem mesaji. Faz 5 soru-cevap kurallarina ek olarak
 * COK TURLU baglam ve "onceki konusmaya tutarli ol" kurali ekler.
 */
export function buildChatSystemPrompt(language: string): string {
  const lang =
    language && language !== 'auto' ? `Yanıt dili: ${language}.` : 'Yanıt dilini sorunun diline uydur.'
  return [
    'Sen kullanıcının kendi notları üzerinde çalışan bir asistanın.',
    'Sana kullanıcının notları ([N#] etiketli), önceki konuşma turları ve yeni bir SORU verilecek.',
    '',
    'Kurallar:',
    '(1) YALNIZCA verilen notlardaki bilgiyi kullan. Notlarda olmayan bir şeyi uydurma.',
    '(2) Bilgi notlarda yoksa açıkça "Notlarınızda bu bilgi yok" de. Tahmin yürütme.',
    '(3) Önceki turlarla TUTARLI ol; kullanıcı bir şeyi netleştirdiyse onu koru.',
    '(4) Kısa ve madde madde yaz; gereksiz giriş/kapanış cümlesi yazma.',
    '(5) Her iddiayı bir not etiketine dayandır ([N2] gibi). Aynı nota birden çok kez atıf yapabilirsin.',
    '(6) Kullanıcının kendi ham notları varsa onlara öncelik ver.',
    lang,
    '',
    'Çıktı YALNIZCA şu JSON olsun (başka metin yazma):',
    '{',
    '  "answer_md": "cevap (markdown)",',
    '  "citations": [ { "source": "N2", "excerpt": "dayandığı kısa alıntı" } ]',
    '}'
  ].join('\n')
}

export interface RawScopedCitation {
  source?: string
  excerpt?: string
}

export interface ResolvedScopedCitation {
  note_id: string
  note_title: string
  source_type: 'previous_note'
  excerpt: string | null
}

/** LLM'in [N#] kaynaklarini gercek not kimliklerine cevirir; gecersizleri atar. */
export function resolveScopedCitations(
  raw: RawScopedCitation[],
  index: ScopedIndex
): { citations: ResolvedScopedCitation[]; dropped: number } {
  const out: ResolvedScopedCitation[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const c of raw ?? []) {
    const src = String(c?.source ?? '').trim().toUpperCase()
    if (!/^N\d+$/.test(src)) {
      dropped++
      continue
    }
    const hit = index.get(src)
    if (!hit) {
      dropped++
      continue
    }
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    out.push({
      note_id: hit.id,
      note_title: hit.title,
      source_type: 'previous_note',
      excerpt: c.excerpt ? String(c.excerpt).trim().slice(0, 300) : null
    })
  }
  return { citations: out, dropped }
}

export interface RawBriefItem {
  text: string
  source: string | null
  excerpt: string | null
}

export interface RawBriefPayload {
  items?: RawBriefItem[]
}

export function normalizeBriefPayload(parsed: unknown): RawBriefPayload {
  const obj = (parsed ?? {}) as Record<string, unknown>
  const items = Array.isArray(obj.items) ? obj.items : []
  const out: RawBriefItem[] = []
  for (const raw of items) {
    const it = raw as Record<string, unknown>
    const text = typeof it.text === 'string' ? it.text.trim() : ''
    if (!text) continue
    out.push({
      text,
      source: typeof it.source === 'string' ? it.source.trim().toUpperCase() : null,
      excerpt: typeof it.excerpt === 'string' ? it.excerpt.trim() : null
    })
    if (out.length >= 3) break
  }
  return { items: out }
}

export function normalizeAskPayload(parsed: unknown): {
  answer_md: string
  citations: RawScopedCitation[]
} {
  const obj = (parsed ?? {}) as Record<string, unknown>
  return {
    answer_md: typeof obj.answer_md === 'string' ? obj.answer_md.trim() : '',
    citations: (Array.isArray(obj.citations) ? obj.citations : []).map((c) => {
      const cc = c as Record<string, unknown>
      return {
        source: typeof cc.source === 'string' ? cc.source : '',
        excerpt: typeof cc.excerpt === 'string' ? cc.excerpt : undefined
      }
    })
  }
}