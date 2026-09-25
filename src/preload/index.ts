import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type {
  AppSettings,
  AutoStartCommand,
  CalendarEventRowDto,
  CalendarSyncResult,
  ImportProgress,
  ImportRequest,
  ImportResult,
  NoteDetail,
  NoteSummary,
  AskRequest,
  AskResult,
  BriefResult,
  ChatMessageDto,
  ChatScopeKind,
  ChatThreadDto,
  DeleteAllResult,
  CompanyDetail,
  CompanySummary,
  DirectorySummary,
  EnhanceProgressEvent,
  EnhanceResultDto,
  ExportRequest,
  ExportResult,
  ExtractPeopleResult,
  JargonEntry,
  PersonDetail,
  RecipeDto,
  RecipeRunResult,
  RekeyResultDto,
  RetentionResult,
  SecurityStatusDto,
  PersonSummary,
  TagSummary,
  LlmProviderInfo,
  RecorderCommand,
  RecordingChunkRequest,
  RecordingChunkResult,
  RecordingEvent,
  RecordingStartRequest,
  Template,
  TriggerDiagnostics
} from '@shared/types'

const api = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGetAll),
  setSetting: (key: string, value: unknown): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, key, value),

  listNotes: (): Promise<NoteSummary[]> => ipcRenderer.invoke(IPC.notesList),
  getNote: (id: string): Promise<NoteDetail | null> => ipcRenderer.invoke(IPC.notesGet, id),
  createNote: (input: { title?: string; source?: string; status?: string }): Promise<NoteDetail> =>
    ipcRenderer.invoke(IPC.notesCreate, input),
  deleteNote: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.notesDelete, id),
  /** Takvim etkinligine tiklaninca: notu acar/olusturur (kayit BASLATMAZ) */
  createNoteForEvent: (ev: {
    id: string
    title: string
    start_at: string
    participants?: string[]
    location?: string | null
  }): Promise<NoteDetail | null> => ipcRenderer.invoke(IPC.notesCreateForEvent, ev),

  setRawNotes: (noteId: string, md: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.notesSetRaw, noteId, md),
  setNoteTitle: (noteId: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.notesSetTitle, noteId, title),
  search: (q: string): Promise<NoteSummary[]> => ipcRenderer.invoke(IPC.searchAll, q),

  listTemplates: (): Promise<Template[]> => ipcRenderer.invoke(IPC.templatesList),

  /** Arayuz hazir sinyali: main, bekleyen isleri ve zamanlayicilari bundan sonra baslatir. */
  rendererReady: (): Promise<boolean> => ipcRenderer.invoke(IPC.rendererReady),

  pickAudio: (): Promise<string[]> => ipcRenderer.invoke(IPC.dialogPickAudio),
  pickIcs: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickIcs),
  importAudio: (req: ImportRequest): Promise<ImportResult> =>
    ipcRenderer.invoke(IPC.notesImportAudio, req),

  // --- FAZ 2: canli kayit ------------------------------------------------
  recordingStart: (req: RecordingStartRequest): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.recordingStart, req),
  recordingChunk: (req: RecordingChunkRequest): Promise<RecordingChunkResult> =>
    ipcRenderer.invoke(IPC.recordingChunk, req),
  recordingStop: (noteId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.recordingStop, noteId),
  recordingCancel: (noteId: string): Promise<{ ok: boolean; deleted: boolean }> =>
    ipcRenderer.invoke(IPC.recordingCancel, noteId),
  notifyPauseState: (paused: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.recordingState, { paused }),

  // --- FAZ 3: otomatik tetikleme ----------------------------------------
  diagnostics: (): Promise<TriggerDiagnostics> => ipcRenderer.invoke(IPC.diagnostics),
  calendarSync: (): Promise<CalendarSyncResult> => ipcRenderer.invoke(IPC.calendarSync),
  calendarEvents: (fromIso?: string): Promise<CalendarEventRowDto[]> =>
    ipcRenderer.invoke(IPC.calendarEvents, fromIso),

  // --- FAZ 4: LLM zenginlestirme -----------------------------------------
  llmProviders: (): Promise<LlmProviderInfo[]> => ipcRenderer.invoke(IPC.llmProviders),

  /** API anahtarini kaydet (Ayarlar ekrani) */
  llmSetKey: (providerId: string, key: string): Promise<LlmProviderInfo[]> =>
    ipcRenderer.invoke(IPC.llmSetKey, providerId, key),

  /** Anahtari saglayiciya sorarak dogrula */
  llmTestKey: (
    providerId?: string
  ): Promise<{ ok: boolean; model?: string; modelCount?: number; source?: 'settings' | 'env' | null; note?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.llmTestKey, providerId),

  llmModels: (
    providerId?: string
  ): Promise<{
    provider: string
    models: string[]
    suggested: string[]
    defaultModel: string
    error?: string
  }> => ipcRenderer.invoke(IPC.llmModels, providerId),

  enhancedVersions: (
    noteId: string
  ): Promise<Array<{ id: string; version: number; model: string | null; created_at: string }>> =>
    ipcRenderer.invoke(IPC.notesEnhancedVersions, noteId),

  enhanceNote: (noteId: string, templateId?: string | null): Promise<EnhanceResultDto> =>
    ipcRenderer.invoke(IPC.notesEnhance, noteId, templateId),

  onEnhanceProgress: (cb: (p: EnhanceProgressEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: EnhanceProgressEvent): void => cb(payload)
    ipcRenderer.on(IPC.enhanceProgress, listener)
    return () => ipcRenderer.removeListener(IPC.enhanceProgress, listener)
  },

  // --- FAZ 5: dizin, etiketler, brief, kapsamli soru ----------------------
  directorySummary: (): Promise<DirectorySummary> => ipcRenderer.invoke(IPC.directorySummary),

  peopleList: (q?: string): Promise<PersonSummary[]> => ipcRenderer.invoke(IPC.peopleList, q),
  personGet: (id: string): Promise<PersonDetail | null> => ipcRenderer.invoke(IPC.peopleGet, id),
  personUpdate: (
    id: string,
    patch: { name?: string; email?: string | null; title?: string | null; company_id?: string | null }
  ): Promise<PersonSummary | null> => ipcRenderer.invoke(IPC.peopleUpdate, id, patch),
  personMerge: (
    fromId: string,
    toId: string
  ): Promise<{ ok: boolean; moved: number; person: PersonSummary | null }> =>
    ipcRenderer.invoke(IPC.peopleMerge, fromId, toId),
  peopleExtract: (noteId: string): Promise<ExtractPeopleResult> =>
    ipcRenderer.invoke(IPC.peopleExtract, noteId),
  peopleDedupe: (): Promise<{ ok: boolean; merged: number; people: PersonSummary[] }> =>
    ipcRenderer.invoke(IPC.peopleDedupe),

  companiesList: (): Promise<CompanySummary[]> => ipcRenderer.invoke(IPC.companiesList),
  companyGet: (id: string): Promise<CompanyDetail | null> => ipcRenderer.invoke(IPC.companiesGet, id),

  tagsList: (): Promise<TagSummary[]> => ipcRenderer.invoke(IPC.tagsList),
  tagAdd: (noteId: string, name: string): Promise<TagSummary | null> =>
    ipcRenderer.invoke(IPC.tagsAdd, noteId, name),
  tagRemove: (noteId: string, tagId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.tagsRemove, noteId, tagId),

  transcriptDelete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.transcriptDelete, id),
  transcriptUpdateSpeaker: (id: string, label: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.transcriptUpdateSpeaker, id, label),

  briefGet: (target: {
    personId?: string | null
    companyId?: string | null
    noteId?: string | null
    eventId?: string | null
  }): Promise<BriefResult> => ipcRenderer.invoke(IPC.briefGet, target),

  ask: (req: AskRequest): Promise<AskResult> => ipcRenderer.invoke(IPC.askScoped, req),

  // --- FAZ 6: sohbet + recipes -------------------------------------------
  chatThreads: (): Promise<ChatThreadDto[]> => ipcRenderer.invoke(IPC.chatThreads),
  chatEnsureThread: (input: {
    scopeKind: ChatScopeKind
    scopeId?: string | null
    title?: string
  }): Promise<string> => ipcRenderer.invoke(IPC.chatEnsureThread, input),
  chatMessages: (threadId: string): Promise<ChatMessageDto[]> =>
    ipcRenderer.invoke(IPC.chatMessages, threadId),
  chatSend: (
    threadId: string,
    question: string
  ): Promise<{ user: ChatMessageDto; assistant: ChatMessageDto }> =>
    ipcRenderer.invoke(IPC.chatSend, threadId, question),
  chatDeleteThread: (threadId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.chatDeleteThread, threadId),

  recipesList: (): Promise<RecipeDto[]> => ipcRenderer.invoke(IPC.recipesList),
  recipesSave: (input: {
    id?: string
    name: string
    shortcut: string
    description?: string | null
    promptBody: string
    scope?: RecipeDto['scope']
  }): Promise<RecipeDto | null> => ipcRenderer.invoke(IPC.recipesSave, input),
  recipesDelete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.recipesDelete, id),
  recipesRun: (
    recipeId: string,
    scope: { kind: 'note' | 'person' | 'company' | 'all'; id?: string | null }
  ): Promise<RecipeRunResult> => ipcRenderer.invoke(IPC.recipesRun, recipeId, scope),

  // --- FAZ 7: disa aktarma, jargon, guvenlik, saklama -------------------
  exportNotes: (req: ExportRequest): Promise<ExportResult> => ipcRenderer.invoke(IPC.exportNotes, req),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickDir),

  jargonList: (): Promise<JargonEntry[]> => ipcRenderer.invoke(IPC.jargonList),
  jargonSave: (input: {
    id?: string
    term: string
    replacement: string
    note?: string | null
    enabled?: boolean
  }): Promise<JargonEntry | null> => ipcRenderer.invoke(IPC.jargonSave, input),
  jargonDelete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.jargonDelete, id),

  securityStatus: (): Promise<SecurityStatusDto> => ipcRenderer.invoke(IPC.securityStatus),
  securityEnable: (): Promise<RekeyResultDto> => ipcRenderer.invoke(IPC.securityEnable),
  securityDisable: (): Promise<RekeyResultDto> => ipcRenderer.invoke(IPC.securityDisable),
  securityBackup: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke(IPC.securityBackup),
  retentionRun: (dryRun?: boolean): Promise<RetentionResult> =>
    ipcRenderer.invoke(IPC.retentionRun, dryRun),
  deleteAllData: (): Promise<DeleteAllResult> => ipcRenderer.invoke(IPC.deleteAllData),

  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: unknown, payload: ImportProgress): void => cb(payload)
    ipcRenderer.on(IPC.importProgress, listener)
    return () => ipcRenderer.removeListener(IPC.importProgress, listener)
  },

  onRecordingEvent: (cb: (e: RecordingEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: RecordingEvent): void => cb(payload)
    ipcRenderer.on(IPC.recordingEvent, listener)
    return () => ipcRenderer.removeListener(IPC.recordingEvent, listener)
  },

  /** main -> renderer: "kaydi otomatik baslat" */
  onAutoStart: (cb: (c: AutoStartCommand) => void): (() => void) => {
    const listener = (_e: unknown, payload: AutoStartCommand): void => cb(payload)
    ipcRenderer.on(IPC.triggerAutoStart, listener)
    return () => ipcRenderer.removeListener(IPC.triggerAutoStart, listener)
  },

  /** main -> renderer: duraklat/devam/durdur/iptal (bildirim penceresinden) */
  onRecorderCommand: (cb: (c: RecorderCommand) => void): (() => void) => {
    const listener = (_e: unknown, payload: RecorderCommand): void => cb(payload)
    ipcRenderer.on(IPC.recorderCommand, listener)
    return () => ipcRenderer.removeListener(IPC.recorderCommand, listener)
  },

  /** main -> renderer: su notu ac (bildirimden "notu ac") */
  onNoteFocus: (cb: (noteId: string) => void): (() => void) => {
    const listener = (_e: unknown, noteId: string): void => cb(noteId)
    ipcRenderer.on(IPC.noteFocus, listener)
    return () => ipcRenderer.removeListener(IPC.noteFocus, listener)
  },

  /** main -> renderer: takvim senkronu bitti (liste tazelensin) */
  onCalendarUpdated: (cb: (r: CalendarSyncResult) => void): (() => void) => {
    const listener = (_e: unknown, payload: CalendarSyncResult): void => cb(payload)
    ipcRenderer.on(IPC.calendarUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.calendarUpdated, listener)
  },

  /** main -> renderer: bilgi bildirimi goster */
  onAppToast: (
    cb: (t: { kind: 'info' | 'success' | 'error'; message: string; noteId?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, payload: { kind: 'info' | 'success' | 'error'; message: string }): void =>
      cb(payload)
    ipcRenderer.on(IPC.appToast, listener)
    return () => ipcRenderer.removeListener(IPC.appToast, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api