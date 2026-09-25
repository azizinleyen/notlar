"use strict";
const node_path = require("node:path");
const dotenv = require("dotenv");
const electron = require("electron");
const Database = require("better-sqlite3-multiple-ciphers");
const node_fs = require("node:fs");
const node_crypto = require("node:crypto");
const node_child_process = require("node:child_process");
const node_os = require("node:os");
const node_http = require("node:http");
const node_zlib = require("node:zlib");
const COLUMN_MIGRATIONS = [
  {
    table: "calendar_events_cache",
    column: "organizer",
    ddl: "ALTER TABLE calendar_events_cache ADD COLUMN organizer TEXT"
  },
  {
    table: "calendar_events_cache",
    column: "all_day",
    ddl: "ALTER TABLE calendar_events_cache ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0"
  },
  {
    table: "calendar_events_cache",
    column: "triggered_at",
    ddl: "ALTER TABLE calendar_events_cache ADD COLUMN triggered_at TEXT"
  },
  {
    table: "calendar_events_cache",
    column: "updated_at",
    ddl: "ALTER TABLE calendar_events_cache ADD COLUMN updated_at TEXT"
  },
  {
    table: "notes",
    column: "trigger_reason",
    ddl: "ALTER TABLE notes ADD COLUMN trigger_reason TEXT"
  },
  // --- FAZ 5 ---
  {
    table: "people",
    column: "source",
    ddl: "ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'"
  },
  {
    table: "people",
    column: "created_at",
    ddl: "ALTER TABLE people ADD COLUMN created_at TEXT"
  },
  {
    table: "note_people",
    column: "evidence",
    ddl: "ALTER TABLE note_people ADD COLUMN evidence TEXT"
  },
  {
    table: "companies",
    column: "created_at",
    ddl: "ALTER TABLE companies ADD COLUMN created_at TEXT"
  }
];
function tableExists(db2, table) {
  const row = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  return Boolean(row);
}
function columnsOf(db2, table) {
  const rows = db2.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}
const BUILTIN_TEMPLATE_TEXT = [
  {
    id: "auto",
    name: "Auto",
    description: "Toplantı tipini otomatik algıla, uygun şablonu uygula.",
    prompt: ""
  },
  {
    id: "one_on_one",
    name: "1:1",
    description: "Birebir görüşme: kişisel konular, geri bildirim, kariyer.",
    prompt: "Bu bir 1:1 görüşmesi. Kişi bazlı konulara, geri bildirime ve kariyer/sonraki adımlara odaklan."
  },
  {
    id: "meeting",
    name: "Toplantı",
    description: "Genel toplantı: kararlar, riskler, sonraki adımlar.",
    prompt: "Genel bir toplantı. Kararlar, riskler ve sorumlu+tarihli sonraki adımlar öne çıkarılsın."
  },
  {
    id: "phone_call",
    name: "Telefon görüşmesi",
    description: "Telefon/arama: kısa özet, anlaşılanlar, aksiyonlar.",
    prompt: "Bu bir telefon görüşmesi. Kısa özet, anlaşılan noktalar ve aksiyonlar çıkar."
  },
  {
    id: "user_interview",
    name: "Kullanıcı görüşmesi",
    description: "Kullanıcı araştırması: ihtiyaçlar, acı noktaları, alıntılar.",
    prompt: "Bu bir kullanıcı görüşmesi. İhtiyaçlar, acı noktaları ve dikkat çekici alıntılar öne çıkarılsın."
  },
  { id: "blank", name: "Boş", description: "Şablon yok; sadece transkript özeti.", prompt: "Sadece kısa bir özet ve ana konular." }
];
function migrateBuiltinTemplateText(db2) {
  let changed = 0;
  const stmt = db2.prepare(
    `UPDATE templates SET name = @name, description = @description, prompt_body = @prompt
      WHERE id = @id AND is_builtin = 1
        AND (name <> @name OR IFNULL(description,'') <> @description OR prompt_body <> @prompt)`
  );
  for (const t of BUILTIN_TEMPLATE_TEXT) {
    const res = stmt.run({ id: t.id, name: t.name, description: t.description, prompt: t.prompt });
    if (res.changes > 0) changed++;
  }
  return changed;
}
function runMigrations(db2) {
  let applied = 0;
  for (const m of COLUMN_MIGRATIONS) {
    if (!tableExists(db2, m.table)) continue;
    if (columnsOf(db2, m.table).has(m.column)) continue;
    try {
      db2.exec(m.ddl);
      applied++;
      console.log(`[db] migration: ${m.table}.${m.column} eklendi`);
    } catch (err) {
      console.warn(`[db] migration atlandi (${m.table}.${m.column}):`, err);
    }
  }
  try {
    const t = migrateBuiltinTemplateText(db2);
    if (t > 0) {
      applied += t;
      console.log(`[db] migration: ${t} yerlesik sablon adi Turkce'ye cevrildi`);
    }
  } catch (err) {
    console.warn("[db] sablon gocu atlandi:", err);
  }
  return applied;
}
const KEY_FILE = "db.key";
function keyPath(dbDir2) {
  return node_path.join(dbDir2, KEY_FILE);
}
function isEncrypted(dbDir2) {
  return node_fs.existsSync(keyPath(dbDir2));
}
function encryptionAvailable() {
  try {
    return electron.safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
function generateKey() {
  return node_crypto.randomBytes(32).toString("hex");
}
function saveKey(dbDir2, passphrase) {
  if (!encryptionAvailable()) {
    throw new Error(
      "Isletim sistemi anahtar deposu (Windows DPAPI) kullanilamiyor; sifreleme acilamaz."
    );
  }
  const encrypted = electron.safeStorage.encryptString(passphrase);
  node_fs.writeFileSync(keyPath(dbDir2), encrypted.toString("base64"), { encoding: "utf-8", mode: 384 });
}
function loadKey(dbDir2) {
  const kp = keyPath(dbDir2);
  if (!node_fs.existsSync(kp)) return null;
  try {
    const b64 = node_fs.readFileSync(kp, "utf-8").trim();
    if (!b64) return null;
    if (!encryptionAvailable()) return null;
    return electron.safeStorage.decryptString(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}
function removeKey(dbDir2) {
  node_fs.rmSync(keyPath(dbDir2), { force: true });
}
function fileLooksPlaintext(filePath) {
  try {
    if (!node_fs.existsSync(filePath)) return false;
    const buf = node_fs.readFileSync(filePath, { encoding: null, flag: "r" }).subarray(0, 16);
    return buf.toString("latin1") === "SQLite format 3\0";
  } catch {
    return false;
  }
}
let db = null;
function resolveSchemaPath() {
  const candidates = [
    node_path.join(electron.app.getAppPath(), "db", "schema.sql"),
    node_path.join(process.resourcesPath ?? "", "db", "schema.sql"),
    node_path.join(__dirname, "..", "..", "db", "schema.sql"),
    node_path.join(process.cwd(), "db", "schema.sql")
  ];
  for (const c of candidates) {
    if (c && node_fs.existsSync(c)) return c;
  }
  throw new Error("db/schema.sql bulunamadi. Aranan yerler: " + candidates.join(" | "));
}
function getDb() {
  if (!db) throw new Error("Veritabani baslatilmadi. Once initDatabase() cagrilmali.");
  return db;
}
function initDatabase() {
  const dir = node_path.join(electron.app.getPath("userData"), "db");
  if (!node_fs.existsSync(dir)) node_fs.mkdirSync(dir, { recursive: true });
  const dbPath = node_path.join(dir, "notlar.db");
  db = new Database(dbPath);
  if (isEncrypted(dir)) {
    const key = loadKey(dir);
    if (!key) {
      throw new Error(
        "Veritabani sifreli ama anahtar cozulemedi (db.key okunamadi). Anahtar dosyasi baska bir kullanici hesabina ait olabilir."
      );
    }
    db.pragma(`key = '${key}'`);
    try {
      db.prepare("SELECT count(*) AS c FROM sqlite_master").get();
    } catch {
      throw new Error("Veritabani anahtari gecersiz (db.key ile sifre cozulemedi).");
    }
    console.log("[db] sifreli veritabani acildi (SQLCipher)");
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  const schemaSql = node_fs.readFileSync(resolveSchemaPath(), "utf-8");
  db.exec(schemaSql);
  runMigrations(db);
  console.log("[db] hazir ->", dbPath);
  return db;
}
function lazyDb() {
  return new Proxy({}, {
    get(_target, prop) {
      const real = getDb();
      const value = real[prop];
      if (typeof value === "function") {
        return value.bind(real);
      }
      return value;
    },
    has(_target, prop) {
      return prop in getDb();
    }
  });
}
function reopenDatabase() {
  closeDatabase();
  return initDatabase();
}
function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch {
    }
    db = null;
  }
}
function foldText(input) {
  return (input ?? "").replace(/[İIı]/g, "i").toLocaleLowerCase("en").replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function normalizePersonKey(name) {
  return foldText(name);
}
function samePerson(a, b) {
  const ka = normalizePersonKey(a);
  const kb = normalizePersonKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const pa = ka.split(" ");
  const pb = kb.split(" ");
  if (pa.length === 1 || pb.length === 1) {
    const single = pa.length === 1 ? pa[0] : pb[0];
    const multi = pa.length === 1 ? pb : pa;
    return multi[0] === single;
  }
  if (pa[0] !== pb[0]) return false;
  const la = pa[pa.length - 1];
  const lb = pb[pb.length - 1];
  if (la === lb) return true;
  if (lb.length === 1 && la.startsWith(lb)) return true;
  if (la.length === 1 && lb.startsWith(la)) return true;
  return false;
}
function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test((value ?? "").trim());
}
function emailDomain(email) {
  if (!isEmailLike(email)) return null;
  const domain = email.trim().split("@")[1]?.toLocaleLowerCase("en") ?? "";
  if (!domain) return null;
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}
const PUBLIC_EMAIL_DOMAINS = /* @__PURE__ */ new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.com.tr",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yandex.com",
  "yandex.ru",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "mail.ru",
  "gmx.com",
  "gmx.de",
  "aol.com",
  "zoho.com",
  "tutanota.com"
]);
function looksLikeDomain(value) {
  const v = (value ?? "").trim().toLocaleLowerCase("en");
  if (!v || v.includes(" ")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v);
}
function normalizeCompanyName(name, domain) {
  const n = (name ?? "").trim();
  const d = (domain ?? "").trim() || null;
  if (!n) return companyNameFromDomain(d);
  if (looksLikeDomain(n)) {
    return companyNameFromDomain(d ?? n);
  }
  return n;
}
function companyNameFromDomain(domain) {
  if (!domain) return null;
  const first = domain.split(".")[0] ?? "";
  if (!first || first.length < 2) return null;
  return first.split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)).join(" ");
}
function evidenceGrounded(evidence, haystack) {
  const ev = (evidence ?? "").trim();
  if (ev.length < 12) return false;
  if (!haystack) return false;
  if (haystack.includes(ev)) return true;
  const foldedEv = foldText(ev);
  if (foldedEv.length < 10) return false;
  return foldText(haystack).includes(foldedEv);
}
function nameMentioned(name, haystack) {
  const key = normalizePersonKey(name);
  if (!key) return false;
  const folded = foldText(haystack);
  if (!folded) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}($|\\s)`, "u").test(folded);
}
function findEmails(text) {
  const out = [];
  const re = /[^\s<>()[\],;]+@[^\s<>()[\],;]+\.[A-Za-z]{2,}/g;
  let m;
  while ((m = re.exec(text ?? "")) !== null) {
    const email = m[0].replace(/[.,;:]+$/, "");
    if (isEmailLike(email)) out.push({ email, index: m.index });
  }
  return out;
}
function nameFromEmail(email) {
  const local = (email ?? "").split("@")[0] ?? "";
  if (!local) return null;
  const parts = local.split(/[._\-+]/).map((p) => p.replace(/[0-9]+$/g, "")).filter((p) => p.length > 1);
  if (parts.length === 0) return null;
  return parts.map((p) => p.charAt(0).toLocaleUpperCase("tr") + p.slice(1)).join(" ");
}
function parseAttendeeLine(raw) {
  const line = (raw ?? "").trim();
  if (!line) return null;
  const m = /^(.*?)[<\s]*([^\s<>]+@[^\s<>]+)[>\s]*$/.exec(line);
  if (m) {
    const name = m[1].replace(/[",]+$/g, "").trim() || nameFromEmail(m[2]) || m[2];
    return { name, email: m[2] };
  }
  if (isEmailLike(line)) return { name: nameFromEmail(line) ?? line, email: line };
  if (line.length >= 2) return { name: line, email: null };
  return null;
}
function companyKey(name) {
  return foldText(name);
}
function mergeExtractions(input) {
  const people = [];
  const companies = [];
  const reasons = [];
  let dropped = 0;
  const pushCompany = (c) => {
    const normalized = normalizeCompanyName(c.name, c.domain);
    if (!normalized) return;
    const key = companyKey(normalized);
    if (!key) return;
    const existing = companies.find((x) => companyKey(x.name) === key);
    if (existing) {
      if (!existing.domain && c.domain) existing.domain = c.domain;
      return;
    }
    companies.push({ ...c, name: normalized });
  };
  const pushPerson = (p) => {
    const key = normalizePersonKey(p.name);
    if (!key) return false;
    const dup = people.find((x) => samePerson(x.name, p.name));
    if (dup) {
      if (!dup.email && p.email) dup.email = p.email;
      if (!dup.title && p.title) dup.title = p.title;
      if (!dup.company && p.company) dup.company = p.company;
      return false;
    }
    people.push(p);
    return true;
  };
  for (const raw of input.attendees ?? []) {
    const parsed = parseAttendeeLine(raw);
    if (!parsed) continue;
    const domain = parsed.email ? emailDomain(parsed.email) : null;
    const company = companyNameFromDomain(domain);
    pushPerson({
      name: parsed.name,
      email: parsed.email,
      title: null,
      company,
      evidence: `Takvim katılımcısı: ${raw}`,
      origin: "attendee"
    });
    if (company && domain) {
      pushCompany({ name: company, domain, evidence: `Katılımcı e-postası: ${parsed.email}` });
    }
  }
  for (const e of input.emails ?? []) {
    const domain = emailDomain(e.email);
    const company = companyNameFromDomain(domain);
    const guess = nameFromEmail(e.email);
    if (guess) {
      pushPerson({
        name: guess,
        email: e.email,
        title: null,
        company,
        evidence: e.evidence,
        origin: "email"
      });
    }
    if (company && domain) pushCompany({ name: company, domain, evidence: e.evidence });
  }
  for (const p of input.llmPeople ?? []) {
    const name = (p.name ?? "").trim();
    if (!name) {
      dropped++;
      reasons.push("LLM kaydi: isim bos");
      continue;
    }
    const evidence = (p.evidence ?? "").trim();
    const grounded = evidenceGrounded(evidence, input.sourceText);
    const mentioned = nameMentioned(name, input.sourceText) || nameMentioned(name, input.calendarText);
    if (!grounded && !mentioned) {
      dropped++;
      reasons.push(`delil bulunamadi: ${name}`);
      continue;
    }
    const domain = p.email ? emailDomain(p.email) : null;
    const companyName = (p.company ?? "").trim() || companyNameFromDomain(domain);
    if (companyName) {
      if (domain) pushCompany({ name: companyName, domain, evidence: evidence || `E-posta: ${p.email}` });
      else if (evidenceGrounded(evidence, input.sourceText)) {
        pushCompany({ name: companyName, domain: null, evidence });
      }
    }
    pushPerson({
      name,
      email: (p.email ?? "").trim() || null,
      title: (p.title ?? "").trim() || null,
      company: companyName || null,
      evidence: evidence || `${name} konuşmada geçti`,
      origin: "llm"
    });
  }
  for (const c of input.llmCompanies ?? []) {
    const name = (c.name ?? "").trim();
    if (!name) {
      dropped++;
      continue;
    }
    const evidence = (c.evidence ?? "").trim();
    const domain = (c.domain ?? "").trim() || null;
    if (!domain && !evidenceGrounded(evidence, input.sourceText)) {
      dropped++;
      reasons.push(`sirket delili bulunamadi: ${name}`);
      continue;
    }
    pushCompany({ name, domain, evidence: evidence || `Alan adı: ${domain}` });
  }
  return { people, companies, dropped, reasons };
}
function planPersonMerges(notes) {
  const decisions = [];
  const alreadyMerged = /* @__PURE__ */ new Set();
  const score = (p) => (p.email ? 1e6 : 0) + (p.noteCount ?? 0) * 1e3 + p.name.trim().length;
  for (const note of notes) {
    const people = note.people.filter((p) => !alreadyMerged.has(p.id));
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i];
        const b = people[j];
        if (!samePerson(a.name, b.name)) continue;
        const [from, to] = score(a) >= score(b) ? [b, a] : [a, b];
        decisions.push({
          fromId: from.id,
          toId: to.id,
          reason: `ayni notta birlikte gecti: "${a.name}" ~ "${b.name}"`
        });
        alreadyMerged.add(from.id);
      }
    }
  }
  return decisions;
}
function planEmailMerges(people) {
  const byEmail = /* @__PURE__ */ new Map();
  for (const p of people) {
    const e = (p.email ?? "").trim().toLocaleLowerCase("en");
    if (!e) continue;
    byEmail.set(e, [...byEmail.get(e) ?? [], p]);
  }
  const out = [];
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (b.noteCount ?? 0) * 1e3 + b.name.length - ((a.noteCount ?? 0) * 1e3 + a.name.length));
    const keep = sorted[0];
    for (const other of sorted.slice(1)) {
      out.push({ fromId: other.id, toId: keep.id, reason: `ayni e-posta: ${email}` });
    }
  }
  return out;
}
function shouldUpgradeName(current, next) {
  const cur = normalizePersonKey(current);
  const nxt = normalizePersonKey(next);
  if (!cur || !nxt || cur === nxt) return false;
  if (!samePerson(current, next)) return false;
  const curParts = cur.split(" ");
  const nxtParts = nxt.split(" ");
  return curParts.length === 1 && nxtParts.length > 1 && nxtParts[0] === curParts[0];
}
function isHtml(text) {
  return /<\/?(p|div|br|ul|ol|li|h[1-6]|strong|em|mark|blockquote)\b/i.test(text ?? "");
}
function htmlToPlain(html) {
  let out = html ?? "";
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text ? `
- ${text}` : "";
  });
  out = out.replace(/<\s*br\s*\/?>/gi, "\n");
  out = out.replace(/<\/\s*(p|div|h[1-6]|blockquote)\s*>/gi, "\n");
  out = out.replace(/<\/\s*(ul|ol)\s*>/gi, "\n");
  out = out.replace(/<[^>]+>/g, "");
  out = out.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  const lines = out.split("\n").map((l) => l.replace(/\s+$/g, "").replace(/^\s+/, "")).filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
  return lines.join("\n").trim();
}
function rawNotesToPlain(content) {
  const text = content ?? "";
  if (!text.trim()) return "";
  return isHtml(text) ? htmlToPlain(text) : text;
}
function foldForId(input) {
  return (input ?? "").replace(/[İIı]/g, "i").toLocaleLowerCase("en").trim();
}
function slugForId(input, maxLen = 60) {
  return foldForId(input).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, maxLen);
}
function nowIso$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function tagsFor(db2, noteId) {
  return db2.prepare(
    `SELECT t.name FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ? ORDER BY t.name`
  ).all(noteId).map((r) => r.name);
}
function participantsFor(db2, noteId) {
  return db2.prepare(
    `SELECT p.id, p.name, p.email, p.avatar_url
         FROM people p JOIN note_people np ON np.person_id = p.id
        WHERE np.note_id = ? ORDER BY p.name`
  ).all(noteId);
}
function toSummary(db2, row) {
  return {
    id: row.id,
    title: row.title,
    started_at: row.started_at,
    ended_at: row.ended_at,
    source: row.source,
    status: row.status,
    calendar_event_id: row.calendar_event_id,
    tags: tagsFor(db2, row.id),
    participants: participantsFor(db2, row.id),
    transcript_count: row.transcript_count ?? 0
  };
}
const NOTE_SELECT = `
  SELECT n.id, n.title, n.started_at, n.ended_at, n.source, n.status, n.calendar_event_id,
         (SELECT COUNT(*) FROM transcripts t WHERE t.note_id = n.id) AS transcript_count
    FROM notes n`;
function listNotes(db2, opts) {
  const rows = db2.prepare(`${NOTE_SELECT} ORDER BY n.started_at DESC LIMIT ?`).all(opts?.limit ?? 500);
  return rows.map((r) => toSummary(db2, r));
}
function searchNotes(db2, query) {
  const q = query.trim();
  if (!q) return listNotes(db2);
  const match = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, "")}"*`).join(" AND ");
  const rows = db2.prepare(
    `${NOTE_SELECT}
        WHERE n.id IN (
          SELECT si.note_id FROM notes_fts f
            JOIN search_index si ON si.rowid = f.rowid
           WHERE notes_fts MATCH ?
          UNION
          SELECT t.note_id FROM transcripts_fts tf
            JOIN transcripts t ON t.rowid = tf.rowid
           WHERE transcripts_fts MATCH ?
        )
        ORDER BY n.started_at DESC LIMIT 200`
  ).all(match, match);
  return rows.map((r) => toSummary(db2, r));
}
function getNoteRow(db2, id) {
  const row = db2.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id);
  return row ?? null;
}
function getTranscripts(db2, noteId) {
  return db2.prepare(
    `SELECT id, note_id, channel, speaker_label, text, start_ms, end_ms
         FROM transcripts WHERE note_id = ? ORDER BY start_ms ASC, created_at ASC`
  ).all(noteId);
}
function getEnhancedNote(db2, noteId) {
  const row = db2.prepare(
    `SELECT id, note_id, content_md, template_id, model, version, created_at
         FROM enhanced_notes WHERE note_id = ? ORDER BY version DESC LIMIT 1`
  ).get(noteId);
  if (!row) return null;
  const citations = db2.prepare(
    `SELECT id, enhanced_note_id, sentence_ref, source_type, source_id, excerpt
         FROM citations WHERE enhanced_note_id = ? ORDER BY sentence_ref ASC`
  ).all(row.id);
  return { ...row, citations };
}
function nextEnhancedVersion(db2, noteId) {
  const row = db2.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM enhanced_notes WHERE note_id = ?").get(noteId);
  return row.v + 1;
}
function insertEnhancedNote(db2, input) {
  const id = node_crypto.randomUUID();
  const insNote = db2.prepare(
    `INSERT INTO enhanced_notes (id, note_id, content_md, template_id, model, version)
     VALUES (@id, @noteId, @contentMd, @templateId, @model, @version)`
  );
  const insCit = db2.prepare(
    `INSERT INTO citations (id, enhanced_note_id, sentence_ref, source_type, source_id, excerpt)
     VALUES (@id, @enhId, @ref, @type, @sourceId, @excerpt)`
  );
  const tx = db2.transaction(() => {
    insNote.run({
      id,
      noteId: input.noteId,
      contentMd: input.contentMd,
      templateId: input.templateId,
      model: input.model,
      version: input.version
    });
    for (const c of input.citations) {
      insCit.run({
        id: node_crypto.randomUUID(),
        enhId: id,
        ref: c.sentence_ref,
        type: c.source_type,
        sourceId: c.source_id,
        excerpt: c.excerpt
      });
    }
  });
  tx();
  return id;
}
function listEnhancedVersions(db2, noteId) {
  return db2.prepare(
    `SELECT id, version, model, created_at FROM enhanced_notes
        WHERE note_id = ? ORDER BY version DESC`
  ).all(noteId);
}
function getCalendarEvent(db2, noteId) {
  const note = db2.prepare("SELECT calendar_event_id FROM notes WHERE id = ?").get(noteId);
  if (!note?.calendar_event_id) return null;
  const ev = db2.prepare(
    `SELECT id, title, start_at, end_at, location, participants
         FROM calendar_events_cache WHERE id = ?`
  ).get(note.calendar_event_id);
  if (!ev) return null;
  let participants = [];
  try {
    participants = ev.participants ? JSON.parse(ev.participants) : [];
  } catch {
    participants = [];
  }
  return { id: ev.id, title: ev.title, start_at: ev.start_at, end_at: ev.end_at, location: ev.location, participants };
}
function getNoteDetail(db2, id) {
  const row = getNoteRow(db2, id);
  if (!row) return null;
  const raw = db2.prepare("SELECT content_md FROM raw_notes WHERE note_id = ?").get(id);
  return {
    note: toSummary(db2, row),
    raw_notes_md: raw?.content_md ?? "",
    transcripts: getTranscripts(db2, id),
    enhanced: getEnhancedNote(db2, id),
    calendar_event: getCalendarEvent(db2, id)
  };
}
function createNote(db2, input) {
  const id = node_crypto.randomUUID();
  const startedAt = input.startedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    `INSERT INTO notes (id, title, started_at, source, status)
     VALUES (@id, @title, @startedAt, @source, @status)`
  ).run({
    id,
    title: input.title,
    startedAt,
    source: input.source,
    status: input.status ?? "ready"
  });
  db2.prepare("INSERT OR IGNORE INTO raw_notes (note_id, content_md) VALUES (?, '')").run(id);
  return id;
}
function setNoteTitle(db2, id, title) {
  db2.prepare("UPDATE notes SET title = ?, updated_at = ? WHERE id = ?").run(title, nowIso$1(), id);
}
function setNoteStatus(db2, id, status, failReason) {
  db2.prepare(
    "UPDATE notes SET status = ?, fail_reason = ?, ended_at = CASE WHEN ? IN ('ready','failed') THEN COALESCE(ended_at, ?) ELSE ended_at END, updated_at = ? WHERE id = ?"
  ).run(status, failReason ?? null, status, nowIso$1(), nowIso$1(), id);
}
function setRawNotes(db2, noteId, contentMd) {
  db2.prepare(
    `INSERT INTO raw_notes (note_id, content_md, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(note_id) DO UPDATE SET content_md = excluded.content_md, updated_at = excluded.updated_at`
  ).run(noteId, contentMd, nowIso$1());
}
function insertTranscriptsReturning(db2, noteId, rows) {
  const stmt = db2.prepare(
    `INSERT INTO transcripts (id, note_id, channel, speaker_label, text, start_ms, end_ms)
     VALUES (@id, @noteId, @channel, @speaker, @text, @start, @end)`
  );
  const inserted = rows.map((r) => ({
    id: node_crypto.randomUUID(),
    note_id: noteId,
    channel: r.channel,
    speaker_label: r.speaker_label,
    text: r.text,
    start_ms: r.start_ms,
    end_ms: r.end_ms
  }));
  const tx = db2.transaction((items) => {
    for (const r of items) {
      stmt.run({
        id: r.id,
        noteId,
        channel: r.channel,
        speaker: r.speaker_label,
        text: r.text,
        start: r.start_ms,
        end: r.end_ms
      });
    }
  });
  tx(inserted);
  return inserted;
}
function insertTranscripts(db2, noteId, rows) {
  return insertTranscriptsReturning(db2, noteId, rows).length;
}
function finalizeStuckRecordings(db2) {
  const res = db2.prepare(
    `UPDATE notes SET status = "ready", ended_at = COALESCE(ended_at, ?), updated_at = ?
        WHERE status = "recording"`
  ).run(nowIso$1(), nowIso$1());
  return res.changes;
}
function deleteNote(db2, id) {
  db2.prepare("DELETE FROM notes WHERE id = ?").run(id);
}
const DEFAULT_SETTINGS = {
  ui_language: "tr",
  language: "auto",
  stt_provider: "groq",
  stt_model: "whisper-large-v3-turbo",
  auto_start_calendar: "participants",
  auto_start_call: true,
  auto_start_apps: false,
  allowed_apps: ["Zoom", "Microsoft Teams", "Discord", "Google Meet", "WhatsApp"],
  retention_days: 0,
  opt_out_training: true,
  notifications: true,
  default_template: "auto",
  // --- FAZ 3: otomatik tetikleme ---
  // ICS kaynagi: yerel dosya yolu (C:\\...\\takvim.ics) veya https URL
  // (Google 'gizli iCal adresi' / Outlook 'takvimi yayinla' baglantisi)
  calendar_source: "",
  calendar_sync_minutes: 15,
  // Ilk 10 sn'de ses yoksa otomatik kaydi iptal et (yanlis tetikleme korumasi)
  auto_cancel_empty_seconds: 10,
  // Bu kadar sn ses gelmezse otomatik durdur (0 = kapali)
  auto_stop_silence_seconds: 60,
  // Kaydi tetikleyen uygulama kapaninca durdur
  auto_stop_on_app_close: true,
  // Ayni tetikleyicinin tekrar atesleme soguma suresi
  trigger_cooldown_seconds: 120,
  // Otomatik kayitlarda sistem sesini de yakala
  record_system_audio: true,
  // --- FAZ 4: LLM zenginlestirme ---
  // Varsayilan Groq: kullanicinin zaten var olan GROQ_API_KEY'i ile hemen calisir.
  // 'local' = cevrimdisi sezgisel cikarim (anahtar gerekmez).
  llm_provider: "groq",
  // Bos ise saglayicinin varsayilan modeli kullanilir
  llm_model: "",
  // Kayit bitince otomatik zenginlestir (spesifikasyon: 'Toplanti bitince not
  // otomatik zenginlesiyor')
  auto_enhance: true,
  // --- FAZ 6 ---
  chat_max_context_notes: 12,
  // --- FAZ 7 ---
  os_notifications: true,
  jargon_enabled: true,
  export_dir: "",
  encrypt_db: false,
  stt_prompt: ""
};
function getAllSettings(db2) {
  const rows = db2.prepare("SELECT key, value FROM settings").all();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, v] of map.entries()) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = DEFAULT_SETTINGS[k];
    if (typeof def === "boolean") out[k] = v === "true" || v === "1";
    else if (typeof def === "number") out[k] = Number(v);
    else if (Array.isArray(def)) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = def;
      }
    } else out[k] = v;
  }
  return out;
}
function setSetting(db2, key, value) {
  const str = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  db2.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, str, nowIso$1());
}
function getSettingRaw(db2, key) {
  const row = db2.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}
