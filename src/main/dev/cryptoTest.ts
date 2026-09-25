// ============================================================================
//  GELISTIRME ARACI: SQLCipher yetenek testi.
//  `electron . --db-crypto-test`
//
//  Dogrular:
//   1) Duz metin DB olusturuluyor mu,
//   2) PRAGMA rekey ile SIFRELENIYOR mu (anahtarla acilip okunabiliyor mu),
//   3) baslik gercekten degisiyor mu (WAL sonrasi),
//   4) PRAGMA rekey='' ile sifre cozuluyor mu.
// ============================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'

function header(path: string): string {
  try {
    const buf = readFileSync(path)
    return JSON.stringify(buf.subarray(0, 16).toString('latin1'))
  } catch {
    return '(okunamadi)'
  }
}

function openOk(path: string, key?: string): { ok: boolean; rows?: number; error?: string } {
  try {
    const db = new Database(path)
    if (key) db.pragma(`key = '${key}'`)
    const r = db.prepare('SELECT count(*) AS c FROM notes').get() as { c: number }
    db.close()
    return { ok: true, rows: r.c }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function runCryptoTest(log: (m: string) => void): void {
  // safeStorage (DPAPI) kullanilabilir mi? Anahtar saklama buna bagli.
  try {
    const avail = safeStorage.isEncryptionAvailable()
    log(`[crypto] 0) safeStorage.isEncryptionAvailable=${avail}`)
    if (avail) {
      const enc = safeStorage.encryptString('test')
      const dec = safeStorage.decryptString(enc)
      log(`[crypto]    sifrele/coz turu: ${dec === 'test' ? 'OK' : 'BASARISIZ'} (${enc.length} bayt)`)
    }
  } catch (err) {
    log(`[crypto]    safeStorage HATASI: ${err instanceof Error ? err.message : String(err)}`)
  }

  const dir = mkdtempSync(join(tmpdir(), 'notlar-crypto-'))
  const path = join(dir, 'test.db')
  const pass = 'a1b2c3d4e5f6'.repeat(2)

  try {
    // 1) Duz metin DB
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)')
    db.prepare('INSERT INTO notes (id, title) VALUES (?, ?)').run('1', 'Merhaba dünya')
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    log(`[crypto] 1) duz metin olusturuldu  baslik=${header(path)} boyut=${statSync(path).size}`)
    log(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`)
    log(`[crypto]    yanlis anahtarla acilis: ${JSON.stringify(openOk(path, 'yanlis-anahtar'))}`)

    // 2) rekey ile sifrele
    const db2 = new Database(path)
    db2.pragma(`rekey = '${pass}'`)
    db2.close()
    log(`[crypto] 2) rekey uygulandi       baslik=${header(path)} boyut=${statSync(path).size}`)
    log(`[crypto]    anahtarla acilis: ${JSON.stringify(openOk(path, pass))}`)
    log(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`)

    // 3) WAL/shm kalinti var mi
    for (const suffix of ['-wal', '-shm']) {
      const extra = path + suffix
      log(`[crypto]    ${suffix} var mi: ${existsSync(extra)}`)
    }

    // 4) sifreyi kaldir
    const db3 = new Database(path)
    db3.pragma(`key = '${pass}'`)
    db3.pragma("rekey = ''")
    db3.close()
    log(`[crypto] 4) sifre kaldirildi      baslik=${header(path)}`)
    log(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`)
  } catch (err) {
    log(`[crypto] HATA: ${err instanceof Error ? err.stack : String(err)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* yoksay */
    }
    log('[crypto] gecici klasor silindi')
  }
}