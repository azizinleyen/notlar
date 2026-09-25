import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  Braces,
  Download,
  FileText,
  HardDrive,
  Keyboard,
  KeyRound,
  Lock,
  Merge,
  Table,
  Trash2,
  Unlock,
  CheckCircle2,
  ChevronDown,
  Languages,
  Loader2,
  Mic,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { AppSettings, ExportResult, LlmProviderInfo, TriggerDiagnostics } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Switch } from './primitives'

const LANGUAGES = [
  { code: 'auto', label: 'Otomatik algıla' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'İngilizce' },
  { code: 'de', label: 'Almanca' },
  { code: 'fr', label: 'Fransızca' },
  { code: 'es', label: 'İspanyolca' }
]

const APP_SUGGESTIONS = [
  'Zoom',
  'Microsoft Teams',
  'Discord',
  'Google Meet',
  'Skype',
  'Slack',
  'WhatsApp',
  'Telegram',
  'Webex'
]

function Section({
  icon,
  title,
  hint,
  children
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-hairlineSoft px-6 py-5 last:border-b-0">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-[2px] text-muted">{icon}</span>
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[13px] text-inkSoft">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen)
  const openSettings = useAppStore((s) => s.openSettings)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const hasApiKey = useAppStore((s) => s.hasApiKey)
  const directory = useAppStore((s) => s.directory)
  const loadDirectory = useAppStore((s) => s.loadDirectory)
  const setView = useAppStore((s) => s.setView)
  const security = useAppStore((s) => s.security)
  const loadSecurity = useAppStore((s) => s.loadSecurity)
  const jargon = useAppStore((s) => s.jargon)
  const loadJargon = useAppStore((s) => s.loadJargon)
  const sttProviders = useAppStore((s) => s.sttProviders)
  const [appVersion, setAppVersion] = useState('')
  const refreshApiKeyStatus = useAppStore((s) => s.refreshApiKeyStatus)
  const loadNotes = useAppStore((s) => s.loadNotes)
  const toastShow = useAppStore((s) => s.toastShow)
  const loadCalendarEvents = useAppStore((s) => s.loadCalendarEvents)

  const [diag, setDiag] = useState<TriggerDiagnostics | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [newApp, setNewApp] = useState('')
  const [showMicDebug, setShowMicDebug] = useState(false)
  const [llmProviders, setLlmProviders] = useState<LlmProviderInfo[]>([])
  const [models, setModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [dedupeBusy, setDedupeBusy] = useState(false)
  const [secBusy, setSecBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportSplit, setExportSplit] = useState(false)
  const [exportIncludeTranscripts, setExportIncludeTranscripts] = useState(true)
  const [exportLast, setExportLast] = useState<ExportResult | null>(null)
  const [retentionBusy, setRetentionBusy] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [newJargon, setNewJargon] = useState({ term: '', replacement: '' })
  // API anahtari girisi (Faz 7 sonrasi: kurulu .exe .env'i goremedigi icin)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    void loadCalendarEvents()
    void window.api.llmProviders().then(setLlmProviders).catch(() => setLlmProviders([]))
    void window.api.appInfo().then((i) => setAppVersion(i.version)).catch(() => setAppVersion(''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadCalendarEvents])

  const loadModels = async (providerId: string): Promise<void> => {
    setModelsBusy(true)
    setModelsError(null)
    try {
      const res = await window.api.llmModels(providerId)
      setModels(res.models ?? [])
      if (res.error) setModelsError(res.error)
      else if ((res.models ?? []).length === 0) {
        setModelsError('Sağlayıcı model listesi vermedi; öneriler gösteriliyor.')
      }
    } catch (err) {
      setModelsError(String(err))
    } finally {
      setModelsBusy(false)
    }
  }

  const activeProvider = llmProviders.find((p) => p.id === settings?.llm_provider) ?? null

  const toggleEncryption = async (enable: boolean): Promise<void> => {
    setSecBusy(true)
    try {
      const res = enable ? await window.api.securityEnable() : await window.api.securityDisable()
      if (res.ok) {
        toastShow({
          kind: 'success',
          message: enable ? 'Veritabanı şifrelendi' : 'Şifreleme kaldırıldı',
          detail: `Yedek: ${res.backupPath ?? '—'}${res.verified ? ' • doğrulandı' : ''}`
        })
      } else {
        toastShow({ kind: 'error', message: 'İşlem başarısız', detail: res.error })
      }
      await loadSecurity()
    } finally {
      setSecBusy(false)
    }
  }

  const doBackup = async (): Promise<void> => {
    setSecBusy(true)
    try {
      const res = await window.api.securityBackup()
      toastShow({
        kind: res.ok ? 'success' : 'error',
        message: res.ok ? 'Yedek alındı' : 'Yedek alınamadı',
        detail: res.path
      })
      await loadSecurity()
    } finally {
      setSecBusy(false)
    }
  }

  const pickExportDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) await updateSettings({ export_dir: dir })
  }

  const doExport = async (format: 'markdown' | 'json' | 'csv'): Promise<void> => {
    setExportBusy(true)
    try {
      const res = await window.api.exportNotes({
        format,
        scope: { kind: 'all' },
        targetDir: settings?.export_dir ?? null,
        includeTranscripts: exportIncludeTranscripts,
        splitFiles: exportSplit && format === 'markdown'
      })
      if (res.ok) {
        setExportLast(res)
        toastShow({
          kind: 'success',
          message: 'Dışa aktarma tamam',
          detail: `${res.noteCount} not • ${res.files.length} dosya • ${(res.bytes / 1024).toFixed(0)} KB`
        })
      } else {
        toastShow({ kind: 'error', message: 'Dışa aktarma başarısız', detail: res.error })
      }
    } finally {
      setExportBusy(false)
    }
  }

  const doRetention = async (): Promise<void> => {
    setRetentionBusy(true)
    try {
      const dry = await window.api.retentionRun(true)
      if (dry.retentionDays === 0) {
        toastShow({ kind: 'info', message: 'Saklama süresi 0 (süresiz) — silinecek not yok.' })
        return
      }
      const res = await window.api.retentionRun(false)
      toastShow({
        kind: res.deleted > 0 ? 'success' : 'info',
        message: res.deleted > 0 ? `${res.deleted} not silindi` : 'Silinecek not yok',
        detail: `${res.retentionDays} günden eski • kalan ${res.kept} not`
      })
      await loadNotes()
    } finally {
      setRetentionBusy(false)
    }
  }

  const doDeleteAll = async (): Promise<void> => {
    setDeleteBusy(true)
    try {
      const res = await window.api.deleteAllData()
      setConfirmDeleteAll(false)
      toastShow({
        kind: 'success',
        message: 'Tüm veriler silindi',
        detail: `${res.deletedNotes} not • yedek: ${res.backupPath ?? '—'}`
      })
      await loadNotes()
      await loadDirectory()
      await loadSecurity()
      setView({ kind: 'note' })
    } finally {
      setDeleteBusy(false)
    }
  }

  const saveKey = async (): Promise<void> => {
    if (!activeProvider) return
    const k = keyDraft.trim()
    if (!k) return
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      const list = await window.api.llmSetKey(activeProvider.id, k)
      setLlmProviders(list)
      await refreshApiKeyStatus()
      setKeyDraft('')
      setKeyMsg({ ok: true, text: 'Anahtar kaydedildi ve kullanıma hazır.' })
      toastShow({ kind: 'success', message: 'API anahtarı kaydedildi' })
    } catch (err) {
      setKeyMsg({ ok: false, text: String(err) })
    } finally {
      setKeyBusy(false)
    }
  }

  const testKey = async (): Promise<void> => {
    if (!activeProvider) return
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      const res = await window.api.llmTestKey(activeProvider.id)
      if (res.ok) {
        const bits = [
          res.model ? `model: ${res.model}` : '',
          res.modelCount ? `${res.modelCount} model görünür` : '',
          res.source ? `kaynak: ${res.source === 'env' ? '.env' : 'bu ekran'}` : '',
          res.note ?? ''
        ].filter(Boolean)
        setKeyMsg({ ok: true, text: `Doğrulandı ✓  ${bits.join(' • ')}` })
      } else {
        setKeyMsg({ ok: false, text: res.error ?? 'Doğrulanamadı' })
      }
    } catch (err) {
      setKeyMsg({ ok: false, text: String(err) })
    } finally {
      setKeyBusy(false)
    }
  }

  const runDedupe = async (): Promise<void> => {
    setDedupeBusy(true)
    try {
      const res = await window.api.peopleDedupe()
      await loadDirectory()
      toastShow({
        kind: res.merged > 0 ? 'success' : 'info',
        message: res.merged > 0 ? `${res.merged} tekrar birleştirildi` : 'Birleştirilecek tekrar bulunamadı',
        detail: `${res.people.length} kişi`
      })
    } catch (err) {
      toastShow({ kind: 'error', message: 'Birleştirme başarısız', detail: String(err) })
    } finally {
      setDedupeBusy(false)
    }
  }

  if (!open || !settings) return null

  const set = (patch: Partial<AppSettings>): void => void updateSettings(patch)

  const runDiagnostics = async (): Promise<void> => {
    setDiagBusy(true)
    try {
      setDiag(await window.api.diagnostics())
    } catch (err) {
      toastShow({ kind: 'error', message: 'Tanılama başarısız', detail: String(err) })
    } finally {
      setDiagBusy(false)
    }
  }

  const syncCalendar = async (): Promise<void> => {
    setSyncing(true)
    try {
      const res = await window.api.calendarSync()
      if (res.ok) {
        toastShow({
          kind: 'success',
          message: 'Takvim güncellendi',
          detail: `${res.fetched} etkinlik bulundu • ${res.upcoming} yaklaşan`
        })
      } else {
        toastShow({ kind: 'error', message: 'Takvim alınamadı', detail: res.error })
      }
      await loadCalendarEvents()
    } finally {
      setSyncing(false)
    }
  }

  const pickIcs = async (): Promise<void> => {
    const file = await window.api.pickIcs()
    if (file) {
      await updateSettings({ calendar_source: file })
      void syncCalendar()
    }
  }

  const apps = settings.allowed_apps ?? []

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#1f1e1c]/25 p-6">
      <div className="flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-pop">
        {/* baslik */}
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Ayarlar</h2>
            <p className="mt-0.5 text-[12px] text-faint">
              Tek kullanıcı için yerel ayarlar — hesap, ekip veya bulut yok.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={() => openSettings(false)}>
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* --- OTOMATIK BASLATMA --- */}
          <Section
            icon={<Sparkles size={16} />}
            title="Otomatik başlatma"
            hint="Toplantı başladığında not otomatik açılır, bildirim ile Duraklat / İptal edebilirsin."
          >
            <Row
              label="Takvim tetiklemesi"
              hint="Etkinlik saatinde otomatik başlat. Varsayılan: sadece katılımcılı toplantılar."
            >
              <select
                value={settings.auto_start_calendar}
                onChange={(e) => set({ auto_start_calendar: e.target.value as AppSettings['auto_start_calendar'] })}
                className="rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
              >
                <option value="participants">Sadece katılımcılı toplantılar</option>
                <option value="all">Tüm etkinlikler</option>
                <option value="off">Kapalı</option>
              </select>
            </Row>

            <Row
              label="Arama tetiklemesi (mikrofon)"
              hint="Başka bir uygulama mikrofonu kullanmaya başlarsa otomatik aç."
            >
              <Switch checked={settings.auto_start_call} onChange={(v) => set({ auto_start_call: v })} />
            </Row>

            <Row
              label="Uygulama tetiklemesi"
              hint="Bilinen toplantı uygulaması açıldığında otomatik başlat."
            >
              <Switch checked={settings.auto_start_apps} onChange={(v) => set({ auto_start_apps: v })} />
            </Row>

            <Row label="Otomatik kayıtta sistem sesini de yakala" hint="Karşı tarafı gri balonda yazıya döker.">
              <Switch
                checked={settings.record_system_audio}
                onChange={(v) => set({ record_system_audio: v })}
              />
            </Row>
          </Section>

          {/* --- IZIN LISTESI --- */}
          <Section
            icon={<Shield size={16} />}
            title="İzin verilen uygulamalar"
            hint="Mikrofonu kullanan uygulama bu listede değilse otomatik başlatma YAPILMAZ."
          >
            <div className="mb-2 flex flex-wrap gap-1.5">
              {apps.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 rounded-full bg-pill py-1 pl-2.5 pr-1.5 text-[12px] text-inkSoft">
                  {a}
                  <button
                    type="button"
                    title="Listeden çıkar"
                    onClick={() => set({ allowed_apps: apps.filter((x) => x !== a) })}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-faint hover:bg-white hover:text-ink"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {apps.length === 0 && <p className="text-[12px] text-faint">Liste boş — otomatik başlatma yapılmaz.</p>}
            </div>
            <div className="flex gap-2">
              <input
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newApp.trim()) {
                    set({ allowed_apps: [...apps, newApp.trim()] })
                    setNewApp('')
                  }
                }}
                placeholder="Uygulama adı ekle (ör. Zoom)"
                className="flex-1 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-faint"
              />
              <button
                type="button"
                disabled={!newApp.trim()}
                onClick={() => {
                  set({ allowed_apps: [...apps, newApp.trim()] })
                  setNewApp('')
                }}
                className="rounded-lg border border-hairline px-3 py-2 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
              >
                Ekle
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {APP_SUGGESTIONS.filter((s) => !apps.includes(s)).slice(0, 5).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set({ allowed_apps: [...apps, s] })}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11.5px] text-muted hover:bg-pill hover:text-ink"
                >
                  + {s}
                </button>
              ))}
            </div>
          </Section>

          {/* --- TAKVIM --- */}
          <Section
            icon={<Languages size={16} />}
            title="Takvim (salt okunur)"
            hint="ICS bağlantısı veya yerel .ics dosyası. OAuth kurulumu gerekmez."
          >
            <div className="flex gap-2">
              <input
                value={settings.calendar_source}
                onChange={(e) => set({ calendar_source: e.target.value })}
                placeholder="https://... .ics  veya  C:\...\takvim.ics"
                className="flex-1 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-faint"
              />
              <button
                type="button"
                onClick={() => void pickIcs()}
                className="rounded-lg border border-hairline px-3 py-2 text-[12.5px] font-medium text-inkSoft hover:bg-pill"
              >
                Dosya seç
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={syncing || !settings.calendar_source}
                onClick={() => void syncCalendar()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primaryHover disabled:opacity-40"
              >
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Şimdi güncelle
              </button>
              <span className="text-[11.5px] text-faint">
                {settings.calendar_sync_minutes} dk'da bir otomatik güncellenir
              </span>
            </div>
            <div className="mt-2">
              <label className="text-[12px] text-muted">Senkron aralığı (dakika)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={settings.calendar_sync_minutes}
                onChange={(e) => set({ calendar_sync_minutes: Number(e.target.value) || 15 })}
                className="ml-2 w-20 rounded-lg border border-hairline bg-canvas px-2 py-1 text-[12.5px] outline-none"
              />
            </div>
            <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[11.5px] leading-relaxed text-faint">
              <strong className="font-semibold text-inkSoft">Nasıl alınır:</strong> Google Takvim →
              Takvimin ayarları → <em>Gizli adres (iCal biçiminde)</em>. Outlook/Office 365 →
              Takvimi yayımla → ICS bağlantısı. İkisi de salt okunurdur.
            </p>
          </Section>

          {/* --- DURMA KURALLARI --- */}
          <Section
            icon={<AlertTriangle size={16} />}
            title="Durdurma ve yanlış tetikleme koruması"
            hint="Sadece otomatik başlayan kayıtlara uygulanır; elle başlattığın kayıt sen durdurana kadar sürer."
          >
            <Row label="İlk saniyelerde ses yoksa iptal et" hint="Boş not silinir.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={settings.auto_cancel_empty_seconds}
                  onChange={(e) => set({ auto_cancel_empty_seconds: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-hairline bg-canvas px-2 py-1 text-[12.5px] outline-none"
                />
                <span className="text-[12px] text-faint">sn</span>
              </div>
            </Row>
            <Row label="Sessizlikte durdur" hint="0 = kapalı. Bu süre boyunca hiç konuşma olmazsa kayıt biter.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={1800}
                  value={settings.auto_stop_silence_seconds}
                  onChange={(e) => set({ auto_stop_silence_seconds: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-hairline bg-canvas px-2 py-1 text-[12.5px] outline-none"
                />
                <span className="text-[12px] text-faint">sn</span>
              </div>
            </Row>
            <Row label="Toplantı uygulaması kapanınca durdur" hint="Zoom/Teams kapanır ya da görüşme biterse.">
              <Switch
                checked={settings.auto_stop_on_app_close}
                onChange={(v) => set({ auto_stop_on_app_close: v })}
              />
            </Row>
            <Row label="Tekrar tetikleme bekleme süresi" hint="Aynı uygulama için arka arkaya kayıt açılmasını önler.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={settings.trigger_cooldown_seconds}
                  onChange={(e) => set({ trigger_cooldown_seconds: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-hairline bg-canvas px-2 py-1 text-[12.5px] outline-none"
                />
                <span className="text-[12px] text-faint">sn</span>
              </div>
            </Row>
          </Section>

          {/* --- LLM ZENGINLESTIRME (FAZ 4) --- */}
          <Section
            icon={<Sparkles size={16} />}
            title="AI not üretimi (LLM)"
            hint="Ham notların + transkript + takvim bağlamı bu modele gönderilir."
          >
            <div className="mb-3">
              <label className="mb-1.5 block text-[12px] text-muted">Sağlayıcı</label>
              <select
                value={settings.llm_provider}
                onChange={(e) => {
                  set({ llm_provider: e.target.value, llm_model: '' })
                  void loadModels(e.target.value)
                }}
                className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] text-ink outline-none"
              >
                {llmProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.requiresApiKey ? (p.hasApiKey ? ' — anahtar tanımlı' : ' — anahtar YOK') : ''}
                  </option>
                ))}
              </select>
              {/* ---------------------------------------------------------------
                  API ANAHTARI — asil cozum:
                  Kurulu .exe, proje kokundeki .env dosyasini goremiyordu; bu yuzden
                  anahtar girisi arayuze tasindi. Anahtar yerel veritabanina yazilir
                  ve .env'den ONCE okunur.
                  --------------------------------------------------------------- */}
              {activeProvider?.requiresApiKey && (
                <div className="mt-3 rounded-xl border border-hairline bg-canvas p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="text-[12px] font-medium text-inkSoft">API anahtarı</label>
                    {activeProvider.hasApiKey ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-liveInk">
                        <Check size={11} /> kayıtlı
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-700">eksik</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => {
                        setKeyDraft(e.target.value)
                        setKeyMsg(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveKey()
                      }}
                      placeholder={activeProvider.hasApiKey ? '•••••••• (değiştirmek için yaz)' : 'gsk_... yapıştır'}
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-faint"
                    />
                    <button
                      type="button"
                      disabled={keyBusy || !keyDraft.trim()}
                      onClick={() => void saveKey()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primaryHover disabled:opacity-40"
                    >
                      {keyBusy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                      Kaydet
                    </button>
                    <button
                      type="button"
                      disabled={keyBusy || !activeProvider.hasApiKey}
                      onClick={() => void testKey()}
                      title="Sağlayıcıya sorarak doğrula"
                      className="shrink-0 rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
                    >
                      Doğrula
                    </button>
                  </div>
                  {activeProvider.hasApiKey && (
                    <p className="mt-1.5 font-mono text-[11px] text-faint">
                      {activeProvider.maskedKey}
                      {activeProvider.keySource === 'env' && ' — kaynak: .env dosyası'}
                      {activeProvider.keySource === 'settings' && ' — kaynak: bu ekrandan girildi'}
                    </p>
                  )}
                  {keyMsg && (
                    <p
                      className={
                        'mt-1.5 text-[11.5px] leading-relaxed ' +
                        (keyMsg.ok ? 'text-liveInk' : 'text-amber-700')
                      }
                    >
                      {keyMsg.text}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                    Anahtar yalnızca bu bilgisayarda, yerel veritabanında saklanır. <code className="font-mono">.env</code>{' '}
                    dosyası kullanmana gerek yok.
                  </p>
                </div>
              )}
            </div>

            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[12px] text-muted">Model</label>
                <button
                  type="button"
                  onClick={() => void loadModels(settings.llm_provider)}
                  disabled={modelsBusy}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-ink disabled:opacity-40"
                >
                  {modelsBusy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Sağlayıcıdan çek
                </button>
              </div>
              <input
                value={settings.llm_model}
                onChange={(e) => set({ llm_model: e.target.value })}
                list="llm-model-list"
                placeholder={activeProvider?.defaultModel ?? 'model adı'}
                className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-faint"
              />
              <datalist id="llm-model-list">
                {(models.length > 0 ? models : (activeProvider?.suggestedModels ?? [])).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {modelsError && (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-700">{modelsError}</p>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Boş bırakılırsa varsayılan: <code className="font-mono">{activeProvider?.defaultModel}</code>
              </p>
            </div>

            <Row
              label="Kayıt bitince otomatik zenginleştir"
              hint="Kayıt durunca not kendiliğinden üretilir; “Notun hazır” bildirimi çıkar."
            >
              <Switch checked={settings.auto_enhance} onChange={(v) => set({ auto_enhance: v })} />
            </Row>
          </Section>

          {/* --- TRANSKRIPSYON (STT) --- */}
          <Section
            icon={<Mic size={16} />}
            title="Transkripsiyon (STT)"
            hint="Ses → yazı. Hem canlı kayıt hem dosya içe aktarma bu ayarları kullanır."
          >
            <Row label="Sağlayıcı">
              <select
                value={settings.stt_provider}
                onChange={(e) => set({ stt_provider: e.target.value })}
                className="rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
              >
                {sttProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Model" hint="whisper-large-v3-turbo hızlı ve çok dilli.">
              <input
                value={settings.stt_model}
                onChange={(e) => set({ stt_model: e.target.value })}
                className="w-[230px] rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-faint"
              />
            </Row>
            <Row label="Dil" hint="Otomatik algıla çok dilli geçişi destekler.">
              <select
                value={settings.language}
                onChange={(e) => set({ language: e.target.value })}
                className="rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Row>
            <div className="mt-3">
              <label className="mb-1.5 block text-[12px] text-muted">
                Transkripsiyon ipucu (özel isim / terim / argo)
              </label>
              <textarea
                value={settings.stt_prompt}
                onChange={(e) => set({ stt_prompt: e.target.value })}
                rows={3}
                placeholder="Ör. Amk, siktir, Groq, Whisper. Küfür ve argo aynen yazılır, sansürlenmez."
                className="w-full resize-y rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-faint"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Whisper'a ipucu olarak verilir: özel isimler ve terimler baştan doğru yazılır, sansür
                uygulanmaz. Jargon sözlüğündeki terimler de otomatik eklenir.
              </p>
            </div>
          </Section>

          {/* --- DIZIN (FAZ 5) --- */}
          <Section
            icon={<Users size={16} />}
            title="Kişiler & Şirketler dizini"
            hint="Notlardan otomatik çıkarılır. Her kayıt, geçtiği cümleyi (delil) saklar."
          >
            <div className="mb-3 grid grid-cols-3 gap-2">
              {(
                [
                  { label: 'Kişi', value: directory.people.length },
                  { label: 'Şirket', value: directory.companies.length },
                  { label: 'Etiket', value: directory.tags.length }
                ] as const
              ).map((x) => (
                <div key={x.label} className="rounded-lg border border-hairline bg-canvas px-3 py-2.5">
                  <p className="text-[18px] font-semibold tabular-nums text-ink">{x.value}</p>
                  <p className="text-[11px] text-faint">{x.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={dedupeBusy}
                onClick={() => void runDedupe()}
                className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
              >
                {dedupeBusy ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />}
                Tekrarları birleştir
              </button>
              <button
                type="button"
                onClick={() => {
                  openSettings(false)
                  setView({ kind: 'people' })
                }}
                className="rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill"
              >
                Dizini aç
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Bir toplantıda kişi hem kısa adıyla (“Sarah”) hem tam adıyla (“Sarah Jones”) geçebilir.
              “Tekrarları birleştir”, <strong>aynı notta birlikte geçen</strong> benzer kayıtları ve aynı
              e-posta/alan adına sahip kayıtları tek kayda indirir. Farklı notlardaki benzer adlar yanlış
              birleşmeyi önlemek için birleştirilmez.
            </p>
          </Section>

          {/* --- GUVENLIK (FAZ 7) --- */}
          <Section
            icon={<Lock size={16} />}
            title="Güvenlik ve veri"
            hint="Veritabanı SQLCipher ile şifrelenebilir; anahtar Windows DPAPI ile korunur."
          >
            <Row
              label="Veritabanını şifrele (SQLCipher)"
              hint="Anahtar, Windows hesabına bağlı olarak saklanır. Başka kullanıcı dosyayı kopyalasa bile açamaz."
            >
              {security?.encrypted ? (
                <button
                  type="button"
                  disabled={secBusy}
                  onClick={() => void toggleEncryption(false)}
                  className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
                >
                  {secBusy ? <Loader2 size={13} className="animate-spin" /> : <Unlock size={13} />}
                  Şifrelemeyi kaldır
                </button>
              ) : (
                <button
                  type="button"
                  disabled={secBusy || !security?.encryptionAvailable}
                  onClick={() => void toggleEncryption(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primaryHover disabled:opacity-40"
                >
                  {secBusy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                  Şifrelemeyi aç
                </button>
              )}
            </Row>

            <div className="mt-2 space-y-1.5 rounded-lg bg-canvas px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
              <p>
                Durum:{' '}
                {security?.encrypted ? (
                  <span className="font-semibold text-liveInk">şifreli (SQLCipher)</span>
                ) : (
                  <span className="font-semibold text-inkSoft">şifresiz</span>
                )}
                {security && !security.consistent && (
                  <span className="ml-1.5 text-amber-700">
                    — tutarsızlık: anahtar dosyası ile veritabanı uyuşmuyor
                  </span>
                )}
              </p>
              <p>
                Dosya: <code className="font-mono">{((security?.dbSizeBytes ?? 0) / 1024) | 0} KB</code>
                {security?.fileIsPlaintext && !security.encrypted ? ' • düz metin' : ''}
              </p>
              <p>Ham ses hiçbir zaman kalıcı saklanmaz; yalnızca transkript tutulur.</p>
              {security?.encrypted && (security.plaintextBackupCount ?? 0) > 0 && (
                <p className="text-amber-700">
                  Uyarı: {security.plaintextBackupCount} yedek dosyası hâlâ düz metin. Bunlar tüm not
                  arşivinin okunabilir kopyasıdır; şifrelemeyi kapatıp yeniden açarak temizleyebilirsin.
                </p>
              )}
              <p>
                Yedekler: {security?.backups.length ?? 0} dosya
                {security?.encrypted ? ' (şifrelenmiş)' : ' (düz metin)'}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={secBusy}
                onClick={() => void doBackup()}
                className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
              >
                <HardDrive size={13} />
                Yedek al
              </button>
              <span className="text-[11px] text-faint">
                {security?.backups.length ?? 0} yedek • en yeni:{' '}
                {security?.backups[0]
                  ? new Date(security.backups[0].createdAt).toLocaleString('tr-TR')
                  : '—'}
              </span>
            </div>
          </Section>

          {/* --- JARGON (FAZ 7) --- */}
          <Section
            icon={<BookOpen size={16} />}
            title="Jargon sözlüğü"
            hint="Özel isim ve terimlerin doğru yazımı. Hem Whisper'a ipucu olarak verilir hem transkript düzeltilir."
          >
            <Row label="Jargon düzeltmesini uygula" hint="Kapatırsan yalnızca ham transkript saklanır.">
              <Switch checked={settings.jargon_enabled} onChange={(v) => set({ jargon_enabled: v })} />
            </Row>

            <div className="mt-2 space-y-1">
              {jargon.map((j) => (
                <div key={j.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1.5">
                  <Switch
                    checked={j.enabled}
                    onChange={(v) =>
                      void window.api
                        .jargonSave({
                          id: j.id,
                          term: j.term,
                          replacement: j.replacement,
                          note: j.note,
                          enabled: v
                        })
                        .then(() => loadJargon())
                    }
                  />
                  <code className="text-[12px] text-inkSoft">{j.term}</code>
                  <span className="text-faint">→</span>
                  <code className="text-[12px] font-medium text-ink">{j.replacement || '(sil)'}</code>
                  <span className="ml-auto text-[10.5px] text-faint">{j.hit_count} kez</span>
                  <button
                    type="button"
                    title="Sil"
                    onClick={() => void window.api.jargonDelete(j.id).then(() => loadJargon())}
                    className="rounded p-0.5 text-faint hover:bg-white hover:text-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {jargon.length === 0 && <p className="text-[11.5px] text-faint">Henüz kural yok.</p>}
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={newJargon.term}
                onChange={(e) => setNewJargon({ ...newJargon, term: e.target.value })}
                placeholder="yanlış yazım (ör. grog)"
                className="flex-1 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-faint"
              />
              <span className="self-center text-faint">→</span>
              <input
                value={newJargon.replacement}
                onChange={(e) => setNewJargon({ ...newJargon, replacement: e.target.value })}
                placeholder="doğru (ör. Groq)"
                className="flex-1 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-faint"
              />
              <button
                type="button"
                disabled={!newJargon.term.trim()}
                onClick={() => {
                  void window.api
                    .jargonSave({ term: newJargon.term, replacement: newJargon.replacement })
                    .then(() => {
                      setNewJargon({ term: '', replacement: '' })
                      void loadJargon()
                    })
                }}
                className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
              >
                Ekle
              </button>
            </div>
          </Section>

          {/* --- DISA AKTARMA (FAZ 7) --- */}
          <Section
            icon={<Download size={16} />}
            title="Dışa aktarma"
            hint="Notlarını Markdown, JSON veya CSV olarak kaydet. Obsidian/Notion için not başına ayrı dosya."
          >
            <Row label="Hedef klasör">
              <div className="flex items-center gap-2">
                <code className="max-w-[220px] truncate rounded bg-canvas px-2 py-1 text-[11px] text-inkSoft">
                  {settings.export_dir || '(seçilmedi)'}
                </code>
                <button
                  type="button"
                  onClick={() => void pickExportDir()}
                  className="rounded-lg border border-hairline px-2.5 py-1.5 text-[12px] font-medium text-inkSoft hover:bg-pill"
                >
                  Seç
                </button>
              </div>
            </Row>
            <Row label="Transkriptleri de aktar" hint="Kapatırsan yalnızca ham not + AI notu yazılır.">
              <Switch checked={exportIncludeTranscripts} onChange={setExportIncludeTranscripts} />
            </Row>
            <Row
              label="Not başına ayrı dosya"
              hint="Obsidian/Notion için önerilir (ayrıca bir indeks dosyası yazılır)."
            >
              <Switch checked={exportSplit} onChange={setExportSplit} />
            </Row>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  { f: 'markdown' as const, label: 'Markdown', icon: <FileText size={13} /> },
                  { f: 'json' as const, label: 'JSON', icon: <Braces size={13} /> },
                  { f: 'csv' as const, label: 'CSV', icon: <Table size={13} /> }
                ] as const
              ).map((x) => (
                <button
                  key={x.f}
                  type="button"
                  disabled={exportBusy || !settings.export_dir}
                  onClick={() => void doExport(x.f)}
                  className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
                >
                  {exportBusy ? <Loader2 size={12} className="animate-spin" /> : x.icon}
                  {x.label}
                </button>
              ))}
            </div>
            {exportLast && (
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Son aktarma: {exportLast.noteCount} not • {exportLast.files.length} dosya •{' '}
                {(exportLast.bytes / 1024).toFixed(0)} KB →{' '}
                <code className="font-mono">{exportLast.targetDir}</code>
              </p>
            )}
          </Section>

          {/* --- SAKLAMA + TEHLIKE (FAZ 7) --- */}
          <Section
            icon={<AlertTriangle size={16} />}
            title="Saklama süresi ve veri silme"
            hint="Saklama süresi 0 ise notlar süresiz saklanır. Silme işlemlerinde önce otomatik yedek alınır."
          >
            <Row label="Saklama süresi" hint="Bu süreden eski notlar temizlik sırasında silinir.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={settings.retention_days}
                  onChange={(e) => set({ retention_days: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-hairline bg-canvas px-2 py-1 text-[12.5px] outline-none"
                />
                <span className="text-[12px] text-faint">gün</span>
                <button
                  type="button"
                  disabled={retentionBusy}
                  onClick={() => void doRetention()}
                  className="rounded-lg border border-hairline px-2.5 py-1.5 text-[12px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
                >
                  {retentionBusy ? <Loader2 size={12} className="animate-spin" /> : 'Şimdi uygula'}
                </button>
              </div>
            </Row>
            <Row label="Bildirimler (uygulama içi)">
              <Switch checked={settings.notifications} onChange={(v) => set({ notifications: v })} />
            </Row>
            <Row
              label="İşletim sistemi bildirimleri"
              hint="“Notun hazır” gibi bildirimler Windows bildirim merkezinde görünür."
            >
              <Switch checked={settings.os_notifications} onChange={(v) => set({ os_notifications: v })} />
            </Row>

            <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-red-700">Tüm verilerimi sil</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-red-700/80">
                Notlar, transkriptler, kişiler, etiketler ve sohbetler silinir. Ayarlar ve jargon korunur.
                Silmeden önce yedek alınır.
              </p>
              {confirmDeleteAll ? (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => void doDeleteAll()}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    {deleteBusy ? <Loader2 size={12} className="animate-spin" /> : 'Evet, hepsini sil'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAll(false)}
                    className="rounded-lg px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-100"
                  >
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAll(true)}
                  className="mt-2 inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100"
                >
                  <Trash2 size={12} />
                  Tüm verilerimi sil
                </button>
              )}
            </div>
          </Section>

          {/* --- GIZLILIK --- */}
          <Section icon={<Shield size={16} />} title="Gizlilik">
            <Row
              label="Verilerim model eğitiminde kullanılmasın"
              hint="Kapalı (yani verilerim gönderilmesin) varsayılandır. Buluta yalnızca transkript için ses gider."
            >
              <Switch
                checked={settings.opt_out_training}
                onChange={(v) => set({ opt_out_training: v })}
              />
            </Row>
            <Row label="Bildirimler" hint="Kayıt başladığında / bittiğinde bildirim göster.">
              <Switch checked={settings.notifications} onChange={(v) => set({ notifications: v })} />
            </Row>
            <div className="mt-3 space-y-1.5 rounded-lg bg-canvas px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
              <p>• Ham ses hiçbir zaman kalıcı saklanmaz (yalnızca geçici dosya, işlem sonunda silinir).</p>
              <p>• Tüm notlar yalnızca bu bilgisayarda (%APPDATA%\notlar\db) durur.</p>
              <p>
                • STT sağlayıcısı: <strong className="font-semibold text-inkSoft">{settings.stt_provider}</strong> /{' '}
                {settings.stt_model}
                {hasApiKey ? ' — anahtar tanımlı' : ' — anahtar yok'}
              </p>
            </div>
          </Section>

          {/* --- TESHIS --- */}
          <Section
            icon={<Mic size={16} />}
            title="Tanılama"
            hint="Tetikleme motorunun ne gördüğünü kontrol et."
          >
            <button
              type="button"
              onClick={() => void runDiagnostics()}
              disabled={diagBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
            >
              {diagBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Sistemi tara
            </button>

            {diag && (
              <div className="mt-3 space-y-2 rounded-lg bg-canvas px-3 py-3 text-[11.5px] leading-relaxed">
                <p className="text-inkSoft">
                  <strong className="font-semibold">Sonuç:</strong>{' '}
                  {diag.activeAllowedApps.length > 0 ? (
                    <span className="text-liveInk">
                      İzinli tetikleyici bulundu: {diag.activeAllowedApps.join(', ')}
                    </span>
                  ) : (
                    'Şu an izinli bir tetikleyici yok'
                  )}
                </p>
                <p className="text-faint">
                  Takvim kaynağı: {diag.calendarSource || '(tanımsız)'} • önbellekte{' '}
                  {diag.calendarEventCount} etkinlik
                </p>
                {diag.nextCalendarEvent && (
                  <p className="text-faint">
                    Sıradaki: {diag.nextCalendarEvent.title} —{' '}
                    {new Date(diag.nextCalendarEvent.start_at).toLocaleString('tr-TR')}
                  </p>
                )}
                <p className="text-faint">Başlıklı süreçler: {diag.processes.length}</p>
                <pre className="overflow-x-auto rounded bg-surface p-2 text-[10.5px] leading-relaxed text-faint">
{JSON.stringify(diag.watchdog, null, 1)}
                </pre>
                <button
                  type="button"
                  onClick={() => setShowMicDebug((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-ink"
                >
                  <ChevronDown size={12} className={clsx(showMicDebug && 'rotate-180')} />
                  Mikrofon kullanan uygulamalar ({diag.micUsers.filter((m) => m.active).length} aktif /{' '}
                  {diag.micUsers.length} kayıt)
                </button>
                {showMicDebug && (
                  <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                    {diag.micUsers.slice(0, 25).map((m) => (
                      <p key={m.exePath} className={clsx('truncate', m.active ? 'text-liveInk' : 'text-faint')}>
                        {m.active ? '● ' : '○ '}
                        {m.exePath}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* --- KISAYOLLAR & IPUCLARI --- */}
          <Section icon={<Keyboard size={16} />} title="Kısayollar ve ipuçları">
            <div className="space-y-2 text-[11.5px] leading-relaxed text-inkSoft">
              {(
                [
                  { k: 'Ctrl + Space', d: 'Dikte ile hızlı not (Dikte kuruluysa)' },
                  { k: '/', d: 'Sohbet kutusunda recipe menüsünü açar (ör. /kararlar)' },
                  { k: 'Ctrl + B / I', d: 'Ham not düzenlerken kalın / italik' },
                  { k: 'Enter', d: 'Sohbet kutusunda soruyu gönder' },
                  { k: 'Esc', d: 'Açık menüyü kapat' }
                ] as const
              ).map((r) => (
                <div key={r.k} className="flex items-center gap-2.5">
                  <code className="min-w-[86px] rounded bg-pill px-1.5 py-[2px] text-center font-mono text-[11px] text-inkSoft">
                    {r.k}
                  </code>
                  <span>{r.d}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5 rounded-lg bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-faint">
              <p>
                <strong className="font-semibold text-inkSoft">En temiz kayıt:</strong> mikrofonda karşı
                tarafın sesini duymamak için <strong>kulaklık</strong> kullan.
              </p>
              <p>
                <strong className="font-semibold text-inkSoft">Otomatik kayıt:</strong> takvim etkinliği
                başlarken ya da izin listesindeki bir uygulama mikrofonu kullanmaya başladığında not kendi
                açılır; bildirimden Duraklat/Durdur/İptal edebilirsin.
              </p>
              <p>
                <strong className="font-semibold text-inkSoft">Verilerin:</strong> her şey bu bilgisayarda
                (%APPDATA%
otlar). Buluta yalnızca transkript için ses gider; ham ses saklanmaz.
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-hairlineSoft pt-2.5">
              <span className="text-[11px] text-faint">
                Notlar {appVersion ? `v${appVersion}` : ''} • STT: {settings.stt_provider} /{' '}
                {settings.stt_model}
              </span>
              <span className="text-[11px] text-faint">
                {hasApiKey ? 'API anahtarı hazır' : 'API anahtarı bekleniyor'}
              </span>
            </div>
          </Section>
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-6 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-faint">
            <CheckCircle2 size={13} className="text-live" />
            Değişiklikler anında kaydedilir
          </span>
          <button
            type="button"
            onClick={() => openSettings(false)}
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primaryHover"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  )
}