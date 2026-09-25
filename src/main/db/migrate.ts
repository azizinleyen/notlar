// ============================================================================
//  Basit, idempotent sema gocu (migration).
//  Yaklasim: her goc "su tabloda su kolon var mi?" kontroludur; yoksa eklenir.
//  Boylece kullanicinin mevcut veritabani bozulmadan guncellenir.
// ============================================================================

import type Database from 'better-sqlite3'

interface ColumnMigration {
  table: string
  column: string
  ddl: string
}

const COLUMN_MIGRATIONS: ColumnMigration[] = [
  {
    table: 'calendar_events_cache',
    column: 'organizer',
    ddl: 'ALTER TABLE calendar_events_cache ADD COLUMN organizer TEXT'
  },
  {
    table: 'calendar_events_cache',
    column: 'all_day',
    ddl: 'ALTER TABLE calendar_events_cache ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0'
  },
  {
    table: 'calendar_events_cache',
    column: 'triggered_at',
    ddl: 'ALTER TABLE calendar_events_cache ADD COLUMN triggered_at TEXT'
  },
  {
    table: 'calendar_events_cache',
    column: 'updated_at',
    ddl: 'ALTER TABLE calendar_events_cache ADD COLUMN updated_at TEXT'
  },
  {
    table: 'notes',
    column: 'trigger_reason',
    ddl: 'ALTER TABLE notes ADD COLUMN trigger_reason TEXT'
  },
  // --- FAZ 5 ---
  {
    table: 'people',
    column: 'source',
    ddl: "ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'"
  },
  {
    table: 'people',
    column: 'created_at',
    ddl: 'ALTER TABLE people ADD COLUMN created_at TEXT'
  },
  {
    table: 'note_people',
    column: 'evidence',
    ddl: 'ALTER TABLE note_people ADD COLUMN evidence TEXT'
  },
  {
    table: 'companies',
    column: 'created_at',
    ddl: 'ALTER TABLE companies ADD COLUMN created_at TEXT'
  }
]

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined
  return Boolean(row)
}

function columnsOf(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

/**
 * Veri gocleri: yerlesik sablonlarin gorunen adlari.
 * Neden: ilk surumde sablon adlari ASCII yazilmisti ("Toplanti"), arayuzde
 * kullaniciya bozuk Turkce gorunuyordu. Yalnizca is_builtin=1 kayitlar
 * guncellenir; kullanicinin kendi sablonlarina dokunulmaz.
 */
const BUILTIN_TEMPLATE_TEXT: Array<{ id: string; name: string; description: string; prompt: string }> = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Toplantı tipini otomatik algıla, uygun şablonu uygula.',
    prompt: ''
  },
  {
    id: 'one_on_one',
    name: '1:1',
    description: 'Birebir görüşme: kişisel konular, geri bildirim, kariyer.',
    prompt: 'Bu bir 1:1 görüşmesi. Kişi bazlı konulara, geri bildirime ve kariyer/sonraki adımlara odaklan.'
  },
  {
    id: 'meeting',
    name: 'Toplantı',
    description: 'Genel toplantı: kararlar, riskler, sonraki adımlar.',
    prompt: 'Genel bir toplantı. Kararlar, riskler ve sorumlu+tarihli sonraki adımlar öne çıkarılsın.'
  },
  {
    id: 'phone_call',
    name: 'Telefon görüşmesi',
    description: 'Telefon/arama: kısa özet, anlaşılanlar, aksiyonlar.',
    prompt: 'Bu bir telefon görüşmesi. Kısa özet, anlaşılan noktalar ve aksiyonlar çıkar.'
  },
  {
    id: 'user_interview',
    name: 'Kullanıcı görüşmesi',
    description: 'Kullanıcı araştırması: ihtiyaçlar, acı noktaları, alıntılar.',
    prompt:
      'Bu bir kullanıcı görüşmesi. İhtiyaçlar, acı noktaları ve dikkat çekici alıntılar öne çıkarılsın.'
  },
  { id: 'blank', name: 'Boş', description: 'Şablon yok; sadece transkript özeti.', prompt: 'Sadece kısa bir özet ve ana konular.' }
]

function migrateBuiltinTemplateText(db: Database.Database): number {
  let changed = 0
  const stmt = db.prepare(
    `UPDATE templates SET name = @name, description = @description, prompt_body = @prompt
      WHERE id = @id AND is_builtin = 1
        AND (name <> @name OR IFNULL(description,'') <> @description OR prompt_body <> @prompt)`
  )
  for (const t of BUILTIN_TEMPLATE_TEXT) {
    const res = stmt.run({ id: t.id, name: t.name, description: t.description, prompt: t.prompt })
    if (res.changes > 0) changed++
  }
  return changed
}

/** Eksik kolonlari ekler; eklenen sayisini doner. */
export function runMigrations(db: Database.Database): number {
  let applied = 0
  for (const m of COLUMN_MIGRATIONS) {
    if (!tableExists(db, m.table)) continue
    if (columnsOf(db, m.table).has(m.column)) continue
    try {
      db.exec(m.ddl)
      applied++
      // eslint-disable-next-line no-console
      console.log(`[db] migration: ${m.table}.${m.column} eklendi`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[db] migration atlandi (${m.table}.${m.column}):`, err)
    }
  }
  // Veri gocleri (kolonlardan bagimsiz)
  try {
    const t = migrateBuiltinTemplateText(db)
    if (t > 0) {
      applied += t
      // eslint-disable-next-line no-console
      console.log(`[db] migration: ${t} yerlesik sablon adi Turkce'ye cevrildi`)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[db] sablon gocu atlandi:', err)
  }

  return applied
}