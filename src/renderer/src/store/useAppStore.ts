import { create } from 'zustand'
import { RECORDING_DEFAULTS } from '@shared/types'
import type {
  AppSettings,
  AutoStartCommand,
  AskResult,
  BriefResult,
  ChatMessageDto,
  ChatScopeKind,
  ChatThreadDto,
  CalendarEventRowDto,
  Channel,
  CompanyDetail,
  DirectorySummary,
  JargonEntry,
  PersonDetail,
  RecipeDto,
  RecipeRunResult,
  SecurityStatusDto,
  EnhanceProgressEvent,
  EnhanceResultDto,
  ImportProgress,
  ImportRequest,
  NoteDetail,
  NoteStatus,
  NoteSummary,
  RecorderCommand,
  Template,
  TranscriptSegment
} from '@shared/types'
import { getRecorder } from '../lib/recorder'
import { openMicStream, openSystemStream } from '../lib/media'

export type AppView =
  | { kind: 'note' }
  | { kind: 'people' }
  | { kind: 'companies' }
  | { kind: 'person'; id: string }
  | { kind: 'company'; id: string }

export interface Toast {
  kind: 'info' | 'success' | 'error'
  message: string
  detail?: string
}

export interface RecordingState {
  active: boolean
  paused: boolean
  /** true: main surec tarafindan surduruluyor (or. --simulate-live) → kontrol cubugu pasif */
  external: boolean
  /** Otomatik tetikleme ile mi basladi */
  auto: boolean
  noteId: string | null
  channels: Channel[]
  chunkErrors: number
}

export interface StartRecordingOptions {
  title: string
  language: string
  micDeviceId?: string
  micEnabled: boolean
  systemEnabled: boolean
  /** Otomatik tetikleme: main zaten not olusturdu */
  existingNoteId?: string
  auto?: boolean
  reason?: string
  triggerApp?: string
}

interface AppState {
  ready: boolean
  hasApiKey: boolean
  /** STT saglayicilari (Ayarlar ekranindaki secim icin) */
  sttProviders: Array<{ id: string; label: string; requiresApiKey: boolean; defaultModel: string }>
  notes: NoteSummary[]
  templates: Template[]
  settings: AppSettings | null
  selectedId: string | null
  detail: NoteDetail | null
  calendarEvents: CalendarEventRowDto[]

  view: AppView
  directory: DirectorySummary
  peopleQuery: string
  detailPerson: PersonDetail | null
  detailCompany: CompanyDetail | null
  brief: BriefResult | null
  briefBusy: boolean
  // FAZ 6
  chatThreads: ChatThreadDto[]
  chatThreadId: string | null
  chatMessages: ChatMessageDto[]
  chatBusy: boolean
  chatScope: { kind: ChatScopeKind; id?: string | null }
  recipes: RecipeDto[]
  recipesOpen: boolean
  // FAZ 7
  security: SecurityStatusDto | null
  jargon: JargonEntry[]
  askBusy: boolean
  askResult: AskResult | null
  extractingPeople: boolean

  searchQuery: string
  transcriptOpen: boolean
  chatOpen: boolean
  importOpen: boolean
  recordOpen: boolean
  settingsOpen: boolean
  chatTab: 'brief' | 'ask'
  /** Transkript panelinde yeni satirlara otomatik kaydir */
  liveScroll: boolean

  progress: ImportProgress | null
  importInFlight: boolean
  toast: Toast | null
  recording: RecordingState

  bootstrap: () => Promise<void>
  /** Anahtar durumunu ve STT saglayici listesini tazeler (anahtar kaydedilince cagrilir) */
  refreshApiKeyStatus: () => Promise<void>
  loadNotes: (q?: string) => Promise<void>
  loadCalendarEvents: () => Promise<void>
  selectNote: (id: string | null) => Promise<void>
  refreshSelected: () => Promise<void>
  createNote: () => Promise<void>
  deleteNote: (id: string) => Promise<void>
  saveRawNotes: (md: string) => Promise<void>
  saveTitle: (title: string) => Promise<void>
  setSearchQuery: (q: string) => void
  toggleTranscript: (v?: boolean) => void
  toggleChat: (v?: boolean) => void
  openImport: (v: boolean) => void
  openRecord: (v: boolean) => void
  openSettings: (v: boolean) => void
  setChatTab: (t: 'brief' | 'ask') => void
  setLiveScroll: (v: boolean) => void
  // FAZ 5
  setView: (v: AppView) => void
  loadDirectory: () => Promise<void>
  setPeopleQuery: (q: string) => void
  openPerson: (id: string) => Promise<void>
  openCompany: (id: string) => Promise<void>
  updatePerson: (id: string, patch: { name?: string; email?: string | null; title?: string | null; company_id?: string | null }) => Promise<void>
  mergePerson: (fromId: string, toId: string) => Promise<void>
  extractPeople: (noteId: string) => Promise<void>
  loadBrief: (target?: { personId?: string | null; companyId?: string | null; noteId?: string | null; eventId?: string | null }) => Promise<void>
  askQuestion: (question: string, scope?: { kind: 'person' | 'company' | 'note' | 'all'; id?: string | null }) => Promise<void>
  addTag: (noteId: string, name: string) => Promise<void>
  removeTag: (noteId: string, tagId: string) => Promise<void>
  deleteSegment: (id: string) => Promise<void>
  relabelSegment: (id: string, label: string) => Promise<void>

