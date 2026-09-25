// ============================================================================
//  ICS (iCalendar) okuyucu — harici bagimlilik YOK.
//
//  NEDEN ICS: Google Takvim ve Microsoft/Outlook, OAuth kurulumu GEREKMEDEN
//  "gizli iCal adresi" / "takvimi yayinla" ile salt-okunur bir .ics URL'i verir.
//  Tek kullanicilik yerel uygulama icin bu, OAuth'tan cok daha az surtunmeli ve
//  ayni islevi gorur (spesifikasyon: "takvim icin Google/Microsoft OAuth
//  (SALT OKUNUR)" — burada ayni salt-okunur sonuc ICS uzerinden alinir).
//  OAuth gerektiren saglayicilar ayni arayuzun arkasina eklenebilir.
// ============================================================================

export interface CalendarEvent {
  uid: string
  title: string
  startAt: Date
  endAt: Date | null
  location: string | null
  description: string | null
  organizer: string | null
  attendees: string[]
  allDay: boolean
}

type TimeMode = 'utc' | 'local'

interface PropLine {
  name: string
  params: Record<string, string>
  value: string
}

// --- temel ayristirma ------------------------------------------------------

/** Katlanmis satirlari acar (RFC 5545: devam satirlari bosluk/tab ile baslar). */
export function unfoldIcs(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

function parsePropLine(line: string): PropLine | null {
  // NAME;PARAM=VAL;PARAM2="VA;LUE":VALUE  ->  ilk tirnak-disi ':' ayirici
  let inQuotes = false
  let colonAt = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ':' && !inQuotes) {
      colonAt = i
      break
    }
  }
  if (colonAt < 0) return null
  const head = line.slice(0, colonAt)
  const value = line.slice(colonAt + 1)
  const parts = head.split(';')
  const name = parts[0].trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim().toUpperCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    params[k] = v
  }
  return { name, params, value }
}

/** Tek gecisli RFC 5545 metin kacis cozumu: \n \, \; \\ */
export function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

// --- tarih ----------------------------------------------------------------

interface ParsedDate {
  date: Date
  mode: TimeMode
  allDay: boolean
}

function two(s: string | undefined): number {
  return Number(s ?? '0')
}

export function parseIcsDate(value: string, params: Record<string, string>): ParsedDate | null {
  const v = value.trim()
  if (!v) return null

  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4))
    const m = Number(v.slice(4, 6))
    const d = Number(v.slice(6, 8))
    if (!y || !m || !d) return null
    return { date: new Date(y, m - 1, d, 0, 0, 0, 0), mode: 'local', allDay: true }
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = two(m[4])
  const mi = two(m[5])
  const s = two(m[6])
  if (m[7] === 'Z') {
    return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), mode: 'utc', allDay: false }
  }
  // TZID'li veya "floating" zamanlar YEREL kabul edilir.
  // (Varsayim: tam saat dilimi veritabani tasimiyoruz; tek kullanicilik yerel
  //  uygulamada takvim zaten kullanicinin yerel saatinde gorunur.)
  return { date: new Date(y, mo - 1, d, h, mi, s), mode: 'local', allDay: false }
}

// --- tekrarlama (RRULE) ----------------------------------------------------

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  until?: Date
  byDay: number[] // 0=Pazar ... 6=Cumartesi
  byMonthDay: number[]
  wkst: number
}

const DAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

export function parseRRule(value: string): RRule | null {
  const out: RRule = { freq: 'DAILY', interval: 1, byDay: [], byMonthDay: [], wkst: 1 }
  let sawFreq = false
  for (const chunk of value.split(';')) {
    const [rawK, rawV] = chunk.split('=')
    if (!rawK || rawV === undefined) continue
    const k = rawK.trim().toUpperCase()
    const v = rawV.trim()
    if (k === 'FREQ') {
      const f = v.toUpperCase()
      if (f === 'DAILY' || f === 'WEEKLY' || f === 'MONTHLY' || f === 'YEARLY') {
        out.freq = f
        sawFreq = true
      }
    } else if (k === 'INTERVAL') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out.interval = n
    } else if (k === 'COUNT') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out.count = n
    } else if (k === 'UNTIL') {
      const parsed = parseIcsDate(v, {})
      if (parsed) out.until = parsed.date
    } else if (k === 'BYDAY') {
      out.byDay = v
        .split(',')
        .map((d) => d.trim().toUpperCase().slice(-2))
        .map((d) => DAY_MAP[d])
        .filter((d): d is number => typeof d === 'number')
    } else if (k === 'BYMONTHDAY') {
      out.byMonthDay = v
        .split(',')
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isFinite(d))
    } else if (k === 'WKST') {
      const d = DAY_MAP[v.toUpperCase().slice(-2)]
      if (typeof d === 'number') out.wkst = d
    }
  }
  return sawFreq ? out : null
}

// --- mod-farkinda tarih yardimcilari ---------------------------------------

const get = (d: Date, mode: TimeMode) => ({
  y: mode === 'utc' ? d.getUTCFullYear() : d.getFullYear(),
  mo: mode === 'utc' ? d.getUTCMonth() : d.getMonth(),
  da: mode === 'utc' ? d.getUTCDate() : d.getDate(),
  h: mode === 'utc' ? d.getUTCHours() : d.getHours(),
  mi: mode === 'utc' ? d.getUTCMinutes() : d.getMinutes(),
  s: mode === 'utc' ? d.getUTCSeconds() : d.getSeconds(),
  wd: mode === 'utc' ? d.getUTCDay() : d.getDay()
})

function make(y: number, mo: number, da: number, h: number, mi: number, s: number, mode: TimeMode): Date {
  return mode === 'utc' ? new Date(Date.UTC(y, mo, da, h, mi, s)) : new Date(y, mo, da, h, mi, s)
}

function addDays(d: Date, n: number, mode: TimeMode): Date {
  const p = get(d, mode)
  return make(p.y, p.mo, p.da + n, p.h, p.mi, p.s, mode)
}

function addMonths(d: Date, n: number, mode: TimeMode): Date {
  const p = get(d, mode)
  return make(p.y, p.mo + n, p.da, p.h, p.mi, p.s, mode)
}

/** dtstart'tan baslayarak [from, to] araligindaki tekrarlari uretir. */
export function expandRecurrence(
  dtstart: Date,
  rule: RRule,
  mode: TimeMode,
  from: Date,
  to: Date,
  exdates: Set<number>,
  maxIterations = 5000
): Date[] {
  const out: Date[] = []
  const startMs = dtstart.getTime()
  const toMs = to.getTime()
  const fromMs = from.getTime()
  let emitted = 0

  const push = (candidate: Date): boolean => {
    const t = candidate.getTime()
    if (t < startMs) return true
    if (rule.until && t > rule.until.getTime()) return false
    emitted++
    if (rule.count !== undefined && emitted > rule.count) return false
    if (t >= fromMs && t <= toMs && !exdates.has(t)) out.push(candidate)
    return t <= toMs
  }

  const p0 = get(dtstart, mode)

  if (rule.freq === 'DAILY') {
    let cursor = dtstart
    for (let i = 0; i < maxIterations; i++) {
      const wd = get(cursor, mode).wd
      const dayOk = rule.byDay.length === 0 || rule.byDay.includes(wd)
      if (dayOk) {
        if (!push(cursor)) break
      }
      cursor = addDays(cursor, rule.interval, mode)
      if (cursor.getTime() > toMs) break
    }
    return out
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? [...rule.byDay].sort((a, b) => a - b) : [p0.wd]
    // dtstart'in bulundugu haftanin baslangicina in
    const shift = (p0.wd - rule.wkst + 7) % 7
    let weekStart = addDays(dtstart, -shift, mode)
    for (let w = 0; w < maxIterations; w++) {
      for (const wd of days) {
        const offset = (wd - rule.wkst + 7) % 7
        const candidate = addDays(weekStart, offset, mode)
        if (!push(candidate)) return out
      }
      const nextWeek = addDays(weekStart, 7 * rule.interval, mode)
      if (nextWeek.getTime() > toMs) break
      weekStart = nextWeek
    }
    return out
  }

  if (rule.freq === 'MONTHLY') {
    const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [p0.da]
    let cursor = make(p0.y, p0.mo, 1, p0.h, p0.mi, p0.s, mode)
    for (let i = 0; i < maxIterations; i++) {
      for (const da of days) {
        const candidate = make(
          get(cursor, mode).y,
          get(cursor, mode).mo,
          da,
          p0.h,
          p0.mi,
          p0.s,
          mode
        )
        if (get(candidate, mode).mo !== get(cursor, mode).mo) continue // 31 Subat gibi tasmalar
        if (!push(candidate)) return out
      }
      cursor = addMonths(cursor, rule.interval, mode)
      if (cursor.getTime() > toMs) break
    }
    return out
  }

  // YEARLY
  let cursor = dtstart
  for (let i = 0; i < maxIterations; i++) {
    if (!push(cursor)) break
    cursor = make(get(cursor, mode).y + rule.interval, p0.mo, p0.da, p0.h, p0.mi, p0.s, mode)
    if (cursor.getTime() > toMs) break
  }
  return out
}

// --- VEVENT -> CalendarEvent ----------------------------------------------

function attendeesFrom(params: Record<string, string>, value: string): string {
  const cn = params.CN
  if (cn) return cn
  return value.replace(/^mailto:/i, '')
}

/** Yalnizca [from, to] araligina dusan olusumlari dondurur. */
export function parseIcsWindow(raw: string, from: Date, to: Date): CalendarEvent[] {
  const lines = unfoldIcs(raw)
  const events: CalendarEvent[] = []

  let inEvent = false
  let cur: Record<string, PropLine[]> = {}
  let inValarm = false

  const flush = (): void => {
    const get1 = (n: string): PropLine | undefined => cur[n]?.[0]
    const dtstartLine = get1('DTSTART')
    if (!dtstartLine) return
    const dtstart = parseIcsDate(dtstartLine.value, dtstartLine.params)
    if (!dtstart) return

    const dtendLine = get1('DTEND')
    const dtend = dtendLine ? parseIcsDate(dtendLine.value, dtendLine.params) : null

    const durationMin = (() => {
      if (dtend) return Math.max(1, Math.round((dtend.date.getTime() - dtstart.date.getTime()) / 60000))
      return dtstart.allDay ? 1440 : 30
    })()

    const endAt = (start: Date): Date => new Date(start.getTime() + durationMin * 60000)

    const exdates = new Set<number>()
    for (const ex of cur['EXDATE'] ?? []) {
      for (const part of ex.value.split(',')) {
        const parsed = parseIcsDate(part.trim(), ex.params)
        if (parsed) exdates.add(parsed.date.getTime())
      }
    }

    const uid = get1('UID')?.value ?? `ics-${dtstart.date.getTime()}`
    const summaryLine = get1('SUMMARY')
    const title = summaryLine ? unescapeText(summaryLine.value) : '(Başlıksız etkinlik)'
    const status = get1('STATUS')?.value?.toUpperCase()
    if (status === 'CANCELLED') return

    // Pencere oncesi baslamis ama hala suren etkinlikleri de al
    const effectiveFrom = new Date(from.getTime() - durationMin * 60000 - 12 * 3600 * 1000)

    const rruleLine = get1('RRULE')
    const rule = rruleLine ? parseRRule(rruleLine.value) : null

    const occurrences: Date[] = rule
      ? expandRecurrence(dtstart.date, rule, dtstart.mode, effectiveFrom, to, exdates)
      : [dtstart.date]

    for (const occ of occurrences) {
      const end = endAt(occ)
      if (end < from || occ > to) continue
      events.push({
        uid: rule ? `${uid}@${occ.toISOString()}` : uid,
        title,
        startAt: occ,
        endAt: end,
        location: (() => {
          const l = get1('LOCATION')
          return l ? unescapeText(l.value) : null
        })(),
        description: (() => {
          const d = get1('DESCRIPTION')
          return d ? unescapeText(d.value) : null
        })(),
        organizer: (() => {
          const o = get1('ORGANIZER')
          return o ? attendeesFrom(o.params, o.value) : null
        })(),
        attendees: (cur['ATTENDEE'] ?? []).map((a) => attendeesFrom(a.params, a.value)),
        allDay: dtstart.allDay
      })
    }
  }

  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true
      cur = {}
      continue
    }
    if (upper === 'END:VEVENT') {
      if (inEvent) flush()
      inEvent = false
      cur = {}
      continue
    }
    if (!inEvent) continue
    if (upper === 'BEGIN:VALARM') {
      inValarm = true
      continue
    }
    if (upper === 'END:VALARM') {
      inValarm = false
      continue
    }
    if (inValarm) continue // alarm alt bilesenlerini yoksay
    const prop = parsePropLine(line)
    if (!prop) continue
    ;(cur[prop.name] ??= []).push(prop)
  }

  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}