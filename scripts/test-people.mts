#!/usr/bin/env node
/**
 * test-people.mts — Kisi/sirket cikariminin SAF fonksiyon testleri.
 * En kritik test: DELIL DOGRULAMA (uydurma kisiler dizine dusmemeli).
 */
import {
  companyNameFromDomain,
  emailDomain,
  evidenceGrounded,
  findEmails,
  foldText,
  isEmailLike,
  mergeExtractions,
  nameFromEmail,
  nameMentioned,
  normalizePersonKey,
  parseAttendeeLine,
  samePerson,
  PUBLIC_EMAIL_DOMAINS
} from '../src/main/people/extract.ts'
import { looksLikeDomain, normalizeCompanyName, planEmailMerges, planPersonMerges, shouldUpgradeName } from '../src/main/people/extract.ts'
import {
  buildScopedContext,
  normalizeAskPayload,
  normalizeBriefPayload,
  resolveScopedCitations,
  buildBriefSystemPrompt,
  buildAskSystemPrompt
} from '../src/main/llm/scoped.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

console.log('\n[1] Metin sadelestirme ve isim anahtari')
{
  check('buyuk/kucuk harf', normalizePersonKey('Sarah JONES') === 'sarah jones', normalizePersonKey('Sarah JONES'))
  check('Turkce I sorunu', normalizePersonKey('İSMAİL') === 'ismail', normalizePersonKey('İSMAİL'))
  check('noktalama temizlenir', normalizePersonKey('Elif-Demir') === 'elif demir', normalizePersonKey('Elif-Demir'))
  check('fold: aksan korunur', foldText('Şükrü') === 'şükrü', foldText('Şükrü'))

  check('ayni isim', samePerson('Sarah Jones', 'sarah jones'))
  check('farkli isim', !samePerson('Sarah Jones', 'James Lee'))
  check('kisaltma eslesir', samePerson('Sarah Jones', 'Sarah J.'), 'Sarah Jones ~ Sarah J.')
  check('bos isim eslesmez', !samePerson('', 'Sarah'))
}

console.log('\n[2] E-posta yardimcilari')
{
  check('gecerli e-posta', isEmailLike('a@b.com'))
  check('gecersiz e-posta', !isEmailLike('a@b'))
  check('alan adi', emailDomain('sarah@acme.com') === 'acme.com')
  check('buyuk harf alan adi', emailDomain('sarah@ACME.COM') === 'acme.com')
  check('gmail sirket sayilmaz', emailDomain('sarah@gmail.com') === null)
  check('gmail listede', PUBLIC_EMAIL_DOMAINS.has('gmail.com'))

  check('e-postadan isim', nameFromEmail('sarah.jones@acme.com') === 'Sarah Jones', nameFromEmail('sarah.jones@acme.com'))
  check('rakam temizlenir', nameFromEmail('elif.demir2@x.com') === 'Elif Demir', nameFromEmail('elif.demir2@x.com'))
  check('tek kelime', nameFromEmail('deniz@x.com') === 'Deniz')

  check('alan adindan sirket', companyNameFromDomain('acme.com') === 'Acme')
  check('tireli alan adi', companyNameFromDomain('ornek-firma.com.tr') === 'Ornek Firma', companyNameFromDomain('ornek-firma.com.tr'))
  check('null alan adi', companyNameFromDomain(null) === null)

  const found = findEmails('Bana sarah.jones@acme.com adresinden yaz, ya da j@b.co.')
  check('metinden 2 e-posta', found.length === 2, JSON.stringify(found.map((f) => f.email)))
  check('sondaki nokta temizlendi', found[1].email === 'j@b.co', found[1].email)
}

console.log('\n[3] Takvim katilimi ayristirma')
{
  const a = parseAttendeeLine('Sarah Jones <sarah@acme.com>')
  check('ad + e-posta', a?.name === 'Sarah Jones' && a?.email === 'sarah@acme.com', JSON.stringify(a))
  const b = parseAttendeeLine('sarah@acme.com')
  check('yalnizca e-posta -> addan isim', b?.name === 'Sarah' && b?.email === 'sarah@acme.com', JSON.stringify(b))
  const c = parseAttendeeLine('Deniz Yılmaz')
  check('yalnizca isim', c?.name === 'Deniz Yılmaz' && c?.email === null)
  check('bos satir null', parseAttendeeLine('  ') === null)
}

