// ============================================================================
//  Windows sistem taramasi: mikrofon kullanicilari + calisan surecler.
//
//  NEDEN BOYLE: Windows'ta "hangi uygulama mikrofonu kullaniyor" bilgisi
//  CapabilityAccessManager\ConsentStore\microphone altinda tutulur:
//    ...\NonPackaged\<C:#yol#App.exe>   -> LastUsedTimeStart / LastUsedTimeStop (FILETIME)
//    ...\Packaged\<PaketAdi>            -> Store uygulamalari
//  LastUsedTimeStop == 0  =>  SU AN kullaniyor.
//
//  Kod sayfasi sorunu: reg.exe cikitisi OEM kod sayfasinda gelir ve Turkce
//  karakterli yollari bozar. Bu yuzden PowerShell (-NoProfile) ile okuyup
//  UTF-8 JSON donduruyoruz. Maliyeti ~250 ms; yalnizca otomatik baslatma
//  ACIKKEN ve 4 sn'de bir calisir.
// ============================================================================

import { execFile } from 'node:child_process'
import type { DetectSnapshot, MicUser, ProcessInfo } from '@shared/types'

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$base = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
$mic = @()
foreach ($sub in @('NonPackaged','Packaged')) {
  $key = Join-Path $base $sub
  if (Test-Path $key) {
    foreach ($item in (Get-ChildItem $key)) {
      $p = Get-ItemProperty $item.PSPath
      $start = $p.LastUsedTimeStart
      $stop  = $p.LastUsedTimeStop
      if ($null -eq $start) { $start = 0 }
      if ($null -eq $stop)  { $stop = 0 }
      $name = $item.PSChildName
      if ($sub -eq 'NonPackaged') { $decoded = $name -replace '#','\\' } else { $decoded = $name }
      $mic += [pscustomobject]@{
        kid   = $sub
        name  = $decoded
        start = [string]$start
        stop  = [string]$stop
      }
    }
  }
}
$procs = @()
foreach ($pr in (Get-Process)) {
  $t = ''
  try { $t = $pr.MainWindowTitle } catch { $t = '' }
  if ($null -eq $t) { $t = '' }
  $procs += [pscustomobject]@{ name = $pr.ProcessName; pid = $pr.Id; title = $t }
}
[pscustomobject]@{ mic = $mic; procs = $procs } | ConvertTo-Json -Compress -Depth 5
`

/**
 * FILETIME (100 ns, 1601-01-01 tabanli) -> ISO string.
 * DIKKAT: FILETIME degerleri ~1.34e17'dir ve JS Number'in guvenli tamsayi
 * sinirini (9.007e15) ASAR. Bu yuzden BigInt ile bolme yapilir (tam sonuc).
 */
export function filetimeToIso(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let ticks: bigint
  try {
    ticks = trimmed.startsWith('0x') ? BigInt(trimmed) : BigInt(trimmed)
  } catch {
    return null
  }
  if (ticks <= 0n) return null
  const ms = Number(ticks / 10000n) - 11644473600000
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

interface RawMicEntry {
  kid?: string
  name?: string
  start?: string
  stop?: string
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function normalizeMic(entries: RawMicEntry[]): MicUser[] {
  return entries
    .filter((e) => Boolean(e?.name))
    .map((e) => {
      const startNum = e.start?.startsWith('0x') ? Number(BigInt(e.start)) : Number(e.start ?? 0)
      const stopNum = e.stop?.startsWith('0x') ? Number(BigInt(e.stop)) : Number(e.stop ?? 0)
      const exePath = (e.name ?? '').replace(/\//g, '\\')
      const parts = exePath.split('\\')
      return {
        exePath,
        exe: parts[parts.length - 1] ?? exePath,
        // Store uygulamalarinda (Packaged) bitis degeri 0 kalabilir; yol da
        // gercek exe olmadigi icin aktiflik kontrolunu yalnizca start>0 ile yapariz.
        active: stopNum === 0 && startNum > 0 && e.kid === 'NonPackaged',
        startAt: filetimeToIso(e.start),
        stopAt: stopNum === 0 ? null : filetimeToIso(e.stop)
      }
    })
    .sort((a, b) => (b.startAt ?? '').localeCompare(a.startAt ?? ''))
}

/** Tek tarama: mikrofon kullanicilari + surecler. Hata halinde bos doner. */
export function takeSnapshot(): Promise<DetectSnapshot> {
  return new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        const empty: DetectSnapshot = { micUsers: [], processes: [], takenAt: new Date().toISOString() }
        if (err && !stdout) {
          console.warn('[detect] tarama basarisiz:', err.message)
          resolve(empty)
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as { mic?: RawMicEntry | RawMicEntry[]; procs?: ProcessInfo | ProcessInfo[] }
          const processes = toArray(parsed.procs).map((p) => ({
            name: String(p?.name ?? ''),
            pid: Number(p?.pid ?? 0),
            title: String(p?.title ?? '')
          }))
          resolve({
            micUsers: normalizeMic(toArray(parsed.mic)),
            processes,
            takenAt: new Date().toISOString()
          })
        } catch (parseErr) {
          console.warn('[detect] tarama JSON hatasi:', parseErr)
          resolve(empty)
        }
      }
    )
    child.on('error', () =>
      resolve({ micUsers: [], processes: [], takenAt: new Date().toISOString() })
    )
  })
}