// ============================================================================
//  Ham notlar icin HTML <-> duz metin donusumleri (SAF, test edilebilir).
//
//  NEDEN: Kullanici notlari TipTap ile HTML olarak saklanir (zengin metin:
//  kalin, vurgu, madde isaretleri). Ancak (a) LLM'e giden girdi sade metin
//  olmali, (b) eski/duz metin notlar da calismali.
// ============================================================================

/** Yalnizca yerel icerik icin kullanilan basit temizleyici (savunma amacli). */
export function sanitizeHtml(html: string): string {
  return (html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

export function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Metin HTML etiketi iceriyor mu? (eski duz metin notlari ayirt etmek icin) */
export function isHtml(text: string): boolean {
  return /<\/?(p|div|br|ul|ol|li|h[1-6]|strong|em|mark|blockquote)\b/i.test(text ?? '')
}

export function htmlToPlain(html: string): string {
  let out = html ?? ''

  // ONCE liste maddeleri: <li> icindeki blok etiketleri (TipTap <li><p>...</p></li>
  // uretir) satir sonu ekleyip araya bos satir sokmasin diye icerik tek satira indirilir.
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    const text = String(inner)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    // Yalnizca ONE yeni satir: '\n- madde'. (Sondaki satir sonu </ul> tarafindan eklenir;
    // aksi halde maddeler arasinda bos satir olusur.)
    return text ? `\n- ${text}` : ''
  })

  // Blok sonlari -> yeni satir
  out = out.replace(/<\s*br\s*\/?>/gi, '\n')
  out = out.replace(/<\/\s*(p|div|h[1-6]|blockquote)\s*>/gi, '\n')
  out = out.replace(/<\/\s*(ul|ol)\s*>/gi, '\n')
  // Kalan etiketleri sil
  out = out.replace(/<[^>]+>/g, '')
  // Varliklari coz
  out = out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  // Fazla bos satirlari sadelestir
  const lines = out
    .split('\n')
    .map((l) => l.replace(/\s+$/g, '').replace(/^\s+/, ''))
    // Ardarda bos satirlari teke indir (blok sonlarindan birikir)
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))

  return lines.join('\n').trim()
}

/**
 * Duz metni (markdown-vari) HTML'e cevirir — eski notlar TipTap'e alinirken.
 * "- " ile baslayan ardisik satirlar <ul><li> olur.
 */
export function plainToHtml(text: string): string {
  const lines = (text ?? '').split('\n')
  const html: string[] = []
  let inList = false

  const closeList = (): void => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '')
    const bullet = /^\s*([-*•]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li><p>${escapeHtml(bullet[2])}</p></li>`)
      continue
    }
    closeList()
    if (line.trim() === '') continue
    if (/^#{1,6}\s+/.test(line)) {
      html.push(`<h2>${escapeHtml(line.replace(/^#{1,6}\s+/, ''))}</h2>`)
      continue
    }
    html.push(`<p>${escapeHtml(line)}</p>`)
  }
  closeList()
  return html.join('')
}

/** Not icerigini TipTap icin guvenli HTML'e cevirir (HTML ise temizler). */
export function normalizeRawNotesForEditor(content: string): string {
  const text = content ?? ''
  if (!text.trim()) return ''
  return isHtml(text) ? sanitizeHtml(text) : plainToHtml(text)
}

/** AI'ye gonderilecek sade metin (HTML ise coz, degilse oldugu gibi). */
export function rawNotesToPlain(content: string): string {
  const text = content ?? ''
  if (!text.trim()) return ''
  return isHtml(text) ? htmlToPlain(text) : text
}

// ---------------------------------------------------------------------------
//  Kimlik (id) uretimi icin metin katlama — TEK KAYNAK.
//
//  NEDEN ORTAK: Ayni isimden kimlik ureten birden fazla yer vardi ve bazilari
//  `toLocaleLowerCase('tr')` kullaniyordu. Turkce'de "MAIL" -> "maıl" (noktasiz i)
//  oldugu icin:
//    - ayni kayit farkli yerlerde FARKLI kimlik alabiliyordu (yetim baglantilar),
//    - I varyanti ile yazilan ayni isim TEKRAR kayit olusturuyordu.
//  Bu fonksiyon once I varyantlarini (I/İ/ı) tek harfe indirir, sonra
//  yerel-bagimsiz kucuk harfe cevirir. Turkce harfler (ğüşöç) KORUNUR.
// ---------------------------------------------------------------------------

export function foldForId(input: string): string {
  return (input ?? '')
    .replace(/[İIı]/g, 'i')
    .toLocaleLowerCase('en')
    .trim()
}

/** Kimlik icin guvenli parca: harf/rakam kalir, digerleri '-'. */
export function slugForId(input: string, maxLen = 60): string {
  return foldForId(input)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
}
