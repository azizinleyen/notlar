// ============================================================================
//  Saf ses yardimcilari (Web Audio tarafi). Yan etkisi yok, test edilebilir.
// ============================================================================

/** Float32 ornek dizisinin RMS'i (0..1) */
export function rmsFloat(input: Float32Array): number {
  if (input.length === 0) return 0
  let sum = 0
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
  return Math.sqrt(sum / input.length)
}

/**
 * Dogrusal interpolasyonla yeniden ornekleme (48k -> 16k gibi).
 * Konusma tanima icin yeterlidir; CPU'da cok ucuzdur.
 * Not: ideal cozum oncesinde alcak geciren filtre olurdu; Whisper bu
 * seviyedeki alias'i sorunsuz tolere eder.
 */
export function resampleFloat(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || input.length === 0) return input
  const ratio = srcRate / dstRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/** Float32 (-1..1) -> PCM16 */
export function toInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Kullanicinin anlayacagi sekilde ses seviyesi (0..1) — metre icin. */
export function levelToBar(rms: number): number {
  // log olcek: -60 dB -> 0, 0 dB -> 1
  const db = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.max(0, Math.min(1, (db + 60) / 60))
}