  // FAZ 6
  loadChatThreads: () => Promise<void>
  openChatForScope: (kind: ChatScopeKind, id?: string | null) => Promise<void>
  sendChat: (question: string) => Promise<void>
  deleteChatThread: (id: string) => Promise<void>
  loadRecipes: () => Promise<void>
  runRecipe: (recipeId: string) => Promise<RecipeRunResult | null>
  setRecipesOpen: (v: boolean) => void

  // FAZ 7
  loadSecurity: () => Promise<void>
  loadJargon: () => Promise<void>
  startImport: (req: ImportRequest) => Promise<void>
  toastShow: (t: Toast) => void
  toastClear: () => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // --- FAZ 2: canli kayit ---
  startRecording: (opts: StartRecordingOptions) => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => Promise<void>
  cancelRecording: () => Promise<void>

  // --- FAZ 4: LLM zenginlestirme ---
  enhancing: { noteId: string; stage: string; message: string } | null
  enhanceNote: (noteId: string, templateId?: string | null, silent?: boolean) => Promise<EnhanceResultDto | null>
  regenerate: () => Promise<void>

  // --- FAZ 3: otomatik tetikleme ---
  handleRecorderCommand: (cmd: RecorderCommand) => Promise<void>
  openCalendarEvent: (ev: CalendarEventRowDto) => Promise<void>
  startFromCalendarEvent: (ev: CalendarEventRowDto) => Promise<void>
}

const emptyRecording: RecordingState = {
  active: false,
  paused: false,
  external: false,
  auto: false,
  noteId: null,
  channels: [],
  chunkErrors: 0
}

