// ============================================================================
//  FAZ 7 — Disa aktarma: Markdown / JSON / CSV.
//
//  Tasarim kararlari:
//   - Markdown: tek dosya (tum notlar) VEYA not basina ayri dosya (Obsidian/
//     Notion icin "splitFiles"). Front-matter (YAML) eklenir; etiketler,
//     kisiler, sirket ve takvim meta verisi oraya yazilir.
//   - JSON: tam yedek (not, ham not, transkript, zenginlestirme, kaynaklar,
//     etiketler, kisiler). Baska bir araca aktarilabilir.
//   - CSV: not basina tek satir (Excel/Sheets icin). Alanlar RFC 4180'e gore
//     tirnaklanir (virgul, tirnak, satir sonu kacisi).
//  Dosyalar hedef klasore yazilir; var olan dosyalar UZERINE YAZILMAZ,
//  sonuna sayi eklenir (veri kaybi olmasin).
// ============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ExportRequest, ExportResult } from '@shared/types'
import * as repo from '../db/repo'
import { rawNotesToPlain } from '@shared/text'

// --- yardimcilar -----------------------------------------------------------

/** Dosya adi icin guvenli metin (Turkce karakterler korunur). */
export function safeFileName(input: string, fallback = 'not'): string {
  const s = (input ?? '')
    .replace(/[\\/:*?"<>|]/g, '-') // Windows'ta yasak karakterler
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
  return s || fallback
}

/** CSV alanini RFC 4180'e gore tirnaklar. */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (s === '') return ''
  const needsQuote = /[",\r\n]/.test(s) || s !== s.trim()
  const escaped = s.replace(/"/g, '""')
  return needsQuote ? `"${escaped}"` : escaped
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',')
}

/** YAML front-matter degeri (tirnak gerekliyse ekler). */
export function yamlValue(value: string): string {
  const s = value ?? ''
  if (s === '') return '""'
  if (/^[\w\-. /]+$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s
  return JSON.stringify(s)
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// --- markdown --------------------------------------------------------------

export function noteToMarkdown(
  db: Database.Database,
  noteId: string,
  opts: { includeTranscripts: boolean }
): string | null {
  const d = repo.getNoteDetail(db, noteId)
  if (!d) return null
  const n = d.note
  const out: string[] = []

  // Front-matter (Obsidian/Notion uyumlu)
  out.push('---')
  out.push(`title: ${yamlValue(n.title)}`)
  out.push(`date: ${n.started_at}`)
  if (n.ended_at) out.push(`ended: ${n.ended_at}`)
  out.push(`source: ${n.source}`)
  out.push(`status: ${n.status}`)
  if (n.tags.length > 0) out.push(`tags: [${n.tags.map(yamlValue).join(', ')}]`)
  if (n.participants.length > 0)
    out.push(`people: [${n.participants.map((p) => yamlValue(p.name)).join(', ')}]`)
  if (d.calendar_event) {
    out.push(`calendar: ${yamlValue(d.calendar_event.title)}`)
    if (d.calendar_event.location) out.push(`location: ${yamlValue(d.calendar_event.location)}`)
  }
  out.push('---')
  out.push('')
  out.push(`# ${n.title}`)
  out.push('')

  const raw = rawNotesToPlain(d.raw_notes_md).trim()
  if (raw) {
    out.push('## Ham notlarım')
    out.push('')
    out.push(raw)
    out.push('')
  }

  if (d.enhanced) {
    out.push('## AI ile zenginleştirilmiş not')
    out.push('')
    out.push(d.enhanced.content_md.trim())
    out.push('')
    // Kaynaklar (izlenebilirlik korunur)
    if (d.enhanced.citations.length > 0) {
      out.push('### Kaynaklar')
      out.push('')
      for (const c of d.enhanced.citations) {
        const kind =
          c.source_type === 'transcript'
            ? 'transkript'
            : c.source_type === 'raw_note'
              ? 'ham not'
              : 'takvim'
        out.push(`- \`${c.sentence_ref}\` (${kind}): ${(c.excerpt ?? '').trim()}`)
      }
      out.push('')
    }
    out.push(`<!-- model: ${d.enhanced.model ?? '-'} • sürüm: ${d.enhanced.version} -->`)
    out.push('')
  }

  if (opts.includeTranscripts && d.transcripts.length > 0) {
    out.push('## Transkript')
    out.push('')
    for (const t of d.transcripts) {
      const who = t.speaker_label ?? (t.channel === 'mic' ? 'Ben' : 'Karşı taraf')
      const chan = t.channel === 'mic' ? 'mikrofon' : 'sistem'
      out.push(`- \`${fmtClock(t.start_ms)}\` **${who}** _(${chan})_: ${t.text}`)
    }
    out.push('')
  }

  return out.join('\n').trimEnd() + '\n'
}

// --- json -----------------------------------------------------------------

export function noteToJsonObject(db: Database.Database, noteId: string): unknown {
  const d = repo.getNoteDetail(db, noteId)
  if (!d) return null
  return {
    id: d.note.id,
    title: d.note.title,
    started_at: d.note.started_at,
    ended_at: d.note.ended_at,
    source: d.note.source,
    status: d.note.status,
    tags: d.note.tags,
    people: d.note.participants.map((p) => ({ name: p.name, email: p.email })),
    calendar_event: d.calendar_event,
    raw_notes: rawNotesToPlain(d.raw_notes_md),
    raw_notes_html: d.raw_notes_md,
    enhanced: d.enhanced
      ? {
          version: d.enhanced.version,
          model: d.enhanced.model,
          template_id: d.enhanced.template_id,
          content_md: d.enhanced.content_md,
          citations: d.enhanced.citations
        }
      : null,
    transcripts: d.transcripts.map((t) => ({
      channel: t.channel,
      speaker: t.speaker_label,
      text: t.text,
      start_ms: t.start_ms,
      end_ms: t.end_ms
    }))
  }
}

// --- csv ------------------------------------------------------------------

export const CSV_HEADERS = [
  'id',
  'title',
  'started_at',
  'ended_at',
  'source',
  'status',
  'tags',
  'people',
  'transcript_segments',
  'raw_notes_chars',
  'enhanced_version',
  'enhanced_model'
]

export function notesToCsv(db: Database.Database, noteIds: string[]): string {
  const lines: string[] = [csvRow(CSV_HEADERS)]
  for (const id of noteIds) {
    const d = repo.getNoteDetail(db, id)
    if (!d) continue
    lines.push(
      csvRow([
        d.note.id,
        d.note.title,
        d.note.started_at,
        d.note.ended_at ?? '',
        d.note.source,
        d.note.status,
        d.note.tags.join('; '),
        d.note.participants.map((p) => p.name).join('; '),
        d.transcripts.length,
        rawNotesToPlain(d.raw_notes_md).length,
        d.enhanced?.version ?? '',
        d.enhanced?.model ?? ''
      ])
    )
  }
  return lines.join('\r\n') + '\r\n'
}

// --- ana akis --------------------------------------------------------------

/** Ayni ada sahip dosya varsa " (2)", " (3)" ... ekler. */
export function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = join(dir, `${base}${ext}`)
  let i = 1
  while (existsSync(candidate)) {
    i++
    candidate = join(dir, `${base} (${i})${ext}`)
  }
  return candidate
}

export function exportNotes(db: Database.Database, req: ExportRequest): ExportResult {
  try {
    // 1) Hedef klasor
    const targetDir =
      req.targetDir?.trim() ||
      repo.getSettingRaw(db, 'export_dir')?.trim() ||
      ''
    if (!targetDir) {
      return { ok: false, files: [], targetDir: '', noteCount: 0, bytes: 0, error: 'Hedef klasor secilmedi' }
    }
    mkdirSync(targetDir, { recursive: true })

    // 2) Notlar
    let noteIds: string[] = []
    if (req.scope.kind === 'note' && req.scope.id) noteIds = [req.scope.id]
    else if (req.scope.kind === 'person' && req.scope.id)
      noteIds = repo.listPersonNotes(db, req.scope.id).map((l) => l.note_id)
    else if (req.scope.kind === 'company' && req.scope.id)
      noteIds = repo.listCompanyNotes(db, req.scope.id).map((l) => l.note_id)
    else noteIds = repo.listNotes(db, { limit: 5000 }).map((n) => n.id)

    if (noteIds.length === 0) {
      return { ok: false, files: [], targetDir, noteCount: 0, bytes: 0, error: 'Aktarilacak not yok' }
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const files: string[] = []
    let bytes = 0

    const write = (path: string, content: string): void => {
      writeFileSync(path, content, 'utf-8')
      files.push(path.slice(targetDir.length + 1))
      bytes += Buffer.byteLength(content, 'utf-8')
    }

    if (req.format === 'markdown') {
      if (req.splitFiles) {
        // Obsidian/Notion icin: not basina ayri dosya
        const folder = join(targetDir, `notlar-${stamp}`)
        mkdirSync(folder, { recursive: true })
        for (const id of noteIds) {
          const md = noteToMarkdown(db, id, { includeTranscripts: req.includeTranscripts })
          if (!md) continue
          const d = repo.getNoteDetail(db, id)
          const date = (d?.note.started_at ?? '').slice(0, 10)
          const base = safeFileName(`${date} ${d?.note.title ?? 'not'}`)
          write(uniquePath(folder, base, '.md'), md)
        }
        // Ayrica bir indeks
        const index = repo
          .listNotes(db, { limit: 5000 })
          .filter((n) => noteIds.includes(n.id))
          .map((n) => `- ${n.started_at.slice(0, 10)} — [[${safeFileName(`${n.started_at.slice(0, 10)} ${n.title}`)}]]`)
          .join('\n')
        write(join(folder, `_indeks-${stamp}.md`), `# Notlar dizini\n\n${index}\n`)
      } else {
        const parts: string[] = [`# Notlar disa aktarma (${stamp})`, '']
        for (const id of noteIds) {
          const md = noteToMarkdown(db, id, { includeTranscripts: req.includeTranscripts })
          if (md) parts.push(md, '\n---\n')
        }
        write(uniquePath(targetDir, `notlar-${stamp}`, '.md'), parts.join('\n'))
      }
    } else if (req.format === 'json') {
      const payload = {
        exported_at: new Date().toISOString(),
        app: 'Notlar',
        note_count: noteIds.length,
        notes: noteIds.map((id) => noteToJsonObject(db, id)).filter(Boolean)
      }
      write(uniquePath(targetDir, `notlar-${stamp}`, '.json'), JSON.stringify(payload, null, 2))
    } else {
      write(uniquePath(targetDir, `notlar-${stamp}`, '.csv'), notesToCsv(db, noteIds))
    }

    return { ok: true, files, targetDir, noteCount: noteIds.length, bytes }
  } catch (err) {
    return {
      ok: false,
      files: [],
      targetDir: req.targetDir ?? '',
      noteCount: 0,
      bytes: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}