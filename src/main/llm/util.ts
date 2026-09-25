// Kucuk yardimcilar (LLM katmani).

/** Saglayiciya gore yetkilendirme basliklari. */
export function authHeaders(apiKey: string | undefined): Record<string, string> {
  const key = (apiKey ?? '').trim()
  if (!key) return {}
  return { Authorization: `Bearer ${key}` }
}

/**
 * Model yanitindan JSON govdesini cikarir.
 * Modeller JSON'u kod bloğu icine alma, onune aciklama yazma gibi aliskanliklar
 * gosterir; bu yuzden ilk '{' ile son '}' arasini aliriz.
 */
export function extractJsonObject(raw: string): unknown {
  const text = (raw ?? '').trim()
  if (!text) throw new Error('Model bos yanit dondu')

  // ```json ... ``` bloklarini sok
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced ? fenced[1] : text).trim()

  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('Model yanitinda JSON govdesi bulunamadi')
  }
  const sliced = candidate.slice(first, last + 1)
  try {
    return JSON.parse(sliced)
  } catch (err) {
    // Yaygin bir sorun: sondaki virguller
    const repaired = sliced.replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(repaired)
    } catch {
      throw new Error(
        'Model JSON cikisi ayristirilamadi: ' + (err instanceof Error ? err.message : String(err))
      )
    }
  }
}