function sortSegments(list: TranscriptSegment[]): TranscriptSegment[] {
  return [...list].sort((a, b) => a.start_ms - b.start_ms || a.id.localeCompare(b.id))
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  hasApiKey: false,
  sttProviders: [],
  notes: [],
  templates: [],
  settings: null,
  selectedId: null,
  detail: null,
  calendarEvents: [],
  searchQuery: '',
  transcriptOpen: false,
  chatOpen: true,
  importOpen: false,
  recordOpen: false,
  settingsOpen: false,
  chatTab: 'brief',
  liveScroll: true,
  view: { kind: 'note' },
  directory: { people: [], companies: [], tags: [] },
  peopleQuery: '',
  detailPerson: null,
  detailCompany: null,
  brief: null,
  briefBusy: false,
  chatThreads: [],
  chatThreadId: null,
  chatMessages: [],
  chatBusy: false,
  chatScope: { kind: 'note', id: null },
  recipes: [],
  recipesOpen: false,
  security: null,
  jargon: [],
  askBusy: false,
  askResult: null,
  extractingPeople: false,
  progress: null,
  importInFlight: false,
  toast: null,
  recording: { ...emptyRecording },
  enhancing: null,

  bootstrap: async () => {
    const [info, settings, templates] = await Promise.all([
      window.api.appInfo(),
      window.api.getSettings(),
      window.api.listTemplates()
    ])
    set({
      hasApiKey: Boolean(info?.hasApiKey),
      sttProviders: info?.providers ?? [],
      settings,
      templates
    })

    window.api.onImportProgress((p) => {
      set({ progress: p })
      if ((p.stage === 'done' || p.stage === 'error') && !get().importInFlight && p.noteId) {
        void get().loadNotes().then(() => get().selectNote(p.noteId!))
      }
    })

    await get().loadNotes()
    const notes = get().notes
    if (notes.length > 0) await get().selectNote(notes[0].id)
    set({ ready: true })
    // Arayuz hazir: main zamanlayicilari (algilayici + takvim) bundan sonra baslar
    await window.api.rendererReady()
    void get().loadCalendarEvents()
    void get().loadDirectory()
    void get().loadRecipes()
    void get().loadSecurity()
    void get().loadJargon()
  },

  refreshApiKeyStatus: async () => {
    // llm:setKey sonrasi cagrilir: "API anahtari yok" uyarisi aninda kalksin
    try {
      const info = await window.api.appInfo()
      set({ hasApiKey: Boolean(info?.hasApiKey), sttProviders: info?.providers ?? [] })
    } catch {
      /* yoksay */
    }
  },

  loadNotes: async (q) => {
    const query = q ?? get().searchQuery
    const notes = query.trim() ? await window.api.search(query) : await window.api.listNotes()
    set({ notes })
  },

  loadCalendarEvents: async () => {
    try {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const events = await window.api.calendarEvents(from.toISOString())
      set({ calendarEvents: events })
    } catch {
      set({ calendarEvents: [] })
    }
  },

  selectNote: async (id) => {
    if (!id) {
      set({ selectedId: null, detail: null })
      return
    }
    const detail = await window.api.getNote(id)
    set({ selectedId: id, detail, view: { kind: 'note' } })
    if (detail && detail.note.transcript_count > 0) set({ transcriptOpen: true })
    // Brief'i takvim baglamiyla tazele
    void get().loadBrief({ noteId: id, eventId: detail?.note.calendar_event_id ?? null })
    // Sohbet kapsami bu not olsun (thread yoksa olusturulur)
    void get().openChatForScope('note', id)
  },

  refreshSelected: async () => {
    const id = get().selectedId
    if (!id) return
    const detail = await window.api.getNote(id)
    if (detail) set({ detail })
  },

  createNote: async () => {
    const detail: NoteDetail = await window.api.createNote({ title: 'Yeni not', source: 'manual' })
    await get().loadNotes()
    set({ selectedId: detail.note.id, detail, transcriptOpen: false })
  },

  deleteNote: async (id) => {
    await window.api.deleteNote(id)
    await get().loadNotes()
    if (get().selectedId === id) {
      const next = get().notes[0]?.id ?? null
      await get().selectNote(next)
    }
  },

  saveRawNotes: async (md) => {
    const id = get().selectedId
    if (!id) return
    await window.api.setRawNotes(id, md)
    const detail = get().detail
    if (detail) set({ detail: { ...detail, raw_notes_md: md } })
  },

  saveTitle: async (title) => {
    const id = get().selectedId
    if (!id) return
    await window.api.setNoteTitle(id, title)
    const detail = get().detail
    if (detail) set({ detail: { ...detail, note: { ...detail.note, title } } })
    await get().loadNotes()
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q })
    void get().loadNotes(q)
  },

  toggleTranscript: (v) => set((s) => ({ transcriptOpen: v ?? !s.transcriptOpen })),
  toggleChat: (v) => set((s) => ({ chatOpen: v ?? !s.chatOpen })),
  openImport: (v) => set({ importOpen: v }),
  openRecord: (v) => set({ recordOpen: v }),
  openSettings: (v) => set({ settingsOpen: v }),
  setChatTab: (t) => set({ chatTab: t }),
  setLiveScroll: (v) => set({ liveScroll: v }),

  startImport: async (req) => {
    set({ importOpen: false, toast: null, importInFlight: true })
    const res = await window.api.importAudio(req)
    await get().loadNotes()
    if (res.error) {
      set({ toast: { kind: 'error', message: 'Transkripsiyon başarısız', detail: res.error } })
      if (res.noteId) await get().selectNote(res.noteId)
    } else {
      set({
        toast: {
          kind: 'success',
          message: 'Transkript hazır',
          detail: `${res.segments} parça • dil: ${res.language ?? '?'}`
        }
      })
      await get().selectNote(res.noteId)
      set({ transcriptOpen: true })
    }
    set({ progress: null, importInFlight: false })
  },

  toastShow: (t) => set({ toast: t }),
  toastClear: () => set({ toast: null }),

  updateSettings: async (patch) => {
    let settings = get().settings
    for (const [k, v] of Object.entries(patch)) {
      settings = await window.api.setSetting(k, v)
    }
    set({ settings })
  },

  // ---------------------------------------------------------------- FAZ 2
  startRecording: async (opts) => {
    const channels: Channel[] = []
    if (opts.micEnabled) channels.push('mic')
    if (opts.systemEnabled) channels.push('system')
    if (channels.length === 0) {
      set({ toast: { kind: 'error', message: 'En az bir kaynak seç (mikrofon veya sistem sesi)' } })
      return
    }

    set({ recordOpen: false, toast: null })

    // 1) Not: otomatik tetiklemede main zaten olusturdu, aksi halde biz acalim
    let noteId = opts.existingNoteId
    if (!noteId) {
      const detail = await window.api.createNote({
        title: opts.title.trim() || 'Canlı kayıt',
        source: 'manual',
        status: 'recording'
      })
      noteId = detail.note.id
    }
    await get().loadNotes()
    await get().selectNote(noteId)
    set({ transcriptOpen: true, liveScroll: true })

    // 2) Ses kaynaklarini ac
    let micStream: MediaStream | null = null
    let systemStream: MediaStream | null = null
    try {
      if (opts.micEnabled) micStream = await openMicStream(opts.micDeviceId)
      if (opts.systemEnabled) systemStream = await openSystemStream()
    } catch (err) {
      micStream?.getTracks().forEach((t) => t.stop())
      systemStream?.getTracks().forEach((t) => t.stop())
      await window.api.recordingCancel(noteId)
      await get().loadNotes()
      set({
        toast: {
          kind: 'error',
          message: 'Ses kaynağı açılamadı',
          detail: err instanceof Error ? err.message : String(err)
        }
      })
      return
    }

    // 3) Yakalamayi baslat
    const recorder = getRecorder()
    const activeChannels = await recorder.start({
      micStream,
      systemStream,
      chunkMs: RECORDING_DEFAULTS.chunkMs,
      minChunkMs: RECORDING_DEFAULTS.minChunkMs,
      silenceRms: RECORDING_DEFAULTS.silenceRms,
      onChunk: async (channel, pcm16, offsetMs, seq) => {
        const bytes = new Uint8Array(pcm16.buffer.slice(0))
        const res = await window.api.recordingChunk({
          noteId: noteId as string,
          channel,
          seq,
          offsetMs,
          sampleRate: RECORDING_DEFAULTS.targetSampleRate,
          language: opts.language,
          pcm: bytes
        })
        if (!res.ok) {
          const prev = get().recording.chunkErrors
          set({ recording: { ...get().recording, chunkErrors: prev + 1 } })
          if (prev === 0) {
            set({
              toast: { kind: 'error', message: 'Bir parça yazıya dökülemedi', detail: res.error }
            })
          }
        }
      },
      onLevel: () => undefined, // metre RecordBar tarafindan okunur
      onError: (channel, message) => {
        set({ toast: { kind: 'error', message: `${channel} kanalında hata`, detail: message } })
      }
    })

    await window.api.recordingStart({
      noteId: noteId as string,
      channels: activeChannels,
      language: opts.language,
      auto: opts.auto,
      reason: opts.reason,
      triggerApp: opts.triggerApp
    })

    set({
      recording: {
        active: true,
        paused: false,
        external: false,
        auto: Boolean(opts.auto),
        noteId: noteId as string,
        channels: activeChannels,
        chunkErrors: 0
      },
      toast: opts.auto
        ? {
            kind: 'success',
            message: 'Otomatik kayıt başladı',
            detail: `${opts.reason ?? ''} • Duraklatabilir veya iptal edebilirsin`
          }
        : {
            kind: 'success',
            message: 'Kayıt başladı',
            detail: `${activeChannels.length} kanal • Duraklatabilir veya durdurabilirsin`
          }
    })
  },

  pauseRecording: () => {
    const rec = getRecorder()
    if (!rec.isActive) return
    rec.pause()
    set({ recording: { ...get().recording, paused: true } })
    void window.api.notifyPauseState(true)
  },

  resumeRecording: () => {
    const rec = getRecorder()
    if (!rec.isActive) return
    rec.resume()
    set({ recording: { ...get().recording, paused: false } })
    void window.api.notifyPauseState(false)
  },

  stopRecording: async () => {
    const noteId = get().recording.noteId
    set({ recording: { ...get().recording, active: false, paused: false } })
    await getRecorder().stop()
    if (noteId) {
      await window.api.recordingStop(noteId)
      await get().loadNotes()
      await get().selectNote(noteId)
    }
    set({ recording: { ...emptyRecording } })

    // Kayit bitince not OTOMATIK zenginlesir (spesifikasyon).
    const st = get()
    const hasContent =
      (st.detail?.transcripts.length ?? 0) > 0 || Boolean(st.detail?.raw_notes_md.trim())
    if (noteId && st.settings?.auto_enhance && hasContent) {
      await get().enhanceNote(noteId, null, false)
      return
    }
    set({
      toast: {
        kind: 'success',
        message: 'Kayıt bitti',
        detail: hasContent
          ? 'Zenginleştirmeyi ✨ düğmesiyle başlatabilirsin.'
          : 'Bu kayıtta konuşma algılanmadı.'
      }
    })
  },

  cancelRecording: async () => {
    const noteId = get().recording.noteId
    set({ recording: { ...emptyRecording } })
    // Iptal: bekleyen ses ISLENMEZ (flush: false) - boylece iptal edilen kayittan
    // transkript olusmaz ve bos not gercekten silinebilir.
    await getRecorder().stop({ flush: false })
    if (noteId) {
      const res = await window.api.recordingCancel(noteId)
      await get().loadNotes()
      if (res.deleted) {
        const next = get().notes[0]?.id ?? null
        await get().selectNote(next)
      } else {
        await get().selectNote(noteId)
      }
      set({
        toast: {
          kind: 'info',
          message: res.deleted ? 'Kayıt iptal edildi, boş not silindi' : 'Kayıt iptal edildi, not korundu'
        }
      })
    }
  },

  // ---------------------------------------------------------------- FAZ 6
  loadChatThreads: async () => {
    try {
      set({ chatThreads: await window.api.chatThreads() })
    } catch {
      /* yoksay */
    }
  },

  openChatForScope: async (kind, id) => {
    set({ chatScope: { kind, id: id ?? null }, askResult: null })
    const threadId = await window.api.chatEnsureThread({ scopeKind: kind, scopeId: id ?? null })
    const messages = await window.api.chatMessages(threadId)
    set({ chatThreadId: threadId, chatMessages: messages })
    await get().loadChatThreads()
  },

  sendChat: async (question) => {
    const threadId = get().chatThreadId
    const q = question.trim()
    if (!threadId || !q || get().chatBusy) return
    // Iyimser gosterim: kullanici mesajini hemen ekle
    const optimistic: ChatMessageDto = {
      id: `tmp-${Date.now()}`,
      thread_id: threadId,
      role: 'user',
      content_md: q,
      citations: [],
      provider: null,
      model: null,
      used_fallback: false,
      scanned_notes: 0,
      error: null,
      created_at: new Date().toISOString()
    }
    set({ chatMessages: [...get().chatMessages, optimistic], chatBusy: true })
    try {
      const res = await window.api.chatSend(threadId, q)
      const msgs = await window.api.chatMessages(threadId)
      set({ chatMessages: msgs })
      if (res.assistant.used_fallback && res.assistant.error) {
        set({ toast: { kind: 'info', message: 'Yerel arama kullanıldı', detail: res.assistant.error } })
      }
    } catch (err) {
      set({ toast: { kind: 'error', message: 'Sohbet hatası', detail: String(err) } })
      const msgs = await window.api.chatMessages(threadId).catch(() => [])
      set({ chatMessages: msgs })
    } finally {
      set({ chatBusy: false })
      await get().loadChatThreads()
    }
  },

  deleteChatThread: async (id) => {
    await window.api.chatDeleteThread(id)
    await get().loadChatThreads()
    if (get().chatThreadId === id) set({ chatThreadId: null, chatMessages: [] })
  },

  loadRecipes: async () => {
    try {
      set({ recipes: await window.api.recipesList() })
    } catch {
      /* yoksay */
    }
  },

  runRecipe: async (recipeId) => {
    set({ recipesOpen: false, chatBusy: true })
    try {
      const sc = get().chatScope
      const res = await window.api.recipesRun(recipeId, {
        kind: sc.kind === 'note' && !sc.id ? 'all' : sc.kind,
        id: sc.id ?? null
      })
      if (res.threadId) {
        const msgs = await window.api.chatMessages(res.threadId)
        set({ chatThreadId: res.threadId, chatMessages: msgs })
        await get().loadChatThreads()
      }
      if (!res.ok) set({ toast: { kind: 'error', message: 'Recipe çalıştırılamadı', detail: res.error } })
      else if (res.usedFallback) {
        set({ toast: { kind: 'info', message: 'Recipe yerel modda çalıştı', detail: res.error } })
      }
      return res
    } catch (err) {
      set({ toast: { kind: 'error', message: 'Recipe hatası', detail: String(err) } })
      return null
    } finally {
      set({ chatBusy: false })
    }
  },

  setRecipesOpen: (v) => set({ recipesOpen: v }),

  // ---------------------------------------------------------------- FAZ 7
  loadSecurity: async () => {
    try {
      set({ security: await window.api.securityStatus() })
    } catch {
      /* yoksay */
    }
  },

  loadJargon: async () => {
    try {
      set({ jargon: await window.api.jargonList() })
    } catch {
      /* yoksay */
    }
  },

  // ---------------------------------------------------------------- FAZ 5
  setView: (v) => set({ view: v }),

  loadDirectory: async () => {
    try {
      const dir = await window.api.directorySummary()
      set({ directory: dir })
    } catch {
      /* yoksay */
    }
  },

  setPeopleQuery: (q) => set({ peopleQuery: q }),

  openPerson: async (id) => {
    const person = await window.api.personGet(id)
    set({ view: { kind: 'person', id }, detailPerson: person, askResult: null })
    void get().loadBrief({ personId: id })
    void get().openChatForScope('person', id)
  },

  openCompany: async (id) => {
    const company = await window.api.companyGet(id)
    set({ view: { kind: 'company', id }, detailCompany: company, askResult: null })
    void get().loadBrief({ companyId: id })
    void get().openChatForScope('company', id)
  },

  updatePerson: async (id, patch) => {
    await window.api.personUpdate(id, patch)
    await get().loadDirectory()
    const cur = get().view
    if (cur.kind === 'person' && cur.id === id) set({ detailPerson: await window.api.personGet(id) })
  },

  mergePerson: async (fromId, toId) => {
    await window.api.personMerge(fromId, toId)
    await get().loadDirectory()
    set({ detailPerson: await window.api.personGet(toId), view: { kind: 'person', id: toId } })
    set({ toast: { kind: 'success', message: 'Kişiler birleştirildi' } })
  },

  extractPeople: async (noteId) => {
    set({ extractingPeople: true })
    try {
      const res = await window.api.peopleExtract(noteId)
      await get().loadDirectory()
      if (res.ok) {
        set({
          toast: {
            kind: 'success',
            message: 'Kişiler güncellendi',
            detail:
              `${res.links_added} bağlantı • ${res.people_added} yeni kişi • ${res.companies_added} yeni şirket` +
              (res.dropped ? ` • ${res.dropped} geçersiz kayıt atıldı` : '') +
              (res.usedFallback ? ' • sezgisel mod' : '')
          }
        })
      } else {
        set({ toast: { kind: 'error', message: 'Kişi çıkarımı başarısız', detail: res.error } })
      }
    } finally {
      set({ extractingPeople: false })
    }
  },

  loadBrief: async (target) => {
    set({ briefBusy: true, brief: null })
    try {
      const t = target ?? {
        noteId: get().selectedId,
        eventId: get().detail?.note.calendar_event_id ?? null
      }
      const res = await window.api.briefGet({
        noteId: t.noteId ?? null,
        personId: t.personId ?? null,
        companyId: t.companyId ?? null,
        eventId: t.eventId ?? null
      })
      set({ brief: res })
    } catch (err) {
      set({
        brief: {
          ok: false,
          items: [],
          provider: null,
          model: null,
          usedFallback: false,
          error: String(err)
        }
      })
    } finally {
      set({ briefBusy: false })
    }
  },

  askQuestion: async (question, scope) => {
    set({ askBusy: true, askResult: null })
    try {
      const sc = scope ?? { kind: 'note' as const, id: get().selectedId }
      const res = await window.api.ask({ scope: sc.kind, scopeId: sc.id ?? null, question })
      set({ askResult: res })
    } catch (err) {
      set({
        askResult: {
          ok: false,
          answer_md: '',
          citations: [],
          provider: null,
          model: null,
          usedFallback: false,
          scanned_notes: 0,
          error: String(err)
        }
      })
    } finally {
      set({ askBusy: false })
    }
  },

  addTag: async (noteId, name) => {
    const tag = await window.api.tagAdd(noteId, name)
    if (!tag) return
    await get().refreshSelected()
    await get().loadNotes()
    await get().loadDirectory()
  },

  removeTag: async (noteId, tagId) => {
    await window.api.tagRemove(noteId, tagId)
    await get().refreshSelected()
    await get().loadNotes()
    await get().loadDirectory()
  },

  deleteSegment: async (id) => {
    await window.api.transcriptDelete(id)
    const d = get().detail
    if (d) {
      const next = d.transcripts.filter((t) => t.id !== id)
      set({
        detail: { ...d, transcripts: next, note: { ...d.note, transcript_count: next.length } }
      })
    }
    await get().loadNotes()
  },

  relabelSegment: async (id, label) => {
    await window.api.transcriptUpdateSpeaker(id, label)
    const d = get().detail
    if (d) {
      set({
        detail: {
          ...d,
          transcripts: d.transcripts.map((t) => (t.id === id ? { ...t, speaker_label: label } : t))
        }
      })
    }
  },

  // ---------------------------------------------------------------- FAZ 4
  enhanceNote: async (noteId, templateId, silent) => {
    set({ enhancing: { noteId, stage: 'building', message: 'Hazırlanıyor...' } })
    try {
      const res = await window.api.enhanceNote(noteId, templateId ?? null)
      const detail = await window.api.getNote(noteId)
      const cur = get()
      const next: Partial<AppState> = {}
      if (cur.selectedId === noteId && detail) next.detail = detail
      next.enhancing = null
      if (res.ok) {
        next.toast = {
          kind: 'success',
          message: 'Notun hazır', // spesifikasyon: bitis bildirimi
          detail:
            `${res.version ? `v${res.version} • ` : ''}${res.citations ?? 0} kaynak` +
            (res.droppedCitations ? ` • ${res.droppedCitations} geçersiz kaynak atıldı` : '') +
            (res.usedFallback ? ' • yerel çıkarım kullanıldı' : '') +
            ` • ${res.provider ?? ''}`
        }
      } else if (!silent) {
        next.toast = { kind: 'error', message: 'Zenginleştirme başarısız', detail: res.error }
      }
      set(next)
      await get().loadNotes()
      return res
    } catch (err) {
      set({
        enhancing: null,
        toast: { kind: 'error', message: 'Zenginleştirme hatası', detail: String(err) }
      })
      return null
    }
  },

  regenerate: async () => {
    const id = get().selectedId
    if (!id) return
    const tpl = get().detail?.enhanced?.template_id ?? get().settings?.default_template ?? null
    await get().enhanceNote(id, tpl, false)
  },

  // ---------------------------------------------------------------- FAZ 3
  handleRecorderCommand: async (cmd) => {
    const st = get().recording
    if (cmd === 'pause') {
      if (st.active && !st.paused) get().pauseRecording()
      return
    }
    if (cmd === 'resume') {
      if (st.active && st.paused) get().resumeRecording()
      return
    }
    if (cmd === 'stop') {
      if (st.active) await get().stopRecording()
      return
    }
    if (cmd === 'cancel') {
      if (st.active) {
        await get().cancelRecording()
      } else if (st.noteId) {
        // Main tarafi iptal etti (or. yanlis tetikleme); arayuzu temizle
        const res = await window.api.recordingCancel(st.noteId)
        await get().loadNotes()
        if (res.deleted) await get().selectNote(get().notes[0]?.id ?? null)
      }
      set({ recording: { ...emptyRecording } })
    }
  },

  /**
   * Takvim etkinligine TIKLANINCA: yalnizca notu acar (yoksa bos not olusturur).
   * KAYIT BASLATMAZ — kayit, etkinlik saati gelince otomatik ya da acikca
   * "Kaydi baslat" denildiginde baslar.
   */
  openCalendarEvent: async (ev) => {
    if (get().recording.active && get().recording.noteId) {
      // Kayit surerken baska bir etkinlige tiklanirsa: once kaydi bitirmesini soyleyelim
      set({
        toast: {
          kind: 'info',
          message: 'Bir kayıt sürüyor',
          detail: 'Önce kaydı durdurun veya iptal edin, sonra başka bir toplantıyı açabilirsiniz.'
        }
      })
      await get().selectNote(get().recording.noteId)
      return
    }
    const detail = await window.api.createNoteForEvent({
      id: ev.id,
      title: ev.title,
      start_at: ev.start_at,
      participants: ev.participants,
      location: ev.location
    })
    if (!detail) return
    await get().loadNotes()
    set({ selectedId: detail.note.id, detail })
  },

  /** ACIK "Kaydi baslat" eylemi (kullanici istedi) */
  startFromCalendarEvent: async (ev) => {
    const existing = get().notes.find((n) => n.calendar_event_id === ev.id)
    if (get().recording.active) {
      set({ toast: { kind: 'info', message: 'Zaten bir kayıt sürüyor' } })
      return
    }
    if (existing) {
      // Not zaten var: onu ac ve kaydi ona bagla
      await get().selectNote(existing.id)
      const settings = get().settings
      await get().startRecording({
        title: existing.title,
        language: settings?.language ?? 'auto',
        micEnabled: true,
        systemEnabled: Boolean(settings?.record_system_audio),
        existingNoteId: existing.id,
        auto: false,
        reason: `calendar:${ev.id}`
      })
      return
    }
    const settings = get().settings
    // Takvim etkinligi icin main tarafinda not olusturup tetikleme akisini
    // kullanmak yerine dogrudan baslatiriz (kullanici acikca istedi).
    const detail = await window.api.createNote({
      title: ev.title,
      source: 'calendar',
      status: 'recording'
    })
    await get().startRecording({
      title: ev.title,
      language: settings?.language ?? 'auto',
      micEnabled: true,
      systemEnabled: Boolean(settings?.record_system_audio),
      existingNoteId: detail.note.id,
      auto: false,
      reason: `calendar:${ev.id}`
    })
  }
}))

