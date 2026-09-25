// ============================================================================
//  Paylasilan tipler ve sabitler (main + preload + renderer ortak kullanir)
// ============================================================================

export type NoteSource = 'calendar' | 'call' | 'manual' | 'import'
export type NoteStatus = 'recording' | 'processing' | 'ready' | 'failed'
export type Channel = 'mic' | 'system'
export type CitationSource = 'transcript' | 'raw_note' | 'calendar'

export interface NoteSummary {
  id: string
  title: string
  started_at: string
  ended_at: string | null
  source: NoteSource
  status: NoteStatus
  /** Takvim tetiklemesiyle acildiysa etkinlik kimligi (sidebar eslesmesi icin) */
  calendar_event_id: string | null
  tags: string[]
  participants: Person[]
  transcript_count: number
}

export interface Person {
  id: string
  name: string
  email?: string | null
  avatar_url?: string | null
}

export interface TranscriptSegment {
  id: string
  note_id: string
  channel: Channel
  speaker_label: string | null
  text: string
  start_ms: number
  end_ms: number
}

export interface Citation {
  id: string
  enhanced_note_id: string
  sentence_ref: string
  source_type: CitationSource
  source_id: string | null
  excerpt: string | null
}

export interface EnhancedNote {
  id: string
  note_id: string
  content_md: string
  template_id: string | null
  model: string | null
  version: number
  created_at: string
  citations: Citation[]
}

export interface CalendarEventMeta {
  id: string
  title: string
  start_at: string
  end_at: string | null
  location: string | null
  participants: string[]
}

export interface NoteDetail {
  note: NoteSummary
  raw_notes_md: string
  transcripts: TranscriptSegment[]
  enhanced: EnhancedNote | null
  calendar_event: CalendarEventMeta | null
}

export interface Template {
  id: string
  name: string
  description: string | null
  is_builtin: boolean
}

export interface AppSettings {
  ui_language: string
  language: string
  stt_provider: string
  stt_model: string
  auto_start_calendar: 'participants' | 'all' | 'off'
  auto_start_call: boolean
  auto_start_apps: boolean
  allowed_apps: string[]
  retention_days: number
  opt_out_training: boolean
  notifications: boolean
  default_template: string
  // --- FAZ 3: otomatik tetikleme ---
  calendar_source: string
  calendar_sync_minutes: number
  auto_cancel_empty_seconds: number
  auto_stop_silence_seconds: number
  auto_stop_on_app_close: boolean
  trigger_cooldown_seconds: number
  record_system_audio: boolean
  // --- FAZ 4 ---
  llm_provider: string
  llm_model: string
  auto_enhance: boolean
  // --- FAZ 6 ---
  chat_max_context_notes: number
  // --- FAZ 7 ---
  os_notifications: boolean
  jargon_enabled: boolean
  export_dir: string
  encrypt_db: boolean
  stt_prompt: string
}

export interface ImportRequest {
  filePath: string
  channel: Channel
  language: string
  title?: string
}

export interface ImportProgress {
  stage: 'queued' | 'uploading' | 'transcribing' | 'saving' | 'done' | 'error'
  filePath: string
  message: string
  noteId?: string
  detail?: string
}

export interface ImportResult {
  noteId: string
  segments: number
  language?: string
  text: string
  error?: string
}

// ---------------------------------------------------------------------------
//  FAZ 2 - Canli kayit
// ---------------------------------------------------------------------------

/** Canli kayit sirasinda main -> renderer gonderilen olaylar (tek kaynak). */
export type RecordingEvent =
  | { type: 'started'; noteId: string; title: string; external?: boolean }
  | { type: 'segments'; noteId: string; segments: TranscriptSegment[] }
  | { type: 'status'; noteId: string; status: NoteStatus; error?: string }

