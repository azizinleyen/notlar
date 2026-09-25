-- ============================================================================
--  Notlar - Yerel SQLite semasi  (tek kullanicili, botless AI toplanti defteri)
--  Felsefe: yerel-once. Bulut sadece STT/LLM cagrisi icin opsiyonel.
--  KASITLI OLARAK YOK: user, workspace, share, billing, api_key tablolari.
--  Tarihler ISO-8601 (UTC) TEXT olarak tutulur.  Sure alanlari milisaniye (INT).
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ---------------------------------------------------------------------------
-- meta: sema surumu (ileride migration icin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta(key, value) VALUES ('schema_version', '1')
  ON CONFLICT(key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- notes: her toplanti/girusum = bir not. status akisi: recording -> processing -> ready|failed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT 'Yeni not',
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  source            TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('calendar','call','manual','import')),
  calendar_event_id TEXT,
  status            TEXT NOT NULL DEFAULT 'ready'
                      CHECK (status IN ('recording','processing','ready','failed')),
  fail_reason       TEXT,
  -- Otomatik tetikleme ile acildiysa nedeni (or. 'call:Zoom.exe', 'calendar:<uid>')
  trigger_reason    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_started_at ON notes(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_status     ON notes(status);

-- ---------------------------------------------------------------------------
-- raw_notes: KULLANICININ elle yazdigi ham notlar (cekirdek). 1 not = 1 kayit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_notes (
  note_id    TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  content_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- transcripts: kanal etiketli transkript satirlari
--   channel 'system' => karsi taraf (gri balon, solda)
--   channel 'mic'    => ben          (yesil balon, sagda)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcripts (
  id            TEXT PRIMARY KEY,
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('mic','system')),
  speaker_label TEXT,
  text          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL DEFAULT 0,
  end_ms        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_transcripts_note    ON transcripts(note_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_transcripts_channel ON transcripts(note_id, channel);

-- ---------------------------------------------------------------------------
-- enhanced_notes: LLM'in urettigi yapilandirilmis not (versiyonlu)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enhanced_notes (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  content_md  TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  model       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_enhanced_note ON enhanced_notes(note_id, version DESC);

-- ---------------------------------------------------------------------------
-- citations: her AI maddesinin kaynagi (buyutec ikonu bunu gosterir)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citations (
  id               TEXT PRIMARY KEY,
  enhanced_note_id TEXT NOT NULL REFERENCES enhanced_notes(id) ON DELETE CASCADE,
  sentence_ref     TEXT NOT NULL,          -- orn: "summary:2"
  source_type      TEXT NOT NULL CHECK (source_type IN ('transcript','raw_note','calendar')),
  source_id        TEXT,                   -- transcripts.id / raw_notes.note_id / calendar_event_id
  excerpt          TEXT
);
CREATE INDEX IF NOT EXISTS idx_citations_enh ON citations(enhanced_note_id);

-- ---------------------------------------------------------------------------
-- templates: not uretim sablonlari (Auto, 1:1, Toplanti, Telefon, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  prompt_body TEXT NOT NULL,
  is_builtin  INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- tags + note_tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- people & companies (notlardan otomatik cikarim; kullanici salt-okur)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  domain   TEXT,
  logo_url TEXT
);
CREATE TABLE IF NOT EXISTS people (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  title      TEXT,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  avatar_url TEXT,
  -- 'auto' (notlardan cikarildi) | 'manual' (kullanici duzeltti/gizledi)
  source     TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS note_people (
  note_id   TEXT NOT NULL REFERENCES notes(id)   ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id)  ON DELETE CASCADE,
  role      TEXT,                                  -- 'participant' | 'owner' | 'mentioned'
  -- Bu kisinin bu notta gectigine dair kanit cumlesi (izlenebilirlik)
  evidence  TEXT,
  PRIMARY KEY (note_id, person_id)
);

-- ---------------------------------------------------------------------------
-- attachments (meta dosyasi; asil dosya kullanici klasorunde)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- calendar_events_cache: takvim tetiklemesi icin salt-okunur yerel onbellek (Faz 3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events_cache (
  id           TEXT PRIMARY KEY,
  calendar_id  TEXT,
  title        TEXT NOT NULL,
  start_at     TEXT NOT NULL,
  end_at       TEXT,
  location     TEXT,
  description  TEXT,
  participants TEXT,          -- JSON dizi (katilimci adlari)
  organizer    TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,
  -- Tetiklendiyse zaman damgasi: ayni etkinlik icin ikinci kez kayit acilmaz
  triggered_at TEXT,
  fetched_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_calevents_start ON calendar_events_cache(start_at);

-- ---------------------------------------------------------------------------
-- settings: key/value (dil, mikrofon, otomatik baslatma, saklama, opt-out ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- FAZ 6 - Sohbet (chat) ve Recipes
-- ---------------------------------------------------------------------------

-- Sohbet konulari: bir nota, kisiye, sirkete veya tum notlara bagli olabilir
CREATE TABLE IF NOT EXISTS chat_threads (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Yeni sohbet',
  scope_kind TEXT NOT NULL DEFAULT 'note',
  scope_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_scope ON chat_threads(scope_kind, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);

-- Sohbet mesajlari (cok turlu). Kaynaklar JSON olarak saklanir.
CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content_md    TEXT NOT NULL DEFAULT '',
  citations_json TEXT,
  provider      TEXT,
  model         TEXT,
  used_fallback INTEGER NOT NULL DEFAULT 0,
  scanned_notes INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);

-- Recipes: "/" ile acilan kayitli promptlar
CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  shortcut    TEXT NOT NULL,
  description TEXT,
  prompt_body TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'note'
                CHECK (scope IN ('note','person','company','all','selection')),
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_shortcut ON recipes(shortcut);

-- ---------------------------------------------------------------------------
-- FAZ 7 - Jargon sozlugu (transkript ve AI ciktisi duzeltmesi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jargon (
  id          TEXT PRIMARY KEY,
  term        TEXT NOT NULL,
  replacement TEXT NOT NULL,
  note        TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  hit_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jargon_term ON jargon(term);

-- ===========================================================================
--  TAM METIN ARAMA (SQLite FTS5)
--  1) search_index  -> notes/raw_notes/enhanced_notes'un birlestirilmis icerigi
--     (trigger'larla otomatik senkron; notes_fts bu tabloyu indeksler)
--  2) transcripts_fts -> transkript cumleleri
-- ===========================================================================
CREATE TABLE IF NOT EXISTS search_index (
  note_id     TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  raw_md      TEXT NOT NULL DEFAULT '',
  enhanced_md TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, raw_md, enhanced_md,
  content='search_index',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
  text, speaker_label,
  content='transcripts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- --- search_index <-> notes_fts senkronu ---
CREATE TRIGGER IF NOT EXISTS trg_si_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO notes_fts(rowid, title, raw_md, enhanced_md)
  VALUES (new.rowid, new.title, new.raw_md, new.enhanced_md);
END;
CREATE TRIGGER IF NOT EXISTS trg_si_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, raw_md, enhanced_md)
  VALUES ('delete', old.rowid, old.title, old.raw_md, old.enhanced_md);
END;
CREATE TRIGGER IF NOT EXISTS trg_si_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, raw_md, enhanced_md)
  VALUES ('delete', old.rowid, old.title, old.raw_md, old.enhanced_md);
  INSERT INTO notes_fts(rowid, title, raw_md, enhanced_md)
  VALUES (new.rowid, new.title, new.raw_md, new.enhanced_md);
END;

-- --- kaynak tablolar -> search_index upsert ---
CREATE TRIGGER IF NOT EXISTS trg_notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO search_index(note_id, title) VALUES (new.id, new.title)
  ON CONFLICT(note_id) DO UPDATE SET title = excluded.title;
END;
CREATE TRIGGER IF NOT EXISTS trg_notes_au AFTER UPDATE OF title ON notes BEGIN
  INSERT INTO search_index(note_id, title) VALUES (new.id, new.title)
  ON CONFLICT(note_id) DO UPDATE SET title = excluded.title;
END;
CREATE TRIGGER IF NOT EXISTS trg_raw_ai AFTER INSERT ON raw_notes BEGIN
  INSERT INTO search_index(note_id, raw_md) VALUES (new.note_id, new.content_md)
  ON CONFLICT(note_id) DO UPDATE SET raw_md = excluded.raw_md;
END;
CREATE TRIGGER IF NOT EXISTS trg_raw_au AFTER UPDATE OF content_md ON raw_notes BEGIN
  INSERT INTO search_index(note_id, raw_md) VALUES (new.note_id, new.content_md)
  ON CONFLICT(note_id) DO UPDATE SET raw_md = excluded.raw_md;
END;
CREATE TRIGGER IF NOT EXISTS trg_enh_ai AFTER INSERT ON enhanced_notes BEGIN
  INSERT INTO search_index(note_id, enhanced_md) VALUES (new.note_id, new.content_md)
  ON CONFLICT(note_id) DO UPDATE SET enhanced_md = excluded.enhanced_md;
END;
CREATE TRIGGER IF NOT EXISTS trg_enh_au AFTER UPDATE OF content_md ON enhanced_notes BEGIN
  INSERT INTO search_index(note_id, enhanced_md) VALUES (new.note_id, new.content_md)
  ON CONFLICT(note_id) DO UPDATE SET enhanced_md = excluded.enhanced_md;
END;

-- --- transcripts <-> transcripts_fts senkronu ---
CREATE TRIGGER IF NOT EXISTS trg_tr_ai AFTER INSERT ON transcripts BEGIN
  INSERT INTO transcripts_fts(rowid, text, speaker_label)
  VALUES (new.rowid, new.text, COALESCE(new.speaker_label, ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_tr_ad AFTER DELETE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, text, speaker_label)
  VALUES ('delete', old.rowid, old.text, COALESCE(old.speaker_label, ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_tr_au AFTER UPDATE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, text, speaker_label)
  VALUES ('delete', old.rowid, old.text, COALESCE(old.speaker_label, ''));
  INSERT INTO transcripts_fts(rowid, text, speaker_label)
  VALUES (new.rowid, new.text, COALESCE(new.speaker_label, ''));
END;

-- ===========================================================================
--  VARSAYILAN VERILER (idempotent seed)
-- ===========================================================================
INSERT INTO templates(id, name, description, prompt_body, is_builtin, sort_order) VALUES
  ('auto','Auto','Toplantı tipini otomatik algıla, uygun şablonu uygula.','',1,0),
  ('one_on_one','1:1','Birebir görüşme: kişisel konular, geri bildirim, kariyer.','Bu bir 1:1 görüşmesi. Kişi bazlı konulara, geri bildirime ve kariyer/sonraki adımlara odaklan.',1,1),
  ('meeting','Toplantı','Genel toplantı: kararlar, riskler, sonraki adımlar.','Genel bir toplantı. Kararlar, riskler ve sorumlu+tarihli sonraki adımlar öne çıkarılsın.',1,2),
  ('phone_call','Telefon görüşmesi','Telefon/arama: kısa özet, anlaşılanlar, aksiyonlar.','Bu bir telefon görüşmesi. Kısa özet, anlaşılan noktalar ve aksiyonlar çıkar.',1,3),
  ('user_interview','Kullanıcı görüşmesi','Kullanıcı araştırması: ihtiyaçlar, acı noktaları, alıntılar.','Bu bir kullanıcı görüşmesi. İhtiyaçlar, acı noktaları ve dikkat çekici alıntılar öne çıkarılsın.',1,4),
  ('blank','Boş','Şablon yok; sadece transkript özeti.','Sadece kısa bir özet ve ana konular.',1,5)
ON CONFLICT(id) DO NOTHING;

INSERT INTO recipes(id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order) VALUES
  ('rec_kararlar','Kararlari cikar','kararlar','Sadece alinan kararlari listeler.','Bu nottaki ALINAN KARARLARI madde madde cikar. Sadece karar cumlelerini yaz; konusma ozeti ekleme.', 'note', 1, 10),
  ('rec_aksyonlar','Aksiyon listesi','aksiyon','Sorumlu ve tarihli yapilacaklar listesi.','Bu nottan YAPILACAKLARI cikar. Her madde icin sorumlu ve varsa tarih belirt. Madde listesi kullan.', 'note', 1, 20),
  ('rec_riskler','Riskleri cikar','risk','Riskler, engeller ve bagimliliklar.','Bu nottaki RISKLERI ve ENGELLERI cikar. Her risk icin etkisi ve varsa azaltma yolu yaz.', 'note', 1, 30),
  ('rec_sorular','Acik sorular','sorular','Cevaplanmamis sorular ve belirsizlikler.','Bu notta CEVAPLANMAMIS SORULARI ve belirsiz kalan konulari cikar. Kimden cevap bekleniyor belirt.', 'note', 1, 40),
  ('rec_mail','Takip e-postasi yaz','mail','Toplanti sonrasi kisa takip e-postasi taslagi.','Bu toplanti icin KISA bir takip e-postasi yaz: selamlama, 3-4 maddelik ozet, net aksiyonlar (sorumlu+tarih), kapanis. Konu satiri da ekle.', 'note', 1, 50),
  ('rec_ozet5','5 satirda ozet','ozet5','En fazla 5 madde ile ozet.','Bu notu EN FAZLA 5 MADDE ile ozetle. Her madde tek cumle olsun.', 'note', 1, 60),
  ('rec_kisi','Kisi profili','kisi','Bir kisi hakkinda bilinenler.','Bu kisi hakkinda notlarimdan cikanlari ozetle: rolu, sorumluluklari, uzerinde calistigi konular, acik takip maddeleri. Bilgi yoksa acikca yaz.', 'person', 1, 70),
  ('rec_sirket','Sirket ozeti','sirket','Bir sirketle iliskinin ozeti.','Bu sirketle ilgili notlarimdan: iliskinin durumu, konusulan ana konular, acik isler ve riskler. Bilgi yoksa acikca yaz.', 'company', 1, 80),
  ('rec_haftalik','Haftalik derleme','haftalik','Son notlardan haftalik derleme.','Son notlarimdan HAFTALIK DERLEME cikar: one cikan konular, verilen kararlar, devam eden riskler, gelecek hafta yapilacaklar.', 'all', 1, 90)
ON CONFLICT(id) DO NOTHING;

INSERT INTO jargon(id, term, replacement, note, enabled, hit_count) VALUES
  ('jr_groq','grog','Groq','Ses benzeri: Groq',1,0),
  ('jr_whisper','visper','Whisper','Ses benzeri: Whisper',1,0),
  ('jr_tip','t i p','TİP','Kisaltma',0,0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO settings(key, value) VALUES
  ('ui_language','tr'),
  ('language','auto'),
  ('stt_provider','groq'),
  ('stt_model','whisper-large-v3-turbo'),
  ('auto_start_calendar','participants'),
  ('auto_start_call','true'),
  ('auto_start_apps','false'),
  ('allowed_apps','["Zoom","Microsoft Teams","Discord","Google Meet","WhatsApp"]'),
  ('retention_days','0'),
  ('opt_out_training','true'),
  ('notifications','true'),
  ('default_template','auto'),
  ('chat_max_context_notes','12'),
  ('os_notifications','true'),
  ('jargon_enabled','true'),
  ('export_dir',''),
  ('encrypt_db','false'),
  ('stt_prompt','')
ON CONFLICT(key) DO NOTHING;