import { randomUUID } from 'node:crypto'
import { planEmailMerges, planPersonMerges, samePerson, shouldUpgradeName } from '../people/extract'
import type Database from 'better-sqlite3'
import { foldForId, slugForId } from '@shared/text'
import type {
  AppSettings,
  CalendarEventMeta,
  Citation,
  EnhancedNote,
  NoteDetail,
  NoteSource,
  NoteStatus,
  CalendarEventRowDto,
  CompanySummary,
  NoteSummary,
  PersonNoteLink,
  PersonSummary,
  TagSummary,
  TranscriptSegment
} from '@shared/types'

function nowIso(): string {
  return new Date().toISOString()
}

// --- satir -> nesne donusumleri ---------------------------------------------

interface NoteRow {
  id: string
  title: string
  started_at: string
  ended_at: string | null
  source: NoteSource
  status: NoteStatus
  calendar_event_id: string | null
  transcript_count?: number
}

function tagsFor(db: Database.Database, noteId: string): string[] {
  return db
    .prepare(
      `SELECT t.name FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ? ORDER BY t.name`
    )
    .all(noteId)
    .map((r) => (r as { name: string }).name)
}

function participantsFor(db: Database.Database, noteId: string): NoteSummary['participants'] {
  return db
    .prepare(
      `SELECT p.id, p.name, p.email, p.avatar_url
         FROM people p JOIN note_people np ON np.person_id = p.id
        WHERE np.note_id = ? ORDER BY p.name`
    )
    .all(noteId) as NoteSummary['participants']
}

function toSummary(db: Database.Database, row: NoteRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    started_at: row.started_at,
    ended_at: row.ended_at,
    source: row.source,
    status: row.status,
    calendar_event_id: row.calendar_event_id,
    tags: tagsFor(db, row.id),
    participants: participantsFor(db, row.id),
    transcript_count: row.transcript_count ?? 0
  }
}

// --- notlar ----------------------------------------------------------------

const NOTE_SELECT = `
  SELECT n.id, n.title, n.started_at, n.ended_at, n.source, n.status, n.calendar_event_id,
         (SELECT COUNT(*) FROM transcripts t WHERE t.note_id = n.id) AS transcript_count
    FROM notes n`

export function listNotes(db: Database.Database, opts?: { limit?: number }): NoteSummary[] {
  const rows = db
    .prepare(`${NOTE_SELECT} ORDER BY n.started_at DESC LIMIT ?`)
    .all(opts?.limit ?? 500) as NoteRow[]
  return rows.map((r) => toSummary(db, r))
}

export function searchNotes(db: Database.Database, query: string): NoteSummary[] {
  const q = query.trim()
  if (!q) return listNotes(db)
  // FTS5: kullanicinin yazdigi terimi guvenli sekilde prefix aramaya cevir
  const match = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '')}"*`)
    .join(' AND ')
  const rows = db
    .prepare(
      `${NOTE_SELECT}
        WHERE n.id IN (
          SELECT si.note_id FROM notes_fts f
            JOIN search_index si ON si.rowid = f.rowid
           WHERE notes_fts MATCH ?
          UNION
          SELECT t.note_id FROM transcripts_fts tf
            JOIN transcripts t ON t.rowid = tf.rowid
           WHERE transcripts_fts MATCH ?
        )
        ORDER BY n.started_at DESC LIMIT 200`
    )
    .all(match, match) as NoteRow[]
  return rows.map((r) => toSummary(db, r))
}

export function getNoteRow(db: Database.Database, id: string): NoteRow | null {
  const row = db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id) as NoteRow | undefined
  return row ?? null
}

export function getTranscripts(db: Database.Database, noteId: string): TranscriptSegment[] {
  return db
    .prepare(
      `SELECT id, note_id, channel, speaker_label, text, start_ms, end_ms
         FROM transcripts WHERE note_id = ? ORDER BY start_ms ASC, created_at ASC`
    )
    .all(noteId) as TranscriptSegment[]
}

export function getEnhancedNote(db: Database.Database, noteId: string): EnhancedNote | null {
  const row = db
    .prepare(
      `SELECT id, note_id, content_md, template_id, model, version, created_at
         FROM enhanced_notes WHERE note_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(noteId) as Omit<EnhancedNote, 'citations'> | undefined
  if (!row) return null
  const citations = db
    .prepare(
      `SELECT id, enhanced_note_id, sentence_ref, source_type, source_id, excerpt
         FROM citations WHERE enhanced_note_id = ? ORDER BY sentence_ref ASC`
    )
    .all(row.id) as Citation[]
  return { ...row, citations }
}

// ---------------------------------------------------------------------------
//  FAZ 4 — zenginlestirilmis notlar + kaynaklar (buyutec izlenebilirligi)
// ---------------------------------------------------------------------------

/** Bir sonraki surum numarasi (1 tabanli). */
export function nextEnhancedVersion(db: Database.Database, noteId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM enhanced_notes WHERE note_id = ?')
    .get(noteId) as { v: number }
  return row.v + 1
}

export interface NewCitation {
  sentence_ref: string
  source_type: 'transcript' | 'raw_note' | 'calendar'
  source_id: string | null
  excerpt: string | null
}

export interface NewEnhancedNote {
  noteId: string
  contentMd: string
  templateId: string | null
  model: string | null
  version: number
  citations: NewCitation[]
}

/**
 * Yeni zenginlestirilmis surumu ve kaynaklarini TEK ISLEMDE yazar.
 * Kaynaklar transaction icinde yazilir; yarim kalmis kaynak listesi olmaz.
 */
export function insertEnhancedNote(db: Database.Database, input: NewEnhancedNote): string {
  const id = randomUUID()
  const insNote = db.prepare(
    `INSERT INTO enhanced_notes (id, note_id, content_md, template_id, model, version)
     VALUES (@id, @noteId, @contentMd, @templateId, @model, @version)`
  )
  const insCit = db.prepare(
    `INSERT INTO citations (id, enhanced_note_id, sentence_ref, source_type, source_id, excerpt)
     VALUES (@id, @enhId, @ref, @type, @sourceId, @excerpt)`
  )
  const tx = db.transaction(() => {
    insNote.run({
      id,
      noteId: input.noteId,
      contentMd: input.contentMd,
      templateId: input.templateId,
      model: input.model,
      version: input.version
    })
    for (const c of input.citations) {
      insCit.run({
        id: randomUUID(),
        enhId: id,
        ref: c.sentence_ref,
        type: c.source_type,
        sourceId: c.source_id,
        excerpt: c.excerpt
      })
    }
  })
  tx()
  return id
}

/** Bir notun tum zenginlestirilmis surumleri (yeniden uretme gecmisi). */
export function listEnhancedVersions(
  db: Database.Database,
  noteId: string
): Array<{ id: string; version: number; model: string | null; created_at: string }> {
  return db
    .prepare(
      `SELECT id, version, model, created_at FROM enhanced_notes
        WHERE note_id = ? ORDER BY version DESC`
    )
    .all(noteId) as Array<{ id: string; version: number; model: string | null; created_at: string }>
}

export function getCalendarEvent(db: Database.Database, noteId: string): CalendarEventMeta | null {
  const note = db
    .prepare('SELECT calendar_event_id FROM notes WHERE id = ?')
    .get(noteId) as { calendar_event_id: string | null } | undefined
  if (!note?.calendar_event_id) return null
  const ev = db
    .prepare(
      `SELECT id, title, start_at, end_at, location, participants
         FROM calendar_events_cache WHERE id = ?`
    )
    .get(note.calendar_event_id) as
    | { id: string; title: string; start_at: string; end_at: string | null; location: string | null; participants: string | null }
    | undefined
  if (!ev) return null
  let participants: string[] = []
  try {
    participants = ev.participants ? (JSON.parse(ev.participants) as string[]) : []
  } catch {
    participants = []
  }
  return { id: ev.id, title: ev.title, start_at: ev.start_at, end_at: ev.end_at, location: ev.location, participants }
}

export function getNoteDetail(db: Database.Database, id: string): NoteDetail | null {
  const row = getNoteRow(db, id)
  if (!row) return null
  const raw = db.prepare('SELECT content_md FROM raw_notes WHERE note_id = ?').get(id) as
    | { content_md: string }
    | undefined
  return {
    note: toSummary(db, row),
    raw_notes_md: raw?.content_md ?? '',
    transcripts: getTranscripts(db, id),
    enhanced: getEnhancedNote(db, id),
    calendar_event: getCalendarEvent(db, id)
  }
}

export function createNote(
  db: Database.Database,
  input: { title: string; source: NoteSource; startedAt?: string; status?: NoteStatus }
): string {
  const id = randomUUID()
  const startedAt = input.startedAt ?? new Date().toISOString()
  db.prepare(
    `INSERT INTO notes (id, title, started_at, source, status)
     VALUES (@id, @title, @startedAt, @source, @status)`
  ).run({
    id,
    title: input.title,
    startedAt,
    source: input.source,
    status: input.status ?? 'ready'
  })
  db.prepare('INSERT OR IGNORE INTO raw_notes (note_id, content_md) VALUES (?, \'\')').run(id)
  return id
}

export function setNoteTitle(db: Database.Database, id: string, title: string): void {
  db.prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id)
}

export function setNoteStatus(db: Database.Database, id: string, status: NoteStatus, failReason?: string): void {
  db.prepare(
    "UPDATE notes SET status = ?, fail_reason = ?, ended_at = CASE WHEN ? IN ('ready','failed') THEN COALESCE(ended_at, ?) ELSE ended_at END, updated_at = ? WHERE id = ?"
  ).run(status, failReason ?? null, status, nowIso(), nowIso(), id)
}

export function setRawNotes(db: Database.Database, noteId: string, contentMd: string): void {
  db.prepare(
    `INSERT INTO raw_notes (note_id, content_md, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(note_id) DO UPDATE SET content_md = excluded.content_md, updated_at = excluded.updated_at`
  ).run(noteId, contentMd, nowIso())
}

export function insertTranscriptsReturning(
  db: Database.Database,
  noteId: string,
  rows: Array<Omit<TranscriptSegment, "id" | "note_id">>
): TranscriptSegment[] {
  const stmt = db.prepare(
    `INSERT INTO transcripts (id, note_id, channel, speaker_label, text, start_ms, end_ms)
     VALUES (@id, @noteId, @channel, @speaker, @text, @start, @end)`
  )
  const inserted: TranscriptSegment[] = rows.map((r) => ({
    id: randomUUID(),
    note_id: noteId,
    channel: r.channel,
    speaker_label: r.speaker_label,
    text: r.text,
    start_ms: r.start_ms,
    end_ms: r.end_ms
  }))
  const tx = db.transaction((items: TranscriptSegment[]) => {
    for (const r of items) {
      stmt.run({
        id: r.id,
        noteId,
        channel: r.channel,
        speaker: r.speaker_label,
        text: r.text,
        start: r.start_ms,
        end: r.end_ms
      })
    }
  })
  tx(inserted)
  return inserted
}

/** Ice aktarma gibi toplu yazimlarda sadece sayi doner. */
export function insertTranscripts(
  db: Database.Database,
  noteId: string,
  rows: Array<Omit<TranscriptSegment, "id" | "note_id">>
): number {
  return insertTranscriptsReturning(db, noteId, rows).length
}

/**
 * Uygulama kayit sirasinda kapanirsa 'recording' durumunda kalan notlari
 * toparlar (aksi halde not sonsuza kadar "kayit suruyor" gorunur).
 */
export function finalizeStuckRecordings(db: Database.Database): number {
  const res = db
    .prepare(
      `UPDATE notes SET status = "ready", ended_at = COALESCE(ended_at, ?), updated_at = ?
        WHERE status = "recording"`
    )
    .run(nowIso(), nowIso())
  return res.changes
}

export function deleteNote(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

// --- ayarlar ---------------------------------------------------------------

const DEFAULT_SETTINGS: AppSettings = {
  ui_language: 'tr',
  language: 'auto',
  stt_provider: 'groq',
  stt_model: 'whisper-large-v3-turbo',
  auto_start_calendar: 'participants',
  auto_start_call: true,
  auto_start_apps: false,
  allowed_apps: ['Zoom', 'Microsoft Teams', 'Discord', 'Google Meet', 'WhatsApp'],
  retention_days: 0,
  opt_out_training: true,
  notifications: true,
  default_template: 'auto',
  // --- FAZ 3: otomatik tetikleme ---
  // ICS kaynagi: yerel dosya yolu (C:\\...\\takvim.ics) veya https URL
  // (Google 'gizli iCal adresi' / Outlook 'takvimi yayinla' baglantisi)
  calendar_source: '',
  calendar_sync_minutes: 15,
  // Ilk 10 sn'de ses yoksa otomatik kaydi iptal et (yanlis tetikleme korumasi)
  auto_cancel_empty_seconds: 10,
  // Bu kadar sn ses gelmezse otomatik durdur (0 = kapali)
  auto_stop_silence_seconds: 60,
  // Kaydi tetikleyen uygulama kapaninca durdur
  auto_stop_on_app_close: true,
  // Ayni tetikleyicinin tekrar atesleme soguma suresi
  trigger_cooldown_seconds: 120,
  // Otomatik kayitlarda sistem sesini de yakala
  record_system_audio: true,
  // --- FAZ 4: LLM zenginlestirme ---
  // Varsayilan Groq: kullanicinin zaten var olan GROQ_API_KEY'i ile hemen calisir.
  // 'local' = cevrimdisi sezgisel cikarim (anahtar gerekmez).
  llm_provider: 'groq',
  // Bos ise saglayicinin varsayilan modeli kullanilir
  llm_model: '',
  // Kayit bitince otomatik zenginlestir (spesifikasyon: 'Toplanti bitince not
  // otomatik zenginlesiyor')
  auto_enhance: true,
  // --- FAZ 6 ---
  chat_max_context_notes: 12,
  // --- FAZ 7 ---
  os_notifications: true,
  jargon_enabled: true,
  export_dir: '',
  encrypt_db: false,
  stt_prompt: ''
}

export function getAllSettings(db: Database.Database): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const [k, v] of map.entries()) {
    if (!(k in DEFAULT_SETTINGS)) continue
    const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]
    if (typeof def === 'boolean') out[k] = v === 'true' || v === '1'
    else if (typeof def === 'number') out[k] = Number(v)
    else if (Array.isArray(def)) {
      try {
        out[k] = JSON.parse(v)
      } catch {
        out[k] = def
      }
    } else out[k] = v
  }
  return out as unknown as AppSettings
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  const str = Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, str, nowIso())
}

export function getSettingRaw(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

// --- sablonlar -------------------------------------------------------------

export function listTemplates(db: Database.Database) {
  return db
    .prepare('SELECT id, name, description, is_builtin FROM templates ORDER BY sort_order ASC')
    .all()
    .map((r) => {
      const row = r as { id: string; name: string; description: string | null; is_builtin: number }
      return { id: row.id, name: row.name, description: row.description, is_builtin: row.is_builtin === 1 }
    })
}

// ---------------------------------------------------------------------------
//  FAZ 3 - Takvim onbellegi (salt okunur ICS -> calendar_events_cache)
// ---------------------------------------------------------------------------

/** Takvim satirinin sekli paylasilan tiplerde tanimli (renderer da kullanir). */
export type CalendarEventRow = CalendarEventRowDto

interface RawCalendarRow {
  id: string
  title: string
  start_at: string
  end_at: string | null
  location: string | null
  description: string | null
  participants: string | null
  organizer: string | null
  all_day: number | null
  triggered_at: string | null
}

function toCalendarRow(r: RawCalendarRow): CalendarEventRow {
  let participants: string[] = []
  try {
    participants = r.participants ? (JSON.parse(r.participants) as string[]) : []
  } catch {
    participants = []
  }
  return {
    id: r.id,
    title: r.title,
    start_at: r.start_at,
    end_at: r.end_at,
    location: r.location,
    description: r.description,
    participants,
    organizer: r.organizer,
    all_day: Boolean(r.all_day),
    triggered_at: r.triggered_at
  }
}

export interface UpsertCalendarEvent {
  id: string
  calendarId: string | null
  title: string
  startAt: string
  endAt: string | null
  location: string | null
  description: string | null
  participants: string[]
  organizer: string | null
  allDay: boolean
}

/** Etkinlikleri yazar; tetiklenmis isaretleri KORUNUR (ON CONFLICT'ta guncellenmez). */
export function upsertCalendarEvents(db: Database.Database, events: UpsertCalendarEvent[]): number {
  const stmt = db.prepare(
    `INSERT INTO calendar_events_cache
       (id, calendar_id, title, start_at, end_at, location, description, participants,
        organizer, all_day, fetched_at, updated_at)
     VALUES (@id, @calendarId, @title, @startAt, @endAt, @location, @description, @participants,
             @organizer, @allDay, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       start_at = excluded.start_at,
       end_at = excluded.end_at,
       location = excluded.location,
       description = excluded.description,
       participants = excluded.participants,
       organizer = excluded.organizer,
       all_day = excluded.all_day,
       updated_at = excluded.updated_at`
  )
  const now = nowIso()
  const tx = db.transaction((rows: UpsertCalendarEvent[]) => {
    for (const e of rows) {
      stmt.run({
        id: e.id,
        calendarId: e.calendarId,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        location: e.location,
        description: e.description,
        participants: JSON.stringify(e.participants ?? []),
        organizer: e.organizer,
        allDay: e.allDay ? 1 : 0,
        now
      })
    }
  })
  tx(events)
  return events.length
}

/** Gecmis etkinlikleri temizler (onbellek sismesin). */
export function pruneCalendarEvents(db: Database.Database, beforeIso: string): number {
  const res = db.prepare('DELETE FROM calendar_events_cache WHERE start_at < ?').run(beforeIso)
  return res.changes
}

/** Kaynak degistiginde tetikleme isaretlerini sifirla. */
export function resetCalendarTriggers(db: Database.Database): number {
  const res = db.prepare('UPDATE calendar_events_cache SET triggered_at = NULL').run()
  return res.changes
}

export function listUpcomingCalendarEvents(
  db: Database.Database,
  fromIso: string,
  limit = 20
): CalendarEventRow[] {
  const rows = db
    .prepare(
      `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache
        WHERE start_at >= ?
        ORDER BY start_at ASC LIMIT ?`
    )
    .all(fromIso, limit) as RawCalendarRow[]
  return rows.map(toCalendarRow)
}

/** Su an tetiklenmesi gereken etkinlikler: baslangic [fromIso, toIso) ve henuz tetiklenmemis. */
export function findDueCalendarEvents(
  db: Database.Database,
  fromIso: string,
  toIso: string
): CalendarEventRow[] {
  const rows = db
    .prepare(
      `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache
        WHERE triggered_at IS NULL
          AND start_at >= ? AND start_at < ?
        ORDER BY start_at ASC`
    )
    .all(fromIso, toIso) as RawCalendarRow[]
  return rows.map(toCalendarRow)
}

export function markCalendarEventTriggered(db: Database.Database, id: string): void {
  db.prepare('UPDATE calendar_events_cache SET triggered_at = ? WHERE id = ?').run(nowIso(), id)
}

export function getCalendarEventRow(db: Database.Database, id: string): CalendarEventRow | null {
  const row = db
    .prepare(
      `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache WHERE id = ?`
    )
    .get(id) as RawCalendarRow | undefined
  return row ? toCalendarRow(row) : null
}

export function countCalendarEvents(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM calendar_events_cache').get() as { c: number }
  return row.c
}

/** Notu otomatik tetikleme nedeniyle isaretler. */
/** Ayni takvim etkinligi icin daha once not acilmis mi? */
export function findNoteByCalendarEventId(db: Database.Database, eventId: string): string | null {
  const row = db
    .prepare('SELECT id FROM notes WHERE calendar_event_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(eventId) as { id: string } | undefined
  return row?.id ?? null
}

export function setNoteTriggerReason(db: Database.Database, noteId: string, reason: string): void {
  db.prepare('UPDATE notes SET trigger_reason = ? WHERE id = ?').run(reason, noteId)
}

/** Takvim etkinligini nota baglar (takvim tetiklemesiyle acilan notlar icin). */
export function linkNoteToCalendarEvent(db: Database.Database, noteId: string, eventId: string, title: string): void {
  db.prepare(
    `UPDATE notes SET calendar_event_id = ?, title = ?, updated_at = ? WHERE id = ?`
  ).run(eventId, title, nowIso(), noteId)
}


/**
 * Takvim etkinligi katilimcilarini kisi olarak kaydeder ve nota baglar.
 * Kimlik isimden turetilir; ayni kisi tekrar eklenmez (Faz 5'te zenginlesecek).
 */
export function linkNoteParticipants(db: Database.Database, noteId: string, names: string[]): number {
  const list = names.map((n) => n.trim()).filter(Boolean)
  if (list.length === 0) return 0
  const insPerson = db.prepare(
    `INSERT INTO people (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`
  )
  const insLink = db.prepare(
    `INSERT OR IGNORE INTO note_people (note_id, person_id, role) VALUES (?, ?, 'participant')`
  )
  const tx = db.transaction((items: string[]) => {
    for (const name of items) {
      const id = 'p:' + name.toLocaleLowerCase('tr').replace(/\s+/g, '-')
      insPerson.run(id, name)
      insLink.run(noteId, id)
    }
  })
  tx(list)
  return list.length
}


// ---------------------------------------------------------------------------
//  FAZ 5 - Kisiler, sirketler, etiketler
// ---------------------------------------------------------------------------

interface PersonRow {
  id: string
  name: string
  email: string | null
  title: string | null
  avatar_url: string | null
  company_id: string | null
  company_name: string | null
  source: string
  note_count: number
  last_seen_at: string | null
}

const PERSON_SELECT = `
  SELECT p.id, p.name, p.email, p.title, p.avatar_url, p.company_id,
         c.name AS company_name,
         (SELECT COUNT(*) FROM note_people np WHERE np.person_id = p.id) AS note_count,
         (SELECT MAX(n.started_at) FROM note_people np JOIN notes n ON n.id = np.note_id
           WHERE np.person_id = p.id) AS last_seen_at
    FROM people p
    LEFT JOIN companies c ON c.id = p.company_id`

function toPersonSummary(r: PersonRow): PersonSummary {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    title: r.title,
    avatar_url: r.avatar_url,
    company_id: r.company_id,
    company_name: r.company_name,
    note_count: r.note_count,
    last_seen_at: r.last_seen_at
  }
}

export function listPeople(db: Database.Database, opts?: { query?: string }): PersonSummary[] {
  const q = (opts?.query ?? '').trim()
  if (!q) {
    const rows = db.prepare(`${PERSON_SELECT} ORDER BY note_count DESC, p.name ASC`).all() as PersonRow[]
    return rows.map(toPersonSummary)
  }
  const like = `%${q}%`
  const rows = db
    .prepare(
      `${PERSON_SELECT}
        WHERE p.name LIKE ? COLLATE NOCASE OR IFNULL(p.email,'') LIKE ? COLLATE NOCASE
           OR IFNULL(p.title,'') LIKE ? COLLATE NOCASE OR IFNULL(c.name,'') LIKE ? COLLATE NOCASE
        ORDER BY note_count DESC, p.name ASC`
    )
    .all(like, like, like, like) as PersonRow[]
  return rows.map(toPersonSummary)
}

export function getPerson(db: Database.Database, id: string): PersonSummary | null {
  const row = db.prepare(`${PERSON_SELECT} WHERE p.id = ?`).get(id) as PersonRow | undefined
  return row ? toPersonSummary(row) : null
}

export function updatePerson(
  db: Database.Database,
  id: string,
  patch: { name?: string; email?: string | null; title?: string | null; company_id?: string | null }
): void {
  const cur = getPerson(db, id)
  if (!cur) return
  db.prepare(
    `UPDATE people SET name = @name, email = @email, title = @title, company_id = @companyId,
            source = 'manual'
      WHERE id = @id`
  ).run({
    id,
    name: patch.name?.trim() || cur.name,
    email: patch.email === undefined ? cur.email : patch.email,
    title: patch.title === undefined ? cur.title : patch.title,
    companyId: patch.company_id === undefined ? cur.company_id : patch.company_id
  })
}

/** Iki kisi kaydini birlestirir (ayni kisi iki kez cikarildiysa). */
export function mergePeople(db: Database.Database, fromId: string, toId: string): number {
  if (fromId === toId) return 0
  const tx = db.transaction(() => {
    const links = db
      .prepare('SELECT note_id, role, evidence FROM note_people WHERE person_id = ?')
      .all(fromId) as Array<{ note_id: string; role: string | null; evidence: string | null }>
    const ins = db.prepare(
      `INSERT INTO note_people (note_id, person_id, role, evidence) VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id, person_id) DO UPDATE SET
         role = CASE
           WHEN excluded.role = 'participant' THEN 'participant'
           WHEN note_people.role IS NULL THEN excluded.role
           ELSE note_people.role
         END,
         evidence = COALESCE(note_people.evidence, excluded.evidence)`
    )
    for (const l of links) ins.run(l.note_id, toId, l.role, l.evidence)
    db.prepare('DELETE FROM people WHERE id = ?').run(fromId)
    return links.length
  })
  return tx()
}

export function deletePerson(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM people WHERE id = ?').run(id)
}

/** Kisi/not baglantisini kaydeder (delil ile). */
export function linkNotePerson(
  db: Database.Database,
  noteId: string,
  personId: string,
  role: string,
  evidence: string | null
): void {
  // ROL ONCELIGI (duzeltme): COALESCE eski degeri korur, bu yuzden once
  // 'mentioned' yazilan bir kisi sonradan 'participant' olamiyordu.
  // 'participant' her zaman kazanir; diger durumda mevcut deger korunur.
  db.prepare(
    `INSERT INTO note_people (note_id, person_id, role, evidence) VALUES (?, ?, ?, ?)
     ON CONFLICT(note_id, person_id) DO UPDATE SET
       role = CASE
         WHEN excluded.role = 'participant' THEN 'participant'
         WHEN note_people.role IS NULL THEN excluded.role
         ELSE note_people.role
       END,
       evidence = COALESCE(note_people.evidence, excluded.evidence)`
  ).run(noteId, personId, role, evidence)
}

/** Bir kisinin iliskili oldugu notlar. */
export function listPersonNotes(db: Database.Database, personId: string): PersonNoteLink[] {
  const rows = db
    .prepare(
      `SELECT n.id AS note_id, n.title, n.started_at, n.source, np.role, np.evidence
         FROM note_people np JOIN notes n ON n.id = np.note_id
        WHERE np.person_id = ? ORDER BY n.started_at DESC LIMIT 300`
    )
    .all(personId) as Array<{
    note_id: string
    title: string
    started_at: string
    source: NoteSource
    role: string | null
    evidence: string | null
  }>
  return rows
}

/** Bir kisinin notlarindaki ortak etiketler. */
export function listPersonTags(db: Database.Database, personId: string): string[] {
  const rows = db
    .prepare(
      `SELECT t.name, COUNT(*) AS c
         FROM note_people np
         JOIN note_tags nt ON nt.note_id = np.note_id
         JOIN tags t ON t.id = nt.tag_id
        WHERE np.person_id = ?
        GROUP BY t.name ORDER BY c DESC, t.name ASC`
    )
    .all(personId) as Array<{ name: string; c: number }>
  return rows.map((r) => r.name)
}

/**
 * Kisi bul (yoksa olustur).
 *
 * ESLESTIRME SIRASI (duzeltme: eskiden yalnizca TAM AD eslesiyordu ve
 * "Sarah Jones" ile "Sarah" iki ayri kayit oluyordu):
 *   1) Tam ad eslesmesi (hizli yol)
 *   2) Ayni e-posta adresi -> kesin ayni kisi
 *   3) Ayni NOTTA bagli olan kisiler arasinda akilli isim eslesmesi (samePerson)
 *      -> ayni toplantida hem "Sarah" hem "Sarah Jones" gecmesi ayni kisidir.
 *      Farkli notlarda gecen benzer adlar BIRLESTIRILMEZ (yanlis birlesme riski).
 */
export function upsertPersonByName(
  db: Database.Database,
  name: string,
  extra?: {
    email?: string | null
    title?: string | null
    companyId?: string | null
    /** Eslesme baglami: bu notta bagli kisilerle akilli eslesme denenir */
    noteId?: string | null
  }
): string {
  const trimmed = name.trim()

  // 1) Tam ad
  const byName = db
    .prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(trimmed) as { id: string } | undefined

  // 2) E-posta
  const email = (extra?.email ?? '').trim()
  const byEmail = email
    ? (db
        .prepare('SELECT id FROM people WHERE email = ? COLLATE NOCASE LIMIT 1')
        .get(email) as { id: string } | undefined)
    : undefined

  // 3) Ayni nottaki kisilerle akilli eslesme
  let bySameNote: { id: string } | undefined
  if (!byName && !byEmail && extra?.noteId) {
    const linked = db
      .prepare(
        `SELECT p.id, p.name FROM note_people np JOIN people p ON p.id = np.person_id
          WHERE np.note_id = ?`
      )
      .all(extra.noteId) as Array<{ id: string; name: string }>
    bySameNote = linked.find((l) => samePerson(l.name, trimmed))
  }

  const existing = byName ?? byEmail ?? bySameNote
  if (existing) {
    if (extra && (extra.email || extra.title || extra.companyId)) {
      db.prepare(
        `UPDATE people SET email = COALESCE(email, @email), title = COALESCE(title, @title),
                company_id = COALESCE(company_id, @companyId) WHERE id = @id`
      ).run({
        id: existing.id,
        email: extra.email ?? null,
        title: extra.title ?? null,
        companyId: extra.companyId ?? null
      })
    }
    // Adi daha bilgilendirici haliyle yukselt ("Sarah" -> "Sarah Jones").
    // Kullanicinin elle yazdigi tam ad asla kisa bir adla EZILMEZ.
    const cur = db.prepare('SELECT name, source FROM people WHERE id = ?').get(existing.id) as
      | { name: string; source: string | null }
      | undefined
    if (cur && cur.source !== 'manual' && shouldUpgradeName(cur.name, trimmed)) {
      db.prepare('UPDATE people SET name = ? WHERE id = ?').run(trimmed, existing.id)
    }
    return existing.id
  }
  const id = 'p:' + normalizedPersonId(trimmed)
  db.prepare('INSERT INTO people (id, name, email, title, company_id) VALUES (?, ?, ?, ?, ?)').run(
    id,
    trimmed,
    extra?.email ?? null,
    extra?.title ?? null,
    extra?.companyId ?? null
  )
  return id
}

/**
 * Isimden kararli kimlik (ayni isim -> ayni kayit).
 * `slugForId` kullanir: tek kaynak, Turkce I tuzagindan etkilenmez.
 */
export function normalizedPersonId(name: string): string {
  return slugForId(name)
}

// --- sirketler -------------------------------------------------------------

/**
 * Sirket yaz (yoksa olustur). ID ISIMDEN turetilir ve STABILDIR.
 *
 * DIKKAT (gercek hata): Bu fonksiyon onceden ayni alan adina sahip "kardes"
 * sirketi de siliyordu. Cagiran taraf donen ID'yi sakladigi icin, sonradan
 * yazilan kisi SILINMIS bir company_id'ye isaret ediyor ve
 * "FOREIGN KEY constraint failed" aliniyordu.
 * Cozum: birleştirme ayri bir adima tasindi (dedupeCompanies) ve burada
 * YALNIZCA yazma yapilir; boylece ID'ler stabil kalir.
 */
export function upsertCompany(
  db: Database.Database,
  name: string,
  domain: string | null
): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const id = 'c:' + slugForId(trimmed)
  db.prepare(
    `INSERT INTO companies (id, name, domain) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET domain = COALESCE(companies.domain, excluded.domain)`
  ).run(id, trimmed, domain)
  return id
}

/**
 * Ayni alan adina sahip sirketleri (veya ayni ada sahip tekrarlari) birlestirir.
 * Hedef: en cok kisiye sahip olan, esitse en cok notu olan, esitse en uzun ad.
 * Ayarlar > "Tekrarlari birlestir" ile veya cikarim sonrasinda cagrilir.
 */
export function dedupeCompanies(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.domain,
              (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id) AS people_count,
              (SELECT COUNT(DISTINCT np.note_id) FROM people p2
                 JOIN note_people np ON np.person_id = p2.id
                WHERE p2.company_id = c.id) AS note_count
         FROM companies c`
    )
    .all() as Array<{ id: string; name: string; domain: string | null; people_count: number; note_count: number }>

  // Anahtar: alan adi varsa alan adi, yoksa normalize edilmis ad
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = (r.domain ?? '').trim().toLocaleLowerCase('en') || normalizedPersonId(r.name)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  let merged = 0
  const tx = db.transaction(() => {
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const sorted = [...group].sort((a, b) => {
        if (b.people_count !== a.people_count) return b.people_count - a.people_count
        if (b.note_count !== a.note_count) return b.note_count - a.note_count
        return b.name.length - a.name.length
      })
      const keep = sorted[0]
      for (const other of sorted.slice(1)) {
        db.prepare('UPDATE people SET company_id = ? WHERE company_id = ?').run(keep.id, other.id)
        db.prepare('DELETE FROM companies WHERE id = ?').run(other.id)
        merged++
      }
    }
  })
  tx()
  return merged
}

interface CompanyRow {
  id: string
  name: string
  domain: string | null
  note_count: number
  people_count: number
}

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.domain,
         (SELECT COUNT(DISTINCT np.note_id) FROM people p
            JOIN note_people np ON np.person_id = p.id
           WHERE p.company_id = c.id) AS note_count,
         (SELECT COUNT(*) FROM people p2 WHERE p2.company_id = c.id) AS people_count
    FROM companies c`

function toCompanySummary(r: CompanyRow): CompanySummary {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    note_count: r.note_count,
    people_count: r.people_count
  }
}

export function listCompanies(db: Database.Database): CompanySummary[] {
  const rows = db
    .prepare(`${COMPANY_SELECT} ORDER BY note_count DESC, c.name ASC`)
    .all() as CompanyRow[]
  return rows.map(toCompanySummary)
}

export function getCompany(db: Database.Database, id: string): CompanySummary | null {
  const row = db.prepare(`${COMPANY_SELECT} WHERE c.id = ?`).get(id) as CompanyRow | undefined
  return row ? toCompanySummary(row) : null
}

export function listCompanyPeople(db: Database.Database, companyId: string): PersonSummary[] {
  const rows = db
    .prepare(`${PERSON_SELECT} WHERE p.company_id = ? ORDER BY note_count DESC, p.name ASC`)
    .all(companyId) as PersonRow[]
  return rows.map(toPersonSummary)
}

/** Ayni kisi gibi gorunen kayitlari birlestirir; birlestirilen sayisini doner. */
export function dedupePeople(db: Database.Database): number {
  // Once sirketleri birlestir (kisiler sirkete bagli olabilir)
  dedupeCompanies(db)
  const notes = db.prepare('SELECT id FROM notes').all() as Array<{ id: string }>
  const grouped: Array<{ noteId: string; people: Array<{ id: string; name: string; email: string | null; noteCount: number }> }> = []
  for (const n of notes) {
    grouped.push({
      noteId: n.id,
      people: db
        .prepare(
          `SELECT p.id, p.name, p.email,
                  (SELECT COUNT(*) FROM note_people np2 WHERE np2.person_id = p.id) AS noteCount
             FROM note_people np JOIN people p ON p.id = np.person_id
            WHERE np.note_id = ?`
        )
        .all(n.id) as Array<{ id: string; name: string; email: string | null; noteCount: number }>
    })
  }
  const all = listPeople(db).map((p) => ({ id: p.id, name: p.name, email: p.email, noteCount: p.note_count }))

  // Once e-posta temelli (bağlamdan bağımsız kesin), sonra ayni-not temelli
  const decisions = [...planEmailMerges(all), ...planPersonMerges(grouped)]
  let merged = 0
  const done = new Set<string>()
  for (const d of decisions) {
    if (d.fromId === d.toId || done.has(d.fromId)) continue
    // Hedef kayit hala var mi?
    const stillThere = db.prepare('SELECT 1 FROM people WHERE id = ?').get(d.fromId)
    if (!stillThere) continue
    mergePeople(db, d.fromId, d.toId)
    done.add(d.fromId)
    merged++
  }
  return merged
}

export function listCompanyNotes(db: Database.Database, companyId: string): PersonNoteLink[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT n.id AS note_id, n.title, n.started_at, n.source, np.role, np.evidence
         FROM people p
         JOIN note_people np ON np.person_id = p.id
         JOIN notes n ON n.id = np.note_id
        WHERE p.company_id = ? ORDER BY n.started_at DESC LIMIT 300`
    )
    .all(companyId) as Array<{
    note_id: string
    title: string
    started_at: string
    source: NoteSource
    role: string | null
    evidence: string | null
  }>
  return rows
}

// --- etiketler -------------------------------------------------------------

export function listTags(db: Database.Database): TagSummary[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
         FROM tags t ORDER BY note_count DESC, t.name ASC`
    )
    .all() as Array<{ id: string; name: string; note_count: number }>
  return rows
}

/** Etiket adini sadelestirir: bas/son bosluk, bas # kalir, tek bosluk. */
export function normalizeTagName(name: string): string {
  return foldForId(
    (name ?? '')
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
  )
}

export function addTagToNote(db: Database.Database, noteId: string, rawName: string): TagSummary | null {
  const name = normalizeTagName(rawName)
  if (!name) return null
  const id = 't:' + slugForId(name)
  db.prepare('INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(id, name)
  db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, id)
  const row = db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
         FROM tags t WHERE t.id = ?`
    )
    .get(id) as { id: string; name: string; note_count: number } | undefined
  return row ?? null
}

export function removeTagFromNote(db: Database.Database, noteId: string, tagId: string): void {
  db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(noteId, tagId)
  // Kullanimda kalmayan etiketi temizle
  const used = db.prepare('SELECT COUNT(*) AS c FROM note_tags WHERE tag_id = ?').get(tagId) as {
    c: number
  }
  if (used.c === 0) db.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
}

export function listNoteTags(db: Database.Database, noteId: string): TagSummary[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM note_tags nt2 WHERE nt2.tag_id = t.id) AS note_count
         FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ? ORDER BY t.name ASC`
    )
    .all(noteId) as Array<{ id: string; name: string; note_count: number }>
  return rows
}

// --- transkript parcasi duzenleme -----------------------------------------

export function deleteTranscript(db: Database.Database, id: string): boolean {
  const res = db.prepare('DELETE FROM transcripts WHERE id = ?').run(id)
  return res.changes > 0
}

export function updateTranscriptSpeaker(db: Database.Database, id: string, label: string): boolean {
  const res = db
    .prepare('UPDATE transcripts SET speaker_label = ? WHERE id = ?')
    .run(label.trim() || null, id)
  return res.changes > 0
}

/** Bir notun tum transkript metni (cikarim/kapsamli soru icin). */
export function transcriptTextOf(db: Database.Database, noteId: string): string {
  const rows = db
    .prepare('SELECT channel, speaker_label, text FROM transcripts WHERE note_id = ? ORDER BY start_ms ASC')
    .all(noteId) as Array<{ channel: string; speaker_label: string | null; text: string }>
  return rows
    .map((r) => `${r.speaker_label ?? (r.channel === 'mic' ? 'Ben' : 'Karşı taraf')}: ${r.text}`)
    .join('\n')
}

/** Dizin ozeti icin sayimlar (her sorguda tam liste cekmemek icin). */
export function directoryCounts(db: Database.Database): { people: number; companies: number; tags: number } {
  const p = db.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }
  const c = db.prepare('SELECT COUNT(*) AS c FROM companies').get() as { c: number }
  const t = db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }
  return { people: p.c, companies: c.c, tags: t.c }
}
