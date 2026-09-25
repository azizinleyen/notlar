// SQLCipher destekli surum kullaniyoruz (API uyumlu, drop-in).
// Boylece ayni kod hem sifresiz hem sifreli veritabani acabilir.
import Database from 'better-sqlite3-multiple-ciphers'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations } from './migrate'
import { isEncrypted, loadKey } from './crypto'

let db: Database.Database | null = null

/**
 * schema.sql yolunu bulur. Gelistirmede proje koku, paketlenmis uygulamada
 * extraResources altinda aranir. (Varsayim: db/schema.sql her zaman korunur.)
 */
function resolveSchemaPath(): string {
  const candidates = [
    join(app.getAppPath(), 'db', 'schema.sql'),
    join(process.resourcesPath ?? '', 'db', 'schema.sql'),
    join(__dirname, '..', '..', 'db', 'schema.sql'),
    join(process.cwd(), 'db', 'schema.sql')
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  throw new Error('db/schema.sql bulunamadi. Aranan yerler: ' + candidates.join(' | '))
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Veritabani baslatilmadi. Once initDatabase() cagrilmali.')
  return db
}

export function initDatabase(): Database.Database {
  // Veriyi Chromium onbellegiyle karistirmamak icin ayri alt klasor
  const dir = join(app.getPath('userData'), 'db')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'notlar.db')

  db = new Database(dbPath)

  // Sifreleme: anahtar dosyasi varsa ACILMADAN ONCE uygulanmali.
  // (SQLCipher'da PRAGMA key, ilk sorgudan once cagrilmali.)
  if (isEncrypted(dir)) {
    const key = loadKey(dir)
    if (!key) {
      throw new Error(
        'Veritabani sifreli ama anahtar cozulemedi (db.key okunamadi). ' +
          'Anahtar dosyasi baska bir kullanici hesabina ait olabilir.'
      )
    }
    db.pragma(`key = '${key}'`)
    // Anahtar dogru mu? (yanlissa ilk sorgu "file is not a database" verir)
    try {
      db.prepare('SELECT count(*) AS c FROM sqlite_master').get()
    } catch {
      throw new Error('Veritabani anahtari gecersiz (db.key ile sifre cozulemedi).')
    }
    console.log('[db] sifreli veritabani acildi (SQLCipher)')
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  const schemaSql = readFileSync(resolveSchemaPath(), 'utf-8')
  db.exec(schemaSql)

  // Mevcut veritabanlarini bozmadan eksik kolonlari ekle
  runMigrations(db)

  // eslint-disable-next-line no-console
  console.log('[db] hazir ->', dbPath)
  return db
}

/**
 * GEC RESOLVE EDEN veritabani referansi (Proxy).
 *
 * NEDEN: Sifreleme acma/kapama (PRAGMA rekey) veritabanini kapatip yeniden acar
 * ve `getDb()` YENI bir nesne doner. Uzun omurlu bilesenler (ipc handler'lari,
 * algilayici, zamanlayici, autoRecord) baslangicta `getDb()` sonucunu
 * sakladiginda, rekey sonrasi KAPANMIS baglantiyi kullanmaya devam ederdi ve
 * tum cagrilar "The database connection is not open" ile cokerdi.
 *
 * Cozum: bu proxy her erisimde guncel baglantiyi cozer. Metotlar dogru `this`
 * ile baglanir (better-sqlite3 metotlari baglantiya bagli calisir).
 */
export function lazyDb(): Database.Database {
  return new Proxy({} as Database.Database, {
    get(_target, prop) {
      const real = getDb() as unknown as Record<string | symbol, unknown>
      const value = real[prop]
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(real)
      }
      return value
    },
    has(_target, prop) {
      return prop in (getDb() as unknown as object)
    }
  })
}

/**
 * Veritabanini kapatip yeniden acar.
 * Sifreleme acma/kapama (PRAGMA rekey) sonrasi ZORUNLU: yeni anahtarla
 * yeniden baglanmak gerekir.
 */
export function reopenDatabase(): Database.Database {
  closeDatabase()
  return initDatabase()
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close()
    } catch {
      /* yoksay */
    }
    db = null
  }
}

export type { Database }