export interface RecordingStartRequest {
  noteId: string
  /** Aktif kanallar: mic = ben (yesil), system = karsi taraf (gri) */
  channels: Channel[]
  language: string
  /** Otomatik tetikleme ile mi basladi? (yanlis tetikleme korumasi bunu kullanir) */
  auto?: boolean
  /** Tetikleme nedeni (or. 'call:Zoom.exe', 'calendar:<eventId>', 'app:Teams') */
  reason?: string
  /** Kaydi tetikleyen uygulama (kapaninca durdurma icin) */
  triggerApp?: string
}

/** Renderer'in ~5 sn'lik PCM16 parcasi. Ham ses diske YAZILMAZ; temp dosya islem sonunda silinir. */
export interface RecordingChunkRequest {
  noteId: string
  channel: Channel
  seq: number
  offsetMs: number
  sampleRate: number
  language: string
  /** PCM16 little-endian mono baytlari */
  pcm: Uint8Array
}

export interface RecordingChunkResult {
  ok: boolean
  /** Eklenen transkript satirlari (id dahil) */
  segments: TranscriptSegment[]
  /** Sessiz/bos parca atlandi mi? */
  skipped?: boolean
  error?: string
}

export interface MediaDeviceInfoLite {
  deviceId: string
  label: string
}

// ---------------------------------------------------------------------------
//  FAZ 3 - Otomatik tetikleme
// ---------------------------------------------------------------------------

export type TriggerKind = 'call' | 'app' | 'calendar'

/** Kaydi tetikleyen olay */
export interface TriggerEvent {
  kind: TriggerKind
  /** 'call:Zoom.exe' | 'app:ms-teams.exe' | 'calendar:<uid>' */
  reason: string
  /** Kullaniciya gosterilecek baslik (takvim etkinlik adi veya uygulama adi) */
  title: string
  /** Tetikleyen uygulama (varsa) */
  app?: string
  calendarEventId?: string
  /** Takvim etkinligi katilimcilari */
  participants?: string[]
  detectedAt: string
}

/** main -> renderer: "kaydi otomatik baslat" komutu */
export interface AutoStartCommand {
  noteId: string
  title: string
  reason: string
  triggerApp?: string
  language: string
  micEnabled: boolean
  systemEnabled: boolean
}

/** main -> renderer: kayit kontrol komutu (bildirim penceresinden gelir) */
export type RecorderCommand = 'pause' | 'resume' | 'stop' | 'cancel'

/** Bildirim penceresi icerigi */
export interface NotifyState {
  visible: boolean
  noteId: string | null
  title: string
  subtitle: string
  status: 'recording' | 'paused'
  startedAt: number
  /** Bu bir hata/uyari bildirimi mi */
  tone: 'record' | 'info' | 'warn'
}

/** Tespit edilen mikrofon kullanicisi (Windows CapabilityAccessManager registry) */
export interface MicUser {
  /** cozulmus exe yolu: C:\...\Zoom.exe */
  exePath: string
  /** dosya adi: Zoom.exe */
  exe: string
  active: boolean
  startAt: string | null
  stopAt: string | null
}

export interface ProcessInfo {
  name: string
  pid: number
  title: string
}

export interface DetectSnapshot {
  micUsers: MicUser[]
  processes: ProcessInfo[]
  takenAt: string
}

/** Ayarlar ekraninda teshis/onizleme icin */
export interface TriggerDiagnostics {
  /** Gozcu (watchdog) ic durumu */
  watchdog: Record<string, unknown>
  micUsers: MicUser[]
  processes: ProcessInfo[]
  activeAllowedApps: string[]
  calendarSource: string
  calendarEventCount: number
  nextCalendarEvent: { id: string; title: string; start_at: string } | null
}

export interface CalendarEventRowDto {
  id: string
  title: string
  start_at: string
  end_at: string | null
  location: string | null
  description: string | null
  participants: string[]
  organizer: string | null
  all_day: boolean
  triggered_at: string | null
}

// ---------------------------------------------------------------------------
//  FAZ 5 - Kisiler & Sirketler, etiketler, Brief, kapsamli soru-cevap
// ---------------------------------------------------------------------------

export interface CompanySummary {
  id: string
  name: string
  domain: string | null
  note_count: number
  people_count: number
}

export interface PersonSummary {
  id: string
  name: string
  email: string | null
  title: string | null
  avatar_url: string | null
  company_id: string | null
  company_name: string | null
  note_count: number
  /** Son gorusme tarihi (ISO) */
  last_seen_at: string | null
}

/** Bir kisinin/sirketin bir notla iliskisi (delil ile birlikte) */
export interface PersonNoteLink {
  note_id: string
  title: string
  started_at: string
  source: NoteSource
  role: string | null
  evidence: string | null
}

export interface PersonDetail {
  person: PersonSummary
  notes: PersonNoteLink[]
  /** Bu kisiyle ilgili notlardan cikan ortak etiketler */
  tags: string[]
}

export interface CompanyDetail {
  company: CompanySummary
  people: PersonSummary[]
  notes: PersonNoteLink[]
}

export interface TagSummary {
  id: string
  name: string
  note_count: number
}

/** Kisiler & Sirketler dizini ozeti (sidebar basliklari icin) */
export interface DirectorySummary {
  people: PersonSummary[]
  companies: CompanySummary[]
  tags: TagSummary[]
}

// --- Brief ---
export interface BriefItem {
  text: string
  /** Dayandigi kaynak not (varsa) */
  note_id: string | null
  note_title: string | null
  /** "transcript" | "raw_note" | "enhanced" | "calendar" | "previous_note" */
  source_type: string | null
}

export interface BriefResult {
  ok: boolean
  /** 2-3 maddelik kisisel ozet */
  items: BriefItem[]
  provider: string | null
  model: string | null
  usedFallback: boolean
  error?: string
}

// --- Kapsamli soru-cevap (kisi / sirket / not / tum notlar) ---
export type AskScopeKind = 'person' | 'company' | 'note' | 'all'

export interface AskRequest {
  scope: AskScopeKind
  /** person/company/note icin kimlik */
  scopeId?: string | null
  question: string
}

export interface AskCitationDto {
  note_id: string
  note_title: string
  source_type: 'transcript' | 'raw_note' | 'enhanced' | 'calendar' | 'previous_note'
  excerpt: string | null
}

export interface AskResult {
  ok: boolean
  answer_md: string
  citations: AskCitationDto[]
  provider: string | null
  model: string | null
  usedFallback: boolean
  /** Kac not tarandi */
  scanned_notes: number
  error?: string
}

// --- Kisi cikarimi (otomatik) ---
export interface ExtractPeopleResult {
  ok: boolean
  people_added: number
  companies_added: number
  links_added: number
  /** Guvenilmez oldugu icin atilan kayit sayisi (delil bulunamadi) */
  dropped: number
  provider: string | null
  model: string | null
  usedFallback: boolean
  error?: string
}

// ---------------------------------------------------------------------------
//  FAZ 6 - Sohbet ve Recipes
// ---------------------------------------------------------------------------

export type ChatScopeKind = 'note' | 'person' | 'company' | 'all'

export interface ChatThreadDto {
  id: string
  title: string
  scope_kind: ChatScopeKind
  scope_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface ChatMessageDto {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content_md: string
  citations: AskCitationDto[]
  provider: string | null
  model: string | null
  used_fallback: boolean
  scanned_notes: number
  error: string | null
  created_at: string
}

export interface RecipeDto {
  id: string
  name: string
  shortcut: string
  description: string | null
  prompt_body: string
  scope: 'note' | 'person' | 'company' | 'all' | 'selection'
  is_builtin: boolean
  sort_order: number
}

/** Recipe uygulama sonucu (sonuc sohbete de dusulur) */
export interface RecipeRunResult {
  ok: boolean
  threadId: string
  answer_md: string
  citations: AskCitationDto[]
  provider: string | null
  model: string | null
  usedFallback: boolean
  error?: string
}

// ---------------------------------------------------------------------------
//  FAZ 7 - Disa aktarma, jargon, guvenlik, saklama
// ---------------------------------------------------------------------------

export type ExportFormat = 'markdown' | 'json' | 'csv'

export interface ExportRequest {
  format: ExportFormat
  /** Hangi notlar: tek not / secili kisi / secili sirket / hepsi */
  scope: { kind: 'note' | 'person' | 'company' | 'all'; id?: string | null }
  /** Hedef klasor; bos ise kullaniciya sorulur */
  targetDir?: string | null
  /** Transkriptleri de yaz */
  includeTranscripts: boolean
  /** Obsidian icin not basina ayri .md dosyasi */
  splitFiles: boolean
}

export interface ExportResult {
  ok: boolean
  /** Yazilan dosyalar (goreli ad) */
  files: string[]
  targetDir: string
  noteCount: number
  bytes: number
  error?: string
}

export interface JargonEntry {
  id: string
  term: string
  replacement: string
  note: string | null
  enabled: boolean
  hit_count: number
}

export interface RetentionResult {
  deleted: number
  kept: number
  retentionDays: number
}

export interface SecurityStatusDto {
  encrypted: boolean
  encryptionAvailable: boolean
  dbPath: string
  dbSizeBytes: number
  fileIsPlaintext: boolean
  consistent: boolean
  keyPath: string
  backups: Array<{ name: string; sizeBytes: number; createdAt: string }>
  /** Sifreleme ACIKKEN duz metin kalan yedek sayisi (>0 ise uyari gosterilir) */
  plaintextBackupCount: number
}

export interface RekeyResultDto {
  ok: boolean
  encrypted: boolean
  backupPath?: string
  error?: string
  verified?: boolean
  encryptedBackups?: number
  decryptedBackups?: number
}

export interface DeleteAllResult {
  ok: boolean
  deletedNotes: number
  backupPath?: string
}

export interface LlmProviderInfo {
  id: string
  label: string
  requiresApiKey: boolean
  defaultModel: string
  suggestedModels: string[]
  hasApiKey: boolean
  /** Maskeli onizleme (or. "gsk_6eHsaMVC…kgIn") */
  maskedKey?: string
  /** Anahtarin kaynagi: ayarlar (arayuz) veya .env */
  keySource?: 'settings' | 'env' | null
}

export interface EnhanceProgressEvent {
  noteId: string
  stage: 'queued' | 'building' | 'calling' | 'parsing' | 'saving' | 'done' | 'error'
  message: string
  detail?: string
  provider?: string
  model?: string
}

export interface EnhanceResultDto {
  ok: boolean
  version?: number
  citations?: number
  droppedCitations?: number
  provider?: string
  model?: string
  error?: string
  usedFallback?: boolean
}

export interface CalendarSyncResult {
  ok: boolean
  source: string
  fetched: number
  stored: number
  upcoming: number
  error?: string
}

// --- IPC kanal adlari (typo'lari onlemek icin tek kaynak) -------------------
export const IPC = {
  appInfo: 'app:info',
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  notesList: 'notes:list',
  notesGet: 'notes:get',
  notesCreate: 'notes:create',
  notesCreateForEvent: 'notes:createForEvent',
  notesDelete: 'notes:delete',
  notesSetRaw: 'notes:setRaw',
  notesSetTitle: 'notes:setTitle',
  notesImportAudio: 'notes:importAudio',
  dialogPickAudio: 'dialog:pickAudio',
  dialogPickIcs: 'dialog:pickIcs',
  templatesList: 'templates:list',
  searchAll: 'search:all',
  rendererReady: 'renderer:ready',
  // FAZ 2 - canli kayit
  recordingStart: 'recording:start',
  recordingChunk: 'recording:chunk',
  recordingStop: 'recording:stop',
  recordingCancel: 'recording:cancel',
  recordingEvent: 'recording:event',
  recordingState: 'recording:state',
  // FAZ 3 - otomatik tetikleme
  triggerAutoStart: 'trigger:autoStart',
  recorderCommand: 'recorder:command',
  diagnostics: 'trigger:diagnostics',
  calendarSync: 'calendar:sync',
  calendarEvents: 'calendar:events',
  notifyAction: 'notify:action',
  noteFocus: 'note:focus',
  appToast: 'app:toast',
  calendarUpdated: 'calendar:updated',
  // FAZ 4 - LLM zenginlestirme
  llmProviders: 'llm:providers',
  llmModels: 'llm:models',
  llmSetKey: 'llm:setKey',
  llmTestKey: 'llm:testKey',
  notesEnhance: 'notes:enhance',
  notesEnhancedVersions: 'notes:enhancedVersions',
  enhanceProgress: 'enhance:progress',
  // FAZ 5 - dizin, etiketler, brief, kapsamli soru
  directorySummary: 'dir:summary',
  peopleList: 'people:list',
  peopleGet: 'people:get',
  peopleUpdate: 'people:update',
  peopleMerge: 'people:merge',
  peopleDedupe: 'people:dedupe',
  peopleExtract: 'people:extract',
  companiesList: 'companies:list',
  companiesGet: 'companies:get',
  tagsList: 'tags:list',
  tagsAdd: 'tags:add',
  tagsRemove: 'tags:remove',
  tagsRename: 'tags:rename',
  transcriptDelete: 'transcript:delete',
  transcriptUpdateSpeaker: 'transcript:updateSpeaker',
  briefGet: 'brief:get',
  askScoped: 'ask:scoped',
  // FAZ 6 - sohbet + recipes
  chatThreads: 'chat:threads',
  chatEnsureThread: 'chat:ensureThread',
  chatMessages: 'chat:messages',
  chatSend: 'chat:send',
  chatDeleteThread: 'chat:deleteThread',
  recipesList: 'recipes:list',
  recipesSave: 'recipes:save',
  recipesDelete: 'recipes:delete',
  recipesRun: 'recipes:run',
  // FAZ 7 - disa aktarma, jargon, guvenlik
  exportNotes: 'export:notes',
  dialogPickDir: 'dialog:pickDir',
  jargonList: 'jargon:list',
  jargonSave: 'jargon:save',
  jargonDelete: 'jargon:delete',
  securityStatus: 'security:status',
  securityEnable: 'security:enable',
  securityDisable: 'security:disable',
  securityBackup: 'security:backup',
  retentionRun: 'retention:run',
  deleteAllData: 'data:deleteAll',
  notifyState: 'notify:state',
  // main -> renderer olaylari
  importProgress: 'import:progress'
} as const

/** Canli kayit varsayilanlari (renderer ve main ayni degerleri kullanir) */
export const RECORDING_DEFAULTS = {
  /** Her parca en fazla bu kadar (ms) */
  chunkMs: 5000,
  /** Bu sureden kisa parca gonderilmez (ms) */
  minChunkMs: 1500,
  /** Sessizlik esigi (RMS, 0..1). Altindaki parca gonderilmez. */
  silenceRms: 0.004,
  /** Parca basindan bu kadar geriye bakarak sessizlik kontrolu (ms) */
  tailCheckMs: 700,
  /** Whisper'a gonderilen hedef ornekleme hizi */
  targetSampleRate: 16000
} as const

/** Bilinen toplanti/arama uygulamalari (exe adi, kucuk harf).
 *  Izin listesindeki etiketler bunlarla eslesirse tetikleme yapilir. */
export const KNOWN_MEETING_EXES = [
  'zoom.exe',
  'zoomhybridconf.exe',
  'teams.exe',
  'ms-teams.exe',
  'ms-teamsupdate.exe',
  'discord.exe',
  'skype.exe',
  'slack.exe',
  'webex.exe',
  'webexmta.exe',
  'ciscowebexstart.exe',
  'whatsapp.exe',
  'telegram.exe',
  'messenger.exe',
  'wemeetapp.exe',
  'jitsi.exe',
  'gotomeeting.exe',
  'bluejeans.exe',
  'around.exe',
  'tuple.exe'
] as const

/** Tarayicida calisan toplantilar icin pencere basligi isaretleri */
export const KNOWN_MEETING_TITLE_MARKERS = [
  'google meet',
  'meet.google.com',
  'zoom meeting',
  'microsoft teams',
  'teams meeting',
  'whereby.com',
  'jitsi meet'
] as const