function listTemplates(db2) {
  return db2.prepare("SELECT id, name, description, is_builtin FROM templates ORDER BY sort_order ASC").all().map((r) => {
    const row = r;
    return { id: row.id, name: row.name, description: row.description, is_builtin: row.is_builtin === 1 };
  });
}
function toCalendarRow(r) {
  let participants = [];
  try {
    participants = r.participants ? JSON.parse(r.participants) : [];
  } catch {
    participants = [];
  }
  return {
    id: r.id,
    title: r.title,
    start_at: r.start_at,
    end_at: r.end_at,
    location: r.location,
    description: r.description,
    participants,
    organizer: r.organizer,
    all_day: Boolean(r.all_day),
    triggered_at: r.triggered_at
  };
}
function upsertCalendarEvents(db2, events) {
  const stmt = db2.prepare(
    `INSERT INTO calendar_events_cache
       (id, calendar_id, title, start_at, end_at, location, description, participants,
        organizer, all_day, fetched_at, updated_at)
     VALUES (@id, @calendarId, @title, @startAt, @endAt, @location, @description, @participants,
             @organizer, @allDay, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       start_at = excluded.start_at,
       end_at = excluded.end_at,
       location = excluded.location,
       description = excluded.description,
       participants = excluded.participants,
       organizer = excluded.organizer,
       all_day = excluded.all_day,
       updated_at = excluded.updated_at`
  );
  const now = nowIso$1();
  const tx = db2.transaction((rows) => {
    for (const e of rows) {
      stmt.run({
        id: e.id,
        calendarId: e.calendarId,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        location: e.location,
        description: e.description,
        participants: JSON.stringify(e.participants ?? []),
        organizer: e.organizer,
        allDay: e.allDay ? 1 : 0,
        now
      });
    }
  });
  tx(events);
  return events.length;
}
function pruneCalendarEvents(db2, beforeIso) {
  const res = db2.prepare("DELETE FROM calendar_events_cache WHERE start_at < ?").run(beforeIso);
  return res.changes;
}
function listUpcomingCalendarEvents(db2, fromIso, limit = 20) {
  const rows = db2.prepare(
    `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache
        WHERE start_at >= ?
        ORDER BY start_at ASC LIMIT ?`
  ).all(fromIso, limit);
  return rows.map(toCalendarRow);
}
function findDueCalendarEvents(db2, fromIso, toIso) {
  const rows = db2.prepare(
    `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache
        WHERE triggered_at IS NULL
          AND start_at >= ? AND start_at < ?
        ORDER BY start_at ASC`
  ).all(fromIso, toIso);
  return rows.map(toCalendarRow);
}
function markCalendarEventTriggered(db2, id) {
  db2.prepare("UPDATE calendar_events_cache SET triggered_at = ? WHERE id = ?").run(nowIso$1(), id);
}
function getCalendarEventRow(db2, id) {
  const row = db2.prepare(
    `SELECT id, title, start_at, end_at, location, description, participants, organizer,
              all_day, triggered_at
         FROM calendar_events_cache WHERE id = ?`
  ).get(id);
  return row ? toCalendarRow(row) : null;
}
function countCalendarEvents(db2) {
  const row = db2.prepare("SELECT COUNT(*) AS c FROM calendar_events_cache").get();
  return row.c;
}
function findNoteByCalendarEventId(db2, eventId) {
  const row = db2.prepare("SELECT id FROM notes WHERE calendar_event_id = ? ORDER BY started_at DESC LIMIT 1").get(eventId);
  return row?.id ?? null;
}
function setNoteTriggerReason(db2, noteId, reason) {
  db2.prepare("UPDATE notes SET trigger_reason = ? WHERE id = ?").run(reason, noteId);
}
function linkNoteToCalendarEvent(db2, noteId, eventId, title) {
  db2.prepare(
    `UPDATE notes SET calendar_event_id = ?, title = ?, updated_at = ? WHERE id = ?`
  ).run(eventId, title, nowIso$1(), noteId);
}
function linkNoteParticipants(db2, noteId, names) {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return 0;
  const insPerson = db2.prepare(
    `INSERT INTO people (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`
  );
  const insLink = db2.prepare(
    `INSERT OR IGNORE INTO note_people (note_id, person_id, role) VALUES (?, ?, 'participant')`
  );
  const tx = db2.transaction((items) => {
    for (const name of items) {
      const id = "p:" + name.toLocaleLowerCase("tr").replace(/\s+/g, "-");
      insPerson.run(id, name);
      insLink.run(noteId, id);
    }
  });
  tx(list);
  return list.length;
}
const PERSON_SELECT = `
  SELECT p.id, p.name, p.email, p.title, p.avatar_url, p.company_id,
         c.name AS company_name,
         (SELECT COUNT(*) FROM note_people np WHERE np.person_id = p.id) AS note_count,
         (SELECT MAX(n.started_at) FROM note_people np JOIN notes n ON n.id = np.note_id
           WHERE np.person_id = p.id) AS last_seen_at
    FROM people p
    LEFT JOIN companies c ON c.id = p.company_id`;
function toPersonSummary(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    title: r.title,
    avatar_url: r.avatar_url,
    company_id: r.company_id,
    company_name: r.company_name,
    note_count: r.note_count,
    last_seen_at: r.last_seen_at
  };
}
function listPeople(db2, opts) {
  const q = (opts?.query ?? "").trim();
  if (!q) {
    const rows2 = db2.prepare(`${PERSON_SELECT} ORDER BY note_count DESC, p.name ASC`).all();
    return rows2.map(toPersonSummary);
  }
  const like = `%${q}%`;
  const rows = db2.prepare(
    `${PERSON_SELECT}
        WHERE p.name LIKE ? COLLATE NOCASE OR IFNULL(p.email,'') LIKE ? COLLATE NOCASE
           OR IFNULL(p.title,'') LIKE ? COLLATE NOCASE OR IFNULL(c.name,'') LIKE ? COLLATE NOCASE
        ORDER BY note_count DESC, p.name ASC`
  ).all(like, like, like, like);
  return rows.map(toPersonSummary);
}
function getPerson(db2, id) {
  const row = db2.prepare(`${PERSON_SELECT} WHERE p.id = ?`).get(id);
  return row ? toPersonSummary(row) : null;
}
function updatePerson(db2, id, patch) {
  const cur = getPerson(db2, id);
  if (!cur) return;
  db2.prepare(
    `UPDATE people SET name = @name, email = @email, title = @title, company_id = @companyId,
            source = 'manual'
      WHERE id = @id`
  ).run({
    id,
    name: patch.name?.trim() || cur.name,
    email: patch.email === void 0 ? cur.email : patch.email,
    title: patch.title === void 0 ? cur.title : patch.title,
    companyId: patch.company_id === void 0 ? cur.company_id : patch.company_id
  });
}
function createPersonManual(db2, input) {
  const name = String(input?.name ?? "").trim();
  const email = String(input?.email ?? "").trim() || null;
  const title = String(input?.title ?? "").trim() || null;
  if (!name) throw new Error("Kişi adı gerekli");
  const duplicate = db2.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE LIMIT 1").get(name);
  if (duplicate) throw new Error("Bu isimde bir kişi zaten kayıtlı");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Geçerli bir e-posta girin");
  const id = node_crypto.randomUUID();
  db2.prepare("INSERT INTO people (id, name, email, title, source) VALUES (?, ?, ?, ?, 'manual')").run(id, name, email, title);
  return getPerson(db2, id);
}
function mergePeople(db2, fromId, toId) {
  if (fromId === toId) return 0;
  const tx = db2.transaction(() => {
    const links = db2.prepare("SELECT note_id, role, evidence FROM note_people WHERE person_id = ?").all(fromId);
    const ins = db2.prepare(
      `INSERT INTO note_people (note_id, person_id, role, evidence) VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id, person_id) DO UPDATE SET
         role = CASE
           WHEN excluded.role = 'participant' THEN 'participant'
           WHEN note_people.role IS NULL THEN excluded.role
           ELSE note_people.role
         END,
         evidence = COALESCE(note_people.evidence, excluded.evidence)`
    );
    for (const l of links) ins.run(l.note_id, toId, l.role, l.evidence);
    db2.prepare("DELETE FROM people WHERE id = ?").run(fromId);
    return links.length;
  });
  return tx();
}
function linkNotePerson(db2, noteId, personId, role, evidence) {
  db2.prepare(
    `INSERT INTO note_people (note_id, person_id, role, evidence) VALUES (?, ?, ?, ?)
     ON CONFLICT(note_id, person_id) DO UPDATE SET
       role = CASE
         WHEN excluded.role = 'participant' THEN 'participant'
         WHEN note_people.role IS NULL THEN excluded.role
         ELSE note_people.role
       END,
       evidence = COALESCE(note_people.evidence, excluded.evidence)`
  ).run(noteId, personId, role, evidence);
}
function listPersonNotes(db2, personId) {
  const rows = db2.prepare(
    `SELECT n.id AS note_id, n.title, n.started_at, n.source, np.role, np.evidence
         FROM note_people np JOIN notes n ON n.id = np.note_id
        WHERE np.person_id = ? ORDER BY n.started_at DESC LIMIT 300`
  ).all(personId);
  return rows;
}
function listPersonTags(db2, personId) {
  const rows = db2.prepare(
    `SELECT t.name, COUNT(*) AS c
         FROM note_people np
         JOIN note_tags nt ON nt.note_id = np.note_id
         JOIN tags t ON t.id = nt.tag_id
        WHERE np.person_id = ?
        GROUP BY t.name ORDER BY c DESC, t.name ASC`
  ).all(personId);
  return rows.map((r) => r.name);
}
function upsertPersonByName(db2, name, extra) {
  const trimmed = name.trim();
  const byName = db2.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE LIMIT 1").get(trimmed);
  const email = (extra?.email ?? "").trim();
  const byEmail = email ? db2.prepare("SELECT id FROM people WHERE email = ? COLLATE NOCASE LIMIT 1").get(email) : void 0;
  let bySameNote;
  if (!byName && !byEmail && extra?.noteId) {
    const linked = db2.prepare(
      `SELECT p.id, p.name FROM note_people np JOIN people p ON p.id = np.person_id
          WHERE np.note_id = ?`
    ).all(extra.noteId);
    bySameNote = linked.find((l) => samePerson(l.name, trimmed));
  }
  const existing = byName ?? byEmail ?? bySameNote;
  if (existing) {
    if (extra && (extra.email || extra.title || extra.companyId)) {
      db2.prepare(
        `UPDATE people SET email = COALESCE(email, @email), title = COALESCE(title, @title),
                company_id = COALESCE(company_id, @companyId) WHERE id = @id`
      ).run({
        id: existing.id,
        email: extra.email ?? null,
        title: extra.title ?? null,
        companyId: extra.companyId ?? null
      });
    }
    const cur = db2.prepare("SELECT name, source FROM people WHERE id = ?").get(existing.id);
    if (cur && cur.source !== "manual" && shouldUpgradeName(cur.name, trimmed)) {
      db2.prepare("UPDATE people SET name = ? WHERE id = ?").run(trimmed, existing.id);
    }
    return existing.id;
  }
  const id = "p:" + normalizedPersonId(trimmed);
  db2.prepare("INSERT INTO people (id, name, email, title, company_id) VALUES (?, ?, ?, ?, ?)").run(
    id,
    trimmed,
    extra?.email ?? null,
    extra?.title ?? null,
    extra?.companyId ?? null
  );
  return id;
}
function normalizedPersonId(name) {
  return slugForId(name);
}
function upsertCompany(db2, name, domain) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const id = "c:" + slugForId(trimmed);
  db2.prepare(
    `INSERT INTO companies (id, name, domain) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET domain = COALESCE(companies.domain, excluded.domain)`
  ).run(id, trimmed, domain);
  return id;
}
function dedupeCompanies(db2) {
  const rows = db2.prepare(
    `SELECT c.id, c.name, c.domain,
              (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id) AS people_count,
              (SELECT COUNT(DISTINCT np.note_id) FROM people p2
                 JOIN note_people np ON np.person_id = p2.id
                WHERE p2.company_id = c.id) AS note_count
         FROM companies c`
  ).all();
  const groups = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const key = (r.domain ?? "").trim().toLocaleLowerCase("en") || normalizedPersonId(r.name);
    if (!key) continue;
    groups.set(key, [...groups.get(key) ?? [], r]);
  }
  let merged = 0;
  const tx = db2.transaction(() => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => {
        if (b.people_count !== a.people_count) return b.people_count - a.people_count;
        if (b.note_count !== a.note_count) return b.note_count - a.note_count;
        return b.name.length - a.name.length;
      });
      const keep = sorted[0];
      for (const other of sorted.slice(1)) {
        db2.prepare("UPDATE people SET company_id = ? WHERE company_id = ?").run(keep.id, other.id);
        db2.prepare("DELETE FROM companies WHERE id = ?").run(other.id);
        merged++;
      }
    }
  });
  tx();
  return merged;
}
const COMPANY_SELECT = `
  SELECT c.id, c.name, c.domain,
         (SELECT COUNT(DISTINCT np.note_id) FROM people p
            JOIN note_people np ON np.person_id = p.id
           WHERE p.company_id = c.id) AS note_count,
         (SELECT COUNT(*) FROM people p2 WHERE p2.company_id = c.id) AS people_count
    FROM companies c`;
function toCompanySummary(r) {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    note_count: r.note_count,
    people_count: r.people_count
  };
}
function listCompanies(db2) {
  const rows = db2.prepare(`${COMPANY_SELECT} ORDER BY note_count DESC, c.name ASC`).all();
  return rows.map(toCompanySummary);
}
function getCompany(db2, id) {
  const row = db2.prepare(`${COMPANY_SELECT} WHERE c.id = ?`).get(id);
  return row ? toCompanySummary(row) : null;
}
function listCompanyPeople(db2, companyId) {
  const rows = db2.prepare(`${PERSON_SELECT} WHERE p.company_id = ? ORDER BY note_count DESC, p.name ASC`).all(companyId);
  return rows.map(toPersonSummary);
}
function dedupePeople(db2) {
  dedupeCompanies(db2);
  const notes = db2.prepare("SELECT id FROM notes").all();
  const grouped = [];
  for (const n of notes) {
    grouped.push({
      noteId: n.id,
      people: db2.prepare(
        `SELECT p.id, p.name, p.email,
                  (SELECT COUNT(*) FROM note_people np2 WHERE np2.person_id = p.id) AS noteCount
             FROM note_people np JOIN people p ON p.id = np.person_id
            WHERE np.note_id = ?`
      ).all(n.id)
    });
  }
  const all = listPeople(db2).map((p) => ({ id: p.id, name: p.name, email: p.email, noteCount: p.note_count }));
  const decisions = [...planEmailMerges(all), ...planPersonMerges(grouped)];
  let merged = 0;
  const done = /* @__PURE__ */ new Set();
  for (const d of decisions) {
    if (d.fromId === d.toId || done.has(d.fromId)) continue;
    const stillThere = db2.prepare("SELECT 1 FROM people WHERE id = ?").get(d.fromId);
    if (!stillThere) continue;
    mergePeople(db2, d.fromId, d.toId);
    done.add(d.fromId);
    merged++;
  }
  return merged;
}
function listCompanyNotes(db2, companyId) {
  const rows = db2.prepare(
    `SELECT DISTINCT n.id AS note_id, n.title, n.started_at, n.source, np.role, np.evidence
         FROM people p
         JOIN note_people np ON np.person_id = p.id
         JOIN notes n ON n.id = np.note_id
        WHERE p.company_id = ? ORDER BY n.started_at DESC LIMIT 300`
  ).all(companyId);
  return rows;
}
function listTags(db2) {
  const rows = db2.prepare(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
         FROM tags t ORDER BY note_count DESC, t.name ASC`
  ).all();
  return rows;
}
function normalizeTagName(name) {
  return foldForId(
    (name ?? "").replace(/^#+/, "").replace(/\s+/g, " ")
  );
}
function addTagToNote(db2, noteId, rawName) {
  const name = normalizeTagName(rawName);
  if (!name) return null;
  const id = "t:" + slugForId(name);
  db2.prepare("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(id, name);
  db2.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)").run(noteId, id);
  const row = db2.prepare(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
         FROM tags t WHERE t.id = ?`
  ).get(id);
  return row ?? null;
}
function removeTagFromNote(db2, noteId, tagId) {
  db2.prepare("DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?").run(noteId, tagId);
  const used = db2.prepare("SELECT COUNT(*) AS c FROM note_tags WHERE tag_id = ?").get(tagId);
  if (used.c === 0) db2.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
}
function deleteTranscript(db2, id) {
  const res = db2.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
  return res.changes > 0;
}
function updateTranscriptSpeaker(db2, id, label) {
  const res = db2.prepare("UPDATE transcripts SET speaker_label = ? WHERE id = ?").run(label.trim() || null, id);
  return res.changes > 0;
}
function transcriptTextOf(db2, noteId) {
  const rows = db2.prepare("SELECT channel, speaker_label, text FROM transcripts WHERE note_id = ? ORDER BY start_ms ASC").all(noteId);
  return rows.map((r) => `${r.speaker_label ?? (r.channel === "mic" ? "Ben" : "Karşı taraf")}: ${r.text}`).join("\n");
}
const IPC = {
  appInfo: "app:info",
  settingsGetAll: "settings:getAll",
  settingsSet: "settings:set",
  notesList: "notes:list",
  notesGet: "notes:get",
  notesCreate: "notes:create",
  notesCreateForEvent: "notes:createForEvent",
  notesDelete: "notes:delete",
  notesSetRaw: "notes:setRaw",
  notesSetTitle: "notes:setTitle",
  notesImportAudio: "notes:importAudio",
  dialogPickAudio: "dialog:pickAudio",
  dialogPickIcs: "dialog:pickIcs",
  templatesList: "templates:list",
  searchAll: "search:all",
  rendererReady: "renderer:ready",
  // FAZ 2 - canli kayit
  recordingStart: "recording:start",
  recordingChunk: "recording:chunk",
  recordingStop: "recording:stop",
  recordingCancel: "recording:cancel",
  recordingEvent: "recording:event",
  recordingState: "recording:state",
  // FAZ 3 - otomatik tetikleme
  triggerAutoStart: "trigger:autoStart",
  recorderCommand: "recorder:command",
  diagnostics: "trigger:diagnostics",
  calendarSync: "calendar:sync",
  calendarEvents: "calendar:events",
  googleStatus: "google:status",
  googlePickCredentials: "google:pickCredentials",
  googleConnect: "google:connect",
  googleDisconnect: "google:disconnect",
  googleProcessNote: "google:processNote",
  notifyAction: "notify:action",
  noteFocus: "note:focus",
  appToast: "app:toast",
  calendarUpdated: "calendar:updated",
  // FAZ 4 - LLM zenginlestirme
  llmProviders: "llm:providers",
  llmModels: "llm:models",
  llmSetKey: "llm:setKey",
  llmTestKey: "llm:testKey",
  notesEnhance: "notes:enhance",
  notesEnhancedVersions: "notes:enhancedVersions",
  enhanceProgress: "enhance:progress",
  // FAZ 5 - dizin, etiketler, brief, kapsamli soru
  directorySummary: "dir:summary",
  peopleList: "people:list",
  peopleGet: "people:get",
  peopleUpdate: "people:update",
  peopleCreate: "people:create",
  peopleMerge: "people:merge",
  peopleDedupe: "people:dedupe",
  peopleExtract: "people:extract",
  companiesList: "companies:list",
  companiesGet: "companies:get",
  tagsList: "tags:list",
  tagsAdd: "tags:add",
  tagsRemove: "tags:remove",
  tagsRename: "tags:rename",
  transcriptDelete: "transcript:delete",
  transcriptUpdateSpeaker: "transcript:updateSpeaker",
  briefGet: "brief:get",
  askScoped: "ask:scoped",
  // FAZ 6 - sohbet + recipes
  chatThreads: "chat:threads",
  chatEnsureThread: "chat:ensureThread",
  chatMessages: "chat:messages",
  chatSend: "chat:send",
  chatDeleteThread: "chat:deleteThread",
  recipesList: "recipes:list",
  recipesSave: "recipes:save",
  recipesDelete: "recipes:delete",
  recipesRun: "recipes:run",
  // FAZ 7 - disa aktarma, jargon, guvenlik
  exportNotes: "export:notes",
  dialogPickDir: "dialog:pickDir",
  jargonList: "jargon:list",
  jargonSave: "jargon:save",
  jargonDelete: "jargon:delete",
  securityStatus: "security:status",
  securityEnable: "security:enable",
  securityDisable: "security:disable",
  securityBackup: "security:backup",
  retentionRun: "retention:run",
  deleteAllData: "data:deleteAll",
  notifyState: "notify:state",
  // main -> renderer olaylari
  importProgress: "import:progress"
};
const KNOWN_MEETING_TITLE_MARKERS = [
  "google meet",
  "meet.google.com",
  "zoom meeting",
  "microsoft teams",
  "teams meeting",
  "whereby.com",
  "jitsi meet"
];
const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 25 * 1024 * 1024;
const groqProvider = {
  id: "groq",
  label: "Groq Whisper (large-v3-turbo)",
  requiresApiKey: true,
  defaultModel: "whisper-large-v3-turbo",
  async transcribe(filePath, opts) {
    const apiKey = opts.apiKey?.trim();
    if (!apiKey) throw new Error("GROQ_API_KEY tanimli degil. .env dosyasini veya Ayarlar > API anahtari bolumunu kontrol edin.");
    const size = node_fs.statSync(filePath).size;
    if (size > MAX_BYTES) {
      throw new Error(`Dosya cok buyuk (${(size / 1048576).toFixed(1)} MB). Groq limiti 25 MB.`);
    }
    const model = opts.model || this.defaultModel;
    opts.onProgress?.(`Ses okunuyor (${(size / 1024).toFixed(0)} KB)...`);
    const buf = node_fs.readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)]), node_path.basename(filePath));
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (opts.language && opts.language !== "auto") form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt);
    opts.onProgress?.("Groq Whisper API'ye gonderiliyor...");
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: opts.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq API hatasi ${res.status} ${res.statusText}: ${body.slice(0, 400)}`);
    }
    const json = await res.json();
    const segments = (json.segments ?? []).map((s) => ({
      start_ms: Math.round(s.start * 1e3),
      end_ms: Math.round(s.end * 1e3),
      text: (s.text ?? "").trim()
    }));
    const text = (json.text ?? "").trim();
    const finalSegments = segments.length > 0 ? segments : text ? [{ start_ms: 0, end_ms: Math.round((json.duration ?? 0) * 1e3), text }] : [];
    return {
      text,
      language: json.language,
      duration_ms: json.duration ? Math.round(json.duration * 1e3) : void 0,
      segments: finalSegments,
      provider: this.id,
      model
    };
  }
};
const registry$1 = /* @__PURE__ */ new Map([[groqProvider.id, groqProvider]]);
function resolveProvider(id) {
  const provider = id ? registry$1.get(id) : void 0;
  if (!provider) return groqProvider;
  return provider;
}
function listProviders() {
  return [...registry$1.values()].map((p) => ({
    id: p.id,
    label: p.label,
    requiresApiKey: p.requiresApiKey,
    defaultModel: p.defaultModel
  }));
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function applyJargon(text, rules) {
  const counts = /* @__PURE__ */ new Map();
  const out = text ?? "";
  if (!out || !rules || rules.length === 0) return { text: out, counts, total: 0 };
  const usable = rules.map((r) => ({ term: (r.term ?? "").trim(), replacement: (r.replacement ?? "").trim() })).filter((r) => r.term && r.replacement && r.term !== r.replacement);
  if (usable.length === 0) return { text: out, counts, total: 0 };
  const sorted = [...usable].sort((a, b) => b.term.length - a.term.length);
  const lookup = /* @__PURE__ */ new Map();
  for (const r of sorted) lookup.set(foldForId(r.term), r);
  const pattern = sorted.map((r) => escapeRegex(r.term)).join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "giu");
  let total = 0;
  const result = out.replace(re, (match) => {
    const rule = lookup.get(foldForId(match));
    if (!rule) return match;
    counts.set(rule.term, (counts.get(rule.term) ?? 0) + 1);
    total++;
    return rule.replacement;
  });
  return { text: result, counts, total };
}
function buildSttHint(rules, extra) {
  const parts = [];
  for (const r of rules ?? []) {
    const term = r.term.trim();
    const rep = r.replacement.trim();
    if (rep) parts.push(rep);
    else if (term) parts.push(term);
  }
  const base = (extra ?? "").trim();
  const merged = [.../* @__PURE__ */ new Set([...parts, ...base ? [base] : []])].join(", ");
  return merged.slice(0, 700);
}
function listJargon(db2) {
  const rows = db2.prepare("SELECT id, term, replacement, note, enabled, hit_count FROM jargon ORDER BY term ASC").all();
  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    replacement: r.replacement,
    note: r.note,
    enabled: r.enabled === 1,
    hit_count: r.hit_count
  }));
}
function activeRules(db2) {
  const settings = getAllSettings(db2);
  if (!settings.jargon_enabled) return [];
  return listJargon(db2).filter((j) => j.enabled && j.term.trim()).map((j) => ({ term: j.term, replacement: j.replacement }));
}
function sttHintFor(db2) {
  const settings = getAllSettings(db2);
  const rules = settings.jargon_enabled ? activeRules(db2) : [];
  return buildSttHint(rules, settings.stt_prompt ?? "");
}
function saveJargon(db2, input) {
  const term = (input.term ?? "").trim();
  if (!term) return null;
  const id = input.id?.trim() || `jr_${slugForId(term, 40).replace(/[^\p{L}\p{N}]+/gu, "_")}`;
  db2.prepare(
    `INSERT INTO jargon (id, term, replacement, note, enabled) VALUES (@id, @term, @replacement, @note, @enabled)
     ON CONFLICT(id) DO UPDATE SET
       term = excluded.term,
       replacement = excluded.replacement,
       note = excluded.note,
       enabled = excluded.enabled`
  ).run({
    id,
    term,
    replacement: (input.replacement ?? "").trim(),
    note: input.note?.trim() || null,
    enabled: input.enabled === false ? 0 : 1
  });
  return listJargon(db2).find((j) => j.id === id) ?? null;
}
function deleteJargon(db2, id) {
  const res = db2.prepare("DELETE FROM jargon WHERE id = ?").run(id);
  return res.changes > 0;
}
function bumpJargonHits(db2, counts) {
  const stmt = db2.prepare("UPDATE jargon SET hit_count = hit_count + ? WHERE term = ?");
  const tx = db2.transaction(() => {
    for (const [term, n] of counts) stmt.run(n, term);
  });
  tx();
}
function correctText(db2, text) {
  const rules = activeRules(db2);
  if (rules.length === 0) return text;
  const res = applyJargon(text, rules);
  if (res.total > 0) bumpJargonHits(db2, res.counts);
  return res.text;
}
async function importAudioFile(deps, req, onProgress) {
  const { db: db2, apiKey } = deps;
  const emit = (p) => {
    onProgress?.(p);
    deps.onProgress?.(p);
  };
  const { filePath, channel, language } = req;
  const settings = getAllSettings(db2);
  emit({ stage: "queued", filePath, message: "Isleniyor..." });
  const title = req.title?.trim() || node_path.basename(filePath, node_path.extname(filePath));
  const noteId = createNote(db2, { title, source: "import", status: "processing" });
  try {
    const provider = resolveProvider(settings.stt_provider);
    emit({ stage: "uploading", filePath, noteId, message: `${provider.label} hazirlaniyor...` });
    const result = await provider.transcribe(filePath, {
      apiKey: apiKey(),
      model: settings.stt_model || provider.defaultModel,
      language: language || settings.language,
      prompt: sttHintFor(db2) || void 0,
      onProgress: (msg) => emit({ stage: "transcribing", filePath, noteId, message: msg })
    });
    emit({
      stage: "saving",
      filePath,
      noteId,
      message: `${result.segments.length} parca kaydediliyor...`
    });
    insertTranscripts(
      db2,
      noteId,
      result.segments.map((s) => ({
        channel,
        speaker_label: channel === "mic" ? "Ben" : "Karsi taraf",
        text: correctText(db2, s.text),
        start_ms: s.start_ms,
        end_ms: s.end_ms
      }))
    );
    setRawNotes(
      db2,
      noteId,
      `> Ice aktarilan dosya: ${node_path.basename(filePath)}
> Sure: ${((result.duration_ms ?? 0) / 1e3).toFixed(
        1
      )} sn  •  Dil: ${result.language ?? "?"}
