import { useState } from 'react'
import { AlertTriangle, FileAudio, Loader2, Upload, X } from 'lucide-react'
import clsx from 'clsx'
import type { Channel } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

const LANGUAGES = [
  { code: 'auto', label: 'Otomatik algıla' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'İngilizce' },
  { code: 'de', label: 'Almanca' },
  { code: 'fr', label: 'Fransızca' },
  { code: 'es', label: 'İspanyolca' }
]

function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

export default function ImportDialog() {
  const open = useAppStore((s) => s.importOpen)
  const openImport = useAppStore((s) => s.openImport)
  const startImport = useAppStore((s) => s.startImport)
  const hasApiKey = useAppStore((s) => s.hasApiKey)
  const settings = useAppStore((s) => s.settings)
  const progress = useAppStore((s) => s.progress)
  const toastShow = useAppStore((s) => s.toastShow)

  const [files, setFiles] = useState<string[]>([])
  const [channel, setChannel] = useState<Channel>('mic')
  const [language, setLanguage] = useState(settings?.language ?? 'auto')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const pick = async (): Promise<void> => {
    const picked = await window.api.pickAudio()
    if (picked.length > 0) setFiles(picked)
  }

  const run = async (): Promise<void> => {
    if (files.length === 0) {
      toastShow({ kind: 'info', message: 'Önce bir ses dosyası seç' })
      return
    }
    if (!hasApiKey) {
      toastShow({
        kind: 'error',
        message: 'API anahtarı yok',
        detail: 'Groq anahtarını .env dosyasına ekleyip uygulamayı yeniden başlat.'
      })
      return
    }
    setBusy(true)
    try {
      for (const f of files) {
        await startImport({ filePath: f, channel, language })
      }
    } finally {
      setBusy(false)
      setFiles([])
    }
  }

  const stageLabel = progress?.message ?? ''

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#1f1e1c]/25 p-6">
      <div className="w-full max-w-[520px] rounded-2xl border border-hairline bg-surface p-6 shadow-pop">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Ses dosyasından içe aktar</h2>
            <p className="mt-1 text-[12.5px] text-faint">
              Dosya yazıya dökülür, transkript notuna kaydedilir; ham ses sunucuda saklanmaz.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={() => openImport(false)} disabled={busy}>
            <X size={17} />
          </button>
        </div>

        {/* dosya secimi */}
        <button
          type="button"
          onClick={() => void pick()}
          disabled={busy}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline bg-canvas px-4 py-3.5 text-left transition-colors hover:border-faint"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pill text-inkSoft">
            <Upload size={17} />
          </span>
          <span className="min-w-0 flex-1">
            {files.length === 0 ? (
              <>
                <span className="block text-[13px] font-medium text-ink">Ses dosyası seç</span>
                <span className="block text-[12px] text-faint">wav, mp3, m4a, flac, ogg — en çok 25 MB</span>
              </>
            ) : (
              <>
                <span className="block truncate text-[13px] font-medium text-ink">
                  {baseName(files[0])}
                  {files.length > 1 ? ` (+${files.length - 1})` : ''}
                </span>
                <span className="block text-[12px] text-faint">{files.length} dosya seçildi</span>
              </>
            )}
          </span>
          <FileAudio size={17} className="shrink-0 text-faint" />
        </button>

        {/* kanal */}
        <div className="mb-4">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Bu ses kimin?</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'mic' as Channel, title: 'Ben (mikrofon)', hint: 'Yeşil balon, sağda' },
                { value: 'system' as Channel, title: 'Karşı taraf (sistem)', hint: 'Gri balon, solda' }
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChannel(opt.value)}
                disabled={busy}
                className={clsx(
                  'rounded-xl border px-3.5 py-3 text-left transition-colors',
                  channel === opt.value
                    ? 'border-ink bg-canvas'
                    : 'border-hairline bg-surface hover:border-faint'
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'h-[7px] w-[7px] rounded-full',
                      opt.value === 'mic' ? 'bg-live' : 'bg-[#b9b6ae]'
                    )}
                  />
                  <span className="text-[13px] font-medium text-ink">{opt.title}</span>
                </span>
                <span className="mt-1 block text-[11.5px] text-faint">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* dil */}
        <div className="mb-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Dil</p>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {!hasApiKey && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <AlertTriangle size={15} className="mt-[1px] shrink-0 text-amber-600" />
            <p className="text-[12px] leading-relaxed text-amber-800">
              Groq API anahtarı bulunamadı. Proje kökündeki <code className="font-mono">.env</code> dosyasına{' '}
              <code className="font-mono">GROQ_API_KEY=...</code> ekleyip uygulamayı yeniden başlat.
            </p>
          </div>
        )}

        {busy && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-hairline bg-canvas px-3.5 py-2.5">
            <Loader2 size={15} className="animate-spin text-inkSoft" />
            <span className="text-[12.5px] text-inkSoft">{stageLabel || 'İşleniyor...'}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openImport(false)}
            disabled={busy}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-muted hover:bg-pill hover:text-ink"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || files.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primaryHover disabled:opacity-45"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Transkripte çevir
          </button>
        </div>
      </div>
    </div>
  )
}