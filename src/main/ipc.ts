import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session } from 'electron'
import { IPC } from '@shared/types'
import type {
  Channel,
  ImportProgress,
  ImportRequest,
  NotifyState,
  RecordingChunkRequest,
  RecordingEvent,
  RecordingStartRequest,
  TriggerDiagnostics
} from '@shared/types'
import { lazyDb } from './db'
import * as repo from './db/repo'
import { listProviders } from './stt'
import { importAudioFile } from './services/importAudio'
import { enhanceNote } from './services/enhance'
import { extractPeopleForNote } from './services/people'
import { buildBrief } from './services/brief'
import { askScoped } from './services/ask'
import * as chat from './services/chat'
import { listRecipes, saveRecipe, deleteRecipe, runRecipe } from './services/recipes'
import { exportNotes } from './services/exportNotes'
import { deleteJargon, listJargon, saveJargon } from './services/jargon'
import {
  backupDatabase,
  disableEncryption,
  enableEncryption,
  pruneBackups,
  securityStatus
} from './services/security'
import { deleteAllData, runRetention } from './services/retention'
import { closeDatabase, reopenDatabase } from './db'
import { listLlmProviders, llmKeyInfo, llmOptionsFor, resolveLlmProvider } from './llm'
import { resetLiveContext, transcribeLiveChunk } from './services/recording'
import type { AutoRecordManager } from './services/autoRecord'
import type { CalendarScheduler } from './calendar'
import type { TriggerDetector } from './detect'
import type { RecordingNotifier } from './notify/window'
import type { OsNotifier } from './notify/os'

type WindowGetter = () => BrowserWindow | null

export interface IpcDeps {
  autoRecord: AutoRecordManager
  scheduler: CalendarScheduler
  detector: TriggerDetector
  notifier: RecordingNotifier
  osNotifier: OsNotifier
  /** Ayar degisince cagrilir (OS bildirim durumu gibi turev durumlar icin) */
  onSettingsChanged?: (settings: import('@shared/types').AppSettings) => void
}

export function makeApiKeyResolver(): () => string {
  // GEC RESOLVE: anahtar, cagri aninda okunur (DB yeniden acilabilir)
  const db = lazyDb()
  return () => (repo.getSettingRaw(db, 'groq_api_key') || process.env.GROQ_API_KEY || '').trim()
}

/**
 * Sistem sesi (loopback) izni + medya izinleri.
 * Windows'ta WASAPI loopback'i Electron'un desktopCapturer'i saglar;
 * audio: 'loopback' bunu acikca ister. Tek kullanicilik yerel uygulama
 * oldugu icin izinler burada acikca verilir (uzak icerik yuklenmez).
 */
export function registerDisplayMediaHandler(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length === 0) {
            callback({ video: undefined, audio: undefined } as never)
            return
          }
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({ video: undefined, audio: undefined } as never))
    },
    { useSystemPicker: false }
  )
}