`
    );
    setNoteStatus(db2, noteId, "ready");
    emit({ stage: "done", filePath, noteId, message: "Transkript hazir" });
    return { noteId, segments: result.segments.length, language: result.language, text: result.text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setNoteStatus(db2, noteId, "failed", message);
    emit({ stage: "error", filePath, noteId, message: "Transkripsiyon basarisiz", detail: message });
    return { noteId, segments: 0, text: "", error: message };
  }
}
function authHeaders(apiKey) {
  const key = (apiKey ?? "").trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}
function extractJsonObject(raw) {
  const text = (raw ?? "").trim();
  if (!text) throw new Error("Model bos yanit dondu");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("Model yanitinda JSON govdesi bulunamadi");
  }
  const sliced = candidate.slice(first, last + 1);
  try {
    return JSON.parse(sliced);
  } catch (err) {
    const repaired = sliced.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(
        "Model JSON cikisi ayristirilamadi: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }
}
async function post(path, body, opts, signal) {
  const url = `${(opts.baseUrl || "").replace(/\/+$/, "")}${path}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders(opts.apiKey) },
    body: JSON.stringify(body),
    signal
  });
}
function makeOpenAiCompatProvider(cfg) {
  return {
    id: cfg.id,
    label: cfg.label,
    requiresApiKey: true,
    defaultModel: cfg.defaultModel,
    suggestedModels: cfg.suggestedModels,
    apiKeyEnvVar: cfg.apiKeyEnvVar,
    async complete(req, opts) {
      const apiKey = opts.apiKey?.trim();
      if (!apiKey) throw new Error(`${cfg.label}: API anahtari yok (${cfg.apiKeyEnvVar}).`);
      const model = opts.model || cfg.defaultModel;
      const runtime = { ...opts, baseUrl: opts.baseUrl || cfg.baseUrl };
      req.onProgress?.(`${cfg.label} / ${model} cagriliyor...`);
      const res = await post(
        "/chat/completions",
        {
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user }
          ],
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 4e3,
          // JSON cikisi isteyen modeller icin ipucu (desteklemeyenler yoksayar)
          response_format: { type: "json_object" }
        },
        runtime,
        req.signal
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `${cfg.label} hatasi ${res.status} ${res.statusText}: ${body.slice(0, 400)}${res.status === 404 ? `  (model adi gecersiz olabilir: "${model}")` : ""}`
        );
      }
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error(`${cfg.label}: model bos yanit dondu`);
      return {
        text,
        model: json.model || model,
        provider: cfg.id,
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens
        }
      };
    },
    async listModels(opts) {
      const apiKey = opts.apiKey?.trim();
      if (!apiKey) return [];
      const base = (opts.baseUrl || cfg.baseUrl).replace(/\/+$/, "");
      const res = await fetch(`${base}/models`, {
        headers: { Accept: "application/json", ...authHeaders(apiKey) }
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []).map((m) => m.id).filter((id) => Boolean(id)).sort();
    }
  };
}
const DECISION_HINTS = [
  "karar",
  "kararlaştır",
  "kararlastir",
  "yapacağız",
  "yapacagiz",
  "olacak",
  "kabul",
  "onayla",
  "anlaştık",
  "anlastik",
  "devam edeceğiz",
  "devam edecegiz",
  "we will",
  "we agreed",
  "decided",
  "let's",
  "approved"
];
const RISK_HINTS = [
  "risk",
  "engel",
  "sorun",
  "problem",
  "gecikme",
  "gecikiyor",
  "yetişmeyebilir",
  "yetismeyebilir",
  "blok",
  "blocked",
  "blocker",
  "issue",
  "concern",
  "delay",
  "endişe",
  "endise"
];
const ACTION_HINTS = [
  "yapacağım",
  "yapacagim",
  "takip",
  "göndereceğim",
  "gonderecegim",
  "hazırlayacağım",
  "hazirlayacagim",
  "bakacağım",
  "bakacagim",
  "ileteceğim",
  "iletecegim",
  "planla",
  "halledeceğim",
  "halledecegim",
  "will send",
  "will follow",
  "action item",
  "to-do",
  "todo",
  "yarın",
  "yarin",
  "gelecek hafta",
  "next week",
  "tomorrow"
];
function hasAny(text, hints) {
  const t = text.toLocaleLowerCase("tr");
  return hints.some((h) => t.includes(h));
}
function extractBlock(user, header2) {
  const start = user.indexOf(header2);
  if (start < 0) return "";
  const rest = user.slice(start + header2.length);
  const nextHeader = rest.indexOf("\n### ");
  return (nextHeader >= 0 ? rest.slice(0, nextHeader) : rest).trim();
}
function parseIndexed(block, prefix) {
  const out = [];
  for (const line of block.split("\n")) {
    const m = new RegExp(`^\\[(${prefix}\\d+)\\]\\s*(.*)$`).exec(line.trim());
    if (!m) continue;
    let text = m[2];
    if (prefix === "T") {
      const idx = text.indexOf(": ");
      if (idx > 0) text = text.slice(idx + 2);
    }
    out.push({ token: m[1], text: text.trim() });
  }
  return out;
}
const localProvider = {
  id: "local",
  label: "Yerel çıkarım (çevrimdışı, anahtar gerekmez)",
  requiresApiKey: false,
  defaultModel: "heuristic-v1",
  suggestedModels: ["heuristic-v1"],
  apiKeyEnvVar: "",
  async complete(req) {
    req.onProgress?.("Yerel çıkarım yapılıyor...");
    const rawBlock = extractBlock(req.user, "### (b) KULLANICININ HAM NOTLARI");
    const trBlock = extractBlock(req.user, "### (a) TRANSKRİPT");
    const rawLines = parseIndexed(rawBlock, "N");
    const trLines = parseIndexed(trBlock, "T");
    const citations = [];
    const add = (heading, items, refPrefix) => {
      items.forEach((text, i) => {
        citations.push({ ref: `${heading}#${i + 1}`, source: refPrefix, excerpt: text.slice(0, 200) });
      });
    };
    const summaryBits = [
      ...rawLines.slice(0, 3).map((l) => l.text),
      ...trLines.slice(0, 2).map((l) => l.text)
    ].filter(Boolean);
    const summary = summaryBits.slice(0, 2).join(" ");
    const topicItems = [
      ...rawLines.slice(0, 6).map((l) => ({ token: l.token, text: l.text })),
      ...trLines.filter((l) => l.text.length > 24).sort((a, b) => b.text.length - a.text.length).slice(0, 5)
    ].slice(0, 8);
    const allText = [...trLines, ...rawLines];
    const decisions = allText.filter((l) => hasAny(l.text, DECISION_HINTS)).slice(0, 6);
    const risks = allText.filter((l) => hasAny(l.text, RISK_HINTS)).slice(0, 6);
    const actions = allText.filter((l) => hasAny(l.text, ACTION_HINTS)).slice(0, 6);
    const sections = [];
    const mk = (heading, srcs) => {
      if (srcs.length === 0) return;
      const items = srcs.map((s) => s.text);
      const before = citations.length;
      add(heading, items, "");
      for (let i = 0; i < srcs.length; i++) citations[before + i].source = srcs[i].token;
      sections.push({ heading, items, cites: citations.slice(before) });
    };
    mk("Ana Konular", topicItems);
    mk("Kararlar", decisions);
    mk("Risk / Engel", risks);
    mk("Sonraki Adımlar", actions);
    const nextSteps = actions.map((a) => ({ task: a.text, owner: null, due: null }));
    const payload = {
      summary,
      sections: sections.map((s) => ({ heading: s.heading, items: s.items })),
      next_steps: nextSteps,
      citations
    };
    return {
      text: JSON.stringify(payload),
      model: "heuristic-v1",
      provider: "local"
    };
  }
};
const groq = makeOpenAiCompatProvider({
  id: "groq",
  label: "Groq (Llama / GPT-OSS)",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKeyEnvVar: "GROQ_API_KEY",
  // DIKKAT: model adlari saglayicida degisir. Bu liste Groq'un GERCEK
  // /v1/models yanitindan alinmistir (Ayarlar > "Saglayicidan cek" ile
  // guncel listeyi cekebilirsin). Metin uretimi icin uygun olanlar:
  defaultModel: "openai/gpt-oss-120b",
  suggestedModels: [
    "openai/gpt-oss-120b",
    // 131k baglam - uzun toplantilar icin tercih edilen
    "openai/gpt-oss-20b",
    // 131k baglam - daha hizli/ucuz
    "qwen/qwen3.8-27b",
    // 131k baglam
    "allam-2-7b"
    // 4k baglam - yalnizca kisa notlar
  ]
});
const openai = makeOpenAiCompatProvider({
  id: "openai",
  label: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnvVar: "OPENAI_API_KEY",
  defaultModel: "gpt-4o-mini",
  suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]
});
const openrouter = makeOpenAiCompatProvider({
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  defaultModel: "google/gemini-2.0-flash-001",
  suggestedModels: [
    "google/gemini-2.0-flash-001",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o-mini",
    "meta-llama/llama-3.3-70b-instruct"
  ]
});
const anthropic = makeOpenAiCompatProvider({
  id: "anthropic",
  label: "Anthropic (OpenAI-uyumlu gecit uzerinden)",
  baseUrl: "https://api.anthropic.com/v1",
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  defaultModel: "claude-3-5-sonnet-latest",
  suggestedModels: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]
});
const registry = new Map(
  [groq, openai, openrouter, anthropic, localProvider].map((p) => [p.id, p])
);
function resolveLlmProvider(id) {
  if (id) {
    const hit = registry.get(id);
    if (hit) return hit;
  }
  return groq;
}
function llmKeyInfo(db2, provider) {
  const fromSettings = getSettingRaw(db2, `${provider.id}_api_key`);
  if (fromSettings && fromSettings.trim()) return { key: fromSettings.trim(), source: "settings" };
  const fromEnv = provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : "";
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim(), source: "env" };
  return { key: "", source: null };
}
function llmOptionsFor(db2, provider) {
  return {
    apiKey: llmKeyInfo(db2, provider).key,
    baseUrl: getSettingRaw(db2, `${provider.id}_base_url`) || void 0,
    model: getSettingRaw(db2, `${provider.id}_model`) || void 0
  };
}
function maskKey(key) {
  const k = (key ?? "").trim();
  if (!k) return "";
  if (k.length <= 14) return "••••••";
  return `${k.slice(0, 10)}…${k.slice(-4)}`;
}
function listLlmProviders(db2) {
  return [...registry.values()].map((p) => {
    const info = llmKeyInfo(db2, p);
    return {
      id: p.id,
      label: p.label,
      requiresApiKey: p.requiresApiKey,
      defaultModel: p.defaultModel,
      suggestedModels: p.suggestedModels,
      hasApiKey: Boolean(info.key),
      maskedKey: maskKey(info.key),
      keySource: info.source
    };
  });
}
function rawNoteLines(md) {
  return (md ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0).map((l) => l.replace(/^([-*•]|\d+\.|>)\s*/, "").trim()).filter((l) => l.length > 0);
}
function fmtClock$1(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function buildTranscriptBlock(segments) {
  const index = /* @__PURE__ */ new Map();
  const lines = [];
  segments.forEach((s, i) => {
    const token = `T${i + 1}`;
    const speaker = s.speaker_label ?? (s.channel === "mic" ? "Ben" : "Karşı taraf");
    const kind = s.channel === "mic" ? "MIKROFON" : "SISTEM";
    index.set(token, {
      id: s.id,
      channel: s.channel,
      speaker,
      text: s.text,
      start_ms: s.start_ms
    });
    lines.push(`[${token}] (${kind}) ${speaker} ${fmtClock$1(s.start_ms)}: ${s.text}`);
  });
  return { block: lines.join("\n"), index };
}
function buildRawNotesBlock(md) {
  const index = /* @__PURE__ */ new Map();
  const lines = rawNoteLines(md);
  lines.forEach((line, i) => {
    index.set(`N${i + 1}`, { line, index: i });
  });
  return { block: lines.map((l, i) => `[N${i + 1}] ${l}`).join("\n"), index };
}
function buildCalendarBlock(ev) {
  const index = ev ? { token: "C1", eventId: ev.id, label: ev.title } : null;
  if (!ev) {
    return { block: "(takvim etkinliği yok — elle başlatılan not)", calendar: index };
  }
  const lines = [
    "[C1] Takvim etkinliği:",
    `  Başlık: ${ev.title}`,
    `  Başlangıç: ${ev.start_at}`,
    ev.end_at ? `  Bitiş: ${ev.end_at}` : null,
    ev.location ? `  Konum: ${ev.location}` : null,
    ev.participants.length > 0 ? `  Katılımcılar: ${ev.participants.join(", ")}` : "  Katılımcılar: (yok)"
  ].filter((l) => Boolean(l));
  return { block: lines.join("\n"), calendar: index };
}
function buildSystemPrompt(language, templatePrompt) {
  const langLine = language && language !== "auto" ? `Yanıt dilini şu dile sabitle: ${language}.` : "Dili, konuşmanın ve ham notların çoğunlukta olduğu dili kullan.";
  return [
    "Sen bir toplantı notu asistanısın.",
    "Sana (a) kanal etiketli toplantı transkripti, (b) kullanıcının ham notları ve",
    "(c) takvim etkinliği meta verisi verilecek.",
    "",
    "Görev: KULLANICININ HAM NOTLARINI ÇEKİRDEK ALARAK, transkriptten gelen bağlamla",
    "zenginleştirilmiş, madde işaretli, okunabilir bir not üret.",
    "",
    "Kurallar:",
    "(1) Yalnızca gerçekten söyleneni veya ham notta yazılanı yaz; halüsinasyon üretme.",
    "(2) Verilmeyen bir bilgiyi uydurma. Emin değilsen maddeyi hiç yazma.",
    "(3) Ham notlar çekirdektir: kullanıcının kendi maddeleri korunmalı, transkript onları",
    "    zenginleştirmeli. Ham notta olmayan önemli bir konu transkriptte geçiyorsa ekleyebilirsin.",
    "(4) Konuşma dili/küfür varsa SANSÜRLEME; olduğu gibi koru.",
    "(5) Özel isimleri, ürün adlarını ve terimleri transkriptte geçtiği şekilde yaz.",
    "(6) Özeti kısa tut (en fazla 4 madde).",
    "(7) Boş bölüm döndürme: ilgili madde yoksa o bölümü tamamen atla.",
    langLine,
    "",
    templatePrompt ? `EK TALİMAT (şablon): ${templatePrompt}` : "",
    "",
    "HER MADDE İÇİN KAYNAK ZORUNLUDUR. Kaynakları sana verilen etiketlerle belirt:",
    '  [T#] = transkript satırı ("source": "T12")',
    '  [N#] = kullanıcının ham not satırı ("source": "N3")',
    '  [C1] = takvim etkinliği ("source": "C1")',
    "",
    "Çıktı YALNIZCA şu JSON olsun (başka hiçbir metin yazma):",
    "{",
    '  "summary": "tek paragraf kısa özet",',
    '  "sections": [',
    '    { "heading": "Ana Konular", "items": ["madde 1", "madde 2"] },',
    '    { "heading": "Kararlar", "items": ["..."] },',
    '    { "heading": "Risk / Engel", "items": ["..."] }',
    "  ],",
    '  "next_steps": [ { "task": "...", "owner": "isim veya null", "due": "tarih veya null" } ],',
    '  "citations": [',
    '    { "ref": "Ana Konular#1", "source": "T12", "excerpt": "kaynak cümlenin kısa alıntısı" }',
    "  ]",
    "}",
    "",
    "Bölüm sırası: Özet, Ana Konular, Kararlar, Risk / Engel, Sonraki Adımlar.",
    'next_steps doluysa ayrıca "Sonraki Adımlar" bölümünü sections içinde de üret.',
    '"citations" içindeki "ref" şu biçimde olmalı: "<bölüm başlığı>#<madde sırası>" (1 tabanlı).',
    "Her madde için en az bir kaynak ver."
  ].filter((l) => l !== void 0).join("\n");
}
function buildUserPrompt(ctx) {
  const cal = buildCalendarBlock(ctx.calendarEvent);
  const raw = buildRawNotesBlock(ctx.rawNotesMd);
  const tr = buildTranscriptBlock(ctx.transcripts);
  const index = {
    transcripts: tr.index,
    rawNoteTokens: raw.index,
    calendar: cal.calendar
  };
  const parts = [
    `NOT BAŞLIĞI: ${ctx.noteTitle}`,
    "",
    "### (c) TAKVİM ETKİNLİĞİ",
    cal.block,
    "",
    "### (b) KULLANICININ HAM NOTLARI (ÇEKİRDEK — önce bunları kapsa)",
    raw.block || "(ham not yok — yalnızca transkriptten üret)",
    ""
  ];
  if (ctx.transcripts.length === 0) {
    parts.push("### (a) TRANSKRİPT", "(transkript yok — yalnızca ham notlardan üret)");
  } else {
    parts.push(
      `### (a) TRANSKRİPT (${ctx.transcripts.length} satır, kanal etiketli; ben = MIKROFON, karşı taraf = SISTEM)`,
      tr.block
    );
  }
  return { user: parts.join("\n"), index };
}
function normalizeRef(ref) {
  return (ref ?? "").trim().replace(/\s+/g, " ");
}
function resolveCitations(rawCitations, index) {
  const citations = [];
  const reasons = [];
  let dropped = 0;
  for (const raw of rawCitations ?? []) {
    const ref = normalizeRef(String(raw?.ref ?? ""));
    if (!ref || !ref.includes("#")) {
      dropped++;
      reasons.push(`gecersiz ref: ${JSON.stringify(raw?.ref)}`);
      continue;
    }
    const source = String(raw?.source ?? "").trim().toUpperCase();
    const excerpt = raw?.excerpt ? String(raw.excerpt).trim().slice(0, 400) : null;
    if (/^T\d+$/.test(source)) {
      const hit = index.transcripts.get(source);
      if (!hit) {
        dropped++;
        reasons.push(`bilinmeyen transkript etiketi: ${source}`);
        continue;
      }
      citations.push({
        sentence_ref: ref,
        source_type: "transcript",
        source_id: hit.id,
        excerpt: excerpt || hit.text.slice(0, 240)
      });
      continue;
    }
    if (/^N\d+$/.test(source)) {
      const hit = index.rawNoteTokens.get(source);
      if (!hit) {
        dropped++;
        reasons.push(`bilinmeyen ham not etiketi: ${source}`);
        continue;
      }
      citations.push({
        sentence_ref: ref,
        source_type: "raw_note",
        source_id: null,
        // ham notun kaynagi notun kendisidir; id'yi kayit sirasinda doldururuz
        excerpt: excerpt || hit.line.slice(0, 240)
      });
      continue;
    }
    if (source === "C1") {
      if (!index.calendar) {
        dropped++;
        reasons.push("takvim etkinligi yok ama C1 kaynagi verildi");
        continue;
      }
      citations.push({
        sentence_ref: ref,
        source_type: "calendar",
        source_id: index.calendar.eventId,
        excerpt: excerpt || index.calendar.label.slice(0, 240)
      });
      continue;
    }
    dropped++;
    reasons.push(`taninmayan kaynak: ${JSON.stringify(raw?.source)}`);
  }
  return { citations, dropped, reasons };
}
function stripSourceTokens(text) {
  return (text ?? "").replace(/\s*[\[(]\s*(?:T|N|C)\d+\s*[\])]/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
function normalizePayload(parsed) {
  const obj = parsed ?? {};
  const summary = typeof obj.summary === "string" ? stripSourceTokens(obj.summary) : "";
  const sections = [];
  for (const s of Array.isArray(obj.sections) ? obj.sections : []) {
    const sec = s;
    const heading = typeof sec.heading === "string" ? sec.heading.trim() : "";
    const items = (Array.isArray(sec.items) ? sec.items : []).map((i) => typeof i === "string" ? stripSourceTokens(i) : "").filter(Boolean);
    if (heading && items.length > 0) sections.push({ heading, items });
  }
  const nextSteps = [];
  for (const n of Array.isArray(obj.next_steps) ? obj.next_steps : []) {
    if (typeof n === "string") {
      const task2 = stripSourceTokens(n);
      if (task2) nextSteps.push({ task: task2, owner: null, due: null });
      continue;
    }
    const ns = n;
    const task = typeof ns.task === "string" ? stripSourceTokens(ns.task) : "";
    if (!task) continue;
    nextSteps.push({
      task,
      owner: typeof ns.owner === "string" && ns.owner.trim() ? ns.owner.trim() : null,
      due: typeof ns.due === "string" && ns.due.trim() ? ns.due.trim() : null
    });
  }
  const citations = (Array.isArray(obj.citations) ? obj.citations : []).map((c) => {
    const cc = c;
    return {
      ref: typeof cc.ref === "string" ? cc.ref : "",
      source: typeof cc.source === "string" ? cc.source : "",
      excerpt: typeof cc.excerpt === "string" ? cc.excerpt : void 0
    };
  });
  return { summary, sections, next_steps: nextSteps, citations };
}
function payloadToMarkdown(payload) {
  const out = [];
  if (payload.summary) {
    out.push("## Özet", `- ${payload.summary}`, "");
  }
  for (const sec of payload.sections) {
    out.push(`## ${sec.heading}`);
    for (const item of sec.items) out.push(`- ${item}`);
    out.push("");
  }
  if (payload.next_steps.length > 0 && !payload.sections.some((s) => /sonraki/i.test(s.heading))) {
    out.push("## Sonraki Adımlar");
    for (const ns of payload.next_steps) {
      const bits = [ns.task];
      if (ns.owner) bits.push(`sorumlu: ${ns.owner}`);
      if (ns.due) bits.push(`tarih: ${ns.due}`);
      out.push(`- ${bits.join(" — ")}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}
function templatePromptFor(db2, templateId) {
  const id = templateId && templateId !== "auto" ? templateId : "";
  if (!id) return "";
  const row = db2.prepare("SELECT prompt_body FROM templates WHERE id = ?").get(id);
  return row?.prompt_body ?? "";
}
async function enhanceNote(deps, noteId, templateId) {
  const { db: db2 } = deps;
  const emit = (p) => deps.onProgress?.(p);
  const log2 = (m) => deps.log?.(m);
  const detail = getNoteDetail(db2, noteId);
  if (!detail) return { ok: false, error: "Not bulunamadi" };
  const settings = getAllSettings(db2);
  const effectiveTemplate = templateId ?? settings.default_template;
  if (detail.transcripts.length === 0 && !rawNotesToPlain(detail.raw_notes_md).trim()) {
    const msg = "Zenginleştirilecek içerik yok (transkript ve ham not boş)";
    setNoteStatus(db2, noteId, "failed", msg);
    emit({ noteId, stage: "error", message: msg });
    return { ok: false, error: msg };
  }
  emit({ noteId, stage: "building", message: "Bağlam hazırlanıyor..." });
  setNoteStatus(db2, noteId, "processing");
  const system = buildSystemPrompt(settings.language, templatePromptFor(db2, effectiveTemplate));
  const { user, index } = buildUserPrompt({
    noteTitle: detail.note.title,
    language: settings.language,
    templatePrompt: templatePromptFor(db2, effectiveTemplate),
    calendarEvent: detail.calendar_event,
    rawNotesMd: rawNotesToPlain(detail.raw_notes_md),
    transcripts: detail.transcripts
  });
  const provider = resolveLlmProvider(settings.llm_provider);
  const opts = llmOptionsFor(db2, provider);
  log2(
    `[enhance] ${noteId}: saglayici=${provider.id} model=${opts.model || provider.defaultModel} transkript=${detail.transcripts.length} hamNot=${detail.raw_notes_md.length}b`
  );
  let completion;
  let usedFallback = false;
  const runProvider = async (p, o) => {
    emit({ noteId, stage: "calling", message: `${p.label} çağrılıyor...`, provider: p.id });
    const res = await p.complete(
      {
        system,
        user,
        maxTokens: 4e3,
        temperature: 0.2,
        onProgress: (m) => emit({ noteId, stage: "calling", message: m, provider: p.id })
      },
      o
    );
    return { text: res.text, model: res.model, provider: res.provider };
  };
  try {
    if (provider.requiresApiKey && !opts.apiKey) {
      throw new Error(
        `${provider.label} için API anahtarı yok. .env dosyasına ${provider.apiKeyEnvVar} ekleyin veya Ayarlar'dan yerel çıkarımı seçin.`
      );
    }
    completion = await runProvider(provider, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log2(`[enhance] LLM hatasi: ${message}`);
    emit({ noteId, stage: "calling", message: "LLM başarısız — yerel çıkarım deneniyor...", detail: message });
    try {
      completion = await runProvider(localProvider, {});
      usedFallback = true;
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      setNoteStatus(db2, noteId, "failed", message);
      emit({ noteId, stage: "error", message: "Zenginleştirme başarısız", detail: message });
      return { ok: false, error: message + " | yedek de başarısız: " + msg2 };
    }
  }
  emit({ noteId, stage: "parsing", message: "Yanıt işleniyor...", provider: completion.provider });
  let payload;
  try {
    payload = normalizePayload(extractJsonObject(completion.text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setNoteStatus(db2, noteId, "failed", message);
    emit({ noteId, stage: "error", message: "Model yanıtı çözümlenemedi", detail: message });
    return { ok: false, error: message };
  }
  const resolved = resolveCitations(payload.citations, index);
  const contentMd = correctText(db2, payloadToMarkdown(payload));
  emit({ noteId, stage: "saving", message: "Not kaydediliyor..." });
  const version = nextEnhancedVersion(db2, noteId);
  insertEnhancedNote(db2, {
    noteId,
    contentMd,
    templateId: effectiveTemplate || null,
    model: `${completion.provider}:${completion.model}`,
    version,
    citations: resolved.citations.map((c) => ({ ...c, source_id: c.source_id }))
  });
  setNoteStatus(db2, noteId, "ready");
  log2(
    `[enhance] tamam: v${version} bolum=${payload.sections.length} next_steps=${payload.next_steps.length} kaynak=${resolved.citations.length} atilan=${resolved.dropped}`
  );
  const enhanced = getEnhancedNote(db2, noteId);
  emit({
    noteId,
    stage: "done",
    message: "Notun hazır",
    provider: completion.provider,
    model: completion.model
  });
  return {
    ok: true,
    enhanced: enhanced ?? void 0,
    version,
    citations: resolved.citations.length,
    droppedCitations: resolved.dropped,
    provider: completion.provider,
    model: completion.model,
    usedFallback
  };
}
function clock(iso) {
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}
function buildScopedContext(notes, opts) {
  const perNote = opts?.maxCharsPerNote ?? 3500;
  const total = opts?.maxTotalChars ?? 24e3;
  const index = /* @__PURE__ */ new Map();
  const chunks = [];
  let used = 0;
  notes.forEach((n, i) => {
    if (used >= total) return;
    const token = `N${i + 1}`;
    index.set(token, { id: n.noteId, title: n.title });
    const parts = [`[${token}] ${n.title} — ${clock(n.startedAt)} (${n.source})`];
    if (n.rawNotes.trim()) parts.push(`  Ham notlar: ${n.rawNotes.trim().slice(0, perNote / 2)}`);
    if (n.enhanced.trim()) parts.push(`  Üretilmiş not: ${n.enhanced.trim().slice(0, perNote / 2)}`);
    if (n.transcript.trim()) parts.push(`  Transkript: ${n.transcript.trim().slice(0, perNote)}`);
    const chunk = parts.join("\n");
    if (used + chunk.length > total) {
      const room = total - used;
      if (room > 400) chunks.push(chunk.slice(0, room) + "…");
      used = total;
      return;
    }
    chunks.push(chunk);
    used += chunk.length;
  });
  return { block: chunks.join("\n\n"), index };
}
function buildBriefSystemPrompt(language) {
  const lang = language && language !== "auto" ? `Yanıt dili: ${language}.` : "Yanıt dilini notların diline uydur.";
  return [
    "Sen bir toplantı öncesi brifing asistanısın.",
    "Sana KULLANICININ GEÇMİŞ NOTLARI ve (varsa) YAKLAŞAN TAKVİM ETKİNLİĞİ verilecek.",
    "",
    "Görev: Bu toplantıya girmeden önce kullanıcının bilmesi gereken EN ÖNEMLİ 2-3 maddeyi yaz.",
    "Yani: geçmişte ne konuşulmuş, hangi kararlar alınmış, hangi konular AÇIK kalmış, neye dikkat etmeli.",
    "",
    "Kurallar:",
    "(1) Yalnızca verilen notlarda geçen bilgiyi kullan; halüsinasyon üretme.",
    "(2) En fazla 3 madde. Her madde tek cümle, somut ve eyleme dönük olsun.",
    '(3) Genel geçer tavsiye yazma ("iyi bir toplantı geçirin" gibi). Sadece bu kişi/şirket/toplantıya özel bilgi.',
    "(4) Bilgi yetersizse daha AZ madde yaz; uydurma. Hiç bilgi yoksa boş liste döndür.",
    "(5) Açık kalan konuları ve riskleri öne çıkar.",
    lang,
    "",
    "Çıktı YALNIZCA şu JSON olsun (başka metin yazma):",
    "{",
    '  "items": [',
    '    { "text": "madde", "source": "N2", "excerpt": "dayandığı kısa alıntı" }',
    "  ]",
    "}",
    '"source" alanına maddeyi dayandırdığın notun etiketini yaz (or. "N3"). Emin değilsen null yaz.'
  ].join("\n");
}
function buildBriefUserPrompt(ctx, event) {
  const parts = [];
  if (event) {
    parts.push(
      "### YAKLAŞAN TOPLANTI",
      `Başlık: ${event.title}`,
      `Zaman: ${clock(event.start_at)}`,
      event.participants.length ? `Katılımcılar: ${event.participants.join(", ")}` : "Katılımcılar: (yok)",
      ""
    );
  } else {
    parts.push("### YAKLAŞAN TOPLANTI", "(takvim bilgisi yok — geçmiş notlara göre genel brifing)", "");
  }
  parts.push("### GEÇMİŞ NOTLAR", ctx.block || "(not yok)");
  return parts.join("\n");
}
function buildAskSystemPrompt(language) {
  const lang = language && language !== "auto" ? `Yanıt dili: ${language}.` : "Yanıt dilini sorunun diline uydur.";
  return [
    "Sen kullanıcının kendi notları üzerinde çalışan bir soru-cevap asistanısın.",
    "Sana kullanıcının notları ([N#] etiketli) ve bir SORU verilecek.",
    "",
    "Kurallar:",
    "(1) YALNIZCA verilen notlardaki bilgiyi kullan. Notlarda olmayan bir şeyi uydurma.",
    '(2) Bilgi notlarda yoksa açıkça "Notlarınızda bu bilgi yok" de. Tahmin yürütme.',
    "(3) Cevabı kısa ve madde madde yaz; gereksiz giriş cümlesi yazma.",
    "(4) Her iddiayı bir not etiketine dayandır ([N2] gibi).",
    "(5) Kullanıcının kendi ham notları varsa onlara öncelik ver.",
    lang,
    "",
    "Çıktı YALNIZCA şu JSON olsun (başka metin yazma):",
    "{",
    '  "answer_md": "cevap (markdown, madde işaretli olabilir)",',
    '  "citations": [ { "source": "N2", "excerpt": "dayandığı kısa alıntı" } ]',
    "}"
  ].join("\n");
}
function buildChatSystemPrompt(language) {
  const lang = language && language !== "auto" ? `Yanıt dili: ${language}.` : "Yanıt dilini sorunun diline uydur.";
  return [
    "Sen kullanıcının kendi notları üzerinde çalışan bir asistanın.",
    "Sana kullanıcının notları ([N#] etiketli), önceki konuşma turları ve yeni bir SORU verilecek.",
    "",
    "Kurallar:",
    "(1) YALNIZCA verilen notlardaki bilgiyi kullan. Notlarda olmayan bir şeyi uydurma.",
    '(2) Bilgi notlarda yoksa açıkça "Notlarınızda bu bilgi yok" de. Tahmin yürütme.',
    "(3) Önceki turlarla TUTARLI ol; kullanıcı bir şeyi netleştirdiyse onu koru.",
    "(4) Kısa ve madde madde yaz; gereksiz giriş/kapanış cümlesi yazma.",
    "(5) Her iddiayı bir not etiketine dayandır ([N2] gibi). Aynı nota birden çok kez atıf yapabilirsin.",
    "(6) Kullanıcının kendi ham notları varsa onlara öncelik ver.",
    lang,
    "",
    "Çıktı YALNIZCA şu JSON olsun (başka metin yazma):",
    "{",
    '  "answer_md": "cevap (markdown)",',
    '  "citations": [ { "source": "N2", "excerpt": "dayandığı kısa alıntı" } ]',
    "}"
  ].join("\n");
}
function resolveScopedCitations(raw, index) {
  const out = [];
  let dropped = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const c of raw ?? []) {
    const src = String(c?.source ?? "").trim().toUpperCase();
    if (!/^N\d+$/.test(src)) {
      dropped++;
      continue;
    }
    const hit = index.get(src);
    if (!hit) {
      dropped++;
      continue;
    }
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({
      note_id: hit.id,
      note_title: hit.title,
      source_type: "previous_note",
      excerpt: c.excerpt ? String(c.excerpt).trim().slice(0, 300) : null
    });
  }
  return { citations: out, dropped };
}
function normalizeBriefPayload(parsed) {
  const obj = parsed ?? {};
  const items = Array.isArray(obj.items) ? obj.items : [];
  const out = [];
  for (const raw of items) {
    const it = raw;
    const text = typeof it.text === "string" ? it.text.trim() : "";
    if (!text) continue;
    out.push({
      text,
      source: typeof it.source === "string" ? it.source.trim().toUpperCase() : null,
      excerpt: typeof it.excerpt === "string" ? it.excerpt.trim() : null
    });
    if (out.length >= 3) break;
  }
  return { items: out };
}
function normalizeAskPayload(parsed) {
  const obj = parsed ?? {};
  return {
    answer_md: typeof obj.answer_md === "string" ? obj.answer_md.trim() : "",
    citations: (Array.isArray(obj.citations) ? obj.citations : []).map((c) => {
      const cc = c;
      return {
        source: typeof cc.source === "string" ? cc.source : "",
        excerpt: typeof cc.excerpt === "string" ? cc.excerpt : void 0
      };
    })
  };
}
const EXTRACT_SYSTEM = [
  "Bir toplantı transkriptinden KİŞİ ve ŞİRKET bilgisi çıkarıyorsun.",
  "",
  "Kurallar:",
  "(1) YALNIZCA metinde geçen kişileri yaz. Metinde adı geçmeyen kimseyi yazma.",
  '(2) Her kişi için "evidence" alanına metinde GEÇEN kısa bir alıntı yaz (birebir, en az 15 karakter).',
  "    Alıntı metinde birebir bulunmazsa kaydın geçersiz sayılır.",
  "(3) Unvan (title) yalnızca açıkça söylenmişse yaz; tahmin etme.",
  "(4) Şirket adı yalnızca açıkça söylenmiş ya da e-posta alan adından belli ise yaz.",
  '(5) Kendi adın olan kullanıcıyı ("Ben") kişi olarak EKLEME.',
  "(6) Konuşmacı etiketleri (Sarah, James gibi) metinde geçen gerçek kişilerdir; ekleyebilirsin.",
  "(7) Emin değilsen o kaydı hiç yazma. Boş liste döndürmek sorun değil.",
  "",
  "Çıktı YALNIZCA şu JSON olsun:",
  "{",
  '  "people": [ { "name": "Sarah Jones", "email": null, "title": "Ürün Yöneticisi", "company": "Acme", "evidence": "birebir alıntı" } ],',
  '  "companies": [ { "name": "Acme", "domain": "acme.com", "evidence": "birebir alıntı" } ]',
  "}"
].join("\n");
async function extractPeopleForNote(deps, noteId) {
  const { db: db2 } = deps;
  const emit = (p) => deps.onProgress?.(p);
  const log2 = (m) => deps.log?.(m);
  const detail = getNoteDetail(db2, noteId);
  if (!detail) return { ok: false, people_added: 0, companies_added: 0, links_added: 0, dropped: 0, provider: null, model: null, usedFallback: false, error: "Not bulunamadi" };
  emit({ noteId, stage: "gathering", message: "Kişiler taranıyor..." });
  const transcriptText = transcriptTextOf(db2, noteId);
  const rawNotes = rawNotesToPlain(detail.raw_notes_md);
  const calendarText = detail.calendar_event ? [detail.calendar_event.title, detail.calendar_event.location ?? ""].join("\n") : "";
  const sourceText = [transcriptText, rawNotes, calendarText].filter(Boolean).join("\n");
  const emails = findEmails(sourceText).map((e) => {
    const idx = sourceText.indexOf(e.email);
    const lineStart = sourceText.lastIndexOf("\n", idx) + 1;
    const lineEnd = sourceText.indexOf("\n", idx);
    const evidence = sourceText.slice(lineStart, lineEnd < 0 ? void 0 : lineEnd).trim();
    return { email: e.email, evidence: evidence || e.email };
  });
  const attendees = detail.calendar_event?.participants ?? [];
  let llmPeople = [];
  let llmCompanies = [];
  let provider = null;
  let model = null;
  let usedFallback = false;
  let llmError;
  const settings = getAllSettings(db2);
  const llm = resolveLlmProvider(settings.llm_provider);
  const opts = llmOptionsFor(db2, llm);
  if (!transcriptText.trim() && !rawNotes.trim()) {
    emit({ noteId, stage: "error", message: "Kişi çıkarılacak içerik yok" });
    return {
      ok: false,
      people_added: 0,
      companies_added: 0,
      links_added: 0,
      dropped: 0,
      provider: null,
      model: null,
      usedFallback: false,
      error: "Not içeriği boş"
    };
  }
  if (llm.requiresApiKey && !opts.apiKey) {
    usedFallback = true;
    llmError = "LLM anahtarı yok — yalnızca sezgisel çıkarım (takvim + e-posta)";
  } else {
    try {
      emit({ noteId, stage: "calling", message: `${llm.label} ile kişiler çıkarılıyor...` });
      const ctx = buildScopedContext([
        {
          noteId,
          title: detail.note.title,
          startedAt: detail.note.started_at,
          source: detail.note.source,
          transcript: transcriptText,
          rawNotes,
          enhanced: ""
        }
      ]);
      const user = [
        `NOT: ${detail.note.title}`,
        detail.calendar_event ? `TAKVİM KATILIMCILARI: ${attendees.join(", ")}` : "",
        "",
        "### İÇERİK",
        ctx.block
      ].filter(Boolean).join("\n");
      const res = await llm.complete(
        { system: EXTRACT_SYSTEM, user, maxTokens: 1500, temperature: 0 },
        opts
      );
      const parsed = extractJsonObject(res.text);
      llmPeople = parsed.people ?? [];
      llmCompanies = parsed.companies ?? [];
      provider = res.provider;
      model = res.model;
    } catch (err) {
      usedFallback = true;
      llmError = err instanceof Error ? err.message : String(err);
      log2(`[people] LLM hatasi, sezgisel mod: ${llmError}`);
    }
  }
  const merged = mergeExtractions({
    attendees,
    emails,
    llmPeople,
    llmCompanies,
    calendarText,
    sourceText
  });
  emit({ noteId, stage: "saving", message: "Kaydediliyor..." });
  let companiesAdded = 0;
  const companyIdByName = /* @__PURE__ */ new Map();
  for (const c of merged.companies) {
    const before = listCompanies(db2).length;
    const id = upsertCompany(db2, c.name, c.domain);
    if (id) companyIdByName.set(foldForId(c.name), id);
    if (listCompanies(db2).length > before) companiesAdded++;
  }
  let peopleAdded = 0;
  let linksAdded = 0;
  const seenIds = /* @__PURE__ */ new Set();
  for (const p of merged.people) {
    const before = listPeople(db2).length;
    const mappedId = p.company ? companyIdByName.get(foldForId(p.company)) ?? null : null;
    const companyId = mappedId && getCompany(db2, mappedId) ? mappedId : null;
    const personId = upsertPersonByName(db2, p.name, {
      email: p.email,
      title: p.title,
      companyId,
      noteId
      // ayni notta gecen "Sarah" ile "Sarah Jones" birlestirilsin
    });
    if (listPeople(db2).length > before) peopleAdded++;
    if (seenIds.has(personId)) continue;
    seenIds.add(personId);
    const role = p.origin === "attendee" ? "participant" : "mentioned";
    linkNotePerson(db2, noteId, personId, role, p.evidence);
    linksAdded++;
  }
  try {
    dedupeCompanies(db2);
    dedupePeople(db2);
  } catch (err) {
    log2(`[people] dedupe atlandi: ${err instanceof Error ? err.message : String(err)}`);
  }
  log2(
    `[people] ${noteId}: kisi=${merged.people.length} (yeni ${peopleAdded}, baglanti=${linksAdded}) sirket=${merged.companies.length} (yeni ${companiesAdded}) atilan=${merged.dropped} isimler=[${merged.people.map((p) => p.name).join(", ")}]`
  );
  emit({ noteId, stage: "done", message: "Kişiler güncellendi" });
  return {
    ok: true,
    people_added: peopleAdded,
    companies_added: companiesAdded,
    links_added: linksAdded,
    dropped: merged.dropped,
    provider,
    model,
    usedFallback,
    error: llmError
  };
}
function linkAttendeesOnly(db2, noteId, attendees) {
  if (attendees.length === 0) return { people: 0, companies: 0 };
  const merged = mergeExtractions({
    attendees,
    emails: [],
    llmPeople: [],
    llmCompanies: [],
    calendarText: attendees.join("\n"),
    sourceText: attendees.join("\n")
  });
  const companyIdByName = /* @__PURE__ */ new Map();
  for (const c of merged.companies) {
    const id = upsertCompany(db2, c.name, c.domain);
    if (id) companyIdByName.set(foldForId(c.name), id);
  }
  for (const p of merged.people) {
    const mappedId = p.company ? companyIdByName.get(foldForId(p.company)) ?? null : null;
    const companyId = mappedId && getCompany(db2, mappedId) ? mappedId : null;
    const personId = upsertPersonByName(db2, p.name, {
      email: p.email,
      title: null,
      companyId,
      noteId
    });
    linkNotePerson(db2, noteId, personId, "participant", p.evidence);
  }
  return { people: merged.people.length, companies: merged.companies.length };
}
const MAX_PAST_NOTES = 8;
function noteToInput$1(db2, noteId) {
  const d = getNoteDetail(db2, noteId);
  if (!d) return null;
  return {
    noteId: d.note.id,
    title: d.note.title,
    startedAt: d.note.started_at,
    source: d.note.source,
    transcript: transcriptTextOf(db2, noteId),
    rawNotes: rawNotesToPlain(d.raw_notes_md),
    enhanced: d.enhanced?.content_md ?? ""
  };
}
function localBrief(notes, limit = 3) {
  const items = [];
  for (const n of notes) {
    const lines = [n.enhanced, n.rawNotes].join("\n").split("\n").map((l) => l.replace(/^([-*•]|\d+\.|#+)\s*/, "").trim()).filter((l) => l.length > 18 && !/^(özet|ozet|ana konular|kararlar|risk|sonraki adımlar)$/i.test(l));
    for (const line of lines) {
      if (items.length >= limit) break;
      if (items.some((i) => i.text === line)) continue;
      items.push({ text: line, note_id: n.noteId, note_title: n.title, source_type: "previous_note" });
    }
    if (items.length >= limit) break;
  }
  return items;
}
async function buildBrief(deps, target) {
  const { db: db2 } = deps;
  const log2 = (m) => deps.log?.(m);
  const ids = [];
  const pushId = (id) => {
    if (id !== target.noteId && !ids.includes(id)) ids.push(id);
  };
  if (target.personId) for (const l of listPersonNotes(db2, target.personId)) pushId(l.note_id);
  if (target.companyId) for (const l of listCompanyNotes(db2, target.companyId)) pushId(l.note_id);
  const evId = target.eventId ?? null;
  if (evId) {
    const ev = getCalendarEventRow(db2, evId);
    if (ev) {
      for (const name of ev.participants) {
        const person = listPeople(db2).find((p) => p.name === name);
        if (person) for (const l of listPersonNotes(db2, person.id)) pushId(l.note_id);
      }
    }
  }
  const notes = [];
  for (const id of ids.slice(0, MAX_PAST_NOTES)) {
    const input = noteToInput$1(db2, id);
    if (input) notes.push(input);
  }
  const events = evId ? getCalendarEventRow(db2, evId) : null;
  const eventForPrompt = events ? { title: events.title, start_at: events.start_at, participants: events.participants } : null;
  if (notes.length === 0) {
    const current = target.noteId ? noteToInput$1(db2, target.noteId) : null;
    const items = current ? localBrief([current], 3) : [];
    return {
      ok: true,
      items,
      provider: null,
      model: null,
      usedFallback: true,
      error: items.length === 0 ? "Brief için geçmiş not yok" : void 0
    };
  }
  const settings = getAllSettings(db2);
  const llm = resolveLlmProvider(settings.llm_provider);
  const opts = llmOptionsFor(db2, llm);
  const ctx = buildScopedContext(notes);
  const system = buildBriefSystemPrompt(settings.language);
  const user = buildBriefUserPrompt({ block: ctx.block }, eventForPrompt);
  if (llm.requiresApiKey && !opts.apiKey) {
    return {
      ok: true,
      items: localBrief(notes, 3),
      provider: null,
      model: null,
      usedFallback: true,
      error: "LLM anahtarı yok — yerel taslak gösteriliyor"
    };
  }
  try {
    deps.onProgress?.(`${llm.label} ile brief hazırlanıyor...`);
    const res = await llm.complete({ system, user, maxTokens: 900, temperature: 0.2 }, opts);
    const payload = normalizeBriefPayload(extractJsonObject(res.text));
    const resolved = resolveScopedCitations(
      (payload.items ?? []).map((i) => ({ source: i.source ?? "", excerpt: i.excerpt ?? void 0 })),
      ctx.index
    );
    const byNoteId = new Map(resolved.citations.map((c) => [c.note_id, c]));
    const noteIdByToken = /* @__PURE__ */ new Map();
    for (const [token, hit] of ctx.index.entries()) noteIdByToken.set("N" + token.replace(/^N+/, ""), hit);
    const items = (payload.items ?? []).filter((i) => i.text.length > 0).slice(0, 3).map((i) => {
      const token = ("N" + (i.source ?? "")).replace(/[^N0-9]/gi, "").replace(/^N+/, "N");
      const hit = noteIdByToken.get(token);
      return {
        text: i.text,
        note_id: hit?.id ?? null,
        note_title: hit?.title ?? null,
        source_type: hit && byNoteId.has(hit.id) ? "previous_note" : hit ? "previous_note" : null
      };
    });
    log2(`[brief] ${items.length} madde (${res.provider}/${res.model}), ${notes.length} not tarandı`);
    return {
      ok: true,
      items: items.length > 0 ? items : localBrief(notes, 3),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log2(`[brief] LLM hatasi, yerel taslak: ${message}`);
    return {
      ok: true,
      items: localBrief(notes, 3),
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    };
  }
}
const MAX_NOTES = 12;
function localSearchAnswer(db2, question, limit = 4) {
  const terms = question.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 3);
  if (terms.length === 0) return { answer_md: "Notlarınızda bu bilgi yok.", citations: [] };
  const found = [];
  const notes = listNotes(db2, { limit: 200 });
  for (const n of notes) {
    if (found.length >= limit) break;
    const detail = getNoteDetail(db2, n.id);
    if (!detail) continue;
    const lines = [
      ...transcriptTextOf(db2, n.id).split("\n"),
      ...rawNotesToPlain(detail.raw_notes_md).split("\n"),
      ...(detail.enhanced?.content_md ?? "").split("\n")
    ];
    const hit = lines.find((l) => {
      const low = l.toLocaleLowerCase("tr");
      return terms.some((t) => low.includes(t));
    });
    if (hit && hit.trim().length > 10) {
      found.push({
        note_id: n.id,
        note_title: n.title,
        source_type: "previous_note",
        excerpt: hit.trim().slice(0, 240)
      });
    }
  }
  if (found.length === 0) return { answer_md: "Notlarınızda bu bilgi yok.", citations: [] };
  const md = ["Notlarınızda bulunan ilgili satırlar:", ...found.map((c) => `- ${c.excerpt}`)].join("\n");
  return { answer_md: md, citations: found };
}
async function askScoped(deps, req) {
  const { db: db2 } = deps;
  const log2 = (m) => deps.log?.(m);
  const question = (req.question ?? "").trim();
  if (!question) {
    return {
      ok: false,
      answer_md: "",
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      scanned_notes: 0,
      error: "Soru boş"
    };
  }
  let ids = [];
  if (req.scope === "person" && req.scopeId) {
    ids = listPersonNotes(db2, req.scopeId).map((l) => l.note_id);
  } else if (req.scope === "company" && req.scopeId) {
    ids = listCompanyNotes(db2, req.scopeId).map((l) => l.note_id);
  } else if (req.scope === "note" && req.scopeId) {
    ids = [req.scopeId];
  } else {
    ids = listNotes(db2, { limit: MAX_NOTES }).map((n) => n.id);
  }
  ids = ids.slice(0, MAX_NOTES);
  if (ids.length === 0) {
    return {
      ok: false,
      answer_md: "Notlarınızda bu bilgi yok.",
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      scanned_notes: 0,
      error: "Bu kapsamda not bulunamadı"
    };
  }
  const notes = [];
  for (const id of ids) {
    const d = getNoteDetail(db2, id);
    if (!d) continue;
    notes.push({
      noteId: d.note.id,
      title: d.note.title,
      startedAt: d.note.started_at,
      source: d.note.source,
      transcript: transcriptTextOf(db2, id),
      rawNotes: rawNotesToPlain(d.raw_notes_md),
      enhanced: d.enhanced?.content_md ?? ""
    });
  }
  const settings = getAllSettings(db2);
  const llm = resolveLlmProvider(settings.llm_provider);
  const opts = llmOptionsFor(db2, llm);
  const ctx = buildScopedContext(notes);
  if (llm.requiresApiKey && !opts.apiKey) {
    const local = localSearchAnswer(db2, question);
    return {
      ok: true,
      answer_md: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      scanned_notes: notes.length,
      error: "LLM anahtarı yok — yerel arama gösteriliyor"
    };
  }
  const system = buildAskSystemPrompt(settings.language);
  const user = ["### NOTLAR", ctx.block, "", "### SORU", question].join("\n");
  try {
    deps.onProgress?.(`${llm.label} yanıtlıyor...`);
    const res = await llm.complete({ system, user, maxTokens: 1600, temperature: 0.1 }, opts);
    const payload = normalizeAskPayload(extractJsonObject(res.text));
    const resolved = resolveScopedCitations(payload.citations, ctx.index);
    log2(
      `[ask] kapsam=${req.scope} not=${notes.length} kaynak=${resolved.citations.length} atilan=${resolved.dropped}`
    );
    return {
      ok: true,
      answer_md: payload.answer_md || "Notlarınızda bu bilgi yok.",
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: "previous_note",
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false,
      scanned_notes: notes.length
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log2(`[ask] LLM hatasi, yerel arama: ${message}`);
    const local = localSearchAnswer(db2, question);
    return {
      ok: true,
      answer_md: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      scanned_notes: notes.length,
      error: message
    };
  }
}
function listThreads(db2, limit = 30) {
  const rows = db2.prepare(
    `SELECT t.id, t.title, t.scope_kind, t.scope_id, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id) AS message_count
         FROM chat_threads t ORDER BY t.updated_at DESC LIMIT ?`
  ).all(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    scope_kind: r.scope_kind,
    scope_id: r.scope_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: r.message_count
  }));
}
function createThread(db2, scopeKind, scopeId, title) {
  const id = node_crypto.randomUUID();
  db2.prepare("INSERT INTO chat_threads (id, title, scope_kind, scope_id) VALUES (?, ?, ?, ?)").run(
    id,
    title?.trim() || defaultTitle(db2, scopeKind, scopeId),
    scopeKind,
    scopeId
  );
  return id;
}
function ensureThread(db2, scopeKind, scopeId, title) {
  const existing = db2.prepare(
    `SELECT id FROM chat_threads
        WHERE scope_kind = ? AND IFNULL(scope_id,'') = IFNULL(?,'')
        ORDER BY updated_at DESC LIMIT 1`
  ).get(scopeKind, scopeId);
  return existing?.id ?? createThread(db2, scopeKind, scopeId, title);
}
function defaultTitle(db2, kind, id) {
  if (kind === "person" && id) return getPerson(db2, id)?.name ?? "Kisi hakkinda";
  if (kind === "company" && id) return getCompany(db2, id)?.name ?? "Sirket hakkinda";
  if (kind === "note" && id) return getNoteDetail(db2, id)?.note.title ?? "Not hakkinda";
  return "Tum notlarim";
}
function deleteThread(db2, id) {
  db2.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
}
function getMessages(db2, threadId) {
  const rows = db2.prepare(
    `SELECT id, thread_id, role, content_md, citations_json, provider, model,
              used_fallback, scanned_notes, error, created_at
         FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC`
  ).all(threadId);
  return rows.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    role: r.role,
    content_md: r.content_md,
    citations: r.citations_json ? JSON.parse(r.citations_json) : [],
    provider: r.provider,
    model: r.model,
    used_fallback: Boolean(r.used_fallback),
    scanned_notes: r.scanned_notes,
    error: r.error,
    created_at: r.created_at
  }));
}
function insertChatMessage(db2, msg) {
  const id = node_crypto.randomUUID();
  db2.prepare(
    `INSERT INTO chat_messages
       (id, thread_id, role, content_md, citations_json, provider, model, used_fallback, scanned_notes, error)
     VALUES (@id, @threadId, @role, @contentMd, @citations, @provider, @model, @usedFallback, @scannedNotes, @error)`
  ).run({
    id,
    threadId: msg.threadId,
    role: msg.role,
    contentMd: msg.contentMd,
    citations: msg.citations && msg.citations.length > 0 ? JSON.stringify(msg.citations) : null,
    provider: msg.provider ?? null,
    model: msg.model ?? null,
    usedFallback: msg.usedFallback ? 1 : 0,
    scannedNotes: msg.scannedNotes ?? 0,
    error: msg.error ?? null
  });
  db2.prepare("UPDATE chat_threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
    msg.threadId
  );
  return {
    id,
    thread_id: msg.threadId,
    role: msg.role,
    content_md: msg.contentMd,
    citations: msg.citations ?? [],
    provider: msg.provider ?? null,
    model: msg.model ?? null,
    used_fallback: Boolean(msg.usedFallback),
    scanned_notes: msg.scannedNotes ?? 0,
    error: msg.error ?? null,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function notesForScopeApi(db2, kind, scopeId, limit) {
  if (kind === "person" && scopeId)
    return listPersonNotes(db2, scopeId).map((l) => l.note_id).slice(0, limit);
  if (kind === "company" && scopeId)
    return listCompanyNotes(db2, scopeId).map((l) => l.note_id).slice(0, limit);
  if (kind === "note" && scopeId) return [scopeId];
  return listNotes(db2, { limit }).map((n) => n.id);
}
function notesForScope(db2, kind, scopeId, limit) {
  return notesForScopeApi(db2, kind, scopeId, limit);
}
function noteToInput(db2, id) {
  const d = getNoteDetail(db2, id);
  if (!d) return null;
  return {
    noteId: d.note.id,
    title: d.note.title,
    startedAt: d.note.started_at,
    source: d.note.source,
    transcript: transcriptTextOf(db2, id),
    rawNotes: rawNotesToPlain(d.raw_notes_md),
    enhanced: d.enhanced?.content_md ?? ""
  };
}
async function sendMessage(deps, threadId, opts) {
  const { db: db2 } = deps;
  const question = (opts.question ?? "").trim();
  if (!question) throw new Error("Soru bos");
  const thread = db2.prepare("SELECT id, scope_kind, scope_id FROM chat_threads WHERE id = ?").get(threadId);
  if (!thread) throw new Error("Sohbet bulunamadi");
  const userMsg = insertChatMessage(db2, { threadId, role: "user", contentMd: question });
  const settings = getAllSettings(db2);
  const limit = Math.max(1, Math.min(50, settings.chat_max_context_notes || 12));
  const ids = notesForScope(db2, thread.scope_kind, thread.scope_id, limit);
  const notes = [];
  for (const id of ids) {
    const input = noteToInput(db2, id);
    if (input) notes.push(input);
  }
  const ctx = buildScopedContext(notes, { maxCharsPerNote: 3e3, maxTotalChars: 2e4 });
  const history = getMessages(db2, threadId).slice(-9, -1);
  const llm = resolveLlmProvider(settings.llm_provider);
  const llmOpts = llmOptionsFor(db2, llm);
  const system = buildChatSystemPrompt(settings.language);
  const historyBlock = history.map((m) => `${m.role === "user" ? "KULLANICI" : "ASISTAN"}: ${m.content_md.slice(0, 1200)}`).join("\n");
  const user = [
    "### NOTLAR",
    ctx.block || "(not yok)",
    "",
    historyBlock ? `### ONCEKI KONUSMA
${historyBlock}` : "",
    "",
    "### SORU",
    question
  ].filter((x) => x !== void 0).join("\n");
  const finish = (payload) => insertChatMessage(db2, {
    threadId,
    role: "assistant",
    contentMd: payload.answerMd,
    citations: payload.citations,
    provider: payload.provider,
    model: payload.model,
    usedFallback: payload.usedFallback,
    scannedNotes: notes.length,
    error: payload.error ?? null
  });
  if (llm.requiresApiKey && !llmOpts.apiKey) {
    const local = localChatAnswer(db2, question, thread.scope_kind, thread.scope_id, limit);
    const assistant = finish({
      answerMd: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      error: "LLM anahtari yok — yerel arama gosteriliyor"
    });
    return { user: userMsg, assistant };
  }
  try {
    deps.onProgress?.(`${llm.label} yanitliyor...`);
    const res = await llm.complete({ system, user, maxTokens: 1800, temperature: 0.15 }, llmOpts);
    const payload = normalizeAskPayload(extractJsonObject(res.text));
    const resolved = resolveScopedCitations(payload.citations, ctx.index);
    deps.log?.(
      `[chat] kapsam=${thread.scope_kind} not=${notes.length} tur=${history.length} kaynak=${resolved.citations.length} atilan=${resolved.dropped}`
    );
    const assistant = finish({
      answerMd: payload.answer_md || "Notlarinizda bu bilgi yok.",
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: "previous_note",
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    });
    return { user: userMsg, assistant };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log?.(`[chat] LLM hatasi, yerel arama: ${message}`);
    const local = localChatAnswer(db2, question, thread.scope_kind, thread.scope_id, limit);
    const assistant = finish({
      answerMd: local.answer_md,
      citations: local.citations,
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    });
    return { user: userMsg, assistant };
  }
}
function localChatAnswer(db2, question, scopeKind, scopeId, limit) {
  const terms = question.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 3);
  if (terms.length === 0) return { answer_md: "Notlarinizda bu bilgi yok.", citations: [] };
  const ids = notesForScope(db2, scopeKind, scopeId, limit);
  const found = [];
  for (const id of ids) {
    if (found.length >= 4) break;
    const d = getNoteDetail(db2, id);
    if (!d) continue;
    const lines = [
      ...transcriptTextOf(db2, id).split("\n"),
      ...rawNotesToPlain(d.raw_notes_md).split("\n"),
      ...(d.enhanced?.content_md ?? "").split("\n")
    ];
    const hit = lines.find((l) => {
      const low = l.toLocaleLowerCase("tr");
      return l.trim().length > 12 && terms.some((t) => low.includes(t));
    });
    if (hit) {
      found.push({
        note_id: id,
        note_title: d.note.title,
        source_type: "previous_note",
        excerpt: hit.trim().slice(0, 240)
      });
    }
  }
  if (found.length === 0) return { answer_md: "Notlarinizda bu bilgi yok.", citations: [] };
  return {
    answer_md: ["Notlarında bulunan ilgili satırlar:", ...found.map((c) => `- ${c.excerpt}`)].join("\n"),
    citations: found
  };
}
function listRecipes(db2) {
  const rows = db2.prepare(
    `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes ORDER BY sort_order ASC, name ASC`
  ).all();
  return rows.map(toRecipe);
}
function toRecipe(r) {
  return {
    id: r.id,
    name: r.name,
    shortcut: r.shortcut,
    description: r.description,
    prompt_body: r.prompt_body,
    scope: r.scope,
    is_builtin: r.is_builtin === 1,
    sort_order: r.sort_order
  };
}
function normalizeShortcut(input) {
  return (input ?? "").trim().replace(/^\//, "").replace(/[İIı]/g, "i").toLocaleLowerCase("en").replace(/[^a-z0-9ğüşöç_-]/g, "");
}
function saveRecipe(db2, input) {
  const name = (input.name ?? "").trim();
  const prompt = (input.promptBody ?? "").trim();
  const shortcut = normalizeShortcut(input.shortcut || name);
  if (!name || !prompt || !shortcut) return null;
  const id = input.id?.trim() || `rec_${node_crypto.randomUUID().slice(0, 8)}`;
  const existing = db2.prepare("SELECT is_builtin, sort_order FROM recipes WHERE id = ?").get(id);
  db2.prepare(
    `INSERT INTO recipes (id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order)
     VALUES (@id, @name, @shortcut, @description, @promptBody, @scope, @isBuiltin, @sortOrder)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       shortcut = excluded.shortcut,
       description = excluded.description,
       prompt_body = excluded.prompt_body,
       scope = excluded.scope`
  ).run({
    id,
    name,
    shortcut,
    description: input.description?.trim() || null,
    promptBody: prompt,
    scope: input.scope ?? "note",
    isBuiltin: existing?.is_builtin ?? 0,
    sortOrder: existing?.sort_order ?? 100
  });
  const row = db2.prepare(
    `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes WHERE id = ?`
  ).get(id);
  return row ? toRecipe(row) : null;
}
function deleteRecipe(db2, id) {
  const row = db2.prepare("SELECT is_builtin FROM recipes WHERE id = ?").get(id);
  if (!row || row.is_builtin === 1) return false;
  db2.prepare("DELETE FROM recipes WHERE id = ?").run(id);
  return true;
}
const RECIPE_SYSTEM_SUFFIX = [
  "Sana kullanıcının notları ([N#] etiketli) verilecek ve belirli bir GÖREV istenecek.",
  "",
  "Kurallar:",
  "(1) YALNIZCA verilen notlardaki bilgiyi kullan; uydurma.",
  "(2) Görevde istenen biçime uy (madde listesi, e-posta, tablo vb.).",
  "(3) Bilgi yetersizse bunu açıkça belirt; eksik kısmı uydurma.",
  "(4) Kısa ve doğrudan yaz; gereksiz giriş cümlesi yazma.",
  "(5) Her iddiayı bir not etiketine dayandır ([N2]).",
  "",
  "Çıktı YALNIZCA şu JSON olsun:",
  '{ "answer_md": "istenen çıktı (markdown)", "citations": [ { "source": "N2", "excerpt": "kısa alıntı" } ] }'
].join("\n");
async function runRecipe(deps, recipeId, scope) {
  const { db: db2 } = deps;
  const recipeRow = db2.prepare(
    `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes WHERE id = ?`
  ).get(recipeId);
  if (!recipeRow) {
    return {
      ok: false,
      threadId: "",
      answer_md: "",
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      error: "Recipe bulunamadi"
    };
  }
  const recipe = toRecipe(recipeRow);
  const settings = getAllSettings(db2);
  const limit = Math.max(1, Math.min(50, settings.chat_max_context_notes || 12));
  const ids = notesForScopeApi(db2, scope.kind, scope.id ?? null, limit);
  const notes = [];
  for (const id of ids) {
    const d = getNoteDetail(db2, id);
    if (!d) continue;
    notes.push({
      noteId: d.note.id,
      title: d.note.title,
      startedAt: d.note.started_at,
      source: d.note.source,
      transcript: transcriptTextOf(db2, id),
      rawNotes: rawNotesToPlain(d.raw_notes_md),
      enhanced: d.enhanced?.content_md ?? ""
    });
  }
  const scopeLabel = scope.kind === "note" ? notes[0]?.title ?? "not" : scope.kind === "person" ? getPerson(db2, scope.id ?? "")?.name ?? "kisi" : scope.kind === "company" ? getCompany(db2, scope.id ?? "")?.name ?? "sirket" : "tum notlar";
  const threadId = createThread(db2, scope.kind, scope.id ?? null, `${recipe.name} — ${scopeLabel}`);
  insertChatMessage(db2, {
    threadId,
    role: "user",
    contentMd: `/${recipe.shortcut} — ${recipe.name}`
  });
  const ctx = buildScopedContext(notes, { maxCharsPerNote: 3e3, maxTotalChars: 2e4 });
  const llm = resolveLlmProvider(settings.llm_provider);
  const opts = llmOptionsFor(db2, llm);
  const system = `${RECIPE_SYSTEM_SUFFIX}

GOREV: ${recipe.prompt_body}`;
  const user = ["### NOTLAR", ctx.block || "(not yok)"].join("\n");
  const finish = (p) => {
    insertChatMessage(db2, {
      threadId,
      role: "assistant",
      contentMd: p.answerMd,
      citations: p.citations,
      provider: p.provider,
      model: p.model,
      usedFallback: p.usedFallback,
      scannedNotes: notes.length,
      error: p.error ?? null
    });
    return {
      ok: true,
      threadId,
      answer_md: p.answerMd,
      citations: p.citations,
      provider: p.provider,
      model: p.model,
      usedFallback: p.usedFallback,
      error: p.error
    };
  };
  if (llm.requiresApiKey && !opts.apiKey) {
    return finish({
      answerMd: "Bu recipe LLM gerektirir; API anahtari tanimli degil. Ayarlar > AI not uretimi bolumunden bir saglayici anahtari ekleyin.",
      citations: [],
      provider: null,
      model: null,
      usedFallback: true,
      error: "LLM anahtari yok"
    });
  }
  try {
    deps.onProgress?.(`${recipe.name} calistiriliyor...`);
    const res = await llm.complete({ system, user, maxTokens: 1800, temperature: 0.2 }, opts);
    const payload = extractJsonObject(res.text);
    const resolved = resolveScopedCitations(payload.citations ?? [], ctx.index);
    deps.log?.(
      `[recipe] ${recipe.shortcut} kapsam=${scope.kind} not=${notes.length} kaynak=${resolved.citations.length}`
    );
    return finish({
      answerMd: (payload.answer_md ?? "").trim() || "(bos yanit)",
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: "previous_note",
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log?.(`[recipe] hata: ${message}`);
    return finish({
      answerMd: `Recipe calistirilamadi: ${message}`,
      citations: [],
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    });
  }
}
function safeFileName(input, fallback = "not") {
  const s = (input ?? "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 80);
  return s || fallback;
}
function csvField(value) {
  const s = value === null || value === void 0 ? "" : String(value);
  if (s === "") return "";
  const needsQuote = /[",\r\n]/.test(s) || s !== s.trim();
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
function csvRow(values) {
  return values.map(csvField).join(",");
}
function yamlValue(value) {
  const s = value ?? "";
  if (s === "") return '""';
  if (/^[\w\-. /]+$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s;
  return JSON.stringify(s);
}
function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function noteToMarkdown(db2, noteId, opts) {
  const d = getNoteDetail(db2, noteId);
  if (!d) return null;
  const n = d.note;
  const out = [];
  out.push("---");
  out.push(`title: ${yamlValue(n.title)}`);
  out.push(`date: ${n.started_at}`);
  if (n.ended_at) out.push(`ended: ${n.ended_at}`);
  out.push(`source: ${n.source}`);
  out.push(`status: ${n.status}`);
  if (n.tags.length > 0) out.push(`tags: [${n.tags.map(yamlValue).join(", ")}]`);
  if (n.participants.length > 0)
    out.push(`people: [${n.participants.map((p) => yamlValue(p.name)).join(", ")}]`);
  if (d.calendar_event) {
    out.push(`calendar: ${yamlValue(d.calendar_event.title)}`);
    if (d.calendar_event.location) out.push(`location: ${yamlValue(d.calendar_event.location)}`);
  }
  out.push("---");
  out.push("");
  out.push(`# ${n.title}`);
  out.push("");
  const raw = rawNotesToPlain(d.raw_notes_md).trim();
  if (raw) {
    out.push("## Ham notlarım");
    out.push("");
    out.push(raw);
    out.push("");
  }
  if (d.enhanced) {
    out.push("## AI ile zenginleştirilmiş not");
    out.push("");
    out.push(d.enhanced.content_md.trim());
    out.push("");
    if (d.enhanced.citations.length > 0) {
      out.push("### Kaynaklar");
      out.push("");
      for (const c of d.enhanced.citations) {
        const kind = c.source_type === "transcript" ? "transkript" : c.source_type === "raw_note" ? "ham not" : "takvim";
        out.push(`- \`${c.sentence_ref}\` (${kind}): ${(c.excerpt ?? "").trim()}`);
      }
      out.push("");
    }
    out.push(`<!-- model: ${d.enhanced.model ?? "-"} • sürüm: ${d.enhanced.version} -->`);
    out.push("");
  }
  if (opts.includeTranscripts && d.transcripts.length > 0) {
    out.push("## Transkript");
    out.push("");
    for (const t of d.transcripts) {
      const who = t.speaker_label ?? (t.channel === "mic" ? "Ben" : "Karşı taraf");
      const chan = t.channel === "mic" ? "mikrofon" : "sistem";
      out.push(`- \`${fmtClock(t.start_ms)}\` **${who}** _(${chan})_: ${t.text}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
function noteToJsonObject(db2, noteId) {
  const d = getNoteDetail(db2, noteId);
  if (!d) return null;
  return {
    id: d.note.id,
    title: d.note.title,
    started_at: d.note.started_at,
    ended_at: d.note.ended_at,
    source: d.note.source,
    status: d.note.status,
    tags: d.note.tags,
    people: d.note.participants.map((p) => ({ name: p.name, email: p.email })),
    calendar_event: d.calendar_event,
    raw_notes: rawNotesToPlain(d.raw_notes_md),
    raw_notes_html: d.raw_notes_md,
    enhanced: d.enhanced ? {
      version: d.enhanced.version,
      model: d.enhanced.model,
      template_id: d.enhanced.template_id,
      content_md: d.enhanced.content_md,
      citations: d.enhanced.citations
    } : null,
    transcripts: d.transcripts.map((t) => ({
      channel: t.channel,
      speaker: t.speaker_label,
      text: t.text,
      start_ms: t.start_ms,
      end_ms: t.end_ms
    }))
  };
}
const CSV_HEADERS = [
  "id",
  "title",
  "started_at",
  "ended_at",
  "source",
  "status",
  "tags",
  "people",
  "transcript_segments",
  "raw_notes_chars",
  "enhanced_version",
  "enhanced_model"
];
function notesToCsv(db2, noteIds) {
  const lines = [csvRow(CSV_HEADERS)];
  for (const id of noteIds) {
    const d = getNoteDetail(db2, id);
    if (!d) continue;
    lines.push(
      csvRow([
        d.note.id,
        d.note.title,
        d.note.started_at,
        d.note.ended_at ?? "",
        d.note.source,
        d.note.status,
        d.note.tags.join("; "),
        d.note.participants.map((p) => p.name).join("; "),
        d.transcripts.length,
        rawNotesToPlain(d.raw_notes_md).length,
        d.enhanced?.version ?? "",
        d.enhanced?.model ?? ""
      ])
    );
  }
  return lines.join("\r\n") + "\r\n";
}
function uniquePath(dir, base, ext) {
  let candidate = node_path.join(dir, `${base}${ext}`);
  let i = 1;
  while (node_fs.existsSync(candidate)) {
    i++;
    candidate = node_path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}
const DOCUMENT_PARTS = ["raw", "enhanced", "summary", "transcript"];
const DOCUMENT_PART_LABELS = { raw: "Ham notlarım", enhanced: "AI ile zenginleştirilmiş not", summary: "Toplantı özeti", transcript: "Transkript" };
function meetingSummary(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s*(özet|summary)\s*$/i.test(line.trim()));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^#{1,6}\s+/.test(line));
  return lines.slice(start + 1, end < 0 ? void 0 : end).join("\n").trim();
}
function enhancedWithoutSummary(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s*(özet|summary)\s*$/i.test(line.trim()));
  if (start < 0) return lines.join("\n").trim();
  const end = lines.findIndex((line, i) => i > start && /^#{1,6}\s+/.test(line));
  return [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join("\n").trim();
}
function exportPartText(detail, part, parts) {
  if (part === "raw") return rawNotesToPlain(detail.raw_notes_md).trim();
  if (part === "enhanced") return parts.includes("summary") ? enhancedWithoutSummary(detail.enhanced?.content_md) : String(detail.enhanced?.content_md ?? "").trim();
  if (part === "summary") return meetingSummary(detail.enhanced?.content_md);
  if (part === "transcript") return detail.transcripts.map((t) => `${fmtClock(t.start_ms)}  ${t.speaker_label ?? (t.channel === "mic" ? "Ben" : "Karşı taraf")}: ${t.text}`).join("\n").trim();
  return "";
}
function buildExportDocument(db2, noteIds, parts, title) {
  const notes = [];
  for (const id of noteIds) {
    const detail = getNoteDetail(db2, id);
    if (!detail) continue;
    const sections = parts.map((part) => ({ key: part, title: DOCUMENT_PART_LABELS[part], text: exportPartText(detail, part, parts) })).filter((part) => part.text);
    if (sections.length) notes.push({ id, title: detail.note.title, date: detail.note.started_at, sections });
  }
  return { title, exportedAt: new Date().toISOString(), notes };
}
function escapeDocumentText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function linesToBlocks(text, transcript = false) {
  return String(text).split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return { kind: "space", text: "" };
    if (transcript) return { kind: "transcript", text: line };
    if (/^#{1,6}\s+/.test(line)) return { kind: "subheading", text: line.replace(/^#{1,6}\s+/, "") };
    if (/^([-*•]|\d+\.)\s+/.test(line)) return { kind: "bullet", text: line.replace(/^([-*•]|\d+\.)\s+/, "") };
    return { kind: "paragraph", text: line };
  });
}
function exportDocumentHtml(doc) {
  const notes = doc.notes.map((note, i) => `<article${i ? ' class="new-note"' : ""}><h1>${escapeDocumentText(note.title)}</h1><p class="date">${escapeDocumentText(new Date(note.date).toLocaleString("tr-TR"))}</p>${note.sections.map((section) => `<section><h2>${escapeDocumentText(section.title)}</h2>${linesToBlocks(section.text, section.key === "transcript").map((block) => block.kind === "space" ? "" : block.kind === "subheading" ? `<h3>${escapeDocumentText(block.text)}</h3>` : `<p class="${block.kind}">${block.kind === "bullet" ? "• " : ""}${escapeDocumentText(block.text)}</p>`).join("")}</section>`).join("")}</article>`).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeDocumentText(doc.title)}</title><style>@page{size:A4;margin:18mm 18mm 20mm}body{font-family:Arial,"Segoe UI",sans-serif;color:#242321;font-size:10.5pt;line-height:1.48}article.new-note{break-before:page}h1{font-size:23pt;line-height:1.15;margin:0 0 5mm;font-weight:700}h2{font-size:14pt;margin:9mm 0 3mm;padding-bottom:2mm;border-bottom:1px solid #dedbd4;break-after:avoid}h3{font-size:11pt;margin:5mm 0 2mm;break-after:avoid}.date{color:#6d6a65;font-size:9pt;margin:0 0 8mm}p{margin:0 0 2.5mm;white-space:pre-wrap;overflow-wrap:anywhere}.bullet{padding-left:4mm;text-indent:-4mm}.transcript{padding:2mm 0;border-bottom:1px solid #efede9;font-size:9.7pt;break-inside:avoid}section{margin-bottom:4mm}</style></head><body>${notes}</body></html>`;
}
async function exportDocumentPdf(doc) {
  const win = new electron.BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    await win.loadURL("data:text/html;base64," + Buffer.from(exportDocumentHtml(doc), "utf8").toString("base64"));
    await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    return await win.webContents.printToPDF({ printBackground: true, displayHeaderFooter: false, pageSize: "A4", preferCSSPageSize: true });
  } finally {
    win.destroy();
  }
}
function docxParagraph(text, style, options = {}) {
  const pStyle = style ? `<w:pStyle w:val="${style}"/>` : "";
  const pageBreak = options.pageBreak ? '<w:pageBreakBefore w:val="1"/>' : "";
  const space = options.space ? '<w:spacing w:after="90"/>' : "";
  const prefix = options.bullet ? "• " : "";
  return `<w:p><w:pPr>${pStyle}${pageBreak}${space}</w:pPr><w:r><w:t xml:space="preserve">${escapeDocumentText(prefix + text)}</w:t></w:r></w:p>`;
}
function docxXml(doc) {
  const body = [];
  for (const [i, note] of doc.notes.entries()) {
    body.push(docxParagraph(note.title, "Title", { pageBreak: i > 0 }));
    body.push(docxParagraph(new Date(note.date).toLocaleString("tr-TR"), "Subtitle"));
    for (const section of note.sections) {
      body.push(docxParagraph(section.title, "Heading1"));
      for (const block of linesToBlocks(section.text, section.key === "transcript")) {
        if (block.kind === "space") continue;
        body.push(docxParagraph(block.text, block.kind === "subheading" ? "Heading2" : block.kind === "transcript" ? "Transcript" : "Normal", { bullet: block.kind === "bullet", space: true }));
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1134" w:left="1020" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? crc >>> 1 ^ 3988292384 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}
function zipFiles(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8"), raw = Buffer.from(content, "utf8"), packed = node_zlib.deflateRawSync(raw), checksum = crc32(raw);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46);
    local.writeUInt32LE(67324752, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(2048, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    directory.writeUInt32LE(33639248, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(2048, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed); central.push(directory, nameBytes); offset += local.length + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function exportDocumentDocx(doc) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:color w:val="242321"/></w:rPr><w:pPr><w:spacing w:after="110" w:line="290" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="000000"/></w:rPr><w:pPr><w:spacing w:after="160"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:color w:val="6D6A65"/></w:rPr><w:pPr><w:spacing w:after="320"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="000000"/></w:rPr><w:pPr><w:spacing w:before="300" w:after="120"/><w:keepNext/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="000000"/></w:rPr><w:pPr><w:spacing w:before="170" w:after="80"/><w:keepNext/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Transcript"><w:name w:val="Transcript"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="19"/></w:rPr><w:pPr><w:spacing w:after="90"/></w:pPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeDocumentText(doc.title)}</dc:title><dc:creator>Notlar</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${doc.exportedAt}</dcterms:created></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Notlar</Application></Properties>`;
  return zipFiles([["[Content_Types].xml", contentTypes], ["_rels/.rels", rels], ["word/document.xml", docxXml(doc)], ["word/styles.xml", styles], ["word/_rels/document.xml.rels", docRels], ["docProps/core.xml", core], ["docProps/app.xml", app]]);
}
async function exportNotes(db2, req) {
  try {
    const targetDir = req.targetDir?.trim() || getSettingRaw(db2, "export_dir")?.trim() || "";
    if (!targetDir) {
      return { ok: false, files: [], targetDir: "", noteCount: 0, bytes: 0, error: "Hedef klasor secilmedi" };
    }
    node_fs.mkdirSync(targetDir, { recursive: true });
    let noteIds = [];
    if (req.scope.kind === "note" && req.scope.id) noteIds = [req.scope.id];
    else if (req.scope.kind === "person" && req.scope.id)
      noteIds = listPersonNotes(db2, req.scope.id).map((l) => l.note_id);
    else if (req.scope.kind === "company" && req.scope.id)
      noteIds = listCompanyNotes(db2, req.scope.id).map((l) => l.note_id);
    else noteIds = listNotes(db2, { limit: 5e3 }).map((n) => n.id);
    if (noteIds.length === 0) {
      return { ok: false, files: [], targetDir, noteCount: 0, bytes: 0, error: "Aktarilacak not yok" };
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const files = [];
    let bytes = 0;
    const write = (path, content) => {
      node_fs.writeFileSync(path, content);
      files.push(path.slice(targetDir.length + 1));
      bytes += Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf-8");
    };
    if (req.format === "pdf" || req.format === "docx") {
      const parts = DOCUMENT_PARTS.filter((part) => req.parts?.includes(part));
      if (!parts.length) throw new Error("En az bir içerik seçin");
      const mode = req.mode === "separate" ? "separate" : "combined";
      const first = getNoteDetail(db2, noteIds[0]);
      const base = safeFileName(noteIds.length === 1 ? first?.note.title : `Toplantı notları ${stamp}`);
      const bundles = mode === "separate" ? parts.map((part) => ({ parts: [part], suffix: DOCUMENT_PART_LABELS[part] })) : [{ parts, suffix: "Tam belge" }];
      const exportedNoteIds = new Set();
      for (const bundle of bundles) {
        const doc = buildExportDocument(db2, noteIds, bundle.parts, `${base} - ${bundle.suffix}`);
        if (!doc.notes.length) continue;
        for (const note of doc.notes) exportedNoteIds.add(note.id);
        const output = uniquePath(targetDir, safeFileName(`${base} - ${bundle.suffix}`), `.${req.format}`);
        write(output, req.format === "pdf" ? await exportDocumentPdf(doc) : exportDocumentDocx(doc));
      }
      if (!files.length) throw new Error("Seçilen içeriklerde dışa aktarılacak veri bulunamadı");
      return { ok: true, files, targetDir, noteCount: exportedNoteIds.size, bytes };
    } else if (req.format === "markdown") {
      if (req.splitFiles) {
        const folder = node_path.join(targetDir, `notlar-${stamp}`);
        node_fs.mkdirSync(folder, { recursive: true });
        for (const id of noteIds) {
          const md = noteToMarkdown(db2, id, { includeTranscripts: req.includeTranscripts });
          if (!md) continue;
          const d = getNoteDetail(db2, id);
          const date = (d?.note.started_at ?? "").slice(0, 10);
          const base = safeFileName(`${date} ${d?.note.title ?? "not"}`);
          write(uniquePath(folder, base, ".md"), md);
        }
        const index = listNotes(db2, { limit: 5e3 }).filter((n) => noteIds.includes(n.id)).map((n) => `- ${n.started_at.slice(0, 10)} — [[${safeFileName(`${n.started_at.slice(0, 10)} ${n.title}`)}]]`).join("\n");
        write(node_path.join(folder, `_indeks-${stamp}.md`), `# Notlar dizini

${index}
`);
      } else {
        const parts = [`# Notlar disa aktarma (${stamp})`, ""];
        for (const id of noteIds) {
          const md = noteToMarkdown(db2, id, { includeTranscripts: req.includeTranscripts });
          if (md) parts.push(md, "\n---\n");
        }
        write(uniquePath(targetDir, `notlar-${stamp}`, ".md"), parts.join("\n"));
      }
    } else if (req.format === "json") {
      const payload = {
        exported_at: (/* @__PURE__ */ new Date()).toISOString(),
        app: "Notlar",
        note_count: noteIds.length,
        notes: noteIds.map((id) => noteToJsonObject(db2, id)).filter(Boolean)
      };
      write(uniquePath(targetDir, `notlar-${stamp}`, ".json"), JSON.stringify(payload, null, 2));
    } else {
      write(uniquePath(targetDir, `notlar-${stamp}`, ".csv"), notesToCsv(db2, noteIds));
    }
    return { ok: true, files, targetDir, noteCount: noteIds.length, bytes };
  } catch (err) {
    return {
      ok: false,
      files: [],
      targetDir: req.targetDir ?? "",
      noteCount: 0,
      bytes: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function dbDir() {
  return node_path.join(electron.app.getPath("userData"), "db");
}
function dbFilePath() {
  return node_path.join(dbDir(), "notlar.db");
}
function backupDir() {
  return node_path.join(dbDir(), "backups");
}
function canOpen(path, key) {
  let db2 = null;
  try {
    db2 = new Database(path);
    if (key) db2.pragma(`key = '${key}'`);
    db2.prepare("SELECT count(*) AS c FROM sqlite_master").get();
    return true;
  } catch {
    return false;
  } finally {
    try {
      db2?.close();
    } catch {
    }
  }
}
function rekeyFile(path, fromKey, toKey) {
  const db2 = new Database(path);
  try {
    if (fromKey) db2.pragma(`key = '${fromKey}'`);
    db2.pragma("journal_mode = DELETE");
    db2.pragma(toKey ? `rekey = '${toKey}'` : "rekey = ''");
  } finally {
    db2.close();
  }
}
function clearWalFiles(path) {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      node_fs.rmSync(path + suffix, { force: true });
    } catch {
    }
  }
}
function convertBackupFiles(passphrase, direction) {
  let done = 0;
  let files = [];
  try {
    files = node_fs.readdirSync(backupDir()).filter((f) => f.endsWith(".db"));
  } catch {
    return 0;
  }
  for (const f of files) {
    const full = node_path.join(backupDir(), f);
    const plain = fileLooksPlaintext(full);
    if (direction === "encrypt" && !plain) continue;
    if (direction === "decrypt" && plain) continue;
    try {
      if (direction === "encrypt") rekeyFile(full, null, passphrase);
      else rekeyFile(full, passphrase, null);
      const ok = direction === "encrypt" ? canOpen(full, passphrase) : canOpen(full, null);
      if (ok) done++;
    } catch {
    }
  }
  return done;
}
function securityStatus() {
  const path = dbFilePath();
  const enc = isEncrypted(dbDir());
  const plain = node_fs.existsSync(path) ? fileLooksPlaintext(path) : false;
  let backups = [];
  let plaintextBackupCount = 0;
  try {
    const files = node_fs.readdirSync(backupDir()).filter((f) => f.endsWith(".db"));
    for (const f of files) {
      if (fileLooksPlaintext(node_path.join(backupDir(), f))) plaintextBackupCount++;
    }
    backups = files.map((f) => {
      const st = node_fs.statSync(node_path.join(backupDir(), f));
      return { name: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    backups = [];
  }
  return {
    encrypted: enc,
    encryptionAvailable: encryptionAvailable(),
    dbPath: path,
    dbSizeBytes: node_fs.existsSync(path) ? node_fs.statSync(path).size : 0,
    fileIsPlaintext: plain,
    consistent: enc ? !plain : plain || !node_fs.existsSync(path),
    keyPath: node_path.join(dbDir(), "db.key"),
    backups,
    plaintextBackupCount
  };
}
function backupDatabase(reason = "manual") {
  const src = dbFilePath();
  if (!node_fs.existsSync(src)) return null;
  node_fs.mkdirSync(backupDir(), { recursive: true });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const target = node_path.join(backupDir(), `notlar-${reason}-${stamp}.db`);
  const key = isEncrypted(dbDir()) ? loadKey(dbDir()) : null;
  let db2 = null;
  try {
    db2 = new Database(src);
    if (key) db2.pragma(`key = '${key}'`);
    db2.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
  } finally {
    try {
      db2?.close();
    } catch {
    }
  }
  node_fs.copyFileSync(src, target);
  return target;
}
function pruneBackups(keep = 5) {
  try {
    const files = node_fs.readdirSync(backupDir()).filter((f) => f.endsWith(".db")).map((f) => ({ f, t: node_fs.statSync(node_path.join(backupDir(), f)).mtimeMs })).sort((a, b) => b.t - a.t);
    let removed = 0;
    for (const { f } of files.slice(keep)) {
      node_fs.rmSync(node_path.join(backupDir(), f), { force: true });
      removed++;
    }
    return removed;
  } catch {
    return 0;
  }
}
async function enableEncryption(hooks) {
  if (!encryptionAvailable()) {
    return {
      ok: false,
      encrypted: false,
      error: "Isletim sistemi anahtar deposu (Windows DPAPI) kullanilamiyor."
    };
  }
  if (isEncrypted(dbDir())) return { ok: false, encrypted: true, error: "Sifreleme zaten acik." };
  const path = dbFilePath();
  if (!node_fs.existsSync(path)) return { ok: false, encrypted: false, error: "Veritabani dosyasi yok." };
  if (!canOpen(path, null)) {
    return {
      ok: false,
      encrypted: false,
      error: "Veritabani su an acilamiyor (baslik veya WAL bozuk); once yedekten geri donun."
    };
  }
  let backupPath;
  hooks.close();
  try {
    backupPath = backupDatabase("pre-encrypt") ?? void 0;
    const passphrase = generateKey();
    rekeyFile(path, null, passphrase);
    clearWalFiles(path);
    try {
      saveKey(dbDir(), passphrase);
    } catch (err) {
      rekeyFile(path, passphrase, null);
      clearWalFiles(path);
      hooks.reopen();
      return {
        ok: false,
        encrypted: false,
        backupPath,
        error: "Anahtar kaydedilemedi, sifreleme geri alindi: " + (err instanceof Error ? err.message : String(err)),
        verified: false
      };
    }
    const encryptedBackups = convertBackupFiles(passphrase, "encrypt");
    if (!canOpen(path, passphrase)) {
      removeKey(dbDir());
      rekeyFile(path, passphrase, null);
      clearWalFiles(path);
      hooks.reopen();
      return {
        ok: false,
        encrypted: false,
        backupPath,
        error: "Dogrulama basarisiz, sifreleme geri alindi.",
        verified: false
      };
    }
    const keylessRejected = !canOpen(path, null);
    hooks.reopen();
    pruneBackups(5);
    return {
      ok: true,
      encrypted: true,
      backupPath,
      verified: keylessRejected,
      encryptedBackups
    };
  } catch (err) {
    if (!isEncrypted(dbDir())) clearWalFiles(path);
    try {
      hooks.reopen();
    } catch {
    }
    return {
      ok: false,
      encrypted: isEncrypted(dbDir()),
      backupPath,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function disableEncryption(hooks) {
  if (!isEncrypted(dbDir())) return { ok: false, encrypted: false, error: "Sifreleme zaten kapali." };
  const path = dbFilePath();
  const key = loadKey(dbDir());
  if (!key) {
    return {
      ok: false,
      encrypted: true,
      error: "Anahtar cozulemedi (db.key okunamadi); sifreleme kaldirilamaz."
    };
  }
  let backupPath;
  hooks.close();
  try {
    backupPath = backupDatabase("pre-decrypt") ?? void 0;
    rekeyFile(path, key, null);
    clearWalFiles(path);
    if (!canOpen(path, null)) {
      rekeyFile(path, null, key);
      clearWalFiles(path);
      hooks.reopen();
      return {
        ok: false,
        encrypted: true,
        backupPath,
        error: "Sifreleme kaldirilamadi; degisiklik geri alindi.",
        verified: false
      };
    }
    const decryptedBackups = convertBackupFiles(key, "decrypt");
    removeKey(dbDir());
    hooks.reopen();
    pruneBackups(5);
    return { ok: true, encrypted: false, backupPath, verified: true, decryptedBackups };
  } catch (err) {
    try {
      hooks.reopen();
    } catch {
    }
    return {
      ok: false,
      encrypted: isEncrypted(dbDir()),
      backupPath,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function checkEncryptionConsistency() {
  const path = dbFilePath();
  if (!node_fs.existsSync(path)) return { ok: true };
  const enc = isEncrypted(dbDir());
  const plain = fileLooksPlaintext(path);
  if (enc && plain) {
    return {
      ok: false,
      message: "Anahtar dosyasi var ama veritabani duz metin gorunuyor. Sifreleme yarim kalmis olabilir; Ayarlar > Guvenlik bolumunden kontrol edin."
    };
  }
  if (!enc && !plain) {
    return {
      ok: false,
      message: "Veritabani sifreli ama anahtar dosyasi bulunamadi. Veriye erisilemez; yedekten geri donmek gerekebilir."
    };
  }
  return { ok: true };
}
function runRetention(deps, opts) {
  const { db: db2 } = deps;
  const settings = getAllSettings(db2);
  const days = Math.max(0, Math.floor(settings.retention_days ?? 0));
  const total = listNotes(db2, { limit: 1e5 }).length;
  if (days === 0) {
    return { deleted: 0, kept: total, retentionDays: 0 };
  }
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const stale = db2.prepare("SELECT id, title FROM notes WHERE started_at < ? ORDER BY started_at ASC").all(cutoff);
  if (stale.length === 0) {
    deps.log?.(`[retention] silinecek not yok (esik: ${cutoff})`);
    return { deleted: 0, kept: total, retentionDays: days };
  }
  if (opts?.dryRun) {
    return { deleted: stale.length, kept: total - stale.length, retentionDays: days };
  }
  try {
    backupDatabase("pre-retention");
    pruneBackups(5);
  } catch (err) {
    deps.log?.(`[retention] yedek alinamadi: ${err instanceof Error ? err.message : String(err)}`);
  }
  const tx = db2.transaction(() => {
    for (const n of stale) deleteNote(db2, n.id);
  });
  tx();
  deps.log?.(`[retention] ${stale.length} not silindi (${days} gunden eski)`);
  return { deleted: stale.length, kept: total - stale.length, retentionDays: days };
}
function deleteAllData(db2) {
  const notes = listNotes(db2, { limit: 1e5 });
  let backupPath;
  try {
    backupPath = backupDatabase("pre-delete-all") ?? void 0;
    pruneBackups(3);
  } catch {
  }
  const tx = db2.transaction(() => {
    db2.prepare("DELETE FROM notes").run();
    db2.prepare("DELETE FROM chat_messages").run();
    db2.prepare("DELETE FROM chat_threads").run();
    db2.prepare("DELETE FROM people").run();
    db2.prepare("DELETE FROM companies").run();
    db2.prepare("DELETE FROM tags").run();
    db2.prepare("DELETE FROM note_tags").run();
    db2.prepare("DELETE FROM note_people").run();
  });
  tx();
  return { deletedNotes: notes.length, backupPath };
}
function pcm16ToWav(pcm, sampleRate) {
  const dataSize = pcm.length * 2;
  const header2 = Buffer.alloc(44);
  header2.write("RIFF", 0, "ascii");
  header2.writeUInt32LE(36 + dataSize, 4);
  header2.write("WAVE", 8, "ascii");
  header2.write("fmt ", 12, "ascii");
  header2.writeUInt32LE(16, 16);
  header2.writeUInt16LE(1, 20);
  header2.writeUInt16LE(1, 22);
  header2.writeUInt32LE(sampleRate, 24);
  header2.writeUInt32LE(sampleRate * 2, 28);
  header2.writeUInt16LE(2, 32);
  header2.writeUInt16LE(16, 34);
  header2.write("data", 36, "ascii");
  header2.writeUInt32LE(dataSize, 40);
  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], i * 2);
  return Buffer.concat([header2, data]);
}
function readWavPcm16(filePath) {
  const buf = node_fs.readFileSync(filePath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Gecersiz WAV dosyasi: RIFF basligi yok");
  }
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Gecersiz WAV dosyasi: WAVE yok");
  const audioFormat = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (audioFormat !== 1) throw new Error(`Desteklenmeyen WAV formati (${audioFormat}); yalnizca PCM`);
  if (bits !== 16) throw new Error(`Desteklenmeyen bit derinligi (${bits}); yalnizca 16-bit`);
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      dataStart = offset + 8;
      dataSize = Math.min(size, buf.length - dataStart);
      break;
    }
    offset += 8 + size + size % 2;
  }
  if (dataStart < 0) throw new Error("WAV icinde data chunk bulunamadi");
  const usable = dataSize - dataSize % 2;
  const samples = usable / 2;
  const raw = new Int16Array(samples);
  for (let i = 0; i < samples; i++) raw[i] = buf.readInt16LE(dataStart + i * 2);
  return { pcm: raw, sampleRate, channels };
}
function downmixToMono(pcm, channels) {
  if (channels <= 1) return pcm;
  const frames = Math.floor(pcm.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c];
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }
  return out;
}
function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate || input.length === 0) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac);
  }
  return out;
}
const liveContext = /* @__PURE__ */ new Map();
function resetLiveContext() {
  liveContext.clear();
}
function toPcm16(data) {
  if (data instanceof ArrayBuffer) return new Int16Array(data);
  const u8 = data;
  const copy = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return new Int16Array(copy);
}
async function transcribeLiveChunk(deps, req) {
  const { db: db2 } = deps;
  const pcm = toPcm16(req.pcm);
  if (pcm.length < req.sampleRate * 0.3) return { ok: true, segments: [], skipped: true };
  const settings = getAllSettings(db2);
  const provider = resolveProvider(settings.stt_provider);
  const tmpFile = node_path.join(electron.app.getPath("temp"), `notlar-live-${node_crypto.randomUUID()}.wav`);
  try {
    node_fs.writeFileSync(tmpFile, pcm16ToWav(pcm, req.sampleRate));
    const result = await provider.transcribe(tmpFile, {
      apiKey: deps.apiKey(),
      model: settings.stt_model || provider.defaultModel,
      language: req.language || settings.language,
      // Iki ipucu birlestirilir: jargon sozlugu (dogru terimler) + kanal baglami
      prompt: [sttHintFor(db2), liveContext.get(req.channel)].filter(Boolean).join(" ").slice(0, 900) || void 0
    });
    const fullText = result.text.trim();
    if (!fullText) return { ok: true, segments: [], skipped: true };
    const rows = result.segments.length ? result.segments.map((s) => ({
      channel: req.channel,
      speaker_label: req.channel === "mic" ? "Ben" : "Karsi taraf",
      text: correctText(db2, s.text.trim() || fullText),
      start_ms: req.offsetMs + s.start_ms,
      end_ms: req.offsetMs + Math.max(s.end_ms, s.start_ms + 1)
    })) : [
      {
        channel: req.channel,
        speaker_label: req.channel === "mic" ? "Ben" : "Karsi taraf",
        text: correctText(db2, fullText),
        start_ms: req.offsetMs,
        end_ms: req.offsetMs + 1e3
      }
    ];
    const inserted = insertTranscriptsReturning(db2, req.noteId, rows);
    const removed = removeEchoDuplicates(db2, req.noteId);
    const prev = liveContext.get(req.channel) ?? "";
    liveContext.set(req.channel, `${prev} ${fullText}`.trim().slice(-400));
    deps.onSegment?.(req.noteId, inserted);
    if (removed) deps.onTranscriptRefresh?.(req.noteId);
    return { ok: true, segments: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, segments: [], error: message };
  } finally {
    node_fs.rmSync(tmpFile, { force: true });
  }
}
function normalizedSpeech(text) {
  return String(text ?? "").toLocaleLowerCase("tr").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function removeEchoDuplicates(db2, noteId) {
  const rows = db2.prepare("SELECT id, channel, text, start_ms, end_ms FROM transcripts WHERE note_id = ? AND channel IN ('mic', 'system') ORDER BY start_ms").all(noteId);
  const systems = rows.filter((r) => r.channel === "system");
  const remove = [];
  for (const mic of rows.filter((r) => r.channel === "mic")) {
    const a = normalizedSpeech(mic.text);
    if (!a) continue;
    const aWords = a.split(" ");
    const match = systems.some((sys) => {
      if (mic.start_ms > sys.end_ms + 1500 || sys.start_ms > mic.end_ms + 1500) return false;
      const b = normalizedSpeech(sys.text);
      if (!b) return false;
      if (a === b) return true;
      const bWords = b.split(" ");
      if (Math.min(aWords.length, bWords.length) < 3) return false;
      const common = aWords.filter((w) => bWords.includes(w)).length;
      return common / Math.min(aWords.length, bWords.length) >= 0.8 && Math.max(aWords.length, bWords.length) / Math.min(aWords.length, bWords.length) <= 1.5;
    });
    if (match) remove.push(mic.id);
  }
  const del = db2.prepare("DELETE FROM transcripts WHERE id = ?");
  for (const id of remove) del.run(id);
  return remove.length;
}
function makeApiKeyResolver() {
  const db2 = lazyDb();
  return () => (getSettingRaw(db2, "groq_api_key") || process.env.GROQ_API_KEY || "").trim();
}
function registerDisplayMediaHandler() {
  electron.session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  electron.session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      electron.desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        if (sources.length === 0) {
          callback({ video: void 0, audio: void 0 });
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      }).catch(() => callback({ video: void 0, audio: void 0 }));
    },
    { useSystemPicker: false }
  );
}
function registerIpcHandlers(getWindow, deps) {
  const db2 = lazyDb();
  const resolveApiKey = makeApiKeyResolver();
  const emitImport = (payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(IPC.importProgress, payload);
  };
  const emitRecording = (payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(IPC.recordingEvent, payload);
  };
  electron.ipcMain.handle(IPC.appInfo, () => ({
    version: electron.app.getVersion(),
    dbPath: electron.app.getPath("userData"),
    providers: listProviders(),
    hasApiKey: resolveApiKey().length > 0
  }));
  electron.ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(db2));
  electron.ipcMain.handle(IPC.settingsSet, (_e, key, value) => {
    setSetting(db2, key, value);
    const next = getAllSettings(db2);
    try {
      deps.onSettingsChanged?.(next);
    } catch (err) {
      console.error("[settings] onSettingsChanged hatasi:", err);
    }
    return next;
  });
  electron.ipcMain.handle(IPC.notesList, () => listNotes(db2));
  electron.ipcMain.handle(IPC.notesGet, (_e, id) => getNoteDetail(db2, id));
  electron.ipcMain.handle(
    IPC.notesCreate,
    (_e, input) => {
      const id = createNote(db2, {
        title: input?.title?.trim() || "Yeni not",
        source: input?.source || "manual",
        status: input?.status || "ready"
      });
      return getNoteDetail(db2, id);
    }
  );
  electron.ipcMain.handle(
    IPC.notesCreateForEvent,
    (_e, ev) => {
      if (!ev?.id) return null;
      const existing = findNoteByCalendarEventId(db2, ev.id);
      if (existing) {
        const detail = getNoteDetail(db2, existing);
        if (detail) return detail;
      }
      const id = createNote(db2, {
        title: ev.title || "Takvim etkinliği",
        source: "calendar",
        // Etkinligin saatini kullan: "Bugun" gruplamasi ve baslik meta verisi dogru olsun
        startedAt: ev.start_at,
        // Kayit YOK -> dogrudan 'ready'
        status: "ready"
      });
      linkNoteToCalendarEvent(db2, id, ev.id, ev.title || "Takvim etkinliği");
      return getNoteDetail(db2, id);
    }
  );
  electron.ipcMain.handle(IPC.notesDelete, (_e, id) => {
    deleteNote(db2, id);
    return true;
  });
  electron.ipcMain.handle(IPC.notesSetRaw, (_e, noteId, md) => {
    setRawNotes(db2, noteId, md);
    return true;
  });
  electron.ipcMain.handle(IPC.notesSetTitle, (_e, noteId, title) => {
    setNoteTitle(db2, noteId, title);
    return true;
  });
  electron.ipcMain.handle(IPC.searchAll, (_e, q) => searchNotes(db2, q || ""));
  electron.ipcMain.handle(IPC.templatesList, () => listTemplates(db2));
  electron.ipcMain.handle(IPC.dialogPickAudio, async () => {
    const w = getWindow();
    const res = w ? await electron.dialog.showOpenDialog(w, {
      title: "Ses dosyasi sec",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Ses dosyalari",
          extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "webm", "mp4"]
        },
        { name: "Tum dosyalar", extensions: ["*"] }
      ]
    }) : { canceled: true, filePaths: [] };
    if (res.canceled) return [];
    return res.filePaths;
  });
  electron.ipcMain.handle(IPC.dialogPickIcs, async () => {
    const w = getWindow();
    const res = w ? await electron.dialog.showOpenDialog(w, {
      title: "Takvim dosyasi (.ics) sec",
      properties: ["openFile"],
      filters: [
        { name: "iCalendar", extensions: ["ics", "ical", "ifb"] },
        { name: "Tum dosyalar", extensions: ["*"] }
      ]
    }) : { canceled: true, filePaths: [] };
    if (res.canceled) return null;
    return res.filePaths[0] ?? null;
  });
  electron.ipcMain.handle(
    IPC.notesImportAudio,
    async (_e, req) => importAudioFile({ db: db2, apiKey: resolveApiKey }, req, emitImport)
  );
  electron.ipcMain.handle(IPC.recordingStart, (_e, req) => {
    resetLiveContext();
    setNoteStatus(db2, req.noteId, "recording");
    deps.autoRecord.onRendererStarted(req);
    return { ok: true, channels: req.channels };
  });
  electron.ipcMain.handle(IPC.recordingChunk, async (_e, req) => {
    const res = await transcribeLiveChunk(
      {
        db: db2,
        apiKey: resolveApiKey,
        onSegment: (noteId, segments) => {
          emitRecording({ type: "segments", noteId, segments });
          deps.autoRecord.onSegments(noteId, segments.length);
        },
        onTranscriptRefresh: (noteId) => emitRecording({ type: "transcripts-refresh", noteId })
      },
      req
    );
    return res;
  });
  electron.ipcMain.handle(IPC.recordingStop, (_e, noteId) => {
    removeEchoDuplicates(db2, noteId);
    setNoteStatus(db2, noteId, "ready");
    if (googleStatus(db2).connected && !getAllSettings(db2).auto_enhance) {
      void processFollowupMeetings(db2, noteId).catch((err) => console.error("[google-calendar] takip toplantısı eklenemedi:", err));
    }
    resetLiveContext();
    emitRecording({ type: "status", noteId, status: "ready" });
    deps.autoRecord.onRendererStopped(noteId);
    const detail = getNoteDetail(db2, noteId);
    deps.osNotifier.show({
      title: "Kayıt bitti",
      body: `${detail?.note.title ?? "Not"} • ${detail?.transcripts.length ?? 0} parça yazıya döküldü`,
      noteId
    });
    return { ok: true };
  });
  electron.ipcMain.handle(IPC.recordingCancel, (_e, noteId) => {
    const detail = getNoteDetail(db2, noteId);
    const empty = !detail || detail.transcripts.length === 0;
    if (empty) {
      deleteNote(db2, noteId);
    } else {
      setNoteStatus(db2, noteId, "ready");
    }
    resetLiveContext();
    deps.autoRecord.onRendererStopped(noteId);
    return { ok: true, deleted: empty };
  });
  electron.ipcMain.handle(IPC.recordingState, (_e, payload) => {
    deps.autoRecord.setPaused(Boolean(payload?.paused));
    return true;
  });
  electron.ipcMain.handle(IPC.notifyAction, (_e, action) => {
    deps.autoRecord.handleAction(action);
    return true;
  });
  electron.ipcMain.handle(IPC.calendarSync, async () => {
    const res = await deps.scheduler.syncNow();
    if (res.ok) {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.calendarUpdated, res);
    }
    return res;
  });
  electron.ipcMain.handle(IPC.googleStatus, () => googleStatus(db2));
  electron.ipcMain.handle(IPC.googlePickCredentials, async () => {
    const w = getWindow();
    const selected = w ? await electron.dialog.showOpenDialog(w, { title: "Google Desktop OAuth JSON dosyası", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] }) : { canceled: true, filePaths: [] };
    if (selected.canceled || !selected.filePaths[0]) return googleStatus(db2);
    return importGoogleCredentials(db2, selected.filePaths[0]);
  });
  electron.ipcMain.handle(IPC.googleConnect, () => connectGoogleCalendar(db2));
  electron.ipcMain.handle(IPC.googleDisconnect, () => { setSetting(db2, "google_refresh_token", ""); return googleStatus(db2); });
  electron.ipcMain.handle(IPC.googleProcessNote, (_e, noteId) => processFollowupMeetings(db2, noteId));
  electron.ipcMain.handle(
    IPC.calendarEvents,
    (_e, fromIso) => listUpcomingCalendarEvents(db2, fromIso ?? (/* @__PURE__ */ new Date()).toISOString(), 100)
  );
  electron.ipcMain.handle(IPC.diagnostics, async () => {
    const settings = getAllSettings(db2);
    const result = await deps.detector.probe();
    const upcoming = listUpcomingCalendarEvents(db2, (/* @__PURE__ */ new Date()).toISOString(), 1);
    const active = [];
    if (result.allowedMicUser) active.push(`mic: ${result.allowedMicUser}`);
    if (result.allowedApp) active.push(`app: ${result.allowedApp}`);
    return {
      watchdog: deps.autoRecord.debugState(),
      micUsers: deps.detector.snapshot?.micUsers ?? [],
      processes: (deps.detector.snapshot?.processes ?? []).filter((p) => p.title),
      activeAllowedApps: active,
      calendarSource: settings.calendar_source,
      calendarEventCount: countCalendarEvents(db2),
      nextCalendarEvent: upcoming[0] ? { id: upcoming[0].id, title: upcoming[0].title, start_at: upcoming[0].start_at } : null
    };
  });
  electron.ipcMain.handle(IPC.directorySummary, () => ({
    people: listPeople(db2),
    companies: listCompanies(db2),
    tags: listTags(db2)
  }));
  electron.ipcMain.handle(IPC.peopleList, (_e, q) => listPeople(db2, { query: q }));
  electron.ipcMain.handle(IPC.peopleCreate, (_e, input) => createPersonManual(db2, input));
  electron.ipcMain.handle(IPC.peopleGet, (_e, id) => {
    const person = getPerson(db2, id);
    if (!person) return null;
    return {
      person,
      notes: listPersonNotes(db2, id),
      tags: listPersonTags(db2, id)
    };
  });
  electron.ipcMain.handle(
    IPC.peopleUpdate,
    (_e, id, patch) => {
      updatePerson(db2, id, patch);
      return getPerson(db2, id);
    }
  );
  electron.ipcMain.handle(IPC.peopleDedupe, () => {
    const merged = dedupePeople(db2);
    return { ok: true, merged, people: listPeople(db2) };
  });
  electron.ipcMain.handle(IPC.peopleMerge, (_e, fromId, toId) => {
    const moved = mergePeople(db2, fromId, toId);
    return { ok: true, moved, person: getPerson(db2, toId) };
  });
  electron.ipcMain.handle(
    IPC.peopleExtract,
    async () => ({ ok: false, error: "Kişiler yalnızca elle kaydedilir" })
  );
  electron.ipcMain.handle(IPC.companiesList, () => listCompanies(db2));
  electron.ipcMain.handle(IPC.companiesGet, (_e, id) => {
    const company = getCompany(db2, id);
    if (!company) return null;
    return {
      company,
      people: listCompanyPeople(db2, id),
      notes: listCompanyNotes(db2, id)
    };
  });
  electron.ipcMain.handle(IPC.tagsList, () => listTags(db2));
  electron.ipcMain.handle(IPC.tagsAdd, (_e, noteId, name) => addTagToNote(db2, noteId, name));
  electron.ipcMain.handle(IPC.tagsRemove, (_e, noteId, tagId) => {
    removeTagFromNote(db2, noteId, tagId);
    return true;
  });
  electron.ipcMain.handle(IPC.transcriptDelete, (_e, id) => deleteTranscript(db2, id));
  electron.ipcMain.handle(
    IPC.transcriptUpdateSpeaker,
    (_e, id, label) => updateTranscriptSpeaker(db2, id, label)
  );
  electron.ipcMain.handle(
    IPC.briefGet,
    async (_e, target) => buildBrief(
      { db: db2, onProgress: (m) => console.log("[brief] " + m), log: (m) => console.log(m) },
      target ?? {}
    )
  );
  electron.ipcMain.handle(
    IPC.askScoped,
    async (_e, req) => askScoped(
      {
        db: db2,
        onProgress: (m) => {
          const w = getWindow();
          if (w && !w.isDestroyed()) w.webContents.send(IPC.enhanceProgress, { stage: "calling", message: m });
        },
        log: (m) => console.log(m)
      },
      req
    )
  );
  electron.ipcMain.handle(IPC.llmProviders, () => listLlmProviders(db2));
  electron.ipcMain.handle(IPC.llmSetKey, (_e, providerId, key) => {
    const provider = resolveLlmProvider(providerId);
    setSetting(db2, `${provider.id}_api_key`, (key ?? "").trim());
    return listLlmProviders(db2);
  });
  electron.ipcMain.handle(IPC.llmTestKey, async (_e, providerId) => {
    const provider = resolveLlmProvider(providerId);
    if (!provider.requiresApiKey) return { ok: true, model: provider.defaultModel, note: "Anahtar gerekmez" };
    const info = llmKeyInfo(db2, provider);
    if (!info.key) {
      return { ok: false, error: "Anahtar tanimli degil. Once kaydedin." };
    }
    const opts = llmOptionsFor(db2, provider);
    try {
      if (provider.listModels) {
        const models = await provider.listModels(opts);
        if (models.length === 0) {
          return { ok: false, error: "Saglayici model listesi vermedi (anahtar gecersiz olabilir)." };
        }
        return { ok: true, modelCount: models.length, model: opts.model || provider.defaultModel, source: info.source };
      }
      const res = await provider.complete(
        { system: "Yanit olarak yalnizca OK yaz.", user: "OK", maxTokens: 5 },
        opts
      );
      return { ok: true, model: res.model, source: info.source };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC.llmModels, async (_e, providerId) => {
    const provider = resolveLlmProvider(providerId);
    try {
      const models = provider.listModels ? await provider.listModels(llmOptionsFor(db2, provider)) : [];
      return { provider: provider.id, models, suggested: provider.suggestedModels, defaultModel: provider.defaultModel };
    } catch (err) {
      return {
        provider: provider.id,
        models: [],
        suggested: provider.suggestedModels,
        defaultModel: provider.defaultModel,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
  electron.ipcMain.handle(
    IPC.notesEnhancedVersions,
    (_e, noteId) => listEnhancedVersions(db2, noteId)
  );
  electron.ipcMain.handle(IPC.notesEnhance, async (_e, noteId, templateId) => {
    const res = await enhanceNote(
      {
        db: db2,
        onProgress: (p) => {
          const w = getWindow();
          if (w && !w.isDestroyed()) w.webContents.send(IPC.enhanceProgress, p);
        },
        log: (m) => console.log(m)
      },
      noteId,
      templateId
    );
    if (res.ok) {
      if (googleStatus(db2).connected) {
        try {
          res.calendar = await processFollowupMeetings(db2, noteId);
        } catch (err) {
          res.calendar = { created: 0, error: err instanceof Error ? err.message : String(err) };
          console.error("[google-calendar] takip toplantısı eklenemedi:", res.calendar.error);
        }
      }
      const detail = getNoteDetail(db2, noteId);
      deps.osNotifier.show({
        title: "Notun hazır",
        body: `${detail?.note.title ?? "Not"} • ${res.citations ?? 0} kaynak`,
        noteId
      });
    }
    return res;
  });
  electron.ipcMain.handle(IPC.chatThreads, () => listThreads(db2));
  electron.ipcMain.handle(
    IPC.chatEnsureThread,
    (_e, input) => ensureThread(db2, input.scopeKind, input.scopeId ?? null, input.title)
  );
  electron.ipcMain.handle(IPC.chatMessages, (_e, threadId) => getMessages(db2, threadId));
  electron.ipcMain.handle(
    IPC.chatSend,
    async (_e, threadId, question) => sendMessage(
      { db: db2, onProgress: (m) => console.log("[chat] " + m), log: (m) => console.log(m) },
      threadId,
      { question }
    )
  );
  electron.ipcMain.handle(IPC.chatDeleteThread, (_e, threadId) => {
    deleteThread(db2, threadId);
    return true;
  });
  electron.ipcMain.handle(IPC.recipesList, () => listRecipes(db2));
  electron.ipcMain.handle(
    IPC.recipesSave,
    (_e, input) => saveRecipe(db2, input)
  );
  electron.ipcMain.handle(IPC.recipesDelete, (_e, id) => deleteRecipe(db2, id));
  electron.ipcMain.handle(
    IPC.recipesRun,
    async (_e, recipeId, scope) => runRecipe(
      { db: db2, onProgress: (m) => console.log("[recipe] " + m), log: (m) => console.log(m) },
      recipeId,
      scope
    )
  );
  electron.ipcMain.handle(IPC.exportNotes, (_e, req) => exportNotes(db2, req));
  electron.ipcMain.handle(IPC.dialogPickDir, async () => {
    const w = getWindow();
    if (!w) return null;
    const res = await electron.dialog.showOpenDialog(w, {
      title: "Hedef klasor sec",
      properties: ["openDirectory", "createDirectory"]
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });
  electron.ipcMain.handle(IPC.jargonList, () => listJargon(db2));
  electron.ipcMain.handle(
    IPC.jargonSave,
    (_e, input) => saveJargon(db2, input)
  );
  electron.ipcMain.handle(IPC.jargonDelete, (_e, id) => deleteJargon(db2, id));
  electron.ipcMain.handle(IPC.securityStatus, () => securityStatus());
  electron.ipcMain.handle(IPC.securityEnable, async () => {
    const res = await enableEncryption({
      close: () => closeDatabase(),
      reopen: () => reopenDatabase()
    });
    return res;
  });
  electron.ipcMain.handle(IPC.securityDisable, async () => {
    const res = await disableEncryption({
      close: () => closeDatabase(),
      reopen: () => reopenDatabase()
    });
    return res;
  });
  electron.ipcMain.handle(IPC.securityBackup, () => {
    const path = backupDatabase("manual");
    pruneBackups(5);
    return { ok: Boolean(path), path };
  });
  electron.ipcMain.handle(
    IPC.retentionRun,
    (_e, dryRun) => runRetention({ db: db2, log: (m) => console.log(m) }, { dryRun: Boolean(dryRun) })
  );
  electron.ipcMain.handle(IPC.deleteAllData, () => {
    const res = deleteAllData(db2);
    return { ok: true, deletedNotes: res.deletedNotes, backupPath: res.backupPath };
  });
  electron.ipcMain.handle(IPC.notifyState, () => null);
}
async function simulateLive(deps, opts) {
  const { db: db2 } = deps;
  const log2 = opts.log ?? (() => {
  });
  const chunkSeconds = opts.chunkSeconds ?? 4;
  const channel = opts.channel ?? "mic";
  const language = opts.language ?? "auto";
  const wav = readWavPcm16(opts.filePath);
  const mono = downmixToMono(wav.pcm, wav.channels);
  const pcm = resampleLinear(mono, wav.sampleRate, 16e3);
  log2(`WAV okundu: ${(pcm.length / 16e3).toFixed(1)} sn, ${wav.sampleRate} Hz -> 16000 Hz, kanal=${channel}`);
  const title = `Canli kayit (simulasyon) ${(/* @__PURE__ */ new Date()).toLocaleTimeString("tr-TR")}`;
  const noteId = createNote(db2, { title, source: "manual", status: "recording" });
  resetLiveContext();
  opts.onEvent({ type: "started", noteId, title, external: true });
  const chunkSamples = Math.floor(16e3 * chunkSeconds);
  let offset = 0;
  let chunks = 0;
  let segments = 0;
  let seq = 0;
  while (offset < pcm.length) {
    const slice = pcm.subarray(offset, Math.min(offset + chunkSamples, pcm.length));
    offset += slice.length;
    seq += 1;
    const offsetMs = Math.round((offset - slice.length) / 16e3 * 1e3);
    const result = await transcribeLiveChunk(deps, {
      noteId,
      channel,
      seq,
      offsetMs,
      sampleRate: 16e3,
      language,
      pcm: new Uint8Array(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength))
    });
    if (!result.ok) {
      log2(`  parca ${seq} HATA: ${result.error}`);
      opts.onEvent({ type: "status", noteId, status: "failed", error: result.error });
      return { noteId, chunks, segments };
    }
    if (result.skipped) {
      log2(`  parca ${seq} atlandi (sessiz/bos)`);
      continue;
    }
    chunks += 1;
    segments += result.segments.length;
    opts.onEvent({ type: "segments", noteId, segments: result.segments });
    log2(
      `  parca ${seq} (+${offsetMs} ms) -> ${result.segments.length} satir: ` + result.segments.map((s) => JSON.stringify(s.text)).join(" | ")
    );
  }
  setNoteStatus(db2, noteId, "ready");
  opts.onEvent({ type: "status", noteId, status: "ready" });
  log2(`Simulasyon bitti: ${chunks} parca, ${segments} transkript satiri`);
  return { noteId, chunks, segments };
}
function unfoldIcs(raw) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("	")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}
function parsePropLine(line) {
  let inQuotes = false;
  let colonAt = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonAt = i;
      break;
    }
  }
  if (colonAt < 0) return null;
  const head = line.slice(0, colonAt);
  const value = line.slice(colonAt + 1);
  const parts = head.split(";");
  const name = parts[0].trim().toUpperCase();
  if (!name) return null;
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim().toUpperCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  return { name, params, value };
}
function unescapeText(value) {
  return value.replace(/\\(.)/g, (_m, c) => c === "n" || c === "N" ? "\n" : c);
}
function two(s) {
  return Number(s ?? "0");
}
function parseIcsDate(value, params) {
  const v = value.trim();
  if (!v) return null;
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y2 = Number(v.slice(0, 4));
    const m2 = Number(v.slice(4, 6));
    const d2 = Number(v.slice(6, 8));
    if (!y2 || !m2 || !d2) return null;
    return { date: new Date(y2, m2 - 1, d2, 0, 0, 0, 0), mode: "local", allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = two(m[4]);
  const mi = two(m[5]);
  const s = two(m[6]);
  if (m[7] === "Z") {
    return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), mode: "utc", allDay: false };
  }
  return { date: new Date(y, mo - 1, d, h, mi, s), mode: "local", allDay: false };
}
const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRRule(value) {
  const out = { freq: "DAILY", interval: 1, byDay: [], byMonthDay: [], wkst: 1 };
  let sawFreq = false;
  for (const chunk of value.split(";")) {
    const [rawK, rawV] = chunk.split("=");
    if (!rawK || rawV === void 0) continue;
    const k = rawK.trim().toUpperCase();
    const v = rawV.trim();
    if (k === "FREQ") {
      const f = v.toUpperCase();
      if (f === "DAILY" || f === "WEEKLY" || f === "MONTHLY" || f === "YEARLY") {
        out.freq = f;
        sawFreq = true;
      }
    } else if (k === "INTERVAL") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.interval = n;
    } else if (k === "COUNT") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.count = n;
    } else if (k === "UNTIL") {
      const parsed = parseIcsDate(v, {});
      if (parsed) out.until = parsed.date;
    } else if (k === "BYDAY") {
      out.byDay = v.split(",").map((d) => d.trim().toUpperCase().slice(-2)).map((d) => DAY_MAP[d]).filter((d) => typeof d === "number");
    } else if (k === "BYMONTHDAY") {
      out.byMonthDay = v.split(",").map((d) => Number(d.trim())).filter((d) => Number.isFinite(d));
    } else if (k === "WKST") {
      const d = DAY_MAP[v.toUpperCase().slice(-2)];
      if (typeof d === "number") out.wkst = d;
    }
  }
  return sawFreq ? out : null;
}
const get = (d, mode) => ({
  y: mode === "utc" ? d.getUTCFullYear() : d.getFullYear(),
  mo: mode === "utc" ? d.getUTCMonth() : d.getMonth(),
  da: mode === "utc" ? d.getUTCDate() : d.getDate(),
  h: mode === "utc" ? d.getUTCHours() : d.getHours(),
  mi: mode === "utc" ? d.getUTCMinutes() : d.getMinutes(),
  s: mode === "utc" ? d.getUTCSeconds() : d.getSeconds(),
  wd: mode === "utc" ? d.getUTCDay() : d.getDay()
});
function make(y, mo, da, h, mi, s, mode) {
  return mode === "utc" ? new Date(Date.UTC(y, mo, da, h, mi, s)) : new Date(y, mo, da, h, mi, s);
}
function addDays(d, n, mode) {
  const p = get(d, mode);
  return make(p.y, p.mo, p.da + n, p.h, p.mi, p.s, mode);
}
function addMonths(d, n, mode) {
  const p = get(d, mode);
  return make(p.y, p.mo + n, p.da, p.h, p.mi, p.s, mode);
}
function expandRecurrence(dtstart, rule, mode, from, to, exdates, maxIterations = 5e3) {
  const out = [];
  const startMs = dtstart.getTime();
  const toMs = to.getTime();
  const fromMs = from.getTime();
  let emitted = 0;
  const push = (candidate) => {
    const t = candidate.getTime();
    if (t < startMs) return true;
    if (rule.until && t > rule.until.getTime()) return false;
    emitted++;
    if (rule.count !== void 0 && emitted > rule.count) return false;
    if (t >= fromMs && t <= toMs && !exdates.has(t)) out.push(candidate);
    return t <= toMs;
  };
  const p0 = get(dtstart, mode);
  if (rule.freq === "DAILY") {
    let cursor2 = dtstart;
    for (let i = 0; i < maxIterations; i++) {
      const wd = get(cursor2, mode).wd;
      const dayOk = rule.byDay.length === 0 || rule.byDay.includes(wd);
      if (dayOk) {
        if (!push(cursor2)) break;
      }
      cursor2 = addDays(cursor2, rule.interval, mode);
      if (cursor2.getTime() > toMs) break;
    }
    return out;
  }
  if (rule.freq === "WEEKLY") {
    const days = rule.byDay.length > 0 ? [...rule.byDay].sort((a, b) => a - b) : [p0.wd];
    const shift = (p0.wd - rule.wkst + 7) % 7;
    let weekStart = addDays(dtstart, -shift, mode);
    for (let w = 0; w < maxIterations; w++) {
      for (const wd of days) {
        const offset = (wd - rule.wkst + 7) % 7;
        const candidate = addDays(weekStart, offset, mode);
        if (!push(candidate)) return out;
      }
      const nextWeek = addDays(weekStart, 7 * rule.interval, mode);
      if (nextWeek.getTime() > toMs) break;
      weekStart = nextWeek;
    }
    return out;
  }
  if (rule.freq === "MONTHLY") {
    const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [p0.da];
    let cursor2 = make(p0.y, p0.mo, 1, p0.h, p0.mi, p0.s, mode);
    for (let i = 0; i < maxIterations; i++) {
      for (const da of days) {
        const candidate = make(
          get(cursor2, mode).y,
          get(cursor2, mode).mo,
          da,
          p0.h,
          p0.mi,
          p0.s,
          mode
        );
        if (get(candidate, mode).mo !== get(cursor2, mode).mo) continue;
        if (!push(candidate)) return out;
      }
      cursor2 = addMonths(cursor2, rule.interval, mode);
      if (cursor2.getTime() > toMs) break;
    }
    return out;
  }
  let cursor = dtstart;
  for (let i = 0; i < maxIterations; i++) {
    if (!push(cursor)) break;
    cursor = make(get(cursor, mode).y + rule.interval, p0.mo, p0.da, p0.h, p0.mi, p0.s, mode);
    if (cursor.getTime() > toMs) break;
  }
  return out;
}
function attendeesFrom(params, value) {
  const cn = params.CN;
  if (cn) return cn;
  return value.replace(/^mailto:/i, "");
}
function parseIcsWindow(raw, from, to) {
  const lines = unfoldIcs(raw);
  const events = [];
  let inEvent = false;
  let cur = {};
  let inValarm = false;
  const flush = () => {
    const get1 = (n) => cur[n]?.[0];
    const dtstartLine = get1("DTSTART");
    if (!dtstartLine) return;
    const dtstart = parseIcsDate(dtstartLine.value, dtstartLine.params);
    if (!dtstart) return;
    const dtendLine = get1("DTEND");
    const dtend = dtendLine ? parseIcsDate(dtendLine.value, dtendLine.params) : null;
    const durationMin = (() => {
      if (dtend) return Math.max(1, Math.round((dtend.date.getTime() - dtstart.date.getTime()) / 6e4));
      return dtstart.allDay ? 1440 : 30;
    })();
    const endAt = (start) => new Date(start.getTime() + durationMin * 6e4);
    const exdates = /* @__PURE__ */ new Set();
    for (const ex of cur["EXDATE"] ?? []) {
      for (const part of ex.value.split(",")) {
        const parsed = parseIcsDate(part.trim(), ex.params);
        if (parsed) exdates.add(parsed.date.getTime());
      }
    }
    const uid = get1("UID")?.value ?? `ics-${dtstart.date.getTime()}`;
    const summaryLine = get1("SUMMARY");
    const title = summaryLine ? unescapeText(summaryLine.value) : "(Başlıksız etkinlik)";
    const status = get1("STATUS")?.value?.toUpperCase();
    if (status === "CANCELLED") return;
    const effectiveFrom = new Date(from.getTime() - durationMin * 6e4 - 12 * 3600 * 1e3);
    const rruleLine = get1("RRULE");
    const rule = rruleLine ? parseRRule(rruleLine.value) : null;
    const occurrences = rule ? expandRecurrence(dtstart.date, rule, dtstart.mode, effectiveFrom, to, exdates) : [dtstart.date];
    for (const occ of occurrences) {
      const end = endAt(occ);
      if (end < from || occ > to) continue;
      events.push({
        uid: rule ? `${uid}@${occ.toISOString()}` : uid,
        title,
        startAt: occ,
        endAt: end,
        location: (() => {
          const l = get1("LOCATION");
          return l ? unescapeText(l.value) : null;
        })(),
        description: (() => {
          const d = get1("DESCRIPTION");
          return d ? unescapeText(d.value) : null;
        })(),
        organizer: (() => {
          const o = get1("ORGANIZER");
          return o ? attendeesFrom(o.params, o.value) : null;
        })(),
        attendees: (cur["ATTENDEE"] ?? []).map((a) => attendeesFrom(a.params, a.value)),
        allDay: dtstart.allDay
      });
    }
  };
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      if (inEvent) flush();
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;
    if (upper === "BEGIN:VALARM") {
      inValarm = true;
      continue;
    }
    if (upper === "END:VALARM") {
      inValarm = false;
      continue;
    }
    if (inValarm) continue;
    const prop = parsePropLine(line);
    if (!prop) continue;
    (cur[prop.name] ??= []).push(prop);
  }
  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
const PAST_DAYS = 1;
const FUTURE_DAYS = 30;
const PRUNE_OLDER_THAN_DAYS = 3;
const LATE_GRACE_MS = 2 * 60 * 1e3;
function normalizeSource(source) {
  const s = (source ?? "").trim();
  if (s.toLowerCase().startsWith("webcal://")) {
    return "https://" + s.slice("webcal://".length);
  }
  return s;
}
function isRemoteSource(source) {
  return /^https?:\/\//i.test(normalizeSource(source));
}
async function fetchIcsText(source) {
  const s = normalizeSource(source);
  if (!s) throw new Error("Takvim kaynagi tanimli degil (Ayarlar > Takvim)");
  if (isRemoteSource(s)) {
    const res = await fetch(s, {
      headers: { "User-Agent": "Notlar/0.1 (kisisel takvim, salt okunur)" },
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`Takvim indirilemedi: HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  }
  if (!node_fs.statSync(s, { throwIfNoEntry: false })) {
    throw new Error("Takvim dosyasi bulunamadi: " + s);
  }
  return node_fs.readFileSync(s, "utf-8");
}
async function syncCalendar(db2, source) {
  const src = normalizeSource(source);
  if (!src) return { ok: false, source: "", fetched: 0, stored: 0, upcoming: 0, error: "Kaynak bos" };
  try {
    const text = await fetchIcsText(src);
    const now = /* @__PURE__ */ new Date();
    const from = new Date(now.getTime() - PAST_DAYS * 864e5);
    const to = new Date(now.getTime() + FUTURE_DAYS * 864e5);
    const parsed = parseIcsWindow(text, from, to);
    const stored = upsertCalendarEvents(
      db2,
      parsed.map((e) => ({
        id: e.uid,
        calendarId: null,
        title: e.title,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
        location: e.location,
        description: e.description,
        participants: e.attendees,
        organizer: e.organizer,
        allDay: e.allDay
      }))
    );
    pruneCalendarEvents(
      db2,
      new Date(now.getTime() - PRUNE_OLDER_THAN_DAYS * 864e5).toISOString()
    );
    const upcoming = listUpcomingCalendarEvents(db2, now.toISOString(), 100).length;
    return { ok: true, source: src, fetched: parsed.length, stored, upcoming };
  } catch (err) {
    return {
      ok: false,
      source: src,
      fetched: 0,
      stored: 0,
      upcoming: countCalendarEvents(db2),
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
const GOOGLE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
function secureGoogleValue(db2, key) {
  const value = getSettingRaw(db2, key);
  if (!value) return "";
  return electron.safeStorage.decryptString(Buffer.from(value, "base64"));
}
function saveSecureGoogleValue(db2, key, value) {
  if (!electron.safeStorage.isEncryptionAvailable()) throw new Error("Windows güvenli saklama kullanılamıyor");
  setSetting(db2, key, electron.safeStorage.encryptString(value).toString("base64"));
}
function googleStatus(db2) {
  return {
    configured: Boolean(getSettingRaw(db2, "google_client_id")),
    connected: Boolean(getSettingRaw(db2, "google_refresh_token"))
  };
}
function importGoogleCredentials(db2, filePath) {
  const parsed = JSON.parse(node_fs.readFileSync(filePath, "utf8"));
  const client = parsed.installed;
  if (!client?.client_id || !client?.client_secret) throw new Error("Google Cloud Desktop app OAuth JSON dosyası gerekli");
  setSetting(db2, "google_client_id", client.client_id);
  saveSecureGoogleValue(db2, "google_client_secret", client.client_secret);
  setSetting(db2, "google_refresh_token", "");
  return googleStatus(db2);
}
async function googleTokenRequest(body) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || `Google OAuth HTTP ${response.status}`);
  return payload;
}
async function connectGoogleCalendar(db2) {
  const clientId = getSettingRaw(db2, "google_client_id");
  const clientSecret = secureGoogleValue(db2, "google_client_secret");
  if (!clientId || !clientSecret) throw new Error("Önce Desktop app OAuth JSON dosyasını seçin");
  const state = node_crypto.randomBytes(24).toString("base64url");
  const verifier = node_crypto.randomBytes(48).toString("base64url");
  const challenge = node_crypto.createHash("sha256").update(verifier).digest("base64url");
  let redirectUri = "";
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = node_http.createServer((request, response) => {
    try {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) throw new Error("OAuth doğrulama durumu uyuşmadı");
      if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error"));
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Google yetkilendirme kodu gelmedi");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<html><body><h2>Notlar Google Takvim'e bağlandı.</h2><p>Bu sekmeyi kapatabilirsiniz.</p></body></html>");
      resolveCode(code);
    } catch (err) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bağlantı tamamlanamadı.");
      rejectCode(err);
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_EVENTS_SCOPE, access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state })) auth.searchParams.set(k, v);
    await electron.shell.openExternal(auth.toString());
    const code = await Promise.race([codePromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Google bağlantısı zaman aşımına uğradı")), 120000))]);
    const token = await googleTokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier });
    if (!token.refresh_token) throw new Error("Google kalıcı yenileme anahtarı vermedi; tekrar bağlanın");
    saveSecureGoogleValue(db2, "google_refresh_token", token.refresh_token);
    return googleStatus(db2);
  } finally {
    server.close();
  }
}
async function googleAccessToken(db2) {
  const refreshToken = secureGoogleValue(db2, "google_refresh_token");
  if (!refreshToken) throw new Error("Google Takvim bağlı değil");
  const token = await googleTokenRequest({ client_id: getSettingRaw(db2, "google_client_id"), client_secret: secureGoogleValue(db2, "google_client_secret"), refresh_token: refreshToken, grant_type: "refresh_token" });
  return token.access_token;
}
async function createGoogleEvent(db2, noteId, event) {
  const accessToken = await googleAccessToken(db2);
  const id = node_crypto.createHash("sha256").update(`notlar:${noteId}:${event.date}:${event.time ?? "all-day"}`).digest("hex").slice(0, 32);
  const start = event.time ? { dateTime: `${event.date}T${event.time}:00+03:00`, timeZone: "Europe/Istanbul" } : { date: event.date };
  const endDate = new Date(`${event.date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = event.time ? { dateTime: new Date(new Date(start.dateTime).getTime() + 30 * 60000).toISOString(), timeZone: "Europe/Istanbul" } : { date: endDate.toISOString().slice(0, 10) };
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, summary: event.title, description: `Notlar toplantı notundan otomatik eklendi.\nAlıntı: ${event.quote}\nNot ID: ${noteId}${event.time ? "" : "\nSaat konuşmada belirtilmedi; tüm gün olarak eklendi."}`, start, end, extendedProperties: { private: { notlarNoteId: noteId } } })
  });
  if (response.status === 409) return { alreadyExists: true };
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Google Calendar HTTP ${response.status}`);
  return { alreadyExists: false, url: payload.htmlLink };
}
async function processFollowupMeetings(db2, noteId) {
  if (!googleStatus(db2).connected) return { created: 0, skipped: "Google Takvim bağlı değil" };
  const detail = getNoteDetail(db2, noteId);
  if (!detail || detail.transcripts.length === 0) return { created: 0 };
  const transcript = detail.transcripts.map((t) => t.text).join(" ");
  if (!/(haftaya|yarın|öbür gün|gelecek|sonraki|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|\d{1,2}[.\/-]\d{1,2}).{0,100}(toplantı|görüş|buluş|konuş|meet)|(toplantı|görüş|buluş|konuş|meet).{0,100}(haftaya|yarın|gelecek|pazartesi|salı|çarşamba|perşembe|cuma|\d{1,2}[.\/-]\d{1,2})/i.test(transcript)) return { created: 0 };
  const settings = getAllSettings(db2);
  const provider = resolveLlmProvider(settings.llm_provider);
  if (provider.id === "local") return { created: 0, skipped: "Yapay zeka sağlayıcısı gerekli" };
  const anchor = detail.note.started_at;
  const result = await provider.complete({
    system: "Sen toplantı transkriptinden kesin olarak kararlaştırılan sonraki toplantıları çıkarırsın. Yalnızca JSON döndür: {\"events\":[{\"title\":\"...\",\"date\":\"YYYY-MM-DD\",\"time\":\"HH:mm veya null\",\"quote\":\"transkriptten birebir kısa alıntı\"}]}. Öneri, ihtimal, geçmiş tarih ve belirsiz tarihleri alma. Göreli tarihleri verilen toplantı tarihine göre Europe/Istanbul saat diliminde çöz. Saat söylenmediyse null yap, saat uydurma. En fazla 3 etkinlik.",
    user: `Toplantı tarihi: ${anchor}\nBugün: ${new Date().toISOString()}\nTranskript:\n${transcript.slice(0, 24000)}`,
    maxTokens: 1200,
    temperature: 0
  }, llmOptionsFor(db2, provider));
  const parsed = extractJsonObject(result.text);
  let created = 0;
  const results = [];
  for (const candidate of Array.isArray(parsed.events) ? parsed.events.slice(0, 3) : []) {
    const title = String(candidate.title ?? "").trim();
    const date = String(candidate.date ?? "");
    const time = candidate.time == null ? null : String(candidate.time);
    const quote = String(candidate.quote ?? "").trim();
    if (title.length < 3 || title.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const validDate = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(validDate.getTime()) || validDate.toISOString().slice(0, 10) !== date) continue;
    const when = new Date(`${date}T${time ?? "12:00"}:00+03:00`).getTime();
    if (!Number.isFinite(when) || when <= Date.now() || when > Date.now() + 365 * 864e5) continue;
    if (quote.length < 12 || !normalizedSpeech(transcript).includes(normalizedSpeech(quote))) continue;
    const event = await createGoogleEvent(db2, noteId, { title, date, time, quote });
    if (!event.alreadyExists) created++;
    results.push(event);
  }
  return { created, results };
}
class CalendarScheduler {
  constructor(deps) {
    this.deps = deps;
  }
  timer = null;
  lastSyncAt = 0;
  busy = false;
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 2e4);
    setTimeout(() => void this.tick(), 3e3);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  log(msg) {
    this.deps.log?.(msg);
  }
  /** Elle "simdi senkronize et" */
  async syncNow() {
    const settings = getAllSettings(this.deps.db);
    const res = await syncCalendar(this.deps.db, settings.calendar_source);
    this.lastSyncAt = Date.now();
    return res;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { db: db2 } = this.deps;
      const settings = getAllSettings(db2);
      const intervalMs = Math.max(1, settings.calendar_sync_minutes) * 6e4;
      if (settings.calendar_source && Date.now() - this.lastSyncAt > intervalMs) {
        this.lastSyncAt = Date.now();
        const res = await syncCalendar(db2, settings.calendar_source);
        if (res.ok) {
          this.log(`[calendar] senkron: ${res.fetched} etkinlik, ${res.upcoming} yaklasan`);
          this.deps.onSynced?.(res);
        } else if (res.error) {
          this.log(`[calendar] senkron hatasi: ${res.error}`);
        }
      }
      if (settings.auto_start_calendar === "off") return;
      const now = /* @__PURE__ */ new Date();
      const from = new Date(now.getTime() - LATE_GRACE_MS);
      const due = findDueCalendarEvents(db2, from.toISOString(), now.toISOString());
      for (const ev of due) {
        if (ev.all_day) {
          markCalendarEventTriggered(db2, ev.id);
          continue;
        }
        if (settings.auto_start_calendar === "participants" && ev.participants.length === 0) {
          markCalendarEventTriggered(db2, ev.id);
          this.log(`[calendar] atlandi (katilimci yok): ${ev.title}`);
          continue;
        }
        if (this.deps.isRecordingActive()) {
          this.log(`[calendar] kayit suruyor, atlandi: ${ev.title}`);
          continue;
        }
        markCalendarEventTriggered(db2, ev.id);
        this.deps.onTrigger({
          kind: "calendar",
          reason: `calendar:${ev.id}`,
          title: ev.title,
          calendarEventId: ev.id,
          participants: ev.participants,
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        this.log(`[calendar] TETIKLENDI: ${ev.title}`);
        break;
      }
    } catch (err) {
      this.log("[calendar] tick hatasi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.busy = false;
    }
  }
}
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
`;
function filetimeToIso(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let ticks;
  try {
    ticks = trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed);
  } catch {
    return null;
  }
  if (ticks <= 0n) return null;
  const ms = Number(ticks / 10000n) - 116444736e5;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}
function toArray(v) {
  if (v === void 0 || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function normalizeMic(entries) {
  return entries.filter((e) => Boolean(e?.name)).map((e) => {
    const startNum = e.start?.startsWith("0x") ? Number(BigInt(e.start)) : Number(e.start ?? 0);
    const stopNum = e.stop?.startsWith("0x") ? Number(BigInt(e.stop)) : Number(e.stop ?? 0);
    const exePath = (e.name ?? "").replace(/\//g, "\\");
    const parts = exePath.split("\\");
    return {
      exePath,
      exe: parts[parts.length - 1] ?? exePath,
      // Store uygulamalarinda (Packaged) bitis degeri 0 kalabilir; yol da
      // gercek exe olmadigi icin aktiflik kontrolunu yalnizca start>0 ile yapariz.
      active: stopNum === 0 && startNum > 0 && e.kid === "NonPackaged",
      startAt: filetimeToIso(e.start),
      stopAt: stopNum === 0 ? null : filetimeToIso(e.stop)
    };
  }).sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? ""));
}
function takeSnapshot() {
  return new Promise((resolve) => {
    const child = node_child_process.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SCRIPT],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 15e3 },
      (err, stdout) => {
        const empty = { micUsers: [], processes: [], takenAt: (/* @__PURE__ */ new Date()).toISOString() };
        if (err && !stdout) {
          console.warn("[detect] tarama basarisiz:", err.message);
          resolve(empty);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const processes = toArray(parsed.procs).map((p) => ({
            name: String(p?.name ?? ""),
            pid: Number(p?.pid ?? 0),
            title: String(p?.title ?? "")
          }));
          resolve({
            micUsers: normalizeMic(toArray(parsed.mic)),
            processes,
            takenAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        } catch (parseErr) {
          console.warn("[detect] tarama JSON hatasi:", parseErr);
          resolve(empty);
        }
      }
    );
    child.on(
      "error",
      () => resolve({ micUsers: [], processes: [], takenAt: (/* @__PURE__ */ new Date()).toISOString() })
    );
  });
}
const APP_ALIASES = [
  { label: "Microsoft Teams", aliases: ["ms-teams.exe", "teams.exe", "ms-teamsupdate.exe", "teams"] },
  { label: "Zoom", aliases: ["zoom.exe", "zoomhybridconf.exe", "zoom"] },
  { label: "Google Meet", aliases: ["meet", "googlemeet"] },
  { label: "Discord", aliases: ["discord.exe", "discord"] },
  { label: "Skype", aliases: ["skype.exe", "skypeapp.exe", "skype"] },
  { label: "Slack", aliases: ["slack.exe", "slack"] },
  { label: "WhatsApp", aliases: ["whatsapp.exe", "whatsapp.root.exe", "whatsapp"] },
  { label: "Telegram", aliases: ["telegram.exe", "telegram"] },
  { label: "Webex", aliases: ["webex.exe", "webexmta.exe", "ciscowebexstart.exe", "webex"] },
  { label: "Jitsi", aliases: ["jitsi.exe"] },
  { label: "GoTo Meeting", aliases: ["gotomeeting.exe", "g2mstart.exe"] },
  { label: "BlueJeans", aliases: ["bluejeans.exe"] },
  { label: "FaceTime", aliases: ["facetime.exe"] }
];
function normalizeLabel(input) {
  return (input ?? "").toLocaleLowerCase("en").replace(/\.exe$/i, "").replace(/[\s._-]/g, "").trim();
}
function basename(path) {
  return (path ?? "").split(/[\\/]/).pop() ?? "";
}
const ALIAS_TO_CANON = /* @__PURE__ */ new Map();
for (const entry of APP_ALIASES) {
  const canon = normalizeLabel(entry.label);
  ALIAS_TO_CANON.set(canon, canon);
  for (const alias of entry.aliases) ALIAS_TO_CANON.set(normalizeLabel(alias), canon);
}
function canonicalApp(name) {
  return ALIAS_TO_CANON.get(normalizeLabel(basename(name))) ?? null;
}
function exeMatchesLabel(exeOrPath, label) {
  const exeNorm = normalizeLabel(basename(exeOrPath));
  const labNorm = normalizeLabel(label);
  if (!exeNorm || !labNorm) return false;
  if (exeNorm === labNorm) return true;
  const canonExe = canonicalApp(exeNorm);
  const canonLab = canonicalApp(labNorm);
  if (canonExe && canonLab) return canonExe === canonLab;
  return exeNorm.includes(labNorm) || labNorm.includes(exeNorm);
}
function appDedupeKey(name) {
  if (!name) return "";
  const norm = normalizeLabel(basename(name));
  return canonicalApp(norm) ?? norm;
}
function titleLooksLikeMeeting(title) {
  const t = (title ?? "").toLocaleLowerCase("en");
  return KNOWN_MEETING_TITLE_MARKERS.some((m) => t.includes(m));
}
function isSelfExe(exe) {
  const e = (exe ?? "").toLocaleLowerCase("en");
  return e === "electron.exe" || e === "notlar.exe" || e.endsWith("\\notlar.exe");
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function meetingCandidates(processes) {
  return processes.filter((p) => !isSelfExe(`${p.name}.exe`) && Boolean(p.name));
}
function evaluateSnapshot(input) {
  const { micUsers, processes, allowedApps, callEnabled, appEnabled } = input;
  const activeMic = micUsers.filter((m) => m.active && !isSelfExe(m.exe));
  const activeMicLabels = activeMic.map((m) => m.exePath);
  const processNames = processes.map((p) => p.name);
  const allowedMic = activeMic.find((m) => allowedApps.some((a) => exeMatchesLabel(m.exe, a)));
  const allowedMicUser = allowedMic ? allowedMic.exePath : null;
  const allowedProc = meetingCandidates(processes).find(
    (p) => allowedApps.some((a) => exeMatchesLabel(`${p.name}.exe`, a)) || titleLooksLikeMeeting(p.title)
  ) ?? null;
  const allowedApp = allowedProc ? `${allowedProc.name}.exe` : null;
  const result = {
    event: null,
    activeMicLabels,
    allowedMicUser,
    allowedApp,
    processNames
  };
  if (input.recordingActive) return result;
  const prevMic = new Set(input.prevActiveMicPaths.map((p) => p.toLocaleLowerCase("en")));
  const prevProcs = new Set(input.prevProcessNames.map((p) => p.toLocaleLowerCase("en")));
  const quiet = input.quietKeys;
  if (callEnabled && allowedMic) {
    const key = appDedupeKey(allowedMic.exe);
    const isNew = !prevMic.has(allowedMic.exePath.toLocaleLowerCase("en"));
    if (isNew && !quiet.has(key)) {
      result.event = {
        kind: "call",
        reason: `call:${allowedMic.exe}`,
        title: labelForExe(allowedMic.exe, allowedApps),
        app: allowedMic.exe,
        detectedAt: nowIso()
      };
      return result;
    }
  }
  if (appEnabled && allowedProc) {
    const key = appDedupeKey(`${allowedProc.name}.exe`);
    const isNewProc = !prevProcs.has(allowedProc.name.toLocaleLowerCase("en"));
    if (isNewProc && !quiet.has(key)) {
      result.event = {
        kind: "app",
        reason: `app:${allowedProc.name}.exe`,
        title: labelForExe(`${allowedProc.name}.exe`, allowedApps),
        app: `${allowedProc.name}.exe`,
        detectedAt: nowIso()
      };
      return result;
    }
  }
  return result;
}
function labelForExe(exe, allowedApps) {
  const match = allowedApps.find((a) => exeMatchesLabel(exe, a));
  if (match) return match;
  const base = basename(exe);
  return base.replace(/\.exe$/i, "");
}
function checkTriggerAlive(triggerApp, kind, snapshot) {
  const base = {
    processCount: snapshot.processes.length,
    activeMicCount: snapshot.micUsers.filter((m) => m.active).length
  };
  if (!triggerApp) return { alive: true, reason: "no-trigger-app", ...base };
  const inProcesses = snapshot.processes.some(
    (p) => exeMatchesLabel(`${p.name}.exe`, triggerApp) || exeMatchesLabel(triggerApp, `${p.name}.exe`)
  );
  if (!inProcesses) return { alive: false, reason: "process-missing", ...base };
  if (kind === "call") {
    const micActive = snapshot.micUsers.some((m) => m.active && exeMatchesLabel(m.exe, triggerApp));
    if (!micActive) return { alive: false, reason: "mic-inactive", ...base };
  }
  return { alive: true, reason: "ok", ...base };
}
const POLL_MS = 4e3;
class TriggerDetector {
  constructor(deps) {
    this.deps = deps;
  }
  timer = null;
  lastSnapshot = null;
  prevActiveMicPaths = [];
  prevProcessNames = [];
  quietUntil = /* @__PURE__ */ new Map();
  busy = false;
  lastResult = null;
  get snapshot() {
    return this.lastSnapshot;
  }
  get result() {
    return this.lastResult;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    setTimeout(() => void this.tick(), 1500);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  /** Bir tetikleyicinin tekrar ateslemesini engelle (soguma suresi). */
  quiet(reason, ms) {
    this.quietUntil.set(reason, Date.now() + ms);
  }
  /** Tekilleştirme anahtari: 'call:Zoom.exe' veya 'app:zoom.exe' */
  static keyForApp(exe, kind) {
    return `${kind}:${exe}`;
  }
  isQuiet(key) {
    const until = this.quietUntil.get(key);
    if (until === void 0) return false;
    if (until < Date.now()) {
      this.quietUntil.delete(key);
      return false;
    }
    return true;
  }
  /** Disaridan (or. kayit bitince) sogumaya alma. */
  quietKey(key, ms) {
    this.quietUntil.set(key, Date.now() + ms);
  }
  /** Tek tarama yapip degerlendirir (teshis ekrani da kullanir). */
  async probe() {
    const { db: db2 } = this.deps;
    const settings = getAllSettings(db2);
    const snapshot = await takeSnapshot();
    this.lastSnapshot = snapshot;
    const result = evaluateSnapshot({
      micUsers: snapshot.micUsers,
      processes: snapshot.processes,
      allowedApps: settings.allowed_apps ?? [],
      prevActiveMicPaths: this.prevActiveMicPaths,
      prevProcessNames: this.prevProcessNames,
      recordingActive: this.deps.isRecordingActive(),
      quietKeys: new Set(
        [...this.quietUntil.entries()].filter(([, until]) => until > Date.now()).map(([k]) => k)
      ),
      callEnabled: Boolean(settings.auto_start_call),
      appEnabled: Boolean(settings.auto_start_apps)
    });
    this.lastResult = result;
    return result;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { db: db2 } = this.deps;
      const settings = getAllSettings(db2);
      if (!settings.auto_start_call && !settings.auto_start_apps) {
        this.lastSnapshot = null;
        this.lastResult = null;
        return;
      }
      const result = await this.probe();
      const eventKey = appDedupeKey(result.event?.app ?? null);
      if (result.event && !(eventKey ? this.isQuiet(eventKey) : false)) {
        const cooldown = Math.max(10, settings.trigger_cooldown_seconds) * 1e3;
        if (eventKey) this.quiet(eventKey, cooldown);
        this.deps.log?.(`[detect] TETIKLENDI: ${result.event.reason} (${result.event.title})`);
        this.deps.onTrigger(result.event);
      }
      this.prevActiveMicPaths = result.activeMicLabels;
      this.prevProcessNames = result.processNames;
    } catch (err) {
      this.deps.log?.("[detect] hata: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.busy = false;
    }
  }
}
const WIDTH = 384;
const HEIGHT = 140;
const MARGIN = 20;
class RecordingNotifier {
  win = null;
  state = null;
  constructor() {
  }
  createWindow() {
    const win = new electron.BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      title: "Kayit",
      webPreferences: {
        preload: node_path.join(__dirname, "../preload/notify.js"),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl) {
      void win.loadURL(`${devUrl}/notify.html`);
    } else {
      void win.loadFile(node_path.join(__dirname, "../renderer/notify.html"));
    }
    win.on("closed", () => {
      this.win = null;
    });
    return win;
  }
  position(win) {
    try {
      const display = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint());
      const area = display.workArea;
      win.setPosition(
        Math.round(area.x + area.width - WIDTH - MARGIN),
        Math.round(area.y + area.height - HEIGHT - MARGIN)
      );
    } catch {
    }
  }
  push() {
    if (this.win && !this.win.isDestroyed() && this.state) {
      this.win.webContents.send(IPC.notifyState, this.state);
    }
  }
  show(payload) {
    this.state = payload;
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.createWindow();
      this.win.webContents.once("did-finish-load", () => {
        this.push();
        if (this.win && !this.win.isDestroyed()) {
          this.position(this.win);
          this.win.showInactive();
        }
      });
    } else {
      this.position(this.win);
      this.win.showInactive();
      this.push();
    }
  }
  update(patch) {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.push();
  }
  hide() {
    if (this.state && this.win && !this.win.isDestroyed()) {
      this.state = { ...this.state, visible: false };
      this.push();
    }
    this.state = null;
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide();
    }
  }
  destroy() {
    this.state = null;
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }
  get visible() {
    return Boolean(this.state?.visible);
  }
  get noteId() {
    return this.state?.noteId ?? null;
  }
}
const RENDERER_START_TIMEOUT_MS = 2e4;
const TICK_MS = 2e3;
function describeTrigger(t) {
  const label = t.app ? t.app.replace(/\.exe$/i, "") : "";
  if (t.kind === "call") return `${label} görüşme başlattı`;
  if (t.kind === "app") return `${label} açıldı`;
  return "Takvim etkinliği başladı";
}
class AutoRecordManager {
  constructor(deps) {
    this.deps = deps;
  }
  pending = null;
  state = null;
  timer = null;
  lastTrigger = null;
  log(msg) {
    this.deps.log?.(msg);
  }
  get isBusy() {
    return Boolean(this.state || this.pending);
  }
  /** Teshis: gozcunun ic durumu (Ayarlar > Tanilama). */
  debugState() {
    const st = this.state;
    const now = Date.now();
    return {
      pending: this.pending ? { noteId: this.pending.noteId, ageMs: now - this.pending.createdAt } : null,
      active: st ? {
        noteId: st.noteId,
        auto: st.auto,
        paused: st.paused,
        kind: st.kind,
        triggerApp: st.triggerApp,
        elapsedMs: now - st.startedAt,
        idleMs: now - st.lastActivityAt,
        transcriptCount: st.transcriptCount
      } : null,
      timerRunning: this.timer !== null
    };
  }
  get activeNoteId() {
    return this.state?.noteId ?? this.pending?.noteId ?? null;
  }
  // -----------------------------------------------------------------------
  //  1) Tetikleme -> not olustur, bildir, renderer'i baslat
  // -----------------------------------------------------------------------
  async handleTrigger(t) {
    if (this.isBusy) {
      this.log(`[auto] zaten meşgul, tetikleme yok sayildi: ${t.reason}`);
      return;
    }
    const { db: db2 } = this.deps;
    const settings = getAllSettings(db2);
    const source = t.kind === "calendar" ? "calendar" : "call";
    const noteId = createNote(db2, { title: t.title, source, status: "recording" });
    setNoteTriggerReason(db2, noteId, t.reason);
    if (t.kind === "calendar" && t.calendarEventId) {
      linkNoteToCalendarEvent(db2, noteId, t.calendarEventId, t.title);
    }
    this.lastTrigger = t;
    this.pending = { noteId, title: t.title, createdAt: Date.now() };
    this.ensureTimer();
    this.deps.notifier.show({
      visible: true,
      noteId,
      title: "Kayıt başladı",
      subtitle: `${describeTrigger(t)} • ${t.title}`,
      status: "recording",
      startedAt: Date.now(),
      tone: "record"
    });
    const command = {
      noteId,
      title: t.title,
      reason: t.reason,
      triggerApp: t.app,
      language: settings.language,
      micEnabled: true,
      systemEnabled: Boolean(settings.record_system_audio)
    };
    this.sendToRenderer(IPC.triggerAutoStart, command);
    this.log(`[auto] tetiklendi -> not ${noteId} (${describeTrigger(t)})`);
  }
  // -----------------------------------------------------------------------
  //  2) Renderer kaydi gercekten baslatti
  // -----------------------------------------------------------------------
  onRendererStarted(req) {
    const pending = this.pending;
    this.pending = null;
    const kind = pending && this.lastTrigger ? this.lastTrigger.kind : "app";
    this.state = {
      noteId: req.noteId,
      title: pending?.title ?? "Kayıt",
      reason: req.reason ?? "",
      kind,
      triggerApp: req.triggerApp ?? null,
      // Soguma anahtari UYGULAMA bazli: arama kaydi bittikten sonra ayni uygulama
      // icin uygulama tetiklemesi ateslenmesin (bkz. test-rules.mts).
      triggerKey: appDedupeKey(req.triggerApp ?? req.reason ?? null) || null,
      auto: Boolean(req.auto),
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      transcriptCount: 0,
      paused: false
    };
    this.deps.notifier.update({ status: "recording", noteId: req.noteId });
    this.log(`[auto] renderer kaydi baslatti: ${req.noteId} (auto=${req.auto})`);
  }
  /** Renderer'in duraklat/devam durumu bildirimi */
  setPaused(paused) {
    if (!this.state) return;
    this.state.paused = paused;
    this.state.lastActivityAt = Date.now();
    this.deps.notifier.update({ status: paused ? "paused" : "recording" });
  }
  // -----------------------------------------------------------------------
  //  3) Transkript uretildi -> sessizlik sayaci sifirlanir
  // -----------------------------------------------------------------------
  onSegments(noteId, count) {
    if (!this.state || this.state.noteId !== noteId) return;
    if (count > 0) {
      this.state.transcriptCount += count;
      this.state.lastActivityAt = Date.now();
    }
  }
  // -----------------------------------------------------------------------
  //  4) Kayit bitti / iptal edildi
  // -----------------------------------------------------------------------
  onRendererStopped(noteId) {
    const key = this.state?.triggerKey ?? null;
    if (key) {
      const settings = getAllSettings(this.deps.db);
      this.deps.detector.quietKey(key, Math.max(10, settings.trigger_cooldown_seconds) * 1e3);
    }
    if (this.pending && (!noteId || this.pending.noteId === noteId)) {
      this.pending = null;
    }
    if (this.state && (!noteId || this.state.noteId === noteId)) {
      this.state = null;
    }
    this.deps.notifier.hide();
    this.stopTimerIfIdle();
    this.log("[auto] kayit durumu temizlendi");
  }
  // -----------------------------------------------------------------------
  //  5) Bildirim penceresi eylemleri
  // -----------------------------------------------------------------------
  handleAction(action) {
    const noteId = this.deps.notifier.noteId;
    this.log(`[auto] bildirim eylemi: ${action}`);
    if (action === "open") {
      const win = this.deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (noteId) win.webContents.send(IPC.noteFocus, noteId);
      }
      this.deps.notifier.hide();
      return;
    }
    if (action === "pause") {
      this.sendToRenderer(IPC.recorderCommand, "pause");
      return;
    }
    if (action === "resume") {
      this.sendToRenderer(IPC.recorderCommand, "resume");
      return;
    }
    if (action === "stop") {
      this.sendToRenderer(IPC.recorderCommand, "stop");
      this.deps.notifier.hide();
      return;
    }
    if (action === "cancel") {
      this.sendToRenderer(IPC.recorderCommand, "cancel");
      this.deps.notifier.hide();
    }
  }
  /** Uygulama kapanirken */
  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.deps.notifier.destroy();
  }
  // -----------------------------------------------------------------------
  //  watchdog
  // -----------------------------------------------------------------------
  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }
  stopTimerIfIdle() {
    if (this.pending || this.state) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  async cancelNote(noteId, message) {
    const detail = getNoteDetail(this.deps.db, noteId);
    if (!detail || detail.transcripts.length === 0) {
      deleteNote(this.deps.db, noteId);
    } else {
      setNoteStatus(this.deps.db, noteId, "ready");
    }
    this.log(`[auto] ${message}`);
    this.deps.notifier.hide();
    this.sendToRenderer(IPC.recorderCommand, "cancel");
    this.sendToRenderer(IPC.appToast, { kind: "info", message, noteId });
    this.pending = null;
    this.state = null;
    this.stopTimerIfIdle();
  }
  async tick() {
    try {
      await this.tickInner();
    } catch (err) {
      this.log("[auto] gozcu hatasi: " + (err instanceof Error ? err.message : String(err)));
    }
  }
  async tickInner() {
    const { db: db2 } = this.deps;
    const settings = getAllSettings(db2);
    if (this.pending && Date.now() - this.pending.createdAt > RENDERER_START_TIMEOUT_MS) {
      const p = this.pending;
      this.log("[auto] renderer zamaninda baslatmadi, iptal ediliyor");
      await this.cancelNote(p.noteId, "Kayıt başlatılamadı");
      return;
    }
    const st = this.state;
    if (!st) return;
    const elapsed = Date.now() - st.startedAt;
    const idle = Date.now() - st.lastActivityAt;
    if (st.auto && st.transcriptCount === 0 && settings.auto_cancel_empty_seconds > 0 && elapsed > settings.auto_cancel_empty_seconds * 1e3) {
      await this.cancelNote(st.noteId, "Ses algılanmadı, kayıt iptal edildi");
      return;
    }
    if (st.auto && !st.paused && settings.auto_stop_silence_seconds > 0 && idle > settings.auto_stop_silence_seconds * 1e3) {
      this.log(`[auto] ${settings.auto_stop_silence_seconds} sn sessizlik, durduruluyor`);
      this.deps.notifier.update({
        visible: true,
        title: "Kayıt durduruldu",
        subtitle: "Sessizlik algılandı • not hazırlanıyor",
        tone: "info"
      });
      this.sendToRenderer(IPC.recorderCommand, "stop");
      return;
    }
    if (st.auto && st.triggerApp && settings.auto_stop_on_app_close && elapsed > 3e3) {
      const snapshot = this.deps.detector.snapshot;
      if (snapshot) {
        const check = checkTriggerAlive(st.triggerApp, st.kind, snapshot);
        if (!check.alive) {
          this.log(
            `[auto] kaynak kayboldu (neden=${check.reason}, procs=${check.processCount}, aktifMic=${check.activeMicCount}, transkript=${st.transcriptCount})`
          );
        }
        if (!check.alive) {
          if (st.transcriptCount === 0) {
            await this.cancelNote(st.noteId, "Kaynak kapandı, kayıt iptal edildi");
          } else {
            this.log(`[auto] ${st.triggerApp} kapandi/gorusme bitti, durduruluyor`);
            this.sendToRenderer(IPC.recorderCommand, "stop");
          }
        }
      }
    }
  }
  sendToRenderer(channel, payload) {
    const win = this.deps.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
class OsNotifier {
  constructor(getWindow) {
    this.getWindow = getWindow;
  }
  enabled = true;
  setEnabled(v) {
    this.enabled = v;
  }
  get isSupported() {
    try {
      return electron.Notification.isSupported();
    } catch {
      return false;
    }
  }
  show(opts) {
    if (!this.enabled) return false;
    try {
      if (!electron.Notification.isSupported()) return false;
      const n = new electron.Notification({
        title: opts.title,
        body: opts.body.slice(0, 400),
        silent: opts.silent ?? false
      });
      n.on("click", () => {
        const w = this.getWindow();
        if (!w || w.isDestroyed()) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
        if (opts.noteId) w.webContents.send(IPC.noteFocus, opts.noteId);
      });
      n.show();
      return true;
    } catch {
      return false;
    }
  }
}
function header(path) {
  try {
    const buf = node_fs.readFileSync(path);
    return JSON.stringify(buf.subarray(0, 16).toString("latin1"));
  } catch {
    return "(okunamadi)";
  }
}
function openOk(path, key) {
  try {
    const db2 = new Database(path);
    if (key) db2.pragma(`key = '${key}'`);
    const r = db2.prepare("SELECT count(*) AS c FROM notes").get();
    db2.close();
    return { ok: true, rows: r.c };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function runCryptoTest(log2) {
  try {
    const avail = electron.safeStorage.isEncryptionAvailable();
    log2(`[crypto] 0) safeStorage.isEncryptionAvailable=${avail}`);
    if (avail) {
      const enc = electron.safeStorage.encryptString("test");
      const dec = electron.safeStorage.decryptString(enc);
      log2(`[crypto]    sifrele/coz turu: ${dec === "test" ? "OK" : "BASARISIZ"} (${enc.length} bayt)`);
    }
  } catch (err) {
    log2(`[crypto]    safeStorage HATASI: ${err instanceof Error ? err.message : String(err)}`);
  }
  const dir = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), "notlar-crypto-"));
  const path = node_path.join(dir, "test.db");
  const pass = "a1b2c3d4e5f6".repeat(2);
  try {
    const db2 = new Database(path);
    db2.pragma("journal_mode = WAL");
    db2.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)");
    db2.prepare("INSERT INTO notes (id, title) VALUES (?, ?)").run("1", "Merhaba dünya");
    db2.pragma("wal_checkpoint(TRUNCATE)");
    db2.close();
    log2(`[crypto] 1) duz metin olusturuldu  baslik=${header(path)} boyut=${node_fs.statSync(path).size}`);
    log2(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`);
    log2(`[crypto]    yanlis anahtarla acilis: ${JSON.stringify(openOk(path, "yanlis-anahtar"))}`);
    const db22 = new Database(path);
    db22.pragma(`rekey = '${pass}'`);
    db22.close();
    log2(`[crypto] 2) rekey uygulandi       baslik=${header(path)} boyut=${node_fs.statSync(path).size}`);
    log2(`[crypto]    anahtarla acilis: ${JSON.stringify(openOk(path, pass))}`);
    log2(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`);
    for (const suffix of ["-wal", "-shm"]) {
      const extra = path + suffix;
      log2(`[crypto]    ${suffix} var mi: ${node_fs.existsSync(extra)}`);
    }
    const db3 = new Database(path);
    db3.pragma(`key = '${pass}'`);
    db3.pragma("rekey = ''");
    db3.close();
    log2(`[crypto] 4) sifre kaldirildi      baslik=${header(path)}`);
    log2(`[crypto]    anahtarsiz acilis: ${JSON.stringify(openOk(path))}`);
  } catch (err) {
    log2(`[crypto] HATA: ${err instanceof Error ? err.stack : String(err)}`);
  } finally {
    try {
      node_fs.rmSync(dir, { recursive: true, force: true });
    } catch {
    }
    log2("[crypto] gecici klasor silindi");
  }
}
dotenv.config({ path: node_path.join(electron.app.getAppPath(), ".env") });
try {
  dotenv.config({ path: node_path.join(electron.app.getPath("userData"), ".env") });
} catch {
}
dotenv.config();
const log = (m) => console.log(m);
let mainWindow = null;
let pendingCliImport = null;
let pendingSimulate = null;
let pendingSimulateTrigger = null;
let detectOnce = false;
let notifier;
let detector;
let autoRecord;
let scheduler;
let osNotifier;
function argValue(flag) {
  const pref = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length).trim().replace(/^"|"$/g, "");
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].trim();
  return null;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
async function runCliImport(filePath) {
  const db2 = getDb();
  const result = await importAudioFile(
    { db: db2, apiKey: makeApiKeyResolver() },
    { filePath, channel: "mic", language: "auto" },
    (p) => {
      log(`[import:${p.stage}] ${p.message}${p.detail ? " -> " + p.detail : ""}`);
      const w = mainWindow;
      if (w && !w.isDestroyed()) w.webContents.send(IPC.importProgress, p);
    }
  );
  log("[import] sonuc: " + JSON.stringify(result).slice(0, 300));
}
async function runSimulate(filePath) {
  const db2 = getDb();
  const send = (e) => {
    const w = mainWindow;
    if (w && !w.isDestroyed()) w.webContents.send(IPC.recordingEvent, e);
  };
  await simulateLive(
    { db: db2, apiKey: makeApiKeyResolver() },
    { filePath, channel: "mic", language: "auto", onEvent: send, log: (m) => log("[sim] " + m) }
  );
}
async function runSimulateTrigger(kind) {
  const db2 = getDb();
  const isCal = kind === "calendar";
  let event;
  if (isCal) {
    const upcoming = listUpcomingCalendarEvents(db2, new Date(Date.now() - 36e5).toISOString(), 1);
    const ev = upcoming[0];
    event = {
      kind: "calendar",
      reason: `calendar:${ev?.id ?? "manual-test"}`,
      title: ev?.title ?? "Takvim tetiklemesi (test)",
      calendarEventId: ev?.id,
      participants: ev?.participants ?? ["Test Katılımcı"],
      detectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } else {
    event = {
      kind: "call",
      reason: "call:Zoom.exe",
      title: "Zoom",
      app: "Zoom.exe",
      detectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  log(`[test] tetikleme enjekte ediliyor: ${event.reason}`);
  await autoRecord.handleTrigger(event);
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: "Notlar",
    backgroundColor: "#f6f5f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // KRITIK: pencere arka planda/ikon halindeyken zamanlayicilar kisilmasin.
      // Kayit parcasi gonderen setInterval buna bagli; kapali olsa toplanti
      // sirasinda (pencere arkada) transkript akisi dururdu.
      backgroundThrottling: false
    }
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" });
    } else if (params.selectionText) {
      items.push({ role: "copy", label: "Kopyala" });
    }
    items.push({ role: "selectAll", label: "Tümünü seç" });
    electron.Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const externalUrl = new URL(url);
      if (externalUrl.protocol === "https:" && externalUrl.hostname) {
        void electron.shell.openExternal(externalUrl.toString());
      }
    } catch {
      // Reject malformed URLs and non-web protocols.
    }
    return { action: "deny" };
  });
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  pendingCliImport = argValue("--import");
  pendingSimulate = argValue("--simulate-live");
  pendingSimulateTrigger = argValue("--simulate-trigger");
  detectOnce = hasFlag("--detect-once");
}
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("[app] zaten calisan bir ornek var; bu surec kapaniyor");
  electron.app.quit();
}
electron.app.on("second-instance", () => {
  const w = mainWindow;
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
});
electron.app.whenReady().then(() => {
  if (!gotTheLock) return;
  initDatabase();
  registerDisplayMediaHandler();
  const db2 = lazyDb();
  notifier = new RecordingNotifier();
  detector = new TriggerDetector({
    db: db2,
    onTrigger: (e) => void autoRecord.handleTrigger(e),
    isRecordingActive: () => autoRecord.isBusy,
    log
  });
  autoRecord = new AutoRecordManager({
    db: db2,
    getMainWindow: () => mainWindow,
    notifier,
    detector,
    log
  });
  scheduler = new CalendarScheduler({
    db: db2,
    onTrigger: (e) => void autoRecord.handleTrigger(e),
    onSynced: (res) => {
      const w = mainWindow;
      if (w && !w.isDestroyed()) w.webContents.send(IPC.calendarUpdated, res);
    },
    isRecordingActive: () => autoRecord.isBusy,
    log
  });
  electron.ipcMain.handle(IPC.rendererReady, async () => {
    if (hasFlag("--db-crypto-test")) {
      runCryptoTest((m) => console.log(m));
    }
    detector.start();
    scheduler.start();
    if (detectOnce) {
      detectOnce = false;
      const settings = getAllSettings(db2);
      const result = await detector.probe();
      log("[detect] ayarlar: call=" + settings.auto_start_call + " app=" + settings.auto_start_apps);
      log("[detect] izin listesi: " + JSON.stringify(settings.allowed_apps));
      log("[detect] aktif mikrofon kullanicilari: " + JSON.stringify(result.activeMicLabels));
      log("[detect] izinli mic kullanicisi: " + String(result.allowedMicUser));
      log("[detect] izinli uygulama: " + String(result.allowedApp));
      log("[detect] tetikleme: " + (result.event ? result.event.reason : "yok"));
    }
    if (pendingCliImport) {
      const file = pendingCliImport;
      pendingCliImport = null;
      void runCliImport(file);
    }
    if (pendingSimulate) {
      const file = pendingSimulate;
      pendingSimulate = null;
      void runSimulate(file);
    }
    if (pendingSimulateTrigger) {
      const kind = pendingSimulateTrigger;
      pendingSimulateTrigger = null;
      setTimeout(() => void runSimulateTrigger(kind), 800);
    }
    return true;
  });
  try {
    electron.app.setAppUserModelId("com.kisisel.notlar");
  } catch {
  }
  osNotifier = new OsNotifier(() => mainWindow);
  {
    const settings = getAllSettings(db2);
    osNotifier.setEnabled(Boolean(settings.os_notifications));
    console.log(
      `[os] bildirim destegi=${osNotifier.isSupported} aktif=${settings.os_notifications}`
    );
  }
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: mediastream:; connect-src 'self' https://api.groq.com https://api.openai.com https://openrouter.ai https://api.anthropic.com ws://localhost:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        ]
      }
    });
  });
  registerIpcHandlers(() => mainWindow, {
    autoRecord,
    scheduler,
    detector,
    notifier,
    osNotifier,
    onSettingsChanged: (next) => osNotifier?.setEnabled(Boolean(next.os_notifications))
  });
  const cryptoCheck = checkEncryptionConsistency();
  if (!cryptoCheck.ok) console.error("[security] " + cryptoCheck.message);
  else console.log("[security] sifreleme durumu tutarli");
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("will-quit", () => {
  try {
    detector?.stop();
    scheduler?.stop();
    autoRecord?.dispose();
    const stuck = finalizeStuckRecordings(getDb());
    if (stuck > 0) log(`[db] ${stuck} yarim kayit 'ready' yapildi`);
  } catch {
  }
  closeDatabase();
});