// ---------------------------------------------------------------------------
//  main -> renderer olaylari (tek yerden baglanir).
// ---------------------------------------------------------------------------
export function attachMainEvents(): void {
  // 1) Canli kayit olaylari
  window.api.onRecordingEvent((e) => {
    const st = useAppStore.getState()
    if (e.type === 'started') {
      void st.loadNotes().then(() => st.selectNote(e.noteId))
      useAppStore.setState({
        recording: {
          active: true,
          paused: false,
          external: Boolean(e.external),
          auto: false,
          noteId: e.noteId,
          channels: ['mic'],
          chunkErrors: 0
        },
        transcriptOpen: true,
        liveScroll: true
      })
      return
    }

    if (e.type === 'segments') {
      useAppStore.setState((s) => {
        const next: Partial<AppState> = {}
        if (s.selectedId === e.noteId && s.detail) {
          const merged = sortSegments([...s.detail.transcripts, ...e.segments])
          next.detail = {
            ...s.detail,
            transcripts: merged,
            note: { ...s.detail.note, transcript_count: merged.length }
          }
        }
        next.notes = s.notes.map((n) =>
          n.id === e.noteId ? { ...n, transcript_count: n.transcript_count + e.segments.length } : n
        )
        return next
      })
      return
    }

    // status
    useAppStore.setState((s) => {
      const next: Partial<AppState> = {}
      if (s.detail && s.detail.note.id === e.noteId) {
        next.detail = { ...s.detail, note: { ...s.detail.note, status: e.status as NoteStatus } }
      }
      if (e.status !== 'recording') {
        next.recording = { ...s.recording, active: false, paused: false }
      }
      return next
    })
    const after = useAppStore.getState()
    void after.loadNotes()
    if (e.status === 'ready' && !after.recording.external) void after.refreshSelected()
  })

  // 2) FAZ 3: otomatik kayit komutu
  window.api.onAutoStart((cmd: AutoStartCommand) => {
    const st = useAppStore.getState()
    if (st.recording.active) {
      // Zaten kayit var; main'e iptal sinyali gonder
      void window.api.recordingCancel(cmd.noteId)
      return
    }
    void st.startRecording({
      title: cmd.title,
      language: cmd.language || 'auto',
      micEnabled: cmd.micEnabled,
      systemEnabled: cmd.systemEnabled,
      existingNoteId: cmd.noteId,
      auto: true,
      reason: cmd.reason,
      triggerApp: cmd.triggerApp
    })
  })

  // 2b) FAZ 4: zenginlestirme ilerlemesi (durum cubugu)
  window.api.onEnhanceProgress((p: EnhanceProgressEvent) => {
    if (p.stage === 'done' || p.stage === 'error') {
      useAppStore.setState({ enhancing: null })
      return
    }
    useAppStore.setState({ enhancing: { noteId: p.noteId, stage: p.stage, message: p.message } })
  })

  // 3) Bildirim penceresinden gelen kontrol komutlari
  window.api.onRecorderCommand((cmd) => {
    void useAppStore.getState().handleRecorderCommand(cmd)
  })

  // 4) "Notu ac" (bildirimden)
  window.api.onNoteFocus((noteId) => {
    const st = useAppStore.getState()
    void st.selectNote(noteId)
    useAppStore.setState({ transcriptOpen: true })
  })

  // 4b) Takvim senkronu bitti -> sidebar/liste tazelensin
  window.api.onCalendarUpdated(() => {
    void useAppStore.getState().loadCalendarEvents()
  })

  // 5) Main'den bilgi bildirimi
  window.api.onAppToast((t) => {
    useAppStore.setState({ toast: { kind: t.kind, message: t.message } })
    void useAppStore.getState().loadNotes()
  })
}