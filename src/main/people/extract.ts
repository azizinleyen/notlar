// ============================================================================
//  Kisi / sirket cikarimi — SAF FONKSIYONLAR (test edilebilir)
//
//  FELSEFE: "Yalnizca gerçekten geçeni yaz; halüsinasyon üretme."
//  Bu yuzden her kayit DELIL (kanit cumlesi) ile gelir ve delil metinde
//  GERÇEKTEN gecmiyorsa kayit ATILIR. Bu kontrol, LLM'in uydurdugu isimleri
//  disarida tutar; uydurma bir kisi dizine dusemez.
// ============================================================================

export interface ExtractedPerson {
  name: string
  email: string | null
  title: string | null
  company: string | null
  /** Metinde gecen kanit cumlesi */
  evidence: string
  /** Kaynak: 'attendee' (takvim) | 'email' | 'text' */
  origin: 'attendee' | 'email' | 'llm'
}

export interface ExtractedCompany {
  name: string
  domain: string | null
  evidence: string
}

export interface ExtractionCounts {
  valid: number
  dropped: number
  reasons: string[]
}

export interface NormalizedExtraction {
  people: ExtractedPerson[]
  companies: ExtractedCompany[]
  dropped: number
  reasons: string[]
}

// --- normalizasyon ---------------------------------------------------------

/**
 * Karsilastirma icin sadelesmis metin: kucuk harf, tek bosluk, noktalama yok.
 *
 * DIKKAT (gercek hata): `toLocaleLowerCase('tr')` Turkce'de I -> ı yapar ve
 * Ingilizce kisaltmalari bozar ('API' -> 'apı', 'Team' -> 'team' ama 'I' -> 'ı').
 * Bu yuzden once I varyantlari (I/İ/ı) TEK harfe ('i') indirilir, sonra
 * yerel-bagimsiz kucuk harfe cevrilir. Sonuc: 'API' ile 'api' eslesir.
 * Diger aksanlar (ş, ü, ğ) KORUNUR; boylece 'ş' ile 's' karismaz.
 */
export function foldText(input: string): string {
  return (input ?? '')
    .replace(/[İIı]/g, 'i') // I / İ / ı -> i
    .toLocaleLowerCase('en')
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Sarah Jones" -> "sarah jones" (kimlik anahtari) */
export function normalizePersonKey(name: string): string {
  return foldText(name)
}

/**
 * Ayni kisi mi?
 *
 * Kurallar (hepsi gerekceli):
 *  1) Tam esitlik.
 *  2) "Sarah Jones" ~ "Sarah J." -> soyadinin kisaltma olmasi kabul.
 *  3) "Sarah" ~ "Sarah Jones" -> tek kelimeli ad, cok kelimelinin ILK adi ise kabul.
 *     (Takvimde "Sarah Jones", transkriptte "Sarah" gecmesi cok yaygin; iki ayri
 *      kayit olusturmak dizini kirletirdi. Kullanici gerekirse Ayarlar'daki
 *      birlestirme/ayirma ile duzeltebilir.)
 *  4) Farkli soylu iki isim ASLA eslesmez ('Sarah Jones' != 'Sarah Lee').
 */
export function samePerson(a: string, b: string): boolean {
  const ka = normalizePersonKey(a)
  const kb = normalizePersonKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true

  const pa = ka.split(' ')
  const pb = kb.split(' ')

  // 3) tek kelime <-> cok kelime: ilk ad eslesmeli
  if (pa.length === 1 || pb.length === 1) {
    const single = pa.length === 1 ? pa[0] : pb[0]
    const multi = pa.length === 1 ? pb : pa
    return multi[0] === single
  }

  // 2) iki taraf da cok kelimeli: ilk ad ayni olmali
  if (pa[0] !== pb[0]) return false
  const la = pa[pa.length - 1]
  const lb = pb[pb.length - 1]
  if (la === lb) return true
  // kisaltma: "j." -> "jones"
  if (lb.length === 1 && la.startsWith(lb)) return true
  if (la.length === 1 && lb.startsWith(la)) return true
  return false
}

/** E-posta adresi gecerli mi (kaba kontrol) */
export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test((value ?? '').trim())
}

export function emailDomain(email: string): string | null {
  if (!isEmailLike(email)) return null
  const domain = email.trim().split('@')[1]?.toLocaleLowerCase('en') ?? ''
  if (!domain) return null
  // Genel amacli saglayicilar sirket sayilmaz
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return null
  return domain
}

/** Ucretsiz/genel e-posta saglayicilari (sirket cikarimindan haric) */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.com.tr',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yandex.com',
  'yandex.ru',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'mail.ru',
  'gmx.com',
  'gmx.de',
  'aol.com',
  'zoho.com',
  'tutanota.com'
])