console.log('\n[4] DELIL DOGRULAMA (uydurma engeli)')
{
  const haystack = 'Sarah: Backend API neredeyse hazır, uç durumlar kaldı. James: Dashboard yüzde seksen.'
  check('birebir alinti kabul', evidenceGrounded('Backend API neredeyse hazır', haystack))
  check('buyuk/kucuk harf toleransi', evidenceGrounded('backend api NEREDEYSE hazır', haystack))
  check('noktalama toleransi', evidenceGrounded('Backend API neredeyse hazir', haystack))
  check('uydurma alinti REDDEDILIR', !evidenceGrounded('Muhasebe raporu tamamlandı', haystack))
  check('kisa alinti reddedilir', !evidenceGrounded('kısa', haystack))
  check('bos alinti reddedilir', !evidenceGrounded('', haystack))
  check('bos kaynak reddedilir', !evidenceGrounded('Backend API', ''))

  check('isim metinde gecer', nameMentioned('Sarah', haystack))
  check('tam isim gecer', nameMentioned('Sarah Jones', 'Sarah Jones toplantıya katıldı'))
  check('olmayan isim', !nameMentioned('Mehmet', haystack))
  check('kismi eslesme olmaz', !nameMentioned('Sar', haystack), 'iki harfli parca eslesmemeli')
}

console.log('\n[5] Birlestirme: takvim + e-posta + LLM')
{
  const sourceText =
    'Sarah Jones: Backend API neredeyse hazır. James: Dashboard yüzde seksen tamam. acme.com ekibi geldi.'
  const merged = mergeExtractions({
    attendees: ['Sarah Jones <sarah@acme.com>', 'James Lee'],
    emails: [{ email: 'elif@beta.io', evidence: 'Elif: elif@beta.io adresinden yazın' }],
    llmPeople: [
      { name: 'Sarah Jones', title: 'Ürün Yöneticisi', evidence: 'Sarah Jones: Backend API neredeyse hazır' },
      { name: 'Uydurma Kisi', title: 'CEO', evidence: 'bu cümle metinde yok' }, // ATILMALI
      { name: 'James', company: 'Acme', evidence: 'James: Dashboard yüzde seksen tamam' }
    ],
    llmCompanies: [
      { name: 'Acme', domain: 'acme.com', evidence: 'acme.com ekibi geldi' },
      { name: 'Uydurma AS', evidence: 'metinde gecmiyor' } // ATILMALI
    ],
    calendarText: 'Q3 Planlama',
    sourceText
  })

  const names = merged.people.map((p) => p.name)
  check('Sarah birlesik (tek kayit)', merged.people.filter((p) => samePerson(p.name, 'Sarah Jones')).length === 1, JSON.stringify(names))
  check('Sarah unvani zenginlesti', merged.people.find((p) => samePerson(p.name, 'Sarah'))?.title === 'Ürün Yöneticisi')
  check('Sarah e-postasi takvimden', merged.people.find((p) => samePerson(p.name, 'Sarah'))?.email === 'sarah@acme.com')
  check('James eklendi', merged.people.some((p) => samePerson(p.name, 'James')))
  check('Elif e-postadan eklendi', merged.people.some((p) => samePerson(p.name, 'Elif')))
  check('UYDURMA KISI ATILDI', !merged.people.some((p) => p.name.includes('Uydurma')), JSON.stringify(names))
  check('atilan sayisi 2', merged.dropped === 2, String(merged.dropped))
  check('atilma nedenleri kayitli', merged.reasons.length === 2, JSON.stringify(merged.reasons))

  const comps = merged.companies.map((c) => c.name)
  check('Acme sirketi var', comps.includes('Acme'), JSON.stringify(comps))
  check('Beta alan adindan turedi', comps.includes('Beta'), JSON.stringify(comps))
  check('UYDURMA SIRKET ATILDI', !comps.some((c) => c.includes('Uydurma')), JSON.stringify(comps))
  check('Acme domaini var', merged.companies.find((c) => c.name === 'Acme')?.domain === 'acme.com')
  check('tekrar eden sirket yok', new Set(comps).size === comps.length)
}

console.log('\n[6] Sadece sezgisel (LLM yok) yine calisir')
{
  const merged = mergeExtractions({
    attendees: ['Deniz Yılmaz <deniz@ornek-firma.com>'],
    emails: [],
    llmPeople: [],
    llmCompanies: [],
    calendarText: '',
    sourceText: ''
  })
  check('takvim katilimcisi kabul (delil gerekmez)', merged.people.length === 1, JSON.stringify(merged.people))
  check('sirket alan adindan turedi', merged.companies[0]?.name === 'Ornek Firma', JSON.stringify(merged.companies))
  check('delil kayitli', Boolean(merged.people[0].evidence))
}

