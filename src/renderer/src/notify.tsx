// ============================================================================
//  Bildirim penceresi arayuzu: "Kayit basladi — Duraklat / Iptal"
//  Ayri bir renderer girisi (notify.html) olarak calisir; ana pencereden
//  bagimsiz oldugu icin toplanti sirasinda odak calmaz.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Mic, Pause, Play, Square, X } from 'lucide-react'
import type { NotifyState } from '@shared/types'
import './index.css'

const EMPTY: NotifyState = {
  visible: false,
  noteId: null,
  title: '',
  subtitle: '',
  status: 'recording',
  startedAt: Date.now(),
  tone: 'record'
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Button({
  onClick,
  children,
  tone = 'ghost',
  title
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: 'ghost' | 'primary' | 'danger'
  title?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors'
  const styles =
    tone === 'primary'
      ? 'bg-primary text-white hover:bg-primaryHover px-3 py-1.5'
      : tone === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-700 px-3 py-1.5'
        : 'px-2.5 py-1.5 text-inkSoft hover:bg-pill hover:text-ink'
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}

function NotifyApp() {
  const [state, setState] = useState<NotifyState>(EMPTY)
  const [now, setNow] = useState(Date.now())
  // Duraklatilan sureler toplam sureden cikarilir; boylece bildirimdeki sayac
  // ana penceredeki kayit cubugu ile ayni degeri gosterir.
  const [pausedTotal, setPausedTotal] = useState(0)
  const pausedAt = useRef<number | null>(null)

  useEffect(() => {
    const off = window.notifyApi.onState((s) => setState(s))
    return () => off()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!state.visible) {
      pausedAt.current = null
      setPausedTotal(0)
      return
    }
    if (state.status === 'paused') {
      if (pausedAt.current === null) pausedAt.current = Date.now()
    } else if (pausedAt.current !== null) {
      const span = Date.now() - pausedAt.current
      pausedAt.current = null
      setPausedTotal((t) => t + span)
    }
  }, [state.status, state.visible, state.startedAt])

  if (!state.visible) return null

  const paused = state.status === 'paused'
  const act = (a: string): void => {
    void window.notifyApi.action(a)
  }

  const toneStyles =
    state.tone === 'warn'
      ? 'border-amber-300 bg-amber-50'
      : state.tone === 'info'
        ? 'border-hairline bg-surface'
        : 'border-hairline bg-surface'

  return (
    <div className="p-2">
      <div
        className={`w-full rounded-xl2 border shadow-pop ${toneStyles}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-start gap-3 px-3.5 pb-2.5 pt-3">
          <span
            className={`mt-[3px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              paused ? 'bg-amber-100 text-amber-700' : 'bg-liveSoft text-liveInk'
            }`}
          >
            <Mic size={15} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[13px] font-semibold text-ink">
                {state.title || (paused ? 'Kayıt duraklatıldı' : 'Kayıt başladı')}
              </p>
              {!paused && (
                <span className="live-dot h-[7px] w-[7px] shrink-0 rounded-full bg-live" />
              )}
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-faint">
              {paused ? 'Duraklatıldı' : clock(now - state.startedAt - pausedTotal)}
              {state.subtitle ? ` • ${state.subtitle}` : ''}
            </p>
          </div>

          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              type="button"
              title="Kapat (kayıt sürer)"
              onClick={() => act('open')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-pill hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-1.5 border-t border-hairlineSoft px-3 py-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            onClick={() => act(paused ? 'resume' : 'pause')}
            title={paused ? 'Devam et' : 'Duraklat'}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Devam' : 'Duraklat'}
          </Button>
          <Button onClick={() => act('stop')} tone="primary" title="Kaydı bitir ve notu kaydet">
            <Square size={12} />
            Durdur
          </Button>
          <Button onClick={() => act('cancel')} tone="danger" title="Kaydı iptal et (boşsa not silinir)">
            İptal
          </Button>
        </div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('notify-root') as HTMLElement).render(<NotifyApp />)