/** Metin bir alan adi gibi mi gorunuyor? ("acme.com", "ornek-firma.com.tr") */
export function looksLikeDomain(value: string): boolean {
  const v = (value ?? '').trim().toLocaleLowerCase('en')
  if (!v || v.includes(' ')) return false
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)
}

/**
 * LLM bazen sirket adi yerine ALAN ADINI yazar ("ornek-firma.com").
 * Boyle bir deger geldiginde alan adindan okunabilir isim turetiriz;
 * aksi halde dizinde "ornek-firma.com" gibi bir sirket adi gorunurdu.
 */
export function normalizeCompanyName(name: string | null | undefined, domain: string | null): string | null {
  const n = (name ?? '').trim()
  const d = (domain ?? '').trim() || null

  if (!n) return companyNameFromDomain(d)
  if (looksLikeDomain(n)) {
    // Alan adi verilmisse onu kullan; yoksa metnin kendisini alan adi say
    return companyNameFromDomain(d ?? n)
  }
  return n
}

/**
 * "ornek-firma.com.tr" -> "Ornek Firma"
 * Sirket adi tahmini: alan adinin ilk etiketi, tire/alt cizgi ile ayrilir.
 */
export function companyNameFromDomain(domain: string | null): string | null {
  if (!domain) return null
  const first = domain.split('.')[0] ?? ''
  if (!first || first.length < 2) return null
  return first
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))
    .join(' ')
}

// --- delil dogrulama -------------------------------------------------------

/**
 * Delil metinde gerçekten geciyor mu?
 * Model bazen cumleyi degistirir; bu yuzden once tam, sonra sadelesmis
 * metinde arariz. Kisa deliller (< 12 karakter) kabul edilmez.
 */
export function evidenceGrounded(evidence: string | null, haystack: string): boolean {
  const ev = (evidence ?? '').trim()
  if (ev.length < 12) return false
  if (!haystack) return false
  if (haystack.includes(ev)) return true
  const foldedEv = foldText(ev)
  if (foldedEv.length < 10) return false
  return foldText(haystack).includes(foldedEv)
}

/** Isim metinde geciyor mu? (delil bulunamasa bile isim dogrulanabilir) */
/**
 * Isim metinde geciyor mu?
 * Yalnizca KELIME SINIRI ile eslesir: "Sar" -> "Sarah" eslesmesi OLMAMALI
 * (kismi eslesme, uydurma isimleri yanlislikla kabul ettirirdi).
 */