console.log('\n[7] Kapsamli baglam ([N#] etiketleri)')
{
  const notes = [
    { noteId: 'aaa', title: 'Toplanti A', startedAt: '2026-09-20T09:00:00Z', source: 'calendar', transcript: 'Konusma A', rawNotes: 'not A', enhanced: '# Ozet\n- madde A' },
    { noteId: 'bbb', title: 'Toplanti B', startedAt: '2026-09-21T09:00:00Z', source: 'call', transcript: 'Konusma B', rawNotes: '', enhanced: '' }
  ]
  const ctx = buildScopedContext(notes)
  check('N1 etiketi', ctx.block.includes('[N1] Toplanti A'))
  check('N2 etiketi', ctx.block.includes('[N2] Toplanti B'))
  check('indeks N1 -> aaa', ctx.index.get('N1')?.id === 'aaa', JSON.stringify([...ctx.index.entries()]))
  check('ham notlar yazildi', ctx.block.includes('not A'))
  check('transkript yazildi', ctx.block.includes('Konusma A'))
  check('bos alanlar atlanir', !ctx.block.includes('Üretilmiş not: \n'))

  const r = resolveScopedCitations(
    [
      { source: 'N1', excerpt: 'alıntı 1' },
      { source: 'n2', excerpt: 'kucuk harf' },
      { source: 'N9', excerpt: 'yok' },
      { source: 'T1', excerpt: 'yanlis tip' },
      { source: 'N1', excerpt: 'tekrar' }
    ],
    ctx.index
  )
  check('2 gecerli kaynak', r.citations.length === 2, JSON.stringify(r.citations))
  check('tekrar kaldirildi', r.citations.filter((c) => c.note_id === 'aaa').length === 1)
  // N9 (yok) + T1 (yanlis tip) gecersiz; N1 tekrari 'atilan' degil 'atlanan'
  check('2 gecersiz atildi', r.dropped === 2, String(r.dropped))
  check('not basligi eklendi', r.citations[0].note_title === 'Toplanti A')
}

console.log('\n[8] Brief ve Ask yuku normalize etme')
{
  const b = normalizeBriefPayload({ items: [{ text: ' madde 1 ', source: 'n2', excerpt: 'x' }, { text: '' }, { text: 'm2' }, { text: 'm3' }, { text: 'm4' }] })
  check('bos madde atildi', b.items?.length === 3, JSON.stringify(b.items))
  check('en fazla 3 madde', b.items?.length === 3)
  check('source buyuk harfe cevrildi', b.items?.[0].source === 'N2', String(b.items?.[0].source))
  check('metin kirpildi', b.items?.[0].text === 'madde 1')

  const b2 = normalizeBriefPayload(null)
  check('null -> bos liste', b2.items?.length === 0)

  const a = normalizeAskPayload({ answer_md: ' cevap ', citations: [{ source: 'N1' }, 'bozuk'] })
  check('cevap kirpildi', a.answer_md === 'cevap')
  check('2 kaynak (bozuk da map edilir, cozumde atilir)', a.citations.length === 2)
  const a2 = normalizeAskPayload(null)
  check('null -> bos cevap', a2.answer_md === '' && a2.citations.length === 0)
}

console.log('\n[9] Sistem mesajlari: anti-halusinasyon vurgusu')
{
  const bs = buildBriefSystemPrompt('tr')
  check('brief: halusinasyon yasagi', bs.includes('halüsinasyon üretme'))
  check('brief: en fazla 3 madde', bs.includes('En fazla 3 madde'))
  check('brief: JSON semasi', bs.includes('"items"'))
  check('brief: genel tavsiye yasagi', bs.includes('Genel geçer tavsiye yazma'))

  const as = buildAskSystemPrompt('tr')
  check('ask: halusinasyon yasagi', as.includes('uydurma'))
  check('ask: bilgi yoksa soyle', as.includes('Notlarınızda bu bilgi yok'))
  check('ask: kaynak zorunlu', as.includes('[N2]'))
}

