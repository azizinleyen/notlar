import type { ReactNode } from 'react'
import clsx from 'clsx'
import { colorFor, initials } from '../lib/format'

/** Kucuk, soyut monogram. Buyuk yazi/logo YOK (spesifikasyon geregi). */
export function Monogram({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Notlar">
      <rect x="3" y="4" width="26" height="20" rx="5.5" fill="#242320" />
      <path d="M10 24v6.5l7.5-6.5z" fill="#242320" />
      <rect x="9" y="11" width="14" height="2.4" rx="1.2" fill="#f6f5f2" />
      <rect x="9" y="16.4" width="9" height="2.4" rx="1.2" fill="#f6f5f2" />
    </svg>
  )
}

/** Basit dalga bicimi cizimi (transkript/kayit gostergesi) */
export function Waveform({ className }: { className?: string }) {
  const bars = [6, 12, 8, 16, 10, 14, 7, 11]
  return (
    <span className={clsx('inline-flex items-center gap-[2px]', className)} aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current"
          style={{ height: h, opacity: 0.55 + (i % 3) * 0.15 }}
        />
      ))}
    </span>
  )
}

/** Kayit sirasinda hareket eden yesil esitleyici barlar */
export function EqualizerBars({ className }: { className?: string }) {
  const delays = [0, 0.15, 0.3, 0.1, 0.25]
  return (
    <span className={clsx('inline-flex h-4 items-end gap-[2px] text-live', className)} aria-hidden>
      {delays.map((d, i) => (
        <span
          key={i}
          className="eq-bar h-full w-[3px] rounded-full bg-current"
          style={{ animationDelay: `${d}s` }}
        />
      ))}
    </span>
  )
}

export function Avatar({
  name,
  src,
  size = 24
}: {
  name: string
  src?: string | null
  size?: number
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        title={name}
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-surface"
      />
    )
  }
  return (
    <span
      title={name}
      className="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  )
}

export function AvatarStack({
  people,
  max = 4,
  size = 24
}: {
  people: Array<{ id: string; name: string; avatar_url?: string | null }>
  max?: number
  size?: number
}) {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} src={p.avatar_url} size={size} />
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-pill font-medium text-muted ring-2 ring-surface"
          style={{ width: size, height: size, fontSize: size * 0.36 }}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors',
        checked ? 'bg-live' : 'bg-[#dedcd6]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[16px]' : 'left-[2px]'
        )}
      />
    </button>
  )
}

export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-live">
      <span className="live-dot inline-block h-[7px] w-[7px] rounded-full bg-live" />
      Kayıt canlı
    </span>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-[13px] leading-relaxed text-faint">{children}</p>
}