export function nameMentioned(name: string, haystack: string): boolean {
  const key = normalizePersonKey(name)
  if (!key) return false
  const folded = foldText(haystack)
  if (!folded) return false
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}($|\\s)`, 'u').test(folded)
}

// --- kaynak kesifleri ------------------------------------------------------

/** Metindeki e-posta adreslerini bulur. */
export function findEmails(text: string): Array<{ email: string; index: number }> {
  const out: Array<{ email: string; index: number }> = []
  const re = /[^\s<>()[\],;]+@[^\s<>()[\],;]+\.[A-Za-z]{2,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text ?? '')) !== null) {
    const email = m[0].replace(/[.,;:]+$/, '')
    if (isEmailLike(email)) out.push({ email, index: m.index })
  }
  return out
}

/** E-postadan gorunen ad tahmini: "sarah.jones@x.com" -> "Sarah Jones" */
export function nameFromEmail(email: string): string | null {
  const local = (email ?? '').split('@')[0] ?? ''
  if (!local) return null
  const parts = local
    .split(/[._\-+]/)
    .map((p) => p.replace(/[0-9]+$/g, ''))
    .filter((p) => p.length > 1)
  if (parts.length === 0) return null
  return parts.map((p) => p.charAt(0).toLocaleUpperCase('tr') + p.slice(1)).join(' ')
}

/** Takvim katilimi satirindan ad ve e-posta ayiklar: "Sarah Jones <s@x.com>" */
export function parseAttendeeLine(raw: string): { name: string; email: string | null } | null {
  const line = (raw ?? '').trim()
  if (!line) return null
  const m = /^(.*?)[<\s]*([^\s<>]+@[^\s<>]+)[>\s]*$/.exec(line)
  if (m) {
    const name = m[1].replace(/[",]+$/g, '').trim() || nameFromEmail(m[2]) || m[2]
    return { name, email: m[2] }
  }
  // Yalnizca e-posta ise addan turet
  if (isEmailLike(line)) return { name: nameFromEmail(line) ?? line, email: line }
  // Yalnizca isimse
  if (line.length >= 2) return { name: line, email: null }
  return null
}

// --- birlestirme + dogrulama ----------------------------------------------

function companyKey(name: string): string {
  return foldText(name)
}

export interface MergeInput {
  /** Takvim katilimcilari ("Ad <eposta>" veya "Ad") */
  attendees: string[]
  /** Metinden bulunan e-postalar */
  emails: Array<{ email: string; evidence: string }>
  /** LLM'in onerdigi kayitlar (delil zorunlu) */
  llmPeople: Array<{ name: string; email?: string | null; title?: string | null; company?: string | null; evidence?: string | null }>
  llmCompanies: Array<{ name: string; domain?: string | null; evidence?: string | null }>
  /** Takvim basligi/aciklamasi (delil havuzu) */
  calendarText: string
  /** Transkript + ham notlarin birlestirilmis metni (delil havuzu) */
  sourceText: string
}

/**
 * Tum kaynaklari birlestirir, dogrular ve tekrarlari kaldirir.
 *
 * Dogrulama kurallari:
 *  - Takvim katilimcilari: guvenilir (takvimde adi gecer) -> dogrudan kabul.
 *  - Metinden e-posta: kabul (delil e-postanin kendisi).
 *  - LLM kayitlari: DELIL ZORUNLU ve delil `sourceText` icinde gecmeli.
 *  - Sirket: alan adi varsa kabul; yalnizca ad verilmisse kaynakta gecmeli.
 */
export function mergeExtractions(input: MergeInput): NormalizedExtraction {
  const people: ExtractedPerson[] = []
  const companies: ExtractedCompany[] = []
  const reasons: string[] = []
  let dropped = 0

  const pushCompany = (c: ExtractedCompany): void => {
    // Ad alan adi gibi gorunuyorsa okunabilir isme cevir ("acme.com" -> "Acme")
    const normalized = normalizeCompanyName(c.name, c.domain)
    if (!normalized) return
    const key = companyKey(normalized)
    if (!key) return
    const existing = companies.find((x) => companyKey(x.name) === key)
    if (existing) {
      // Ayni sirket: eksik alan adini doldur
      if (!existing.domain && c.domain) existing.domain = c.domain
      return
    }
    companies.push({ ...c, name: normalized })
  }

  const pushPerson = (p: ExtractedPerson): boolean => {
    const key = normalizePersonKey(p.name)
    if (!key) return false
    const dup = people.find((x) => samePerson(x.name, p.name))
    if (dup) {
      // Mevcut kaydi zenginlestir (bos alanlari doldur)
      if (!dup.email && p.email) dup.email = p.email
      if (!dup.title && p.title) dup.title = p.title
      if (!dup.company && p.company) dup.company = p.company
      return false
    }
    people.push(p)
    return true
  }

  // 1) Takvim katilimcilari (en guvenilir kaynak)
  for (const raw of input.attendees ?? []) {
    const parsed = parseAttendeeLine(raw)
    if (!parsed) continue
    const domain = parsed.email ? emailDomain(parsed.email) : null
    const company = companyNameFromDomain(domain)
    pushPerson({
      name: parsed.name,
      email: parsed.email,
      title: null,
      company,
      evidence: `Takvim katılımcısı: ${raw}`,
      origin: 'attendee'
    })
    if (company && domain) {
      pushCompany({ name: company, domain, evidence: `Katılımcı e-postası: ${parsed.email}` })
    }
  }

  // 2) Metinden e-postalar
  for (const e of input.emails ?? []) {
    const domain = emailDomain(e.email)
    const company = companyNameFromDomain(domain)
    const guess = nameFromEmail(e.email)
    if (guess) {
      pushPerson({
        name: guess,
        email: e.email,
        title: null,
        company,
        evidence: e.evidence,
        origin: 'email'
      })
    }
    if (company && domain) pushCompany({ name: company, domain, evidence: e.evidence })
  }

  // 3) LLM kayitlari (delil zorunlu)
  for (const p of input.llmPeople ?? []) {
    const name = (p.name ?? '').trim()
    if (!name) {
      dropped++
      reasons.push('LLM kaydi: isim bos')
      continue
    }
    const evidence = (p.evidence ?? '').trim()
    const grounded = evidenceGrounded(evidence, input.sourceText)
    const mentioned = nameMentioned(name, input.sourceText) || nameMentioned(name, input.calendarText)
    if (!grounded && !mentioned) {
      dropped++
      reasons.push(`delil bulunamadi: ${name}`)
      continue
    }
    const domain = p.email ? emailDomain(p.email) : null
    const companyName = (p.company ?? '').trim() || companyNameFromDomain(domain)
    if (companyName) {
      if (domain) pushCompany({ name: companyName, domain, evidence: evidence || `E-posta: ${p.email}` })
      else if (evidenceGrounded(evidence, input.sourceText)) {
        pushCompany({ name: companyName, domain: null, evidence })
      }
    }
    pushPerson({
      name,
      email: (p.email ?? '').trim() || null,
      title: (p.title ?? '').trim() || null,
      company: companyName || null,
      evidence: evidence || `${name} konuşmada geçti`,
      origin: 'llm'
    })
  }

  // 4) LLM sirket kayitlari (delil zorunlu)
  for (const c of input.llmCompanies ?? []) {
    const name = (c.name ?? '').trim()
    if (!name) {
      dropped++
      continue
    }
    const evidence = (c.evidence ?? '').trim()
    const domain = (c.domain ?? '').trim() || null
    if (!domain && !evidenceGrounded(evidence, input.sourceText)) {
      dropped++
      reasons.push(`sirket delili bulunamadi: ${name}`)
      continue
    }
    pushCompany({ name, domain, evidence: evidence || `Alan adı: ${domain}` })
  }

  return { people, companies, dropped, reasons }
}

// --- tekrar (dedupe) planlayicisi -----------------------------------------

export interface PersonRef {
  id: string
  name: string
  email?: string | null
  noteCount?: number
}

export interface MergeDecision {
  fromId: string
  toId: string
  reason: string
}

/**
 * Ayni kisi gibi gorunen kayitlari bulur.
 *
 * KURAL (temkinli): yalnizca AYNI NOTTA birlikte gecen kisiler birlestirilir.
 * Gerekce: ayni toplantida hem "Sarah" hem "Sarah Jones" gecmesi neredeyse
 * kesin ayni kisidir; farkli notlarda gecen "Ali" ve "Ali Yilmaz" ise iki ayri
 * kisi olabilir — orada birleştirmek veri bozardi.
 *
 * Hedef kayit secimi: (1) e-postasi olan, (2) daha cok notta gecen,
 * (3) daha uzun ad (daha bilgilendirici) tercih edilir.
 */
export function planPersonMerges(
  notes: Array<{ noteId: string; people: PersonRef[] }>
): MergeDecision[] {
  const decisions: MergeDecision[] = []
  const alreadyMerged = new Set<string>()

  const score = (p: PersonRef): number =>
    (p.email ? 1_000_000 : 0) + (p.noteCount ?? 0) * 1000 + p.name.trim().length

  for (const note of notes) {
    const people = note.people.filter((p) => !alreadyMerged.has(p.id))
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i]
        const b = people[j]
        if (!samePerson(a.name, b.name)) continue
        const [from, to] = score(a) >= score(b) ? [b, a] : [a, b]
        decisions.push({
          fromId: from.id,
          toId: to.id,
          reason: `ayni notta birlikte gecti: "${a.name}" ~ "${b.name}"`
        })
        alreadyMerged.add(from.id)
      }
    }
  }
  return decisions
}

/** Ayni e-posta adresine sahip kayitlar kesin ayni kisidir (not fark etmeksizin). */
export function planEmailMerges(people: PersonRef[]): MergeDecision[] {
  const byEmail = new Map<string, PersonRef[]>()
  for (const p of people) {
    const e = (p.email ?? '').trim().toLocaleLowerCase('en')
    if (!e) continue
    byEmail.set(e, [...(byEmail.get(e) ?? []), p])
  }
  const out: MergeDecision[] = []
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (b.noteCount ?? 0) * 1000 + b.name.length - ((a.noteCount ?? 0) * 1000 + a.name.length))
    const keep = sorted[0]
    for (const other of sorted.slice(1)) {
      out.push({ fromId: other.id, toId: keep.id, reason: `ayni e-posta: ${email}` })
    }
  }
  return out
}


/**
 * Mevcut bir kaydin adi, daha bilgilendirici bir adla YUKSELTILMELI mi?
 *
 * Kural: yalnizca mevcut ad TEK kelimeyse ve yeni ad ayni ilk adla baslayan
 * COK kelimeli bir adsa yukseltilir ("Sarah" -> "Sarah Jones").
 * Boylece kullanicinin elle yazdigi tam ad asla kisa bir adla EZILMEZ.
 */
export function shouldUpgradeName(current: string, next: string): boolean {
  const cur = normalizePersonKey(current)
  const nxt = normalizePersonKey(next)
  if (!cur || !nxt || cur === nxt) return false
  if (!samePerson(current, next)) return false
  const curParts = cur.split(' ')
  const nxtParts = nxt.split(' ')
  return curParts.length === 1 && nxtParts.length > 1 && nxtParts[0] === curParts[0]
}
