// ============================================================================
//  FAZ 5 — Kapsamli soru-cevap bileseni (kisi / sirket / not).
//  Ayni altyapi Faz 6'daki "Soru sor" sekmesini de besler.
// ============================================================================

import { useState } from 'react'
import { Loader2, Send, Sparkles } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export default function ScopedAsk({
  scopeLabel,
  scope
}: {
  scopeLabel: string
  scope: { kind: 'person' | 'company' | 'note' | 'all'; id?: string | null }
}) {
  const askQuestion = useAppStore((s) => s.askQuestion)
  const askBusy = useAppStore((s) => s.askBusy)
  const askResult = useAppStore((s) => s.askResult)
  const selectNote = useAppStore((s) => s.selectNote)
  const [question, setQuestion] = useState('')

  const submit = (): void => {
    const q = question.trim()
    if (!q || askBusy) return
    void askQuestion(q, scope)
  }

  return (
    <section className="rounded-xl border border-hairline bg-canvas/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={14} className="text-inkSoft" />
        <h3 className="text-[13px] font-semibold text-ink">Soru sor — {scopeLabel}</h3>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Ör. en son ne karar verildi? hangi konular açık kaldı?"
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={submit}
          disabled={askBusy || !question.trim()}
          className="icon-btn h-7 w-7 disabled:opacity-40"
          title="Sor"
        >
          {askBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>

      {askBusy && <p className="mt-2 text-[11.5px] text-faint">Yanıt hazırlanıyor…</p>}

      {askResult && !askBusy && (
        <div className="mt-3">
          <div className="rounded-lg border border-hairline bg-surface px-3.5 py-3">
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-inkSoft">
              {askResult.answer_md || (askResult.error ?? 'Yanıt yok')}
            </p>
            {askResult.citations.length > 0 && (
              <div className="mt-2.5 space-y-1 border-t border-hairlineSoft pt-2.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                  Kaynaklar ({askResult.scanned_notes} not tarandı)
                </p>
                {askResult.citations.map((c) => (
                  <button
                    key={c.note_id + (c.excerpt ?? '')}
                    type="button"
                    onClick={() => void selectNote(c.note_id)}
                    className="block w-full rounded px-1.5 py-1 text-left text-[11.5px] text-inkSoft transition-colors hover:bg-pill"
                  >
                    <span className="mr-1.5 text-faint">{c.note_title}</span>
                    {c.excerpt}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10.5px] text-faint">
              {askResult.usedFallback
                ? `yerel mod${askResult.error ? ` — ${askResult.error}` : ''}`
                : `${askResult.provider ?? ''}/${askResult.model ?? ''}`}
            </p>
          </div>
        </div>
      )}

      {!askResult && !askBusy && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Yalnızca notlarına dayanarak yanıtlar; bilgi yoksa “Notlarınızda bu bilgi yok” der.
        </p>
      )}
    </section>
  )
}