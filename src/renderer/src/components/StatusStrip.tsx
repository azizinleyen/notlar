// ============================================================================
//  Ust durum seridi.
//
//  NEDEN: Kullanici "kayit/transkript calismiyor" dediginde SEBEBI gormuyordu;
//  yalnizca diyalog icinde kucuk bir uyari vardi. Artik anahtarsiz durumda
//  en ustte kalici, tiklanabilir bir uyari durur ve dogrudan Ayarlar'i acar.
// ============================================================================

import { AlertTriangle, KeyRound, X } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { useAppStore } from '../store/useAppStore'

export default function StatusStrip() {
  const hasApiKey = useAppStore((s) => s.hasApiKey)
  const openSettings = useAppStore((s) => s.openSettings)
  const recording = useAppStore((s) => s.recording)
  const [dismissed, setDismissed] = useState(false)

  // Anahtar var ya da kullanici kapatti -> hicbir sey gosterme (sade arayuz)
  if (hasApiKey || dismissed) return null

  return (
    <div
      className={clsx(
        'flex shrink-0 items-center gap-2.5 border-b px-3 py-1.5 text-[12px]',
        'border-amber-200 bg-amber-50 text-amber-900'
      )}
    >
      <AlertTriangle size={14} className="shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold">API anahtarı yok.</strong> Canlı transkript ve AI not üretimi
        çalışmaz.
        {recording.active && ' (Kayıt sürüyor ama yazıya dökülemez.)'}
      </span>
      <button
        type="button"
        onClick={() => openSettings(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-[3px] text-[11.5px] font-medium text-white hover:bg-amber-700"
      >
        <KeyRound size={12} />
        Anahtar ekle
      </button>
      <button
        type="button"
        title="Gizle"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100"
      >
        <X size={13} />
      </button>
    </div>
  )
}