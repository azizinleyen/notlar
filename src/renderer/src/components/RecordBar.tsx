import { useEffect, useState } from 'react'
import { Mic, Pause, Play, Square, X } from 'lucide-react'
import clsx from 'clsx'
import type { Channel } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { getRecorder } from '../lib/recorder'
import { fmtClock } from '../lib/format'

/** Iki kanal icin kucuk seviye metresi */
function LevelMeter({ label, level, tone }: { label: string; level: number; tone: 'live' | 'gray' }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="flex h-3 w-[46px] items-center gap-[2px] overflow-hidden rounded-full bg-pill px-[3px]">
        <span
          className={clsx('h-[7px] rounded-full transition-[width] duration-150', tone === 'live' ? 'bg-live' : 'bg-[#a9a6a0]')}
          style={{ width: `${Math.max(3, Math.round(level * 40))}px` }}
        />
      </span>
    </span>
  )
}

export default function RecordBar() {
  const recording = useAppStore((s) => s.recording)
  const pauseRecording = useAppStore((s) => s.pauseRecording)
  const resumeRecording = useAppStore((s) => s.resumeRecording)
  const stopRecording = useAppStore((s) => s.stopRecording)
  const cancelRecording = useAppStore((s) => s.cancelRecording)
  const selectNote = useAppStore((s) => s.selectNote)

  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<Record<Channel, number>>({ mic: 0, system: 0 })
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!recording.active) return
    const id = window.setInterval(() => {
      const rec = getRecorder()
      setElapsed(rec.elapsedMs())
      if (!recording.external) setLevels(rec.levels())
    }, 150)
    return () => window.clearInterval(id)
  }, [recording.active, recording.external])

  if (!recording.active) return null

  const hasMic = recording.channels.includes('mic')
  const hasSystem = recording.channels.includes('system')

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-2.5 shadow-pop">
        <span className="inline-flex items-center gap-2">
          <span
            className={clsx(
              'h-[8px] w-[8px] rounded-full',
              recording.paused ? 'bg-amber-400' : 'live-dot bg-live'
            )}
          />
          <span className="text-[13px] font-semibold tabular-nums text-ink">
            {fmtClock(elapsed)}
          </span>
        </span>

        <span className="h-5 w-px bg-hairline" />

        {recording.external ? (
          <span className="text-[12px] text-inkSoft">
            Harici kayıt sürüyor (simülasyon) — satırlar canlı akıyor
          </span>
        ) : recording.paused ? (
          <span className="text-[12px] text-amber-700">Duraklatıldı</span>
        ) : (
          <span className="flex items-center gap-3">
            {hasMic && <LevelMeter label="Ben" level={levels.mic} tone="live" />}
            {hasSystem && <LevelMeter label="Karşı taraf" level={levels.system} tone="gray" />}
          </span>
        )}

        {recording.chunkErrors > 0 && (
          <span className="chip text-red-600">{recording.chunkErrors} parça hatası</span>
        )}

        {!recording.external && (
          <>
            <span className="h-5 w-px bg-hairline" />
            <button
              type="button"
              onClick={() => (recording.paused ? resumeRecording() : pauseRecording())}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-inkSoft transition-colors hover:bg-pill hover:text-ink"
            >
              {recording.paused ? <Play size={14} /> : <Pause size={14} />}
              {recording.paused ? 'Devam' : 'Duraklat'}
            </button>
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primaryHover"
            >
              <Square size={13} />
              Durdur
            </button>
            {confirming ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false)
                    void cancelRecording()
                  }}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-red-700"
                >
                  İptal et
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg px-2 py-1.5 text-[12px] text-muted hover:bg-pill"
                >
                  Vazgeç
                </button>
              </span>
            ) : (
              <button
                type="button"
                title="Kaydı iptal et (boşsa not silinir)"
                onClick={() => setConfirming(true)}
                className="icon-btn h-7 w-7"
              >
                <X size={15} />
              </button>
            )}
          </>
        )}

        <button
          type="button"
          title="Kayan nota git"
          onClick={() => recording.noteId && void selectNote(recording.noteId)}
          className="icon-btn h-7 w-7"
        >
          <Mic size={14} />
        </button>
      </div>
    </div>
  )
}