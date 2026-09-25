import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import clsx from 'clsx'
import { attachMainEvents, useAppStore } from './store/useAppStore'
import Sidebar from './components/Sidebar'
import NoteEditor from './components/NoteEditor'
import ChatPanel from './components/ChatPanel'
import TranscriptPanel from './components/TranscriptPanel'
import ImportDialog from './components/ImportDialog'
import RecordDialog from './components/RecordDialog'
import RecordBar from './components/RecordBar'
import DirectoryPanel from './components/DirectoryPanel'
import StatusStrip from './components/StatusStrip'
import SettingsDialog from './components/SettingsDialog'
import { Monogram } from './components/primitives'

function ToastHost() {
  const toast = useAppStore((s) => s.toast)
  const clear = useAppStore((s) => s.toastClear)
  if (!toast) return null
  const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info
  return (
    <div className="fixed bottom-5 right-5 z-50 w-[330px]">
      <div
        className={clsx(
          'flex items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-pop',
          toast.kind === 'error' ? 'border-red-200' : 'border-hairline'
        )}
      >
        <Icon
          size={17}
          className={clsx(
            'mt-[1px] shrink-0',
            toast.kind === 'success' ? 'text-live' : toast.kind === 'error' ? 'text-red-500' : 'text-muted'
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{toast.message}</p>
          {toast.detail && <p className="mt-1 text-[12px] leading-relaxed text-faint">{toast.detail}</p>}
        </div>
        <button type="button" className="icon-btn h-6 w-6" onClick={clear}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const ready = useAppStore((s) => s.ready)
  const view = useAppStore((s) => s.view)

  useEffect(() => {
    // Canli kayit olaylari (main -> renderer) bir kez baglanir
    attachMainEvents()
    void bootstrap()
  }, [bootstrap])

  if (!ready) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas">
        <Monogram size={34} />
        <p className="text-[13px] text-faint">Notlar hazırlanıyor...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas">
      {/* Ust durum seridi: yalnizca eksik/uyari durumunda gorunur */}
      <StatusStrip />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        {view.kind === 'note' ? <NoteEditor /> : <DirectoryPanel />}
        <ChatPanel />
        <TranscriptPanel />
      </div>
      <ImportDialog />
      <RecordDialog />
      <RecordBar />
      <SettingsDialog />
      <ToastHost />
    </div>
  )
}