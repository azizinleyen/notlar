#!/usr/bin/env node
/**
 * test-export.mts — Faz 6+7'nin SAF fonksiyon testleri:
 *   - CSV/RFC 4180 kacislari, dosya adi guvenligi, YAML front-matter
 *   - Jargon uygulama (tam kelime eslesmesi, uzun terim onceligi)
 *   - Recipe shortcut normalizasyonu
 *   - Sohbet yardimcilari (kapsam etiketleri)
 */
import { CSV_HEADERS, csvField, csvRow, fmtClock, safeFileName, yamlValue } from '../src/main/services/exportNotes.ts'
import { applyJargon, applyJargonToMarkdown, buildSttHint } from '../src/main/jargon/apply.ts'
import { normalizeShortcut } from '../src/main/services/recipes.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

console.log('\n[1] CSV (RFC 4180)')
{
  check('bos alan', csvField('') === '')
  check('null alan', csvField(null) === '')
  check('sade alan tirnaksiz', csvField('Merhaba') === 'Merhaba')
  check('virgul -> tirnak', csvField('a,b') === '"a,b"', csvField('a,b'))
  check('tirnak katlanir', csvField('a"b') === '"a""b"', csvField('a"b'))
  check('satir sonu -> tirnak', csvField('a\nb') === '"a\nb"')
  check('bastaki bosluk -> tirnak', csvField(' a') === '" a"')
  const row = csvRow(['x', 'a,b', 'c"d'])
  check('satir birlestirme', row === 'x,"a,b","c""d"', row)
  check('baslik sayisi 12', CSV_HEADERS.length === 12, String(CSV_HEADERS.length))
  check('ilk baslik id', CSV_HEADERS[0] === 'id')
  check('saat bicimi', fmtClock(65000) === '01:05', fmtClock(65000))
  check('negatif saat 00:00', fmtClock(-5) === '00:00')
}

console.log('\n[2] Dosya adi ve YAML')
{
  check('yasak karakterler', safeFileName('a/b:c*d?e"f<g>h|i') === 'a-b-c-d-e-f-g-h-i', safeFileName('a/b:c*d?e"f<g>h|i'))
  check('Turkce korunur', safeFileName('Toplantı Özeti') === 'Toplantı Özeti')
  check('bos -> yedek ad', safeFileName('', 'not') === 'not')
  check('sadece nokta temizlenir', safeFileName('...x') === 'x')
  check('uzunluk sinirlanir', safeFileName('a'.repeat(200)).length === 80)
  check('satir sonu tek bosluga iner', safeFileName('a\nb') === 'a b', JSON.stringify(safeFileName('a\nb')))

  check('sade yaml', yamlValue('Sabah standup') === 'Sabah standup')
  check('iki nokta tirnaklanir', yamlValue('a: b') === '"a: b"', yamlValue('a: b'))
  check('bos -> tirnak', yamlValue('') === '""')
  check('bool benzeri tirnaklanir', yamlValue('true') === '"true"', yamlValue('true'))
  check('sayi tirnaklanmaz', yamlValue('2026') === '2026')
}

console.log('\n[3] Jargon (tam kelime eslesmesi)')
{
  const rules = [
    { term: 'grog', replacement: 'Groq' },
    { term: 'hipo', replacement: 'HiPPO' },
    { term: 'api', replacement: 'API' }
  ]
  const r1 = applyJargon('grog cok hizli, hipo kavrami onemli', rules)
  check('iki terim duzeltildi', r1.text === 'Groq cok hizli, HiPPO kavrami onemli', r1.text)
  check('toplam 2', r1.total === 2, String(r1.total))
  check('sayaclar', r1.counts.get('grog') === 1 && r1.counts.get('hipo') === 1)

  // KRITIK: kelime icinde eslesmemeli
  const r2 = applyJargon('capital ve rapid kelimeleri', rules)
  check('kelime ici eslesme YOK (capital/rapid)', r2.text === 'capital ve rapid kelimeleri', r2.text)
  check('toplam 0', r2.total === 0)

  const r3 = applyJargon('grog GROG Grog', rules)
  check('buyuk/kucuk harf duyarsiz', r3.text === 'Groq Groq Groq', r3.text)
  check('3 kez sayildi', r3.counts.get('grog') === 3, String(r3.counts.get('grog')))
  check('dogru yazim degismez', applyJargon('Groq iyi', rules).total === 0)

  const r4 = applyJargon('api', rules)
  check('kisa terim duzeltildi', r4.text === 'API', r4.text)

  // Uzun terim once uygulanmali
  const longFirst = [
    { term: 'acme', replacement: 'ACME' },
    { term: 'acme corp', replacement: 'Acme Corporation' }
  ]
  const r5 = applyJargon('acme corp ve acme', longFirst)
  check('uzun terim once', r5.text === 'Acme Corporation ve ACME', r5.text)

  check('bos metin', applyJargon('', rules).total === 0)
  check('bos kural listesi', applyJargon('grog', []).total === 0)
  check('kural = replacement ise atlanir', applyJargon('x', [{ term: 'x', replacement: 'x' }]).total === 0)
}

console.log('\n[4] Jargon: STT ipucu')
{
  const hint = buildSttHint([{ term: 'grog', replacement: 'Groq' }, { term: 'hippo', replacement: 'HiPPO' }])
  check('dogru yazimlar ipucunda', hint.includes('Groq') && hint.includes('HiPPO'), hint)
  check('yanlis yazimlar ipucunda degil', !hint.includes('grog'), hint)
  check('virgulle ayrilir', hint.includes(', '))

  const hint2 = buildSttHint([], 'Amk, siktir')
  check('ek ipucu korunur', hint2.includes('Amk'), hint2)
  check('sinirlama 700', buildSttHint(Array.from({ length: 200 }, (_, i) => ({ term: `t${i}`, replacement: `UzunTerim${i}` }))).length <= 700)
  check('bos liste bos metin', buildSttHint([]) === '')

  check('markdown duzeltme', applyJargonToMarkdown('## Ozet\n- grog kullanildi', [{ term: 'grog', replacement: 'Groq' }]).includes('Groq'))
}

console.log('\n[5] Recipe shortcut normalizasyonu')
{
  check('bastaki slash atilir', normalizeShortcut('/kararlar') === 'kararlar')
  check('buyuk harf kuculur', normalizeShortcut('MAIL') === 'mail')
  check('bosluk ve ozel karakter atilir', normalizeShortcut('  özet 5! ') === 'özet5', normalizeShortcut('  özet 5! '))
  // I varyantlari tek harfe iner (yoksa "/RİSK" ile "/risk" IKI farkli shortcut olurdu)
  check('I varyanti katlanir', normalizeShortcut('/RİSKLER') === 'riskler', normalizeShortcut('/RİSKLER'))
  check('noktali/noktasiz i ayni', normalizeShortcut('/MAIL') === normalizeShortcut('/maıl'),
    normalizeShortcut('/MAIL') + ' vs ' + normalizeShortcut('/maıl'))
  check('gercek Turkce harfler korunur', normalizeShortcut('/özet') === 'özet', normalizeShortcut('/özet'))
  check('c-cedilla korunur', normalizeShortcut('/çıkar') === 'çikar', normalizeShortcut('/çıkar'))
  check('bos', normalizeShortcut('') === '')
  check('sadece slash', normalizeShortcut('/') === '')
}

console.log(`\n===== SONUC: ${pass} gecti, ${fail} basarisiz =====`)
process.exit(fail === 0 ? 0 : 1)