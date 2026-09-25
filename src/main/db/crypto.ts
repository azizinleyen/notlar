// ============================================================================
//  Veritabani sifrelemesi (SQLCipher) — anahtar yonetimi.
//
//  TASARIM NOTU (chicken-and-egg): "sifreleme acik mi" bilgisi veritabaninin
//  ICINDE tutulamaz, cunku veritabani acilirken anahtar gerekiyor. Bu yuzden
//  sifreleme durumu ANAHTAR DOSYASININ VARLIGI ile belirlenir:
//      <userData>/db/db.key  varsa  -> sifreli
//      yoksa                        -> sifresiz
//
//  Anahtar saklama: Electron `safeStorage` (Windows'ta DPAPI).
//  Yani anahtar, kullanici hesabina bagli olarak isletim sistemi tarafindan
//  sifrelenir; baska bir kullanici/makine dosyayi kopyalasa bile cozemez.
//  safeStorage yoksa sifreleme ACILAMAZ (sessizce sifresiz devam etmek
//  yaniltici olurdu).
// ============================================================================

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { safeStorage } from 'electron'

export const KEY_FILE = 'db.key'

/** Anahtar dosyasinin yolu (veritabaniyla ayni klasorde). */
export function keyPath(dbDir: string): string {
  return join(dbDir, KEY_FILE)
}

export function isEncrypted(dbDir: string): boolean {
  return existsSync(keyPath(dbDir))
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Yeni bir parola uretir.
 * 64 hex karakter: SQL `PRAGMA key = '...'` icinde kacis gerektirmez ve
 * yuksek entropi saglar (32 bayt).
 */
export function generateKey(): string {
  return randomBytes(32).toString('hex')
}

/** Parolayi DPAPI ile sifreleyip diske yazar. */
export function saveKey(dbDir: string, passphrase: string): void {
  if (!encryptionAvailable()) {
    throw new Error(
      'Isletim sistemi anahtar deposu (Windows DPAPI) kullanilamiyor; sifreleme acilamaz.'
    )
  }
  const encrypted = safeStorage.encryptString(passphrase)
  writeFileSync(keyPath(dbDir), encrypted.toString('base64'), { encoding: 'utf-8', mode: 0o600 })
}

/** Parolayi diskten okuyup DPAPI ile cozer. Yoksa/cozulemezse null. */
export function loadKey(dbDir: string): string | null {
  const kp = keyPath(dbDir)
  if (!existsSync(kp)) return null
  try {
    const b64 = readFileSync(kp, 'utf-8').trim()
    if (!b64) return null
    if (!encryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}

export function removeKey(dbDir: string): void {
  rmSync(keyPath(dbDir), { force: true })
}

/**
 * Dosya gercekten sifreli mi? (SQLCipher ile sifrelenmis veritabanlari
 * "SQLite format 3" basligiyla BASLAMAZ.)
 * Yalnizca teshis/dogrulama icin.
 */
export function fileLooksPlaintext(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false
    const buf = readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, 16)
    return buf.toString('latin1') === 'SQLite format 3\u0000'
  } catch {
    return false
  }
}