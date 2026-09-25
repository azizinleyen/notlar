// ============================================================================
//  FAZ 7 — Guvenlik: veritabani sifreleme ac/kapat, yedekleme, veri silme.
//
//  Sifreleme: SQLCipher (better-sqlite3-multiple-ciphers) + anahtar Windows
//  DPAPI ile korunur (db/crypto.ts).
//
//  ### NEDEN BU KADAR DETAYLI (gercek hata notu)
//  Ilk denemede sifreleme "acildi" ama uygulama "file is not a database" ile
//  coktu. Sebep: veritabani WAL modunda ve `-wal` dosyasinda DUZ METIN sayfalar
//  vardi. `PRAGMA rekey` ana dosyayi sifreledi, ama WAL'de kalan duz metin
//  sayfalar okunmaya calisilinca SQLite dosyayi bozuk sandi.
//
//  Cozum: rekey'den ONCE `PRAGMA journal_mode = DELETE` ile WAL'i ana dosyaya
//  isleyip (-wal/-shm silinir), SONRA rekey uygulamak. Uygulama acilista
//  WAL moduna geri doner.
//
//  Ayrica her adimda GERI ALMA (rollback) vardir: bir adim basarisiz olursa
//  anahtar dosyasi ve sifreleme durumu TUTARLI birakilir; asla "anahtari
//  kaybolmus sifreli veritabani" durumuna dusulmez.
// ============================================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  encryptionAvailable,
  fileLooksPlaintext,
  generateKey,
  isEncrypted,
  loadKey,
  removeKey,
  saveKey
} from '../db/crypto'

export interface SecurityStatus {
  encrypted: boolean
  encryptionAvailable: boolean
  dbPath: string
  dbSizeBytes: number
  fileIsPlaintext: boolean
  consistent: boolean
  keyPath: string
  backups: Array<{ name: string; sizeBytes: number; createdAt: string }>
  /** Sifreleme ACIKKEN duz metin kalan yedek sayisi (>0 ise uyari) */
  plaintextBackupCount: number
}

function dbDir(): string {
  return join(app.getPath('userData'), 'db')
}

function dbFilePath(): string {
  return join(dbDir(), 'notlar.db')
}

function backupDir(): string {
  return join(dbDir(), 'backups')
}

// --- dusuk seviyeli yardimcilar -------------------------------------------

/** Veritabani verilen anahtarla acilip sorgu calistirilabiliyor mu? */
function canOpen(path: string, key?: string | null): boolean {
  let db: Database.Database | null = null
  try {
    db = new Database(path)
    if (key) db.pragma(`key = '${key}'`)
    db.prepare('SELECT count(*) AS c FROM sqlite_master').get()
    return true
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* yoksay */
    }
  }
}

/**
 * Dosyayi anahtarlar arasinda donusturur.
 * @param fromKey mevcut anahtar (null = duz metin)
 * @param toKey   hedef anahtar (null = sifreyi kaldir)
 *
 * KRITIK: `journal_mode = DELETE` ile WAL once ana dosyaya islenir; aksi halde
 * `-wal` icindeki duz metin sayfalar sifreleme sonrasi bozuk veri gibi okunur.
 */
function rekeyFile(path: string, fromKey: string | null, toKey: string | null): void {
  const db = new Database(path)
  try {
    if (fromKey) db.pragma(`key = '${fromKey}'`)
    // WAL'i kapat ve ana dosyaya isle (-wal / -shm silinir)
    db.pragma('journal_mode = DELETE')
    db.pragma(toKey ? `rekey = '${toKey}'` : "rekey = ''")
  } finally {
    db.close()
  }
}

/** WAL/shm kalintilarini temizler (basarisiz islemlerden kalabilir). */
function clearWalFiles(path: string): void {
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(path + suffix, { force: true })
    } catch {
      /* yoksay */
    }
  }
}

/**
 * Yedek dosyalarini anahtarla SIFRELER / sifresini COZER.
 *
 * NEDEN GEREKLI (gercek guvenlik acigi): Sifreleme acildiginda ESKI yedekler
 * duz metin kaliyordu; yani tum not arsivinin okunabilir bir kopyasi diskte
 * duruyordu ve "veritabani sifreli" demek yaniltici oluyordu.
 * Sifreleme acilirken yedekler de ayni anahtarla sifrelenir; kapatilirken
 * (anahtar silinmeden ONCE) tekrar duz metne cevrilir — aksi halde yedekler
 * anahtarsiz kalirdi ve kurtarma imkansiz olurdu.
 *
 * @returns islenen dosya sayisi
 */
function convertBackupFiles(passphrase: string, direction: 'encrypt' | 'decrypt'): number {
  let done = 0
  let files: string[] = []
  try {
    files = readdirSync(backupDir()).filter((f) => f.endsWith('.db'))
  } catch {
    return 0
  }
  for (const f of files) {
    const full = join(backupDir(), f)
    const plain = fileLooksPlaintext(full)
    // Zaten istenen durumdaysa atla
    if (direction === 'encrypt' && !plain) continue
    if (direction === 'decrypt' && plain) continue
    try {
      if (direction === 'encrypt') rekeyFile(full, null, passphrase)
      else rekeyFile(full, passphrase, null)
      // Dogrula
      const ok = direction === 'encrypt' ? canOpen(full, passphrase) : canOpen(full, null)
      if (ok) done++
    } catch {
      /* tek dosya hatasi islemi durdurmasin */
    }
  }
  return done
}

// --- durum ----------------------------------------------------------------

export function securityStatus(): SecurityStatus {
  const path = dbFilePath()
  const enc = isEncrypted(dbDir())
  const plain = existsSync(path) ? fileLooksPlaintext(path) : false
  let backups: SecurityStatus['backups'] = []
  let plaintextBackupCount = 0
  try {
    const files = readdirSync(backupDir()).filter((f) => f.endsWith('.db'))
    for (const f of files) {
      if (fileLooksPlaintext(join(backupDir(), f))) plaintextBackupCount++
    }
    backups = files
      .map((f) => {
        const st = statSync(join(backupDir(), f))
        return { name: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    backups = []
  }
  return {
    encrypted: enc,
    encryptionAvailable: encryptionAvailable(),
    dbPath: path,
    dbSizeBytes: existsSync(path) ? statSync(path).size : 0,
    fileIsPlaintext: plain,
    consistent: enc ? !plain : plain || !existsSync(path),
    keyPath: join(dbDir(), 'db.key'),
    backups,
    plaintextBackupCount
  }
}

// --- yedekleme -------------------------------------------------------------

/**
 * Tutarli bir yedek olusturur.
 * WAL icerigi ana dosyaya islenir (checkpoint) ki kopya TAM olsun; aksi halde
 * yalnizca eski sayfalar kopyalanir (gercek hata olarak yasandi).
 */
export function backupDatabase(reason = 'manual'): string | null {
  const src = dbFilePath()
  if (!existsSync(src)) return null
  mkdirSync(backupDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(backupDir(), `notlar-${reason}-${stamp}.db`)

  const key = isEncrypted(dbDir()) ? loadKey(dbDir()) : null
  let db: Database.Database | null = null
  try {
    db = new Database(src)
    if (key) db.pragma(`key = '${key}'`)
    // WAL'i ana dosyaya isle (TRUNCATE da yeterli; DELETE dosyalari kaldirir)
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* checkpoint yapilamazsa duz kopya denenir */
  } finally {
    try {
      db?.close()
    } catch {
      /* yoksay */
    }
  }

  copyFileSync(src, target)
  return target
}

/** Eski yedekleri temizler; en yeni `keep` tanesini tutar. */
export function pruneBackups(keep = 5): number {
  try {
    const files = readdirSync(backupDir())
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ f, t: statSync(join(backupDir(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    let removed = 0
    for (const { f } of files.slice(keep)) {
      rmSync(join(backupDir(), f), { force: true })
      removed++
    }
    return removed
  } catch {
    return 0
  }
}

// --- sifreleme -------------------------------------------------------------

export interface RekeyResult {
  ok: boolean
  encrypted: boolean
  backupPath?: string
  error?: string
  verified?: boolean
  /** Sifreleme acilirken sifrelenen yedek sayisi */
  encryptedBackups?: number
  /** Sifreleme kapatilirken cozulen yedek sayisi */
  decryptedBackups?: number
}

export interface RekeyHooks {
  close: () => void
  reopen: () => void
}

/** Sifrelemeyi acar. Her adimda geri donusumu garanti eder. */
export async function enableEncryption(hooks: RekeyHooks): Promise<RekeyResult> {
  if (!encryptionAvailable()) {
    return {
      ok: false,
      encrypted: false,
      error: 'Isletim sistemi anahtar deposu (Windows DPAPI) kullanilamiyor.'
    }
  }
  if (isEncrypted(dbDir())) return { ok: false, encrypted: true, error: 'Sifreleme zaten acik.' }

  const path = dbFilePath()
  if (!existsSync(path)) return { ok: false, encrypted: false, error: 'Veritabani dosyasi yok.' }
  if (!canOpen(path, null)) {
    return {
      ok: false,
      encrypted: false,
      error: 'Veritabani su an acilamiyor (baslik veya WAL bozuk); once yedekten geri donun.'
    }
  }

  let backupPath: string | undefined
  hooks.close()

  try {
    // 1) Once yedek (checkpoint dahil)
    backupPath = backupDatabase('pre-encrypt') ?? undefined

    // 2) Duz metin -> sifreli
    const passphrase = generateKey()
    rekeyFile(path, null, passphrase)
    clearWalFiles(path)

    // 3) Anahtari yaz; BASARISIZ olursa sifrelemeyi GERI AL (aksi halde
    //    anahtarsiz sifreli veritabani kalirdi — duzeltilen gercek hata)
    try {
      saveKey(dbDir(), passphrase)
    } catch (err) {
      rekeyFile(path, passphrase, null)
      clearWalFiles(path)
      hooks.reopen()
      return {
        ok: false,
        encrypted: false,
        backupPath,
        error:
          'Anahtar kaydedilemedi, sifreleme geri alindi: ' +
          (err instanceof Error ? err.message : String(err)),
        verified: false
      }
    }

    // 3b) ESKI YEDEKLERI DE SIFRELE (aksi halde duz metin kopya kalirdi)
    const encryptedBackups = convertBackupFiles(passphrase, 'encrypt')

    // 4) Dogrulama: anahtarla gercekten acilabiliyor mu?
    if (!canOpen(path, passphrase)) {
      removeKey(dbDir())
      rekeyFile(path, passphrase, null)
      clearWalFiles(path)
      hooks.reopen()
      return {
        ok: false,
        encrypted: false,
        backupPath,
        error: 'Dogrulama basarisiz, sifreleme geri alindi.',
        verified: false
      }
    }

    // 5) Ayni anahtarla acilmamasi da beklenir (yanlis anahtar reddi)
    const keylessRejected = !canOpen(path, null)

    hooks.reopen()
    pruneBackups(5)
    return {
      ok: true,
      encrypted: true,
      backupPath,
      verified: keylessRejected,
      encryptedBackups
    }
  } catch (err) {
    // Beklenmedik hata: anahtar yoksa sifreleme de olmamali -> kalintilari temizle
    if (!isEncrypted(dbDir())) clearWalFiles(path)
    try {
      hooks.reopen()
    } catch {
      /* yoksay */
    }
    return {
      ok: false,
      encrypted: isEncrypted(dbDir()),
      backupPath,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Sifrelemeyi kaldirir (veri silinmez). */
export async function disableEncryption(hooks: RekeyHooks): Promise<RekeyResult> {
  if (!isEncrypted(dbDir())) return { ok: false, encrypted: false, error: 'Sifreleme zaten kapali.' }
  const path = dbFilePath()
  const key = loadKey(dbDir())
  if (!key) {
    return {
      ok: false,
      encrypted: true,
      error: 'Anahtar cozulemedi (db.key okunamadi); sifreleme kaldirilamaz.'
    }
  }

  let backupPath: string | undefined
  hooks.close()
  try {
    backupPath = backupDatabase('pre-decrypt') ?? undefined

    rekeyFile(path, key, null)
    clearWalFiles(path)

    if (!canOpen(path, null)) {
      // Beklenmedik: geri al (veri erisilebilir kalsin)
      rekeyFile(path, null, key)
      clearWalFiles(path)
      hooks.reopen()
      return {
        ok: false,
        encrypted: true,
        backupPath,
        error: 'Sifreleme kaldirilamadi; degisiklik geri alindi.',
        verified: false
      }
    }

    // Yedekleri anahtar SILINMEDEN ONCE coz (aksi halde erisilemez kalirlardi)
    const decryptedBackups = convertBackupFiles(key, 'decrypt')

    removeKey(dbDir())
    hooks.reopen()
    pruneBackups(5)
    return { ok: true, encrypted: false, backupPath, verified: true, decryptedBackups }
  } catch (err) {
    try {
      hooks.reopen()
    } catch {
      /* yoksay */
    }
    return {
      ok: false,
      encrypted: isEncrypted(dbDir()),
      backupPath,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Acilista tutarlilik kontrolu: anahtar var ama dosya duz metin (veya tersi)
 * ise ACIK bir uyari uretir. Sessiz bozulma yerine teshis edilebilir olsun.
 */
export function checkEncryptionConsistency(): { ok: boolean; message?: string } {
  const path = dbFilePath()
  if (!existsSync(path)) return { ok: true }
  const enc = isEncrypted(dbDir())
  const plain = fileLooksPlaintext(path)

  if (enc && plain) {
    return {
      ok: false,
      message:
        'Anahtar dosyasi var ama veritabani duz metin gorunuyor. Sifreleme yarim kalmis olabilir; Ayarlar > Guvenlik bolumunden kontrol edin.'
    }
  }
  if (!enc && !plain) {
    return {
      ok: false,
      message:
        'Veritabani sifreli ama anahtar dosyasi bulunamadi. Veriye erisilemez; yedekten geri donmek gerekebilir.'
    }
  }
  return { ok: true }
}