console.log('\n[10] Tekrar birlestirme plani (dedupe)')
{
  // Senaryo: ayni toplantida takvimden "Sarah Jones", transkriptten "Sarah" geldi
  const plans = planPersonMerges([
    {
      noteId: 'n1',
      people: [
        { id: 'p1', name: 'Sarah Jones', email: null, noteCount: 3 },
        { id: 'p2', name: 'Sarah', email: null, noteCount: 1 },
        { id: 'p3', name: 'James Lee', email: null, noteCount: 2 },
        { id: 'p4', name: 'James', email: null, noteCount: 1 }
      ]
    }
  ])
  check('2 birlestirme karari', plans.length === 2, JSON.stringify(plans))
  check('"Sarah" -> "Sarah Jones" (daha bilgilendirici ad kazanir)',
    plans.some((p) => p.fromId === 'p2' && p.toId === 'p1'), JSON.stringify(plans))
  check('"James" -> "James Lee"', plans.some((p) => p.fromId === 'p4' && p.toId === 'p3'))
  check('gerekce kayitli', plans[0].reason.includes('ayni notta'))

  // Farkli notlarda gecen benzer adlar BIRLESTIRILMEZ (yanlis birlesme riski)
  const crossNote = planPersonMerges([
    { noteId: 'n1', people: [{ id: 'a', name: 'Ali', email: null, noteCount: 1 }] },
    { noteId: 'n2', people: [{ id: 'b', name: 'Ali Yilmaz', email: null, noteCount: 1 }] }
  ])
  check('farkli notlarda birlesme YOK', crossNote.length === 0, JSON.stringify(crossNote))

  // E-posta temelli: bagimsiz, kesin
  const byEmail = planEmailMerges([
    { id: 'x', name: 'S. Jones', email: 'sarah@acme.com', noteCount: 1 },
    { id: 'y', name: 'Sarah Jones', email: 'SARAH@acme.com', noteCount: 4 },
    { id: 'z', name: 'Baska', email: 'baska@x.com', noteCount: 2 }
  ])
  check('e-posta ile 1 birlestirme', byEmail.length === 1, JSON.stringify(byEmail))
  check('cok notu olan hedef secildi', byEmail[0].toId === 'y', JSON.stringify(byEmail[0]))
  check('ayni e-posta tekrar eden (buyuk harf) yakalandi', byEmail[0].reason.includes('acme.com'))
}

console.log('\n[11] Isim yukseltme kurali')
{
  check('Sarah -> Sarah Jones yukseltilir', shouldUpgradeName('Sarah', 'Sarah Jones'))
  check('James -> James Lee', shouldUpgradeName('James', 'James Lee'))
  check('tam ad kisa adla EZILMEZ', !shouldUpgradeName('Sarah Jones', 'Sarah'))
  check('farkli kisi yukseltilmez', !shouldUpgradeName('Sarah', 'James Lee'))
  check('ayni ad degismez', !shouldUpgradeName('Sarah Jones', 'Sarah Jones'))
  check('cok kelimeli -> cok kelimeli degismez', !shouldUpgradeName('Sarah Jones', 'Sarah J.'))
  check('bos ad yukseltilmez', !shouldUpgradeName('', 'Sarah Jones'))
}

console.log('\n[12] Sirket adi normalizasyonu (LLM alan adi yazarsa)')
{
  check('looksLikeDomain: acme.com', looksLikeDomain('acme.com'))
  check('looksLikeDomain: ornek-firma.com.tr', looksLikeDomain('ornek-firma.com.tr'))
  check('looksLikeDomain: "Acme Corp" degil', !looksLikeDomain('Acme Corp'))
  check('looksLikeDomain: bos degil', !looksLikeDomain(''))

  check('alan adi -> okunabilir isim', normalizeCompanyName('ornek-firma.com', 'ornek-firma.com') === 'Ornek Firma',
    String(normalizeCompanyName('ornek-firma.com', 'ornek-firma.com')))
  check('normal isim korunur', normalizeCompanyName('Acme Corp', 'acme.com') === 'Acme Corp')
  check('isim bos + domain varsa domainden turet', normalizeCompanyName('', 'acme.com') === 'Acme')
  check('ikisi de yoksa null', normalizeCompanyName('', null) === null)
  check('isim bos, domain de bostan null', normalizeCompanyName(null, null) === null)

  // Birlestirme icinde de normalizasyon uygulanmali
  const merged = mergeExtractions({
    attendees: ['Deniz <deniz@ornek-firma.com>'],
    emails: [],
    llmPeople: [],
    llmCompanies: [{ name: 'ornek-firma.com', domain: 'ornek-firma.com', evidence: 'delil' }],
    calendarText: '',
    sourceText: 'deniz@ornek-firma.com adresinden yazdi'
  })
  const names = merged.companies.map((c) => c.name)
  check('alan adi kaydi tek isme donustu', names.length === 1, JSON.stringify(names))
  check('isim "Ornek Firma"', names[0] === 'Ornek Firma', JSON.stringify(names))
  check('alan adi kayitli', merged.companies[0].domain === 'ornek-firma.com')
}

console.log(`\n===== SONUC: ${pass} gecti, ${fail} basarisiz =====`)
process.exit(fail === 0 ? 0 : 1)