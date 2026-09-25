import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Pencil, Search, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { useAppStore } from '../store/useAppStore'
import { fmtClock } from '../lib/format'
import { Switch } from './primitives'

export default function TranscriptPanel() {
  const open = useAppStore((s) => s.transcriptOpen)
  const toggleTranscript = useAppStore((s) => s.toggleTranscript)
  const detail = useAppStore((s) => s.detail)
  const recording = useAppStore((s) => s.recording)
  const liveScroll = useAppStore((s) => s.liveScroll)
  const setLiveScroll = useAppStore((s) => s.setLiveScroll)
  const toastShow = useAppStore((s) => s.toastShow)
  const deleteSegment = useAppStore((s) => s.deleteSegment)
  const relabelSegment = useAppStore((s) => s.relabelSegment)
  const [filter, setFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const segments = detail?.transcripts ?? []
  const count = segments.length

  const visible = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase('tr')
    if (!q) return segments
    return segments.filter((s) => s.text.toLocaleLowerCase('tr').includes(q))
  }, [segments, filter])

  // Canli kayitta yeni satir gelince en alta kaydir
  useEffect(() => {
    if (!open || !liveScroll || filter.trim()) return
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, open, liveScroll, filter])

  if (!open) return null

  const copyAll = (): void => {
    const text = visible
      .map(
        (s) =>
          `[${fmtClock(s.start_ms)}] ${s.speaker_label ?? (s.channel === 'mic' ? 'Ben' : 'Karşı taraf')}: ${s.text}`
      )
      .join('\n')
    void navigator.clipboard.writeText(text)
    toastShow({ kind: 'success', message: 'Transkript kopyalandı' })
  }

  return (
    <div className="slide-in-right flex h-full w-[420px] shrink-0 flex-col border-l border-hairline bg-surface">
      <header className="flex items-center justify-between px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Transkript</h2>
          {recording.active && !recording.paused && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-liveSoft px-2 py-[2px] text-[11px] font-medium text-liveInk">
              <span className="live-dot h-[6px] w-[6px] rounded-full bg-live" />
              canlı
            </span>
          )}
          {recording.paused && <span className="chip">duraklatıldı</span>}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" className="icon-btn" title="Tümünü kopyala" onClick={copyAll}>
            <Copy size={15} />
          </button>
          <button type="button" className="icon-btn" title="Kapat" onClick={() => toggleTranscript(false)}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="px-5 pb-3">
        <label className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-2.5 py-[6px]">
          <Search size={14} className="text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Transkriptte ara..."
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div ref={scroller} className="flex-1 space-y-3.5 overflow-y-auto px-5 py-3">
        {visible.length === 0 ? (
          <p className="pt-6 text-center text-[12.5px] leading-relaxed text-faint">
            {count > 0
              ? 'Aramanızla eşleşen parça yok.'
              : recording.active
                ? 'Konuşma bekleniyor... Sessiz parçalar gönderilmez.'
                : 'Bu notta henüz transkript yok. Canlı kayıt başlat ya da bir ses dosyası içe aktar.'}
          </p>
        ) : (
          visible.map((s) => {
            const mine = s.channel === 'mic'
            return (
              <div
                key={s.id}
                className={clsx('group flex flex-col', mine ? 'items-end' : 'items-start')}
              >
                <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-faint">
                  {editingId === s.id ? (
                    <input
                      autoFocus
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onBlur={() => {
                        void relabelSegment(s.id, labelDraft)
                        setEditingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void relabelSegment(s.id, labelDraft)
                          setEditingId(null)
                        }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-[120px] rounded border border-hairline bg-canvas px-1.5 py-[1px] text-[11px] text-ink outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      title="Konuşmacı etiketini düzenle"
                      onClick={() => {
                        setEditingId(s.id)
                        setLabelDraft(s.speaker_label ?? (mine ? 'Ben' : 'Karşı taraf'))
                      }}
                      className="font-medium text-muted hover:text-ink"
                    >
                      {s.speaker_label ?? (mine ? 'Ben' : 'Karşı taraf')}
                    </button>
                  )}
                  <span className="tabular-nums">{fmtClock(s.start_ms)}</span>
                  <span
                    className={clsx(
                      'h-[6px] w-[6px] rounded-full',
                      mine ? 'bg-live' : 'bg-[#c9c6bf]'
                    )}
                    title={mine ? 'Mikrofon kanalı' : 'Sistem sesi kanalı'}
                  />
                  {/* Parca aksiyonlari: ustune gelince gorunur */}
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      title="Parçayı kopyala"
                      onClick={() => {
                        void navigator.clipboard.writeText(s.text)
                        toastShow({ kind: 'info', message: 'Parça kopyalandı' })
                      }}
                      className="rounded p-0.5 text-faint hover:bg-pill hover:text-ink"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      title="Konuşmacıyı düzenle"
                      onClick={() => {
                        setEditingId(s.id)
                        setLabelDraft(s.speaker_label ?? (mine ? 'Ben' : 'Karşı taraf'))
                      }}
                      className="rounded p-0.5 text-faint hover:bg-pill hover:text-ink"
                    >
                      <Pencil size={11} />
                    </button>
                    {confirmingId === s.id ? (
                      <button
                        type="button"
                        title="Silmeyi onayla"
                        onClick={() => {
                          setConfirmingId(null)
                          void deleteSegment(s.id)
                          toastShow({ kind: 'info', message: 'Parça silindi' })
                        }}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
                      >
                        sil
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Parçayı sil"
                        onClick={() => setConfirmingId(s.id)}
                        className="rounded p-0.5 text-faint hover:bg-pill hover:text-red-600"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </span>
                  {confirmingId === s.id && (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded px-1 text-[10px] text-muted hover:bg-pill"
                    >
                      vazgeç
                    </button>
                  )}
                </div>
                <p
                  className={clsx(
                    'max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-[1.6]',
                    mine
                      ? 'rounded-tr-sm bg-bubbleMic text-ink'
                      : 'rounded-tl-sm bg-bubbleSystem text-inkSoft'
                  )}
                >
                  {s.text}
                </p>
              </div>
            )
          })
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-hairline px-5 py-3">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-inkSoft">
          <span
            className={clsx(
              'inline-flex items-end gap-[2px]',
              recording.active && !recording.paused ? 'text-live' : 'text-faint'
            )}
          >
            <span className="h-2 w-[2.5px] rounded-full bg-current" />
            <span className="h-3.5 w-[2.5px] rounded-full bg-current" />
            <span className="h-2.5 w-[2.5px] rounded-full bg-current" />
          </span>
          {recording.active && !recording.paused ? 'Canlı transkript' : 'Canlı transkript'}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-faint">{count} parça</span>
          <Switch checked={liveScroll} onChange={setLiveScroll} />
        </div>
      </footer>
    </div>
  )
}