import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Mic, MonitorSpeaker, X } from 'lucide-react'
import clsx from 'clsx'
import type { MediaDeviceInfoLite } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { ensureMicPermission, listAudioInputs } from '../lib/media'
import { Switch } from './primitives'

const LANGUAGES = [
  { code: 'auto', label: 'Otomatik algıla' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'İngilizce' },
  { code: 'de', label: 'Almanca' },
  { code: 'fr', label: 'Fransızca' },
  { code: 'es', label: 'İspanyolca' }
]

function defaultTitle(): string {
  const now = new Date()
  const t = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return `Canlı kayıt — ${t}`
}

export default function RecordDialog() {
  const open = useAppStore((s) => s.recordOpen)
  const openRecord = useAppStore((s) => s.openRecord)
  const startRecording = useAppStore((s) => s.startRecording)
  const hasApiKey = useAppStore((s) => s.hasApiKey)
  const settings = useAppStore((s) => s.settings)
  const busy = useAppStore((s) => s.recording.active)

  const [title, setTitle] = useState(defaultTitle())
  const [language, setLanguage] = useState(settings?.language ?? 'auto')
  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [micEnabled, setMicEnabled] = useState(true)
  const [systemEnabled, setSystemEnabled] = useState(true)
  const [starting, setStarting] = useState(false)
  const [permissionNote, setPermissionNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle())
    setLanguage(settings?.language ?? 'auto')
    setStarting(false)

    let alive = true
    void (async () => {
      const ok = await ensureMicPermission()
      if (!alive) return
      if (!ok) {
        setPermissionNote('Mikrofon izni verilmedi. Sistem sesiyle kayıt yapabilirsin.')
        setMicEnabled(false)
      } else {
        setPermissionNote(null)
      }
      try {
        const list = await listAudioInputs()
        if (!alive) return
        setDevices(list)
        setDeviceId((prev) => prev || list[0]?.deviceId || '')
      } catch {
        /* yoksay */
      }
    })()
    return () => {
      alive = false
    }
  }, [open, settings?.language])

  if (!open) return null

  const run = async (): Promise<void> => {
    setStarting(true)
    await startRecording({
      title,
      language,
      micDeviceId: deviceId || undefined,
      micEnabled,
      systemEnabled
    })
    setStarting(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#1f1e1c]/25 p-6">
      <div className="w-full max-w-[540px] rounded-2xl border border-hairline bg-surface p-6 shadow-pop">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Canlı kayıt başlat</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
              Mikrofon <span className="text-inkSoft">seni</span> (yeşil), sistem sesi{' '}
              <span className="text-inkSoft">karşı tarafı</span> (gri) ayrı kanallara yazar. Ham ses
              saklanmaz.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={() => openRecord(false)} disabled={starting}>
            <X size={17} />
          </button>
        </div>

        {/* baslik */}
        <div className="mb-4">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Başlık</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint"
          />
        </div>

        {/* kaynaklar */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div
            className={clsx(
              'rounded-xl border px-3.5 py-3',
              micEnabled ? 'border-ink bg-canvas' : 'border-hairline bg-surface'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink">
                <Mic size={15} className="text-live" />
                Mikrofon
              </span>
              <Switch checked={micEnabled} onChange={setMicEnabled} disabled={starting} />
            </div>
            <p className="mt-1 text-[11.5px] text-faint">Yeşil balon, sağda — “Ben”</p>
            {micEnabled && devices.length > 0 && (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                disabled={starting}
                className="mt-2 w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink outline-none"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div
            className={clsx(
              'rounded-xl border px-3.5 py-3',
              systemEnabled ? 'border-ink bg-canvas' : 'border-hairline bg-surface'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink">
                <MonitorSpeaker size={15} className="text-[#b9b6ae]" />
                Sistem sesi
              </span>
              <Switch checked={systemEnabled} onChange={setSystemEnabled} disabled={starting} />
            </div>
            <p className="mt-1 text-[11.5px] text-faint">Gri balon, solda — karşı taraf</p>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Windows loopback ile bilgisayardan çıkan ses yakalanır.
            </p>
          </div>
        </div>

        {/* dil */}
        <div className="mb-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Dil</p>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={starting}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {permissionNote && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <AlertTriangle size={15} className="mt-[1px] shrink-0 text-amber-600" />
            <p className="text-[12px] leading-relaxed text-amber-800">{permissionNote}</p>
          </div>
        )}

        {!hasApiKey && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <AlertTriangle size={15} className="mt-[1px] shrink-0 text-amber-600" />
            <p className="text-[12px] leading-relaxed text-amber-800">
              Groq API anahtarı yok; transkript üretilemez. <code className="font-mono">.env</code>{' '}
              dosyasına <code className="font-mono">GROQ_API_KEY</code> ekle.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openRecord(false)}
            disabled={starting}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-muted hover:bg-pill hover:text-ink"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={starting || busy || (!micEnabled && !systemEnabled)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primaryHover disabled:opacity-45"
          >
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
            Kaydı başlat
          </button>
        </div>
      </div>
    </div>
  )
}