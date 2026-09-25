import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  History,
  Link2,
  Loader2,
  MapPin,
  Mic,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { Citation, TranscriptSegment } from '@shared/types'
import { isHtml, plainToHtml, sanitizeHtml } from '@shared/text'
import { useAppStore } from '../store/useAppStore'
import { fmtClock, fmtDateLong, fmtRange } from '../lib/format'
import { Avatar, AvatarStack, EqualizerBars, LiveBadge, Waveform } from './primitives'
import RawNotesEditor from './RawNotesEditor'

// ---------------------------------------------------------------------------
//  Zenginlestirilmis notun ayristirilmasi
//  Bicim sabittir (main/llm/prompt.ts -> payloadToMarkdown): "## Baslik" + "- madde"
// ---------------------------------------------------------------------------

interface EnhancedItem {
  text: string
  /** Bolum icindeki 1 tabanli sira (buyutec eslesmesi icin) */
  index: number
  /** "Baslik#index" -> kaynaklar */
  citations: Citation[]
}

interface EnhancedSection {
  heading: string
  items: EnhancedItem[]
  citationCount: number
}

function parseEnhanced(md: string, citations: Citation[]): EnhancedSection[] {
  const byRef = new Map<string, Citation[]>()
  for (const c of citations) {
    const list = byRef.get(c.sentence_ref) ?? []
    list.push(c)
    byRef.set(c.sentence_ref, list)
  }

  const sections: EnhancedSection[] = []
  let current: { heading: string; items: string[] } | null = null

  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      if (current) sections.push(finish(current))
      current = { heading: line.replace(/^#+\s*/, ''), items: [] }
      continue
    }
    if (!current) current = { heading: 'Özet', items: [] }
    current.items.push(line.replace(/^([-*•]|\d+\.)\s*/, '').trim())
  }
  if (current) sections.push(finish(current))

  function finish(sec: { heading: string; items: string[] }): EnhancedSection {
    const items: EnhancedItem[] = sec.items.map((text, i) => {
      const ref = `${sec.heading}#${i + 1}`
      return { text, index: i + 1, citations: byRef.get(ref) ?? [] }
    })
    return {
      heading: sec.heading,
      items,
      citationCount: items.reduce((n, it) => n + it.citations.length, 0)
    }
  }

  return sections
}

const SOURCE_LABEL: Record<Citation['source_type'], string> = {
  transcript: 'transkript',
  raw_note: 'ham not',
  calendar: 'takvim'
}

/** Buyutec: bir maddenin kaynagini gosterir (izlenebilirlik). */
function SourcePopover({
  citations,
  transcripts,
  open,
  onToggle
}: {
  citations: Citation[]
  transcripts: TranscriptSegment[]
  open: boolean
  onToggle: () => void
}) {
  const has = citations.length > 0
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={!has}
        title={has ? 'Kaynağı göster' : 'Bu madde için kaynak verilmedi'}
        className={clsx(
          'mt-[2px] inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-md transition-colors',
          has ? 'text-muted hover:bg-pill hover:text-ink' : 'cursor-default text-hairline'
        )}
      >
        <Search size={13} />
      </button>
      {open && has && (
        <ul className="mt-1.5 space-y-1.5 rounded-lg border border-hairline bg-surface p-2.5">
          {citations.map((c) => {
            const seg = c.source_id ? transcripts.find((t) => t.id === c.source_id) : undefined
            return (
              <li key={c.id} className="text-[12px] leading-relaxed text-inkSoft">
                <span className="mr-1.5 inline-flex items-center gap-1 rounded bg-pill px-1.5 py-[1px] text-[10px] uppercase tracking-wide text-faint">
                  {SOURCE_LABEL[c.source_type]}
                  {seg && (
                    <span className={clsx('font-medium', seg.channel === 'mic' ? 'text-liveInk' : 'text-muted')}>
                      {seg.channel === 'mic' ? 'mikrofon' : 'sistem'} {fmtClock(seg.start_ms)}
                    </span>
                  )}
                </span>
                {c.excerpt}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function EnhancedSectionCard({
  section,
  transcripts
}: {
  section: EnhancedSection
  transcripts: TranscriptSegment[]
}) {
  const [openRef, setOpenRef] = useState<string | null>(null)
  return (
    <section className="mb-5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="rounded-md bg-pill px-2.5 py-[3px] text-[12.5px] font-semibold text-inkSoft">
          {section.heading}
        </span>
        {section.citationCount > 0 ? (
          <span className="text-[11px] text-faint">{section.citationCount} kaynak</span>
        ) : (
          <span className="text-[11px] text-faint">kaynak yok</span>
        )}
      </div>
      <ul className="space-y-[7px]">
        {section.items.map((item) => {
          const key = `${section.heading}#${item.index}`
          return (
            <li key={key} className="flex gap-2">
              <SourcePopover
                citations={item.citations}
                transcripts={transcripts}
                open={openRef === key}
                onToggle={() => setOpenRef(openRef === key ? null : key)}
              />
              <span className="flex-1 text-[13.5px] leading-[1.65] text-inkSoft">{item.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------

export default function NoteEditor() {
  const detail = useAppStore((s) => s.detail)
  const templates = useAppStore((s) => s.templates)
  const settings = useAppStore((s) => s.settings)
  const enhancing = useAppStore((s) => s.enhancing)
  const saveRawNotes = useAppStore((s) => s.saveRawNotes)
  const saveTitle = useAppStore((s) => s.saveTitle)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const toggleTranscript = useAppStore((s) => s.toggleTranscript)
  const openImport = useAppStore((s) => s.openImport)
  const toastShow = useAppStore((s) => s.toastShow)
  const startRecording = useAppStore((s) => s.startRecording)
  const enhanceNote = useAppStore((s) => s.enhanceNote)
  const regenerate = useAppStore((s) => s.regenerate)
  const addTag = useAppStore((s) => s.addTag)
  const removeTag = useAppStore((s) => s.removeTag)
  const extractPeople = useAppStore((s) => s.extractPeople)
  const extractingPeople = useAppStore((s) => s.extractingPeople)
  const openPerson = useAppStore((s) => s.openPerson)
  const directory = useAppStore((s) => s.directory)

  const [editingNotes, setEditingNotes] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<Array<{ id: string; version: number; model: string | null; created_at: string }>>([])
  const [tagDraft, setTagDraft] = useState('')
  const saveTimer = useRef<number | null>(null)

  const noteId = detail?.note.id ?? null

  useEffect(() => {
    setTitleDraft(detail?.note.title ?? '')
    setEditingNotes(false)
    setShowTemplates(false)
    setShowMenu(false)
    setShowVersions(false)
  }, [noteId, detail?.note.title])

  const sections = useMemo(
    () => (detail?.enhanced ? parseEnhanced(detail.enhanced.content_md, detail.enhanced.citations) : []),
    [detail?.enhanced]
  )

  if (!detail) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
        <Waveform className="text-faint" />
        <h2 className="text-[15px] font-semibold text-ink">Bir not seç ya da yeni bir tane aç</h2>
        <p className="max-w-[380px] text-[13px] leading-relaxed text-faint">
          Soldan bir not seçebilir, “Yeni Not” ile boş bir defter açabilir ya da elindeki bir ses
          dosyasını transkripte çevirebilirsin.
        </p>
        <button
          type="button"
          onClick={() => openImport(true)}
          className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-white hover:bg-primaryHover"
        >
          <Upload size={15} />
          Ses dosyası içe aktar
        </button>
      </div>
    )
  }

  const note = detail.note
  const recording = note.status === 'recording'
  const busyEnhancing = enhancing?.noteId === note.id
  const hasContent = detail.transcripts.length > 0 || Boolean(detail.raw_notes_md.trim())

  const statusText = busyEnhancing
    ? enhancing?.message ?? 'Zenginleştiriliyor'
    : note.status === 'processing'
      ? 'Zenginleştiriliyor'
      : recording
        ? 'Kayıt sürüyor'
        : note.status === 'failed'
          ? 'Başarısız — yeniden deneyin'
          : detail.enhanced
            ? 'Hazır'
            : 'Ham not'

  const onNotesChange = (html: string): void => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void saveRawNotes(html), 600)
  }

  const applyTemplate = async (templateId: string): Promise<void> => {
    setShowTemplates(false)
    await useAppStore.getState().updateSettings({ default_template: templateId })
    const tpl = templates.find((t) => t.id === templateId)
    await enhanceNote(note.id, templateId, false)
    toastShow({ kind: 'info', message: `Şablon uygulandı: ${tpl?.name ?? templateId}` })
  }

  const openVersions = async (): Promise<void> => {
    setShowVersions((v) => !v)
    if (!showVersions) setVersions(await window.api.enhancedVersions(note.id))
  }

  const startRecordingNow = async (): Promise<void> => {
    const st = useAppStore.getState().settings
    await startRecording({
      title: note.title,
      language: st?.language ?? 'auto',
      micEnabled: true,
      systemEnabled: Boolean(st?.record_system_audio),
      existingNoteId: note.id,
      auto: false,
      reason: note.calendar_event_id ? `calendar:${note.calendar_event_id}` : undefined
    })
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-surface">
      {/* --- BASLIK --- */}
      <header className="px-8 pt-7">
        <div className="flex items-start justify-between gap-4">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft !== note.title) void saveTitle(titleDraft.trim())
            }}
            className="w-full bg-transparent text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink outline-none"
          />
          <div className="flex shrink-0 items-center gap-0.5 pt-1">
            <button
              type="button"
              className="icon-btn"
              title="Bağlantıyı kopyala (yerel — paylaşım yok)"
              onClick={() => {
                void navigator.clipboard.writeText(`notlar://note/${note.id}`)
                toastShow({ kind: 'info', message: 'Not bağlantısı kopyalandı' })
              }}
            >
              <Link2 size={16} />
            </button>
            <div className="relative">
              <button type="button" className="icon-btn" title="Diğer" onClick={() => setShowMenu((v) => !v)}>
                <MoreHorizontal size={17} />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-9 z-20 w-60 rounded-lg border border-hairline bg-surface p-1 shadow-pop">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      openImport(true)
                    }}
                    className="nav-item"
                  >
                    <Upload size={15} /> Bu nota ses ekle
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      void openVersions()
                    }}
                    className="nav-item"
                  >
                    <History size={15} /> Sürüm geçmişi
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      void deleteNote(note.id)
                    }}
                    className="nav-item text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} /> Notu sil
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} className="text-faint" />
            {fmtDateLong(detail.calendar_event?.start_at ?? note.started_at)}
          </span>
          <span className="text-faint">
            {detail.calendar_event
              ? fmtRange(detail.calendar_event.start_at, detail.calendar_event.end_at)
              : fmtRange(note.started_at, note.ended_at)}
          </span>
          {note.source === 'calendar' && <span className="chip">takvimden açıldı</span>}
          {note.source === 'call' && <span className="chip">otomatik kayıt</span>}
          {detail.enhanced && (
            <span className="chip" title={`${detail.enhanced.model ?? ''}`}>
              v{detail.enhanced.version} • {detail.enhanced.citations.length} kaynak
            </span>
          )}
          {note.participants.length > 0 && <AvatarStack people={note.participants} size={24} />}
          {recording && <LiveBadge />}
        </div>

        {/* Etiketler (Faz 5) */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {note.tags.map((t) => {
            const tag = directory.tags.find((x) => x.name === t)
            return (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-pill py-1 pl-2.5 pr-1.5 text-[12px] text-inkSoft"
              >
                {t}
                <button
                  type="button"
                  title="Etiketi kaldır"
                  disabled={!tag}
                  onClick={() => tag && void removeTag(note.id, tag.id)}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-faint hover:bg-white hover:text-ink disabled:opacity-40"
                >
                  <X size={11} />
                </button>
              </span>
            )
          })}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagDraft.trim()) {
                void addTag(note.id, tagDraft)
                setTagDraft('')
              }
            }}
            placeholder={note.tags.length === 0 ? '+ etiket ekle' : '+ etiket'}
            className="w-[110px] rounded-full border border-dashed border-hairline bg-transparent px-2.5 py-1 text-[12px] outline-none placeholder:text-faint focus:border-faint"
          />
        </div>

        {detail.calendar_event &&
          (detail.calendar_event.location || detail.calendar_event.participants.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-canvas px-3.5 py-2.5 text-[11.5px] text-faint">
              {detail.calendar_event.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={12} />
                  {detail.calendar_event.location}
                </span>
              )}
              {detail.calendar_event.participants.length > 0 && (
                <span className="truncate">
                  {detail.calendar_event.participants.length} katılımcı:{' '}
                  {detail.calendar_event.participants.slice(0, 4).join(', ')}
                  {detail.calendar_event.participants.length > 4 ? '…' : ''}
                </span>
              )}
            </div>
          )}

        {showVersions && (
          <div className="mt-3 rounded-lg border border-hairline bg-canvas p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">
                Zenginleştirme sürümleri
              </p>
              <button type="button" className="icon-btn h-6 w-6" onClick={() => setShowVersions(false)}>
                <X size={13} />
              </button>
            </div>
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 text-[12px] text-inkSoft">
                  <span className="chip">v{v.version}</span>
                  <span className="truncate text-faint">{v.model}</span>
                  <span className="ml-auto shrink-0 text-faint">
                    {new Date(v.created_at).toLocaleString('tr-TR')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">En son sürüm gösterilir (v{versions[0]?.version ?? 1}).</p>
          </div>
        )}

        <div className="h-px bg-hairlineSoft" />
      </header>

      {/* --- GOVDE --- */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Kisiler (Faz 5): otomatik cikarim + delil */}
        <section className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Users size={13} className="text-faint" /> Kişiler
              {note.participants.length > 0 && (
                <span className="font-normal text-faint">({note.participants.length})</span>
              )}
            </h2>
            <button
              type="button"
              disabled={extractingPeople || !hasContent}
              onClick={() => void extractPeople(note.id)}
              title="Transkriptten ve ham notlardan kişi/şirket çıkar"
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1 text-[11.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
            >
              {extractingPeople ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Kişileri çıkar
            </button>
          </div>
          {note.participants.length === 0 ? (
            <p className="text-[11.5px] leading-relaxed text-faint">
              Henüz kişi yok. Takvim katılımcıları otomatik eklenir; transkript kaydından sonra
              “Kişileri çıkar” ile dizini doldurabilirsin.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {note.participants.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => void openPerson(pt.id)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-canvas py-1 pl-1 pr-2.5 text-[12px] text-inkSoft transition-colors hover:bg-pill"
                >
                  <Avatar name={pt.name} size={18} />
                  {pt.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Ham notlarim */}
        <section className="mb-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Ham notlarım</h2>
            <span className="text-[11px] text-faint">AI bunları çekirdek alır</span>
          </div>
          {editingNotes ? (
            <RawNotesEditor
              value={detail.raw_notes_md}
              onChange={onNotesChange}
              editorKey={note.id}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingNotes(true)}
              className="w-full rounded-lg border border-dashed border-transparent text-left transition-colors hover:border-hairline"
            >
              {detail.raw_notes_md.trim() ? (
                <div
                  className="tiptap-notes pointer-events-none text-[13.5px]"
                  dangerouslySetInnerHTML={{ __html: previewHtml(detail.raw_notes_md) }}
                />
              ) : (
                <p className="px-1 text-[13px] text-faint">
                  Ham not yok — tıklayıp yaz. Zenginleştirmenin çekirdeği burasıdır.
                </p>
              )}
            </button>
          )}
        </section>

        {/* Takvim notu ve henuz transkript yok -> ACIK kayit baslatma */}
        {note.source === 'calendar' && note.transcript_count === 0 && !recording && (
          <section className="mb-7">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-canvas px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">Bu toplantı için kayıt başlatılmadı</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
                  {(detail.calendar_event?.participants.length ?? 0) > 0
                    ? `${detail.calendar_event?.participants.length} katılımcı`
                    : 'Katılımcı bilgisi yok'}{' '}
                  • Toplantı saati gelince otomatik başlar; istersen şimdi başlat.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startRecordingNow()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-primaryHover"
              >
                <Mic size={14} />
                Kaydı başlat
              </button>
            </div>
          </section>
        )}

        {/* AI ile zenginlestirilmis not */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">AI ile zenginleştirilmiş not</h2>
            <div className="flex items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  className="icon-btn"
                  title="Şablon seç ve uygula"
                  onClick={() => setShowTemplates((v) => !v)}
                >
                  <Sparkles size={16} />
                </button>
                {showTemplates && (
                  <div className="absolute right-0 top-9 z-20 w-72 rounded-lg border border-hairline bg-surface p-1 shadow-pop">
                    <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
                      Şablon uygula (yeniden üretir)
                    </p>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => void applyTemplate(t.id)}
                        className="nav-item flex-col items-start gap-0.5"
                      >
                        <span className="flex w-full items-center justify-between">
                          <span className="font-medium">{t.name}</span>
                          {settings?.default_template === t.id && <Check size={14} className="text-live" />}
                        </span>
                        {t.description && (
                          <span className="text-[11px] leading-snug text-faint">{t.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Yeniden üret"
                disabled={busyEnhancing || !hasContent}
                onClick={() => void regenerate()}
              >
                {busyEnhancing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
              </button>
            </div>
          </div>

          {busyEnhancing && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-hairline bg-canvas px-3.5 py-2.5">
              <Loader2 size={14} className="animate-spin text-inkSoft" />
              <span className="text-[12.5px] text-inkSoft">{enhancing?.message}</span>
            </div>
          )}

          {sections.length > 0 ? (
            <div>
              {sections.map((s) => (
                <EnhancedSectionCard key={s.heading} section={s} transcripts={detail.transcripts} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-hairline bg-canvas/60 px-5 py-6">
              <div className="mb-2 flex items-center gap-2 text-inkSoft">
                <Sparkles size={16} className="text-faint" />
                <p className="text-[13px] font-medium">Henüz zenginleştirilmedi</p>
              </div>
              <p className="text-[12.5px] leading-relaxed text-faint">
                Ham notların + kanal etiketli transkript + takvim bağlamı modele gönderilir;{' '}
                <span className="text-inkSoft">Özet / Ana Konular / Kararlar / Risk / Sonraki Adımlar</span>{' '}
                bölümleri ve her madde için kaynak (büyüteç) üretilir.
              </p>
              <button
                type="button"
                disabled={busyEnhancing || !hasContent}
                onClick={() => void regenerate()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-primaryHover disabled:opacity-45"
              >
                <Sparkles size={14} />
                Zenginleştir
              </button>
              {!hasContent && (
                <p className="mt-2 text-[11.5px] text-faint">
                  Önce bir kayıt yap, ses dosyası içe aktar ya da ham not yaz.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* --- DURUM CUBUGU --- */}
      <footer className="flex items-center justify-between border-t border-hairline px-8 py-2.5 text-[12px] text-muted">
        <div className="flex items-center gap-2.5">
          {busyEnhancing || note.status === 'processing' ? (
            <Loader2 size={14} className="animate-spin text-inkSoft" />
          ) : recording ? (
            <EqualizerBars />
          ) : (
            <Waveform className="text-faint" />
          )}
          <span>{statusText}</span>
          {note.status === 'failed' && (
            <button
              type="button"
              onClick={() => void regenerate()}
              className="chip inline-flex items-center gap-1 text-red-600 hover:bg-red-50"
            >
              <AlertTriangle size={11} /> yeniden dene
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-faint">{note.transcript_count} transkript parçası</span>
          {note.transcript_count > 0 && (
            <button
              type="button"
              onClick={() => toggleTranscript(true)}
              className="font-medium text-inkSoft hover:text-ink"
            >
              Transkripti göster
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

/**
 * Onizleme HTML'i: kayitli icerik HTML ise TEMIZLENIR (savunma amacli),
 * eski duz metin ise madde listesine cevrilir.
 */
function previewHtml(content: string): string {
  const text = content ?? ''
  if (isHtml(text)) return sanitizeHtml(text)
  return plainToHtml(text)
}