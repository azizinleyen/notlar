import { basename, extname } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { ImportProgress, ImportRequest, ImportResult } from '@shared/types'
import * as repo from '../db/repo'
import { resolveProvider } from '../stt'
import { correctText, sttHintFor } from './jargon'

export interface ImportDeps {
  db: Database
  /** API anahtarini cozen fonksiyon (Ayarlar -> .env sirasi) */
  apiKey: () => string
  onProgress?: (p: ImportProgress) => void
}

/**
 * FAZ 1 cekirdek akisi: ses dosyasi -> STT -> transkript satirlari (kanal etiketli).
 * Hem IPC hem CLI tarafindan ayni sekilde kullanilir (katmanli ayrim).
 */
export async function importAudioFile(
  deps: ImportDeps,
  req: ImportRequest,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const { db, apiKey } = deps
  const emit = (p: ImportProgress): void => {
    onProgress?.(p)
    deps.onProgress?.(p)
  }

  const { filePath, channel, language } = req
  const settings = repo.getAllSettings(db)

  emit({ stage: 'queued', filePath, message: 'Isleniyor...' })

  const title = req.title?.trim() || basename(filePath, extname(filePath))
  const noteId = repo.createNote(db, { title, source: 'import', status: 'processing' })

  try {
    const provider = resolveProvider(settings.stt_provider)
    emit({ stage: 'uploading', filePath, noteId, message: `${provider.label} hazirlaniyor...` })

    const result = await provider.transcribe(filePath, {
      apiKey: apiKey(),
      model: settings.stt_model || provider.defaultModel,
      language: language || settings.language,
      prompt: sttHintFor(db) || undefined,
      onProgress: (msg) => emit({ stage: 'transcribing', filePath, noteId, message: msg })
    })

    emit({
      stage: 'saving',
      filePath,
      noteId,
      message: `${result.segments.length} parca kaydediliyor...`
    })

    repo.insertTranscripts(
      db,
      noteId,
      result.segments.map((s) => ({
        channel,
        speaker_label: channel === 'mic' ? 'Ben' : 'Karsi taraf',
        text: correctText(db, s.text),
        start_ms: s.start_ms,
        end_ms: s.end_ms
      }))
    )

    repo.setRawNotes(
      db,
      noteId,
      `> Ice aktarilan dosya: ${basename(filePath)}\n> Sure: ${((result.duration_ms ?? 0) / 1000).toFixed(
        1
      )} sn  •  Dil: ${result.language ?? '?'}\n`
    )
    repo.setNoteStatus(db, noteId, 'ready')
    emit({ stage: 'done', filePath, noteId, message: 'Transkript hazir' })

    return { noteId, segments: result.segments.length, language: result.language, text: result.text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    repo.setNoteStatus(db, noteId, 'failed', message)
    emit({ stage: 'error', filePath, noteId, message: 'Transkripsiyon basarisiz', detail: message })
    return { noteId, segments: 0, text: '', error: message }
  }
}