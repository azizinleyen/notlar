// ============================================================================
//  FAZ 5 — Kisiler & Sirketler dizini (orta panel).
//  Notlardan OTOMATIK cikarilir; her kaydin yaninda delil (kanit cumlesi) var.
// ============================================================================

import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Merge,
  Pencil,
  Search,
  Users
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { Avatar, EmptyHint } from './primitives'
import { fmtDateLong } from '../lib/format'
import ScopedAsk from './ScopedAsk'

/** Bir kisi/sirket ile ilgili not listesi (delil ile). */
function NoteLinkList({
  notes,
  onOpen
}: {
  notes: Array<{ note_id: string; title: string; started_at: string; source: string; role: string | null; evidence: string | null }>
  onOpen: (id: string) => void
}) {
  if (notes.length === 0) return <EmptyHint>İlişkili not yok.</EmptyHint>
  return (
    <ul className="space-y-1">
      {notes.map((n) => (
        <li key={n.note_id + (n.role ?? '')}>
          <button
            type="button"
            onClick={() => onOpen(n.note_id)}
            className="w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-pill"
          >
            <span className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-ink">{n.title}</span>
              {n.role && <span className="chip shrink-0">{n.role}</span>}
              <span className="ml-auto shrink-0 text-[11px] text-faint">{fmtDateLong(n.started_at)}</span>
            </span>
            {n.evidence && (
              <span className="mt-0.5 block truncate text-[11.5px] text-faint">{n.evidence}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

function PersonView() {
  const detail = useAppStore((s) => s.detailPerson)
  const selectNote = useAppStore((s) => s.selectNote)
  const updatePerson = useAppStore((s) => s.updatePerson)
  const directory = useAppStore((s) => s.directory)
  const mergePerson = useAppStore((s) => s.mergePerson)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', email: '', title: '' })
  const [mergeTarget, setMergeTarget] = useState('')

  if (!detail) return null
  const p = detail.person

  const startEdit = (): void => {
    setDraft({ name: p.name, email: p.email ?? '', title: p.title ?? '' })
    setEditing(true)
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7">
      <div className="mb-5 flex items-start gap-4">
        <Avatar name={p.name} size={52} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ad Soyad"
                className="w-full rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-[15px] font-semibold outline-none focus:border-faint"
              />
              <div className="flex gap-2">
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Unvan (ör. Ürün Yöneticisi)"
                  className="flex-1 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-faint"
                />
                <input
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="E-posta"
                  className="flex-1 rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-faint"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void updatePerson(p.id, {
                      name: draft.name,
                      email: draft.email || null,
                      title: draft.title || null
                    })
                    setEditing(false)
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primaryHover"
                >
                  Kaydet
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-3 py-1.5 text-[12.5px] text-muted hover:bg-pill"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[22px] font-bold tracking-[-0.02em] text-ink">{p.name}</h1>
                <button type="button" className="icon-btn h-6 w-6" title="Düzenle" onClick={startEdit}>
                  <Pencil size={13} />
                </button>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {[p.title, p.company_name].filter(Boolean).join(' • ') || 'Unvan bilgisi yok'}
                {p.email ? ` • ${p.email}` : ''}
              </p>
              <p className="mt-1 text-[11.5px] text-faint">
                {p.note_count} notta geçiyor
                {p.last_seen_at ? ` • son: ${fmtDateLong(p.last_seen_at)}` : ''}
              </p>
            </>
          )}
        </div>
      </div>

      {detail.tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {detail.tags.slice(0, 8).map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}

      <ScopedAsk scopeLabel={`${p.name} hakkında`} scope={{ kind: 'person', id: p.id }} />

      <section className="mt-6">
        <h2 className="mb-2.5 text-[13.5px] font-semibold text-ink">İlişkili notlar</h2>
        <NoteLinkList notes={detail.notes} onOpen={(id) => void selectNote(id)} />
      </section>

      {/* Birlestirme: ayni kisi iki kez cikarildiysa */}
      <section className="mt-7 border-t border-hairlineSoft pt-5">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-inkSoft">
          <Merge size={13} /> Aynı kişi iki kayıt mı?
        </h3>
        <div className="flex gap-2">
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            className="flex-1 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none"
          >
            <option value="">Birleştirilecek kişiyi seç…</option>
            {directory.people
              .filter((x) => x.id !== p.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.email ? ` (${x.email})` : ''}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!mergeTarget}
            onClick={() => mergePerson(mergeTarget, p.id)}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill disabled:opacity-40"
          >
            Bunu buna birleştir
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          Seçilen kişinin tüm not bağlantıları bu kişiye taşınır ve seçilen kayıt silinir.
        </p>
      </section>
    </div>
  )
}

function CompanyView() {
  const detail = useAppStore((s) => s.detailCompany)
  const openPerson = useAppStore((s) => s.openPerson)
  const selectNote = useAppStore((s) => s.selectNote)

  if (!detail) return null
  const c = detail.company

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-pill text-inkSoft">
          <Building2 size={24} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold tracking-[-0.02em] text-ink">{c.name}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {c.domain ? (
              <span className="inline-flex items-center gap-1.5">
                {c.domain}
                <ExternalLink size={11} className="text-faint" />
              </span>
            ) : (
              'Alan adı bilgisi yok'
            )}
          </p>
          <p className="mt-1 text-[11.5px] text-faint">
            {c.people_count} kişi • {c.note_count} notta geçiyor
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Alan adı otomatik çıkarıldı (e-posta adreslerinden). Genel amaçlı sağlayıcılar
            (gmail, outlook…) şirket sayılmaz.
          </p>
        </div>
      </div>

      <ScopedAsk scopeLabel={`${c.name} hakkında`} scope={{ kind: 'company', id: c.id }} />

      {detail.people.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2.5 text-[13.5px] font-semibold text-ink">Kişiler</h2>
          <div className="space-y-0.5">
            {detail.people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void openPerson(p.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-pill"
              >
                <Avatar name={p.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {[p.title, p.email].filter(Boolean).join(' • ') || '—'}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-faint">{p.note_count} not</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2.5 text-[13.5px] font-semibold text-ink">İlişkili notlar</h2>
        <NoteLinkList notes={detail.notes} onOpen={(id) => void selectNote(id)} />
      </section>
    </div>
  )
}

export default function DirectoryPanel() {
  const view = useAppStore((s) => s.view)
  const directory = useAppStore((s) => s.directory)
  const setView = useAppStore((s) => s.setView)
  const openPerson = useAppStore((s) => s.openPerson)
  const openCompany = useAppStore((s) => s.openCompany)
  const peopleQuery = useAppStore((s) => s.peopleQuery)
  const setPeopleQuery = useAppStore((s) => s.setPeopleQuery)

  const filtered = useMemo(() => {
    const q = peopleQuery.trim().toLocaleLowerCase('tr')
    if (!q) return directory.people
    return directory.people.filter(
      (p) =>
        p.name.toLocaleLowerCase('tr').includes(q) ||
        (p.company_name ?? '').toLocaleLowerCase('tr').includes(q) ||
        (p.email ?? '').toLocaleLowerCase('tr').includes(q) ||
        (p.title ?? '').toLocaleLowerCase('tr').includes(q)
    )
  }, [directory.people, peopleQuery])

  if (view.kind === 'person') return <PersonView />
  if (view.kind === 'company') return <CompanyView />

  const isPeople = view.kind === 'people'
  const list = isPeople ? filtered : directory.companies

  return (
    <div className="flex-1 overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-hairlineSoft px-8 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-muted">{isPeople ? <Users size={18} /> : <Building2 size={18} />}</span>
          <div>
            <h1 className="text-[15px] font-semibold text-ink">{isPeople ? 'Kişiler' : 'Şirketler'}</h1>
            <p className="text-[11.5px] text-faint">
              {isPeople
                ? `${directory.people.length} kişi — notlarından otomatik çıkarıldı`
                : `${directory.companies.length} şirket — e-posta alan adlarından çıkarıldı`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPeople && (
            <label className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-2.5 py-[6px]">
              <Search size={14} className="text-faint" />
              <input
                value={peopleQuery}
                onChange={(e) => setPeopleQuery(e.target.value)}
                placeholder="Kişi ara…"
                className="w-[150px] bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => setView({ kind: 'note' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-inkSoft hover:bg-pill"
          >
            <ArrowLeft size={13} />
            Notlara dön
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-73px)] overflow-y-auto px-8 py-5">
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline bg-canvas/60 px-5 py-6">
            <p className="text-[13px] font-medium text-inkSoft">
              {isPeople ? 'Henüz kişi çıkarılmadı' : 'Henüz şirket çıkarılmadı'}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
              Kişiler notlarından otomatik çıkarılır. Bir notu açıp <strong>Kişileri çıkar</strong>{' '}
              düğmesini kullanabilir ya da takvim bağlarsan katılımcılar otomatik eklenir.
            </p>
          </div>
        ) : isPeople ? (
          <div className="space-y-0.5">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void openPerson(p.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-pill"
              >
                <Avatar name={p.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {[p.title, p.company_name, p.email].filter(Boolean).join(' • ') || '—'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[11.5px] text-inkSoft">{p.note_count} not</span>
                  {p.last_seen_at && (
                    <span className="block text-[10.5px] text-faint">{fmtDateLong(p.last_seen_at)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {directory.companies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void openCompany(c.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-pill"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pill text-inkSoft">
                  <Building2 size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">{c.domain ?? '—'}</span>
                </span>
                <span className="shrink-0 text-right text-[11.5px] text-inkSoft">
                  {c.people_count} kişi
                  <span className="block text-[10.5px] text-faint">{c.note_count} not</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