export function registerIpcHandlers(getWindow: WindowGetter, deps: IpcDeps): void {
  // GEC RESOLVE: sifreleme acma/kapama sonrasi DB yeniden acilir; proxy sayesinde
  // handler'lar yeni baglantiyi gorur (bkz. db/index.ts -> lazyDb).
  const db = lazyDb()
  const resolveApiKey = makeApiKeyResolver()

  const emitImport = (payload: ImportProgress): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.importProgress, payload)
  }

  const emitRecording = (payload: RecordingEvent): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.recordingEvent, payload)
  }

  // --- uygulama / ayarlar --------------------------------------------------
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    dbPath: app.getPath('userData'),
    providers: listProviders(),
    hasApiKey: resolveApiKey().length > 0
  }))

  ipcMain.handle(IPC.settingsGetAll, () => repo.getAllSettings(db))
  ipcMain.handle(IPC.settingsSet, (_e, key: string, value: unknown) => {
    repo.setSetting(db, key, value)
    const next = repo.getAllSettings(db)
    // Turev durumlari senkronla (or. OS bildirimleri ayari)
    try {
      deps.onSettingsChanged?.(next)
    } catch (err) {
      console.error('[settings] onSettingsChanged hatasi:', err)
    }
    return next
  })

  // --- notlar --------------------------------------------------------------
  ipcMain.handle(IPC.notesList, () => repo.listNotes(db))
  ipcMain.handle(IPC.notesGet, (_e, id: string) => repo.getNoteDetail(db, id))

  ipcMain.handle(
    IPC.notesCreate,
    (_e, input: { title?: string; source?: string; status?: string }) => {
      const id = repo.createNote(db, {
        title: input?.title?.trim() || 'Yeni not',
        source: (input?.source as 'manual') || 'manual',
        status: (input?.status as 'recording') || 'ready'
      })
      return repo.getNoteDetail(db, id)
    }
  )

  /**
   * Takvim etkinligine TIKLAYINCA cagrilir: notu acar (yoksa olusturur).
   * DIKKAT: Kayit BASLATMAZ. Kayit yalnizca (a) etkinlik saati gelince otomatik
   * ya da (b) kullanicinin acik "Kaydi baslat" eylemiyle baslar.
   */
  ipcMain.handle(
    IPC.notesCreateForEvent,
    (
      _e,
      ev: { id: string; title: string; start_at: string; participants?: string[]; location?: string | null }
    ) => {
      if (!ev?.id) return null
      const existing = repo.findNoteByCalendarEventId(db, ev.id)
      if (existing) {
        const detail = repo.getNoteDetail(db, existing)
        if (detail) return detail
      }
      const id = repo.createNote(db, {
        title: ev.title || 'Takvim etkinliği',
        source: 'calendar',
        // Etkinligin saatini kullan: "Bugun" gruplamasi ve baslik meta verisi dogru olsun
        startedAt: ev.start_at,
        // Kayit YOK -> dogrudan 'ready'
        status: 'ready'
      })
      repo.linkNoteToCalendarEvent(db, id, ev.id, ev.title || 'Takvim etkinliği')
      if (ev.participants && ev.participants.length > 0) {
        repo.linkNoteParticipants(db, id, ev.participants)
      }
      return repo.getNoteDetail(db, id)
    }
  )

  ipcMain.handle(IPC.notesDelete, (_e, id: string) => {
    repo.deleteNote(db, id)
    return true
  })

  ipcMain.handle(IPC.notesSetRaw, (_e, noteId: string, md: string) => {
    repo.setRawNotes(db, noteId, md)
    return true
  })

  ipcMain.handle(IPC.notesSetTitle, (_e, noteId: string, title: string) => {
    repo.setNoteTitle(db, noteId, title)
    return true
  })

  ipcMain.handle(IPC.searchAll, (_e, q: string) => repo.searchNotes(db, q || ''))
  ipcMain.handle(IPC.templatesList, () => repo.listTemplates(db))

  ipcMain.handle(IPC.dialogPickAudio, async () => {
    const w = getWindow()
    const res = w
      ? await dialog.showOpenDialog(w, {
          title: 'Ses dosyasi sec',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'Ses dosyalari',
              extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4']
            },
            { name: 'Tum dosyalar', extensions: ['*'] }
          ]
        })
      : { canceled: true as const, filePaths: [] as string[] }
    if (res.canceled) return []
    return res.filePaths
  })

  ipcMain.handle(IPC.dialogPickIcs, async () => {
    const w = getWindow()
    const res = w
      ? await dialog.showOpenDialog(w, {
          title: 'Takvim dosyasi (.ics) sec',
          properties: ['openFile'],
          filters: [
            { name: 'iCalendar', extensions: ['ics', 'ical', 'ifb'] },
            { name: 'Tum dosyalar', extensions: ['*'] }
          ]
        })
      : { canceled: true as const, filePaths: [] as string[] }
    if (res.canceled) return null
    return res.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.notesImportAudio, async (_e, req: ImportRequest) =>
    importAudioFile({ db, apiKey: resolveApiKey }, req, emitImport)
  )

  // --- FAZ 2 - canli kayit -------------------------------------------------
  ipcMain.handle(IPC.recordingStart, (_e, req: RecordingStartRequest) => {
    resetLiveContext()
    repo.setNoteStatus(db, req.noteId, 'recording')
    // Otomatik tetikleme akisini bilgilendir (watchdog baslar)
    deps.autoRecord.onRendererStarted(req)
    return { ok: true, channels: req.channels as Channel[] }
  })

  ipcMain.handle(IPC.recordingChunk, async (_e, req: RecordingChunkRequest) => {
    const res = await transcribeLiveChunk(
      {
        db,
        apiKey: resolveApiKey,
        onSegment: (noteId, segments) => {
          emitRecording({ type: 'segments', noteId, segments })
          deps.autoRecord.onSegments(noteId, segments.length)
        }
      },
      req
    )
    return res
  })

  ipcMain.handle(IPC.recordingStop, (_e, noteId: string) => {
    repo.setNoteStatus(db, noteId, 'ready')
    resetLiveContext()
    emitRecording({ type: 'status', noteId, status: 'ready' })
    deps.autoRecord.onRendererStopped(noteId)
    const detail = repo.getNoteDetail(db, noteId)
    deps.osNotifier.show({
      title: 'Kayıt bitti',
      body: `${detail?.note.title ?? 'Not'} • ${detail?.transcripts.length ?? 0} parça yazıya döküldü`,
      noteId
    })
    return { ok: true }
  })

  ipcMain.handle(IPC.recordingCancel, (_e, noteId: string) => {
    const detail = repo.getNoteDetail(db, noteId)
    const empty = !detail || detail.transcripts.length === 0
    if (empty) {
      repo.deleteNote(db, noteId)
    } else {
      repo.setNoteStatus(db, noteId, 'ready')
    }
    resetLiveContext()
    deps.autoRecord.onRendererStopped(noteId)
    return { ok: true, deleted: empty }
  })

  /** Duraklat/devam durumu (bildirim penceresini senkronlar) */
  ipcMain.handle(IPC.recordingState, (_e, payload: { paused: boolean }) => {
    deps.autoRecord.setPaused(Boolean(payload?.paused))
    return true
  })

  // --- FAZ 3 - otomatik tetikleme -----------------------------------------
  ipcMain.handle(IPC.notifyAction, (_e, action: string) => {
    deps.autoRecord.handleAction(action as never)
    return true
  })

  ipcMain.handle(IPC.calendarSync, async () => {
    const res = await deps.scheduler.syncNow()
    // Elle senkron: arayuz takvimi hemen tazelensin
    if (res.ok) {
      const w = getWindow()
      if (w && !w.isDestroyed()) w.webContents.send(IPC.calendarUpdated, res)
    }
    return res
  })

  ipcMain.handle(IPC.calendarEvents, (_e, fromIso?: string) =>
    repo.listUpcomingCalendarEvents(db, fromIso ?? new Date().toISOString(), 100)
  )

  ipcMain.handle(IPC.diagnostics, async (): Promise<TriggerDiagnostics> => {
    const settings = repo.getAllSettings(db)
    const result = await deps.detector.probe()
    const upcoming = repo.listUpcomingCalendarEvents(db, new Date().toISOString(), 1)
    const active: string[] = []
    if (result.allowedMicUser) active.push(`mic: ${result.allowedMicUser}`)
    if (result.allowedApp) active.push(`app: ${result.allowedApp}`)

    return {
      watchdog: deps.autoRecord.debugState(),
      micUsers: deps.detector.snapshot?.micUsers ?? [],
      processes: (deps.detector.snapshot?.processes ?? []).filter((p) => p.title),
      activeAllowedApps: active,
      calendarSource: settings.calendar_source,
      calendarEventCount: repo.countCalendarEvents(db),
      nextCalendarEvent: upcoming[0]
        ? { id: upcoming[0].id, title: upcoming[0].title, start_at: upcoming[0].start_at }
        : null
    }
  })

  // --- FAZ 5 - dizin, etiketler, brief, kapsamli soru ----------------------

  ipcMain.handle(IPC.directorySummary, () => ({
    people: repo.listPeople(db),
    companies: repo.listCompanies(db),
    tags: repo.listTags(db)
  }))

  ipcMain.handle(IPC.peopleList, (_e, q?: string) => repo.listPeople(db, { query: q }))

  ipcMain.handle(IPC.peopleGet, (_e, id: string) => {
    const person = repo.getPerson(db, id)
    if (!person) return null
    return {
      person,
      notes: repo.listPersonNotes(db, id),
      tags: repo.listPersonTags(db, id)
    }
  })

  ipcMain.handle(
    IPC.peopleUpdate,
    (
      _e,
      id: string,
      patch: { name?: string; email?: string | null; title?: string | null; company_id?: string | null }
    ) => {
      repo.updatePerson(db, id, patch)
      return repo.getPerson(db, id)
    }
  )

  ipcMain.handle(IPC.peopleDedupe, () => {
    const merged = repo.dedupePeople(db)
    return { ok: true, merged, people: repo.listPeople(db) }
  })

  ipcMain.handle(IPC.peopleMerge, (_e, fromId: string, toId: string) => {
    const moved = repo.mergePeople(db, fromId, toId)
    return { ok: true, moved, person: repo.getPerson(db, toId) }
  })

  ipcMain.handle(IPC.peopleExtract, async (_e, noteId: string) =>
    extractPeopleForNote(
      {
        db,
        onProgress: (p) => {
          const w = getWindow()
          if (w && !w.isDestroyed()) w.webContents.send(IPC.enhanceProgress, p)
        },
        log: (m) => console.log(m)
      },
      noteId
    )
  )

  ipcMain.handle(IPC.companiesList, () => repo.listCompanies(db))

  ipcMain.handle(IPC.companiesGet, (_e, id: string) => {
    const company = repo.getCompany(db, id)
    if (!company) return null
    return {
      company,
      people: repo.listCompanyPeople(db, id),
      notes: repo.listCompanyNotes(db, id)
    }
  })

  ipcMain.handle(IPC.tagsList, () => repo.listTags(db))
  ipcMain.handle(IPC.tagsAdd, (_e, noteId: string, name: string) => repo.addTagToNote(db, noteId, name))
  ipcMain.handle(IPC.tagsRemove, (_e, noteId: string, tagId: string) => {
    repo.removeTagFromNote(db, noteId, tagId)
    return true
  })

  ipcMain.handle(IPC.transcriptDelete, (_e, id: string) => repo.deleteTranscript(db, id))
  ipcMain.handle(IPC.transcriptUpdateSpeaker, (_e, id: string, label: string) =>
    repo.updateTranscriptSpeaker(db, id, label)
  )

  ipcMain.handle(IPC.briefGet, async (_e, target: {
    personId?: string | null
    companyId?: string | null
    noteId?: string | null
    eventId?: string | null
  }) =>
    buildBrief(
      { db, onProgress: (m) => console.log('[brief] ' + m), log: (m) => console.log(m) },
      target ?? {}
    )
  )

  ipcMain.handle(IPC.askScoped, async (_e, req: { scope: string; scopeId?: string | null; question: string }) =>
    askScoped(
      {
        db,
        onProgress: (m) => {
          const w = getWindow()
          if (w && !w.isDestroyed()) w.webContents.send(IPC.enhanceProgress, { stage: 'calling', message: m })
        },
        log: (m) => console.log(m)
      },
      req as never
    )
  )

  // --- FAZ 4 - LLM zenginlestirme -----------------------------------------
  ipcMain.handle(IPC.llmProviders, () => listLlmProviders(db))

  /**
   * API anahtarini kaydeder (Ayarlar ekranindan girilir).
   * Anahtar `settings` tablosunda `<providerId>_api_key` olarak tutulur ve
   * `llmKeyInfo` ONU .env'den ONCE okur — yani arayuzden girilen deger kazanir.
   */
  ipcMain.handle(IPC.llmSetKey, (_e, providerId: string, key: string) => {
    const provider = resolveLlmProvider(providerId)
    repo.setSetting(db, `${provider.id}_api_key`, (key ?? '').trim())
    return listLlmProviders(db)
  })

  /**
   * Anahtari GERCEKTEN dogrular: saglayicinin /models ucunu cagirir (ucuz ve hizli).
   * Boylece kullanici "kaydettim ama calisiyor mu?" sorusunu arayuzde cevaplayabilir.
   */
  ipcMain.handle(IPC.llmTestKey, async (_e, providerId?: string) => {
    const provider = resolveLlmProvider(providerId)
    if (!provider.requiresApiKey) return { ok: true, model: provider.defaultModel, note: 'Anahtar gerekmez' }
    const info = llmKeyInfo(db, provider)
    if (!info.key) {
      return { ok: false, error: 'Anahtar tanimli degil. Once kaydedin.' }
    }
    const opts = llmOptionsFor(db, provider)
    try {
      if (provider.listModels) {
        const models = await provider.listModels(opts)
        if (models.length === 0) {
          return { ok: false, error: 'Saglayici model listesi vermedi (anahtar gecersiz olabilir).' }
        }
        return { ok: true, modelCount: models.length, model: opts.model || provider.defaultModel, source: info.source }
      }
      const res = await provider.complete(
        { system: 'Yanit olarak yalnizca OK yaz.', user: 'OK', maxTokens: 5 },
        opts
      )
      return { ok: true, model: res.model, source: info.source }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.llmModels, async (_e, providerId?: string) => {
    const provider = resolveLlmProvider(providerId)
    try {
      const models = provider.listModels ? await provider.listModels(llmOptionsFor(db, provider)) : []
      return { provider: provider.id, models, suggested: provider.suggestedModels, defaultModel: provider.defaultModel }
    } catch (err) {
      return {
        provider: provider.id,
        models: [],
        suggested: provider.suggestedModels,
        defaultModel: provider.defaultModel,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(IPC.notesEnhancedVersions, (_e, noteId: string) =>
    repo.listEnhancedVersions(db, noteId)
  )

  ipcMain.handle(IPC.notesEnhance, async (_e, noteId: string, templateId?: string | null) => {
    const res = await enhanceNote(
      {
        db,
        onProgress: (p) => {
          const w = getWindow()
          if (w && !w.isDestroyed()) w.webContents.send(IPC.enhanceProgress, p)
        },
        log: (m) => console.log(m)
      },
      noteId,
      templateId
    )
    // FAZ 7: "Notun hazir" OS bildirimi (tiklayinca not acilir)
    if (res.ok) {
      const detail = repo.getNoteDetail(db, noteId)
      deps.osNotifier.show({
        title: 'Notun hazır',
        body: `${detail?.note.title ?? 'Not'} • ${res.citations ?? 0} kaynak`,
        noteId
      })
    }
    return res
  })

  // --- FAZ 6 - sohbet + recipes -------------------------------------------
  ipcMain.handle(IPC.chatThreads, () => chat.listThreads(db))

  ipcMain.handle(
    IPC.chatEnsureThread,
    (_e, input: { scopeKind: 'note' | 'person' | 'company' | 'all'; scopeId?: string | null; title?: string }) =>
      chat.ensureThread(db, input.scopeKind, input.scopeId ?? null, input.title)
  )

  ipcMain.handle(IPC.chatMessages, (_e, threadId: string) => chat.getMessages(db, threadId))

  ipcMain.handle(IPC.chatSend, async (_e, threadId: string, question: string) =>
    chat.sendMessage(
      { db, onProgress: (m) => console.log('[chat] ' + m), log: (m) => console.log(m) },
      threadId,
      { question }
    )
  )

  ipcMain.handle(IPC.chatDeleteThread, (_e, threadId: string) => {
    chat.deleteThread(db, threadId)
    return true
  })

  ipcMain.handle(IPC.recipesList, () => listRecipes(db))
  ipcMain.handle(
    IPC.recipesSave,
    (
      _e,
      input: {
        id?: string
        name: string
        shortcut: string
        description?: string | null
        promptBody: string
        scope?: 'note' | 'person' | 'company' | 'all' | 'selection'
      }
    ) => saveRecipe(db, input)
  )
  ipcMain.handle(IPC.recipesDelete, (_e, id: string) => deleteRecipe(db, id))
  ipcMain.handle(
    IPC.recipesRun,
    async (
      _e,
      recipeId: string,
      scope: { kind: 'note' | 'person' | 'company' | 'all'; id?: string | null }
    ) =>
      runRecipe(
        { db, onProgress: (m) => console.log('[recipe] ' + m), log: (m) => console.log(m) },
        recipeId,
        scope
      )
  )

  // --- FAZ 7 - disa aktarma, jargon, guvenlik, saklama -------------------
  ipcMain.handle(IPC.exportNotes, (_e, req: import('@shared/types').ExportRequest) => exportNotes(db, req))

  ipcMain.handle(IPC.dialogPickDir, async () => {
    const w = getWindow()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Hedef klasor sec',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.jargonList, () => listJargon(db))
  ipcMain.handle(
    IPC.jargonSave,
    (_e, input: { id?: string; term: string; replacement: string; note?: string | null; enabled?: boolean }) =>
      saveJargon(db, input)
  )
  ipcMain.handle(IPC.jargonDelete, (_e, id: string) => deleteJargon(db, id))

  ipcMain.handle(IPC.securityStatus, () => securityStatus())

  ipcMain.handle(IPC.securityEnable, async () => {
    const res = await enableEncryption({
      close: () => closeDatabase(),
      reopen: () => reopenDatabase()
    })
    return res
  })

  ipcMain.handle(IPC.securityDisable, async () => {
    const res = await disableEncryption({
      close: () => closeDatabase(),
      reopen: () => reopenDatabase()
    })
    return res
  })

  ipcMain.handle(IPC.securityBackup, () => {
    const path = backupDatabase('manual')
    pruneBackups(5)
    return { ok: Boolean(path), path }
  })

  ipcMain.handle(IPC.retentionRun, (_e, dryRun?: boolean) =>
    runRetention({ db, log: (m) => console.log(m) }, { dryRun: Boolean(dryRun) })
  )

  ipcMain.handle(IPC.deleteAllData, () => {
    const res = deleteAllData(db)
    return { ok: true, deletedNotes: res.deletedNotes, backupPath: res.backupPath }
  })

  // Bildirim penceresi acilirken mevcut durumu hemen alabilsin
  ipcMain.handle(IPC.notifyState, () => null as NotifyState | null)
}