#!/usr/bin/env node
/**
 * test-prompt.mts — Zenginlestirme hattinin SAF fonksiyon testleri:
 * prompt kurulumu, numarali etiketler, kaynak cozumu, JSON ayiklama, markdown.
 */
import {
  buildCalendarBlock,
  buildRawNotesBlock,
  buildSystemPrompt,
  buildTranscriptBlock,
  buildUserPrompt,
  normalizePayload,
  payloadToMarkdown,
  rawNoteLines,
  resolveCitations,
  stripSourceTokens
} from '../src/main/llm/prompt.ts'
import { extractJsonObject } from '../src/main/llm/util.ts'
import {
  escapeHtml,
  htmlToPlain,
  isHtml,
  normalizeRawNotesForEditor,
  plainToHtml,
  rawNotesToPlain,
  sanitizeHtml
} from '../src/shared/text.ts'
import type { CalendarEventMeta, TranscriptSegment } from '@shared/types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

const seg = (id: string, channel: 'mic' | 'system', text: string, ms: number, speaker?: string): TranscriptSegment => ({
  id, note_id: 'n1', channel, speaker_label: speaker ?? (channel === 'mic' ? 'Ben' : 'Karşı taraf'),
  text, start_ms: ms, end_ms: ms + 1500
})

const transcripts: TranscriptSegment[] = [
  seg('t-aaa', 'system', 'Backend API neredeyse hazır, uç durumlar kaldı.', 2000, 'Sarah'),
  seg('t-bbb', 'mic', 'Veritabanı taşıma ne durumda?', 5000),
  seg('t-ccc', 'system', 'Gelecek hafta planlandı, risk var.', 8000, 'Elif')
]

const event: CalendarEventMeta = {
  id: 'ev-1', title: 'Sabah stand-up', start_at: '2026-09-25T06:00:00.000Z',
  end_at: '2026-09-25T06:30:00.000Z', location: 'Google Meet',
  participants: ['Sarah Jones', 'Elif Demir']
}

console.log('\n[1] Ham not satirlari')
{
  check('markdown isaretleri temizlenir', JSON.stringify(rawNoteLines('- API hazır\n* test\n> alinti\n1. madde')) ===
    JSON.stringify(['API hazır', 'test', 'alinti', 'madde']), JSON.stringify(rawNoteLines('- API hazır\n* test\n> alinti\n1. madde')))
  check('bos satirlar atilir', rawNoteLines('\n\n  \n- x\n').length === 1)
  check('bos girdi', rawNoteLines('').length === 0)
}

console.log('\n[2] Numarali etiketler (T/N/C)')
{
  const tr = buildTranscriptBlock(transcripts)
  check('T1 etiketi var', tr.block.includes('[T1]'))
  check('T3 etiketi var', tr.block.includes('[T3]'))
  check('kanal etiketi MIKROFON', tr.block.includes('(MIKROFON)'), tr.block.split('\n')[1])
  check('kanal etiketi SISTEM', tr.block.includes('(SISTEM)'))
  check('T1 -> gercek id', tr.index.get('T2')?.id === 't-bbb', String(tr.index.get('T2')?.id))
  check('konusmaci korunur', tr.index.get('T1')?.speaker === 'Sarah')
  check('zaman damgasi bicimi', tr.block.includes('00:02'), tr.block.split('\n')[0])

  const raw = buildRawNotesBlock('- API hazır\n- Müşteriye dönüş')
  check('N1/N2 etiketleri', raw.block.includes('[N1]') && raw.block.includes('[N2]'))
  check('N2 -> satir', raw.index.get('N2')?.line === 'Müşteriye dönüş')

  const cal = buildCalendarBlock(event)
  check('C1 blogu baslik', cal.block.includes('[C1]'))
  check('katilimcilar yazilir', cal.block.includes('Sarah Jones, Elif Demir'))
  check('konum yazilir', cal.block.includes('Google Meet'))
  check('C1 -> event id', cal.calendar?.eventId === 'ev-1')

  check('takvim yoksa bos blok', buildCalendarBlock(null).calendar === null)
  check('takvim yoksa aciklama', buildCalendarBlock(null).block.includes('takvim etkinliği yok'))
}

console.log('\n[3] Sistem ve kullanici promptu')
{
  const sys = buildSystemPrompt('tr', 'Bu bir 1:1 görüşmesi.')
  check('dil talimati', sys.includes('tr'))
  check('JSON semasi istenir', sys.includes('"citations"'))
  check('etiket aciklamasi', sys.includes('[T#]') && sys.includes('[N#]') && sys.includes('[C1]'))
  check('sablon talimati', sys.includes('EK TALİMAT'))
  check('ref bicimi', sys.includes('<bölüm başlığı>#<madde sırası>'))

  const auto = buildSystemPrompt('auto', '')
  check('auto dil talimati', auto.includes('çoğunlukta olduğu dili'))
  check('sablon yoksa EK TALIMAT yok', !auto.includes('EK TALİMAT'))

  const { user, index } = buildUserPrompt({
    noteTitle: 'Sabah stand-up', language: 'tr', templatePrompt: '',
    calendarEvent: event, rawNotesMd: '- Kendi notum', transcripts
  })
  check('uc bolum de var', user.includes('(a) TRANSKRİPT') && user.includes('(b) KULLANICININ HAM NOTLARI') && user.includes('(c) TAKVİM'))
  check('not basligi', user.includes('NOT BAŞLIĞI: Sabah stand-up'))
  check('cekirdek vurgusu', user.includes('ÇEKİRDEK'))
  check('index dolu', index.transcripts.size === 3 && index.rawNoteTokens.size === 1)

  const empty = buildUserPrompt({
    noteTitle: 'x', language: 'tr', templatePrompt: '', calendarEvent: null,
    rawNotesMd: '', transcripts: []
  })
  check('transkript yok mesaji', empty.user.includes('(transkript yok'))
  check('ham not yok mesaji', empty.user.includes('(ham not yok'))
}

console.log('\n[4] Kaynak cozumu (buyutec izlenebilirligi)')
{
  const { index } = buildUserPrompt({
    noteTitle: 'x', language: 'tr', templatePrompt: '', calendarEvent: event,
    rawNotesMd: '- Kendi notum', transcripts
  })

  const r = resolveCitations(
    [
      { ref: 'Özet#1', source: 'T1', excerpt: 'alıntı' },
      { ref: 'Kararlar#2', source: 'N1' },
      { ref: 'Ana Konular#1', source: 'C1' },
      { ref: 'Özet#2', source: 't99' },       // bilinmeyen etiket -> atilir
      { ref: 'bozukref', source: 'T1' },      // # yok -> atilir
      { ref: 'Özet#3', source: 'ZZ' }         // taninmayan kaynak -> atilir
    ],
    index
  )
  check('3 gecerli kaynak kaldi', r.citations.length === 3, JSON.stringify(r.citations.map((c) => c.sentence_ref)))
  check('3 gecersiz atildi', r.dropped === 3, String(r.dropped))
  check('atilma nedenleri kayitli', r.reasons.length === 3)
  check('T1 -> source_id t-aaa', r.citations[0].source_id === 't-aaa', String(r.citations[0].source_id))
  check('T1 -> tip transcript', r.citations[0].source_type === 'transcript')
  check('alinti korunur', r.citations[0].excerpt === 'alıntı')
  check('N1 -> tip raw_note', r.citations[1].source_type === 'raw_note')
  check('N1 -> source_id null', r.citations[1].source_id === null)
  check('N1 -> alinti satirdan', r.citations[1].excerpt === 'Kendi notum', String(r.citations[1].excerpt))
  check('C1 -> takvim id', r.citations[2].source_id === 'ev-1')
  check('bos liste sorunsuz', resolveCitations([], index).citations.length === 0)

  const noCal = resolveCitations([{ ref: 'Özet#1', source: 'C1' }], { ...index, calendar: null })
  check('takvim yoksa C1 atilir', noCal.dropped === 1 && noCal.citations.length === 0)
}

console.log('\n[5] JSON ayiklama (model cikisi)')
{
  check('sade JSON', JSON.stringify(extractJsonObject('{"a":1}')) === '{"a":1}')
  check('kod blogu', JSON.stringify(extractJsonObject('```json\n{"a":2}\n```')) === '{"a":2}')
  check('etrafinda aciklama', JSON.stringify(extractJsonObject('Iste sonuc:\n{"a":3}\nUmarim yardimci olur')) === '{"a":3}')
  check('sondaki virgul onarimi', JSON.stringify(extractJsonObject('{"a":4,}')) === '{"a":4}')

  let threw = false
  try { extractJsonObject('JSON yok') } catch { threw = true }
  check('JSON yoksa hata', threw)

  let threw2 = false
  try { extractJsonObject('') } catch { threw2 = true }
  check('bos yanit hata', threw2)
}

console.log('\n[6] Yuku normalize etme (eksik alan toleransi)')
{
  const p1 = normalizePayload({
    summary: 'kısa özet',
    sections: [
      { heading: 'Ana Konular', items: ['a', 'b'] },
      { heading: 'Bos Bolum', items: [] },       // atilmali
      { items: ['basliksiz'] },                   // atilmali
      { heading: 'Kararlar', items: ['c', '', '  '] }
    ],
    next_steps: [{ task: 'görev', owner: 'James', due: 'gelecek hafta' }, { task: '  ' }, 'duz metin'],
    citations: [{ ref: 'Ana Konular#1', source: 'T1' }]
  })
  check('summary', p1.summary === 'kısa özet')
  check('2 gecerli bolum', p1.sections.length === 2, JSON.stringify(p1.sections.map((s) => s.heading)))
  check('bos maddeler atilir', p1.sections[1].items.length === 1)
  check('2 sonraki adim (bos + duz metin dahil)', p1.next_steps.length === 2, JSON.stringify(p1.next_steps))
  check('owner/due', p1.next_steps[0].owner === 'James' && p1.next_steps[0].due === 'gelecek hafta')
  check('duz metin adim', p1.next_steps[1].task === 'duz metin' && p1.next_steps[1].owner === null)

  check('metinden [T#] etiketi temizlenir', stripSourceTokens('Madde metni [T12]') === 'Madde metni', stripSourceTokens('Madde metni [T12]'))
  check('ic etiket temizlenir', stripSourceTokens('a [N1] b [C1] c') === 'a b c', stripSourceTokens('a [N1] b [C1] c'))
  check('normal maddede degisiklik yok', stripSourceTokens('Sadece metin') === 'Sadece metin')
  check('fazla bosluk sadelesir', stripSourceTokens('a  [T1]  b') === 'a b', stripSourceTokens('a  [T1]  b'))
  check('parantezli (N1) bicimi', stripSourceTokens('Madde sonu (N2).') === 'Madde sonu.', stripSourceTokens('Madde sonu (N2).'))
  check('parantezli (T12) bicimi', stripSourceTokens('Konu (T12)') === 'Konu', stripSourceTokens('Konu (T12)'))
  check('noktalama boslugu duzelir', stripSourceTokens('bitis (C1) .') === 'bitis.', stripSourceTokens('bitis (C1) .'))
  check('gercek parantez korunur', stripSourceTokens('tutar (yaklasik 500) TL') === 'tutar (yaklasik 500) TL')

  const pStrip = normalizePayload({
    summary: 'ozet [T1]',
    sections: [{ heading: 'X', items: ['madde [T2]', 'temiz'] }],
    next_steps: [{ task: 'gorev [T3]' }],
    citations: []
  })
  check('summary etiketleri temiz', pStrip.summary === 'ozet')
  check('madde etiketleri temiz', pStrip.sections[0].items[0] === 'madde')
  check('gorev etiketi temiz', pStrip.next_steps[0].task === 'gorev')

  const p2 = normalizePayload(null)
  check('null -> bos yapi', p2.sections.length === 0 && p2.citations.length === 0 && p2.summary === '')
  const p3 = normalizePayload({ sections: 'metin', next_steps: 5, citations: null })
  check('yanlis tipler tolere edilir', p3.sections.length === 0 && p3.next_steps.length === 0)
}

console.log('\n[7] Markdown uretimi (arayuz bunu ayristirir)')
{
  const md = payloadToMarkdown(
    normalizePayload({
      summary: 'kısa özet',
      sections: [
        { heading: 'Ana Konular', items: ['bir', 'iki'] },
        { heading: 'Kararlar', items: ['uc'] }
      ],
      next_steps: [{ task: 'görev A', owner: 'James', due: 'Cuma' }],
      citations: []
    })
  )
  const lines = md.split('\n')
  check('Ozet basligi', lines[0] === '## Özet')
  check('ozet maddesi', lines[1] === '- kısa özet')
  check('bolum basligi', md.includes('## Ana Konular'))
  check('maddeler', md.includes('- bir') && md.includes('- iki') && md.includes('- uc'))
  check('Sonraki Adimlar bolumu eklenir', md.includes('## Sonraki Adımlar'))
  check('sorumlu/tarih bicimi', md.includes('- görev A — sorumlu: James — tarih: Cuma'), md)

  // Model zaten "Sonraki Adimlar" bolumunu verdiyse tekrar eklenmez
  const md2 = payloadToMarkdown(
    normalizePayload({
      summary: '',
      sections: [{ heading: 'Sonraki Adımlar', items: ['x'] }],
      next_steps: [{ task: 'x', owner: null, due: null }],
      citations: []
    })
  )
  check('cift Sonraki Adimlar olmaz', md2.split('## Sonraki Adımlar').length === 2, md2)
  check('summary bos -> Ozet bolumu yok', !md2.includes('## Özet'))
}

console.log('\n[8] HTML <-> duz metin (TipTap ham notlar)')
{
  check('isHtml: p etiketi', isHtml('<p>selam</p>'))
  check('isHtml: duz metin degil', !isHtml('- selam'))
  check('isHtml: bos', !isHtml(''))

  const html = '<ul><li><p>birinci madde</p></li><li><p>ikinci madde</p></li></ul><p>kapanis paragrafi</p>'
  const plain = htmlToPlain(html)
  check('liste maddeleri "- " ile', plain.includes('- birinci madde') && plain.includes('- ikinci madde'), JSON.stringify(plain))
  check('paragraf yeni satir', plain.includes('kapanis paragrafi'))
  check('etiket kalmaz', !plain.includes('<'), JSON.stringify(plain))

  check('br -> yeni satir', htmlToPlain('a<br>b') === 'a\nb', JSON.stringify(htmlToPlain('a<br>b')))
  check('nbsp cozulur', htmlToPlain('a&nbsp;b') === 'a b')
  check('&amp; cozulur', htmlToPlain('a &amp; b') === 'a & b')
  check('ardarda bos satirlar teke iner', htmlToPlain('<p>a</p><p></p><p></p><p>b</p>') === 'a\n\nb', JSON.stringify(htmlToPlain('<p>a</p><p></p><p></p><p>b</p>')))
  check('TipTap li>p yapisi bos satir uretmez',
    htmlToPlain('<ul><li><p>elma</p></li><li><p>armut</p></li></ul>') === '- elma\n- armut',
    JSON.stringify(htmlToPlain('<ul><li><p>elma</p></li><li><p>armut</p></li></ul>')))

  const back = plainToHtml('- birinci madde\n- ikinci madde\nNormal satir')
  check('plainToHtml: ul olusur', back.includes('<ul>') && back.includes('<li>'))
  check('plainToHtml: paragraf', back.includes('<p>Normal satir</p>'))
  check('plainToHtml: kacis', plainToHtml('a < b').includes('a &lt; b'), plainToHtml('a < b'))
  check('plainToHtml: baslik', plainToHtml('## Baslik').includes('<h2>Baslik</h2>'))

  // Gidis-donus: duz -> html -> duz; ANLAMLI satirlar (bos olmayanlar) korunmali
  const src = '- elma\n- armut\nsade satir'
  const roundTrip = htmlToPlain(plainToHtml(src))
  const nonEmpty = (t: string): string[] => t.split('\n').filter((l) => l.trim())
  check('gidis-donus: icerik korunur', JSON.stringify(nonEmpty(roundTrip)) === JSON.stringify(nonEmpty(src)),
    JSON.stringify(roundTrip))

  check('normalizeRawNotesForEditor: duz metni cevirir', normalizeRawNotesForEditor('- a').includes('<ul>'))
  check('normalizeRawNotesForEditor: html korunur', normalizeRawNotesForEditor('<p>a</p>') === '<p>a</p>')
  check('normalizeRawNotesForEditor: bos', normalizeRawNotesForEditor('') === '')
  check('rawNotesToPlain: html cozer', rawNotesToPlain('<p>selam</p>') === 'selam')
  check('rawNotesToPlain: duz metin aynen', rawNotesToPlain('- selam') === '- selam')

  check('sanitizeHtml: script silinir', !sanitizeHtml('<p>a</p><script>alert(1)</script>').includes('script'))
  check('sanitizeHtml: onclick silinir', !sanitizeHtml('<p onclick="x()">a</p>').includes('onclick'))
  check('sanitizeHtml: javascript: silinir', !sanitizeHtml('<a href="javascript:x">a</a>').includes('javascript:'))
  check('escapeHtml', escapeHtml('<a>') === '&lt;a&gt;')
}

console.log(`\n===== SONUC: ${pass} gecti, ${fail} basarisiz =====`)
process.exit(fail === 0 ? 0 : 1)