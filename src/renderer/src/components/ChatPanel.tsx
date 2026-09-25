// ============================================================================
//  FAZ 6 — Sohbet paneli (sag sutun).
//
//  Sekmeler:
//    "Brief"     : toplanti oncesi ozet (Faz 5) + gercek sohbet gecmisi
//    "Soru sor"  : cok turlu sohbet (kapsam: not / kisi / sirket / tum notlar)
//
//  "/" ile Recipes menusu acilir (kayitli promptlar).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react'
import clsx from 'clsx'
import type { ChatScopeKind } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Waveform } from './primitives'

const SCOPE_LABEL: Record<ChatScopeKind, string> = {
  note: 'bu not',
  person: 'bu kişi',
  company: 'bu şirket',
  all: 'tüm notlarım'
}

export default function ChatPanel() {
  const detail = useAppStore((s) => s.detail)
  const chatOpen = useAppStore((s) => s.chatOpen)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const tab = useAppStore((s) => s.chatTab)
  const setTab = useAppStore((s) => s.setChatTab)
  const transcriptOpen = useAppStore((s) => s.transcriptOpen)
  const toggleTranscript = useAppStore((s) => s.toggleTranscript)

  const brief = useAppStore((s) => s.brief)
  const briefBusy = useAppStore((s) => s.briefBusy)
  const loadBrief = useAppStore((s) => s.loadBrief)
  const selectNote = useAppStore((s) => s.selectNote)

  const chatMessages = useAppStore((s) => s.chatMessages)
  const chatBusy = useAppStore((s) => s.chatBusy)
  const chatScope = useAppStore((s) => s.chatScope)
  const sendChat = useAppStore((s) => s.sendChat)
  const recipes = useAppStore((s) => s.recipes)
  const recipesOpen = useAppStore((s) => s.recipesOpen)
  const setRecipesOpen = useAppStore((s) => s.setRecipesOpen)
  const runRecipe = useAppStore((s) => s.runRecipe)
  const chatThreads = useAppStore((s) => s.chatThreads)
  const deleteChatThread = useAppStore((s) => s.deleteChatThread)
  const openChatForScope = useAppStore((s) => s.openChatForScope)

  const [question, setQuestion] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const scroller = useRef<HTMLDivElement | null>(null)
  const seq = useMemo(() => chatMessages.length, [chatMessages])

  // Yeni mesaj gelince en alta kaydir
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [seq, chatBusy])

  if (!chatOpen) {
    return (
      <button
        type="button"
        onClick={() => toggleChat(true)}
        title="Paneli aç"
        className="flex w-9 shrink-0 items-center justify-center border-l border-hairline bg-surface text-faint hover:bg-pill hover:text-ink"
      >
        <ChevronLeft size={16} />
      </button>
    )
  }

  const submit = (): void => {
    const q = question.trim()
    if (!q || chatBusy) return
    setQuestion('')
    setRecipesOpen(false)
    void sendChat(q)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') setRecipesOpen(false)
  }

  const onQuestionChange = (v: string): void => {
    setQuestion(v)
    // "/" ile recipe menusu
    setRecipesOpen(v.startsWith('/'))
  }

  const matchingRecipes = useMemo(() => {
    if (!recipesOpen) return []
    const q = question.replace(/^\//, '').toLocaleLowerCase('tr').trim()
    if (!q) return recipes
    return recipes.filter(
      (r) =>
        r.shortcut.includes(q) ||
        r.name.toLocaleLowerCase('tr').includes(q) ||
        (r.description ?? '').toLocaleLowerCase('tr').includes(q)
    )
  }, [recipes, recipesOpen, question])

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-hairline bg-surface">
      {/* sekmeler */}
      <div className="flex items-center gap-2 px-4 pt-4">
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-canvas p-1">
          {(['brief', 'ask'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 rounded-md py-[6px] text-[12.5px] font-medium transition-colors',
                tab === t ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
              )}
            >
              {t === 'brief' ? 'Brief' : 'Soru sor'}
            </button>
          ))}
        </div>
        {tab === 'ask' && (
          <button
            type="button"
            className="icon-btn"
            title="Sohbet geçmişi"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History size={16} />
          </button>
        )}
        <button type="button" className="icon-btn" title="Paneli daralt" onClick={() => toggleChat(false)}>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* sohbet gecmisi listesi */}
      {showHistory && tab === 'ask' && (
        <div className="mx-4 mt-3 rounded-lg border border-hairline bg-canvas p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              Sohbetler
            </span>
            <button
              type="button"
              className="icon-btn h-5 w-5"
              title="Kapat"
              onClick={() => setShowHistory(false)}
            >
              <ChevronRight size={12} />
            </button>
          </div>
          {chatThreads.length === 0 ? (
            <p className="px-1 py-1 text-[11.5px] text-faint">Henüz sohbet yok.</p>
          ) : (
            <ul className="max-h-[180px] space-y-0.5 overflow-y-auto">
              {chatThreads.map((t) => (
                <li key={t.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void openChatForScope(t.scope_kind, t.scope_id)
                      setShowHistory(false)
                    }}
                    className={clsx(
                      'min-w-0 flex-1 rounded px-2 py-1.5 text-left transition-colors hover:bg-pill',
                      t.id === useAppStore.getState().chatThreadId && 'bg-pill'
                    )}
                  >
                    <span className="block truncate text-[12px] text-ink">{t.title}</span>
                    <span className="block text-[10.5px] text-faint">
                      {SCOPE_LABEL[t.scope_kind]} • {t.message_count} mesaj
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Sohbeti sil"
                    onClick={() => void deleteChatThread(t.id)}
                    className="rounded p-1 text-faint opacity-0 transition-opacity hover:bg-pill hover:text-red-600 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'brief' ? (
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={15} className="text-inkSoft" />
              <h3 className="text-[13px] font-semibold text-ink">Toplantı Özeti</h3>
            </div>
            {briefBusy ? (
              <p className="flex items-center gap-2 text-[12.5px] text-faint">
                <Loader2 size={13} className="animate-spin" /> Brief hazırlanıyor…
              </p>
            ) : brief && brief.items.length > 0 ? (
              <ul className="space-y-2.5">
                {brief.items.map((b, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-inkSoft">
                    <span className="mt-[8px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
                    <span>
                      {b.text}
                      {b.note_title && b.note_id && (
                        <button
                          type="button"
                          onClick={() => void selectNote(b.note_id!)}
                          className="ml-1.5 text-[11px] text-faint underline decoration-dotted hover:text-ink"
                        >
                          {b.note_title}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-faint">
                {brief?.error ?? 'Brief için yeterli geçmiş not yok.'}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-hairlineSoft pt-2.5">
              <span className="text-[11px] leading-relaxed text-faint">
                {brief?.usedFallback
                  ? 'yerel mod'
                  : brief?.model
                    ? `${brief.provider}/${brief.model}`
                    : 'geçmiş notlar + takvim bağlamı'}
              </span>
              <button
                type="button"
                onClick={() =>
                  void loadBrief({
                    noteId: detail?.note.id ?? null,
                    eventId: detail?.note.calendar_event_id ?? null
                  })
                }
                disabled={briefBusy}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-ink disabled:opacity-40"
              >
                <RefreshCw size={11} />
                Yenile
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* mesajlar */}
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {chatMessages.length === 0 && !chatBusy && (
              <div className="rounded-xl border border-dashed border-hairline bg-canvas/60 p-4">
                <h3 className="mb-1.5 text-[13px] font-semibold text-ink">
                  {SCOPE_LABEL[chatScope.kind]} hakkında soru sor
                </h3>
                <p className="text-[12.5px] leading-relaxed text-faint">
                  Yalnızca notlarına dayanarak yanıtlar. Bilgi yoksa “Notlarınızda bu bilgi yok” der.
                  <br />
                  <span className="text-inkSoft">/</span> yazarak hazır recipe'leri açabilirsin.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void openChatForScope('all', null)}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[11.5px] text-muted hover:bg-pill hover:text-ink"
                  >
                    Tüm notlarımda ara
                  </button>
                </div>
              </div>
            )}

            {chatMessages.map((m) => (
              <div
                key={m.id}
                className={clsx('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}
              >
                {m.role === 'assistant' ? (
                  <div className="w-full">
                    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-inkSoft">
                      {m.content_md}
                    </p>
                    {m.citations.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-hairlineSoft pt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                          Kaynaklar ({m.scanned_notes} not tarandı)
                        </p>
                        {m.citations.map((c) => (
                          <button
                            key={c.note_id + (c.excerpt ?? '')}
                            type="button"
                            onClick={() => void selectNote(c.note_id)}
                            className="block w-full rounded px-1.5 py-1 text-left text-[11px] text-inkSoft transition-colors hover:bg-pill"
                          >
                            <span className="mr-1.5 text-faint">{c.note_title}</span>
                            {c.excerpt}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-[10px] text-faint">
                      {m.used_fallback ? `yerel mod${m.error ? ` — ${m.error}` : ''}` : `${m.provider ?? ''}/${m.model ?? ''}`}
                    </p>
                  </div>
                ) : (
                  <p className="max-w-[88%] rounded-2xl rounded-tr-sm bg-bubbleMic px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                    {m.content_md}
                  </p>
                )}
              </div>
            ))}

            {chatBusy && (
              <p className="flex items-center gap-2 text-[12px] text-faint">
                <Loader2 size={13} className="animate-spin" /> Yanıt hazırlanıyor…
              </p>
            )}
          </div>

          {/* Recipes menusu */}
          {recipesOpen && (
            <div className="border-t border-hairline bg-canvas/70 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <Wand2 size={11} /> Recipes
                </span>
                <button
                  type="button"
                  className="text-[11px] text-faint hover:text-ink"
                  onClick={() => setRecipesOpen(false)}
                >
                  kapat
                </button>
              </div>
              <ul className="max-h-[180px] space-y-0.5 overflow-y-auto">
                {matchingRecipes.length === 0 && (
                  <li className="px-1 text-[11.5px] text-faint">Eşleşen recipe yok.</li>
                )}
                {matchingRecipes.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion('')
                        setRecipesOpen(false)
                        void runRecipe(r.id)
                      }}
                      className="w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-pill"
                    >
                      <span className="flex items-center gap-2">
                        <code className="rounded bg-pill px-1.5 py-[1px] text-[11px] text-inkSoft">
                          /{r.shortcut}
                        </code>
                        <span className="text-[12px] font-medium text-ink">{r.name}</span>
                        <span className="ml-auto text-[10px] text-faint">{r.scope}</span>
                      </span>
                      {r.description && (
                        <span className="mt-0.5 block text-[11px] text-faint">{r.description}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* giris */}
          <div className="border-t border-hairline p-3">
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2">
              <Waveform className="text-faint" />
              <input
                value={question}
                onChange={(e) => onQuestionChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`${SCOPE_LABEL[chatScope.kind]} hakkında sor…  (/ ile recipe)`}
                className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
              <button
                type="button"
                title="Recipe'ler"
                onClick={() => setRecipesOpen(!recipesOpen)}
                className="icon-btn h-7 w-7"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={chatBusy || !question.trim()}
                className="icon-btn h-7 w-7 disabled:opacity-40"
                title="Gönder"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* alt: transkripti goster */}
      <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-inkSoft">
          <Waveform className="text-faint" />
          Transkripti göster
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={transcriptOpen}
          onClick={() => toggleTranscript()}
          className={clsx(
            'relative h-[18px] w-[32px] rounded-full transition-colors',
            transcriptOpen ? 'bg-live' : 'bg-[#dedcd6]'
          )}
        >
          <span
            className={clsx(
              'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
              transcriptOpen ? 'left-[16px]' : 'left-[2px]'
            )}
          />
        </button>
      </div>
    </aside>
  )
}