import { Building2, Mic, Plus, Search, Settings, Upload, Users } from 'lucide-react'
import clsx from 'clsx'
import type { CalendarEventRowDto, NoteSummary } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { fmtRange, isToday, fmtTime } from '../lib/format'
import { AvatarStack, Monogram } from './primitives'

function todayLabel(): string {
  return new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
}

/** Takvim katilimcilari duz isim listesidir; avatar icin sahte kimlik uretiyoruz. */
/** Etkinlik zamani: gecti / su an / yaklasan */
function eventState(ev: CalendarEventRowDto): 'past' | 'now' | 'future' {
  const now = Date.now()
  const start = new Date(ev.start_at).getTime()
  const end = ev.end_at ? new Date(ev.end_at).getTime() : start + 30 * 60000
  if (now >= start && now <= end) return 'now'
  return now > end ? 'past' : 'future'
}

function peopleFromNames(names: string[]): Array<{ id: string; name: string }> {
  return names.filter(Boolean).map((n) => ({ id: n, name: n }))
}

export default function Sidebar() {
  const notes = useAppStore((s) => s.notes)
  const events = useAppStore((s) => s.calendarEvents)
  const selectedId = useAppStore((s) => s.selectedId)
  const query = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const selectNote = useAppStore((s) => s.selectNote)
  const createNote = useAppStore((s) => s.createNote)
  const openImport = useAppStore((s) => s.openImport)
  const openRecord = useAppStore((s) => s.openRecord)
  const openSettings = useAppStore((s) => s.openSettings)
  const setView = useAppStore((s) => s.setView)
  const view = useAppStore((s) => s.view)
  const directory = useAppStore((s) => s.directory)
  const selectedPerson = useAppStore((s) => s.detailPerson)
  const selectedCompany = useAppStore((s) => s.detailCompany)
  const recording = useAppStore((s) => s.recording)
  const openCalendarEvent = useAppStore((s) => s.openCalendarEvent)
  const startFromCalendarEvent = useAppStore((s) => s.startFromCalendarEvent)

  const todaysNotes = notes.filter((n) => isToday(n.started_at))
  const todaysEvents = events
    .filter((e) => isToday(e.start_at))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  // Takvim etkinligine bagli olmayan bugunku notlar (elle/ice aktarma)
  const linkedNoteIds = new Set(
    todaysEvents
      .map((e) => notes.find((n) => n.calendar_event_id === e.id)?.id)
      .filter((v): v is string => Boolean(v))
  )
  const looseNotes = todaysNotes.filter((n) => !linkedNoteIds.has(n.id))

  const noteForEvent = (e: CalendarEventRowDto): NoteSummary | undefined =>
    notes.find((n) => n.calendar_event_id === e.id)

  return (
    <aside className="flex h-full w-[262px] shrink-0 flex-col border-r border-hairline bg-surface">
      {/* monogram - buyuk yazi/logo YOK */}
      <div className="px-4 pb-3 pt-4">
        <Monogram />
      </div>

      {/* arama */}
      <div className="px-3">
        <label className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-2.5 py-[7px] focus-within:border-faint">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Notlarımda ara..."
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-2">
        {/* BUGUN */}
        <div className="section-label mb-1.5 flex items-center justify-between">
          <span>Bugün</span>
          <span className="font-normal normal-case tracking-normal text-faint">{todayLabel()}</span>
        </div>

        {todaysEvents.length === 0 && todaysNotes.length === 0 ? (
          <p className="px-2 pb-1 text-[12px] leading-relaxed text-faint">
            Bugün için toplantı yok. Bir takvim bağla (Ayarlar) veya canlı kayıt başlat.
          </p>
        ) : (
          <div className="space-y-0.5">
            {/* takvim etkinlikleri */}
            {todaysEvents.map((ev) => {
              const note = noteForEvent(ev)
              const live = note?.status === 'recording'
              const active = note ? selectedId === note.id : false
              const state = eventState(ev)
              return (
                <div
                  key={ev.id}
                  className={clsx(
                    'group relative rounded-lg transition-colors hover:bg-pill',
                    active && 'bg-pill'
                  )}
                >
                  {/*
                    DIKKAT: Tiklama KAYIT BASLATMAZ. Yalnizca o toplantinin notunu acar
                    (yoksa bos not olusturur). Kayit, etkinlik saati gelince otomatik ya da
                    sagdaki mikrofon dugmesiyle ACIKCA baslar.
                  */}
                  <button
                    type="button"
                    onClick={() => void openCalendarEvent(ev)}
                    title={
                      note
                        ? 'Notu aç'
                        : state === 'past'
                          ? 'Notu aç (toplantı geçmiş)'
                          : 'Notu aç — kayıt saati gelince ya da mikrofon düğmesiyle başlar'
                    }
                    className="w-full rounded-lg px-2 py-2 pr-9 text-left"
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-muted">
                        {fmtTime(ev.start_at)}
                        {ev.end_at ? ` – ${fmtTime(ev.end_at)}` : ''}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {state === 'now' && !live && (
                          <span className="rounded-full bg-liveSoft px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide text-liveInk">
                            şimdi
                          </span>
                        )}
                        <span
                          className={clsx(
                            'h-[7px] w-[7px] rounded-full',
                            live ? 'live-dot bg-live' : note ? 'bg-[#c9c6bf]' : 'bg-hairline'
                          )}
                          title={live ? 'Kayıt sürüyor' : note ? 'Not var' : 'Not yok'}
                        />
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[13px] font-semibold text-ink">
                      {ev.title}
                    </span>
                    {ev.participants.length > 0 && (
                      <span className="mt-1.5 block">
                        <AvatarStack people={peopleFromNames(ev.participants)} size={20} />
                      </span>
                    )}
                  </button>

                  {/* ACIK kayit eylemi: yalnizca ustune gelince gorunur */}
                  <button
                    type="button"
                    title="Bu toplantı için kaydı başlat"
                    aria-label="Kaydı başlat"
                    disabled={recording.active}
                    onClick={(e) => {
                      e.stopPropagation()
                      void startFromCalendarEvent(ev)
                    }}
                    className={clsx(
                      'absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md',
                      'text-faint transition-all hover:bg-white hover:text-live',
                      'opacity-0 focus:opacity-100 group-hover:opacity-100',
                      recording.active && 'cursor-not-allowed opacity-30'
                    )}
                  >
                    <Mic size={13} />
                  </button>
                </div>
              )
            })}

            {/* takvime bagli olmayan bugunku notlar */}
            {looseNotes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void selectNote(n.id)}
                className={clsx(
                  'w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-pill',
                  selectedId === n.id && 'bg-pill'
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted">
                    {fmtRange(n.started_at, n.ended_at)}
                  </span>
                  <span
                    className={clsx(
                      'h-[7px] w-[7px] rounded-full',
                      n.status === 'recording' ? 'live-dot bg-live' : 'bg-hairline'
                    )}
                  />
                </span>
                <span className="mt-1 block truncate text-[13px] font-semibold text-ink">{n.title}</span>
                {n.participants.length > 0 && (
                  <span className="mt-1.5 block">
                    <AvatarStack people={n.participants} size={20} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* AKSIYONLAR */}
        <div className="mt-3 space-y-1.5">
          <button
            type="button"
            onClick={() => void createNote()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-[9px] text-[13px] font-medium text-white transition-colors hover:bg-primaryHover"
          >
            <Plus size={15} />
            Yeni Not
          </button>
          <button
            type="button"
            onClick={() => openRecord(true)}
            disabled={recording.active}
            className={clsx(
              'flex w-full items-center justify-center gap-2 rounded-lg border py-[8px] text-[12.5px] font-medium transition-colors',
              recording.active
                ? 'cursor-not-allowed border-hairline bg-canvas text-faint'
                : 'border-hairline bg-surface text-inkSoft hover:bg-pill'
            )}
          >
            <Mic size={14} className={recording.active ? 'text-faint' : 'text-live'} />
            {recording.active ? 'Kayıt sürüyor...' : 'Canlı kayıt başlat'}
          </button>
          <button
            type="button"
            onClick={() => openImport(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface py-[8px] text-[12.5px] font-medium text-inkSoft transition-colors hover:bg-pill"
          >
            <Upload size={14} />
            Ses dosyası içe aktar
          </button>
        </div>

        {/* TUM NOTLAR */}
        <div className="mt-5">
          <div className="section-label mb-1.5">Tüm Notlar</div>
          {notes.length === 0 ? (
            <p className="px-2 text-[12px] text-faint">Henüz not yok.</p>
          ) : (
            <div className="space-y-0.5">
              {notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void selectNote(n.id)}
                  className={clsx('nav-item', selectedId === n.id && 'nav-item-active')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                    {n.tags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {n.tags.slice(0, 3).map((t) => (
                          <span key={t} className="chip">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ALT IKONLAR */}
      <div className="flex items-center gap-1 border-t border-hairline px-3 py-2.5">
        <button
          type="button"
          title={`Kişiler (${directory.people.length})`}
          onClick={() => setView({ kind: 'people' })}
          className={clsx('icon-btn', view.kind === 'people' || view.kind === 'person' ? 'bg-pill text-ink' : '')}
        >
          <Users size={17} />
        </button>
        <button
          type="button"
          title={`Şirketler (${directory.companies.length})`}
          onClick={() => setView({ kind: 'companies' })}
          className={clsx('icon-btn', view.kind === 'companies' || view.kind === 'company' ? 'bg-pill text-ink' : '')}
        >
          <Building2 size={17} />
        </button>
        <span className="flex-1" />
        {(view.kind === 'person' || view.kind === 'company') && (
          <span className="truncate text-[11px] text-faint">
            {view.kind === 'person' ? selectedPerson?.person.name : selectedCompany?.company.name}
          </span>
        )}
        <button
          type="button"
          title="Ayarlar"
          onClick={() => openSettings(true)}
          className="icon-btn"
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  )
}