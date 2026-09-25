// Kucuk bicimlendirme yardimcilari (TR yereli)

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtRange(startIso: string | null, endIso: string | null): string {
  const s = fmtTime(startIso)
  const e = endIso ? fmtTime(endIso) : ''
  return e ? `${s} – ${e}` : s
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const n = new Date()
  return (
    d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Basit, kararli bir renk secici (avatar arka plani icin) */
export function colorFor(seed: string): string {
  const palette = ['#c9b8a8', '#a8bfc9', '#b8c9a8', '#c9a8b8', '#a8a8c9', '#c9c1a8', '#a8c9c1']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}