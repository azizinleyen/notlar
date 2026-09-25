// ============================================================================
//  FAZ 6 — Recipes: "/" ile acilan kayitli promptlar.
//
//  Kullanim: bir kapsam (not/kisi/sirket/tum) seciliyken recipe calistirilir;
//  recipe prompt'u LLM'e gonderilir ve sonuc SOHBETE kaydedilir (gecmis kalir).
//  Boylece her recipe kullanimi izlenebilir ve devam ettirilebilir.
// ============================================================================

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AskCitationDto, RecipeDto, RecipeRunResult } from '@shared/types'
import * as repo from '../db/repo'
import { rawNotesToPlain } from '@shared/text'
import { llmOptionsFor, resolveLlmProvider } from '../llm'
import { extractJsonObject } from '../llm/util'
import { buildScopedContext, resolveScopedCitations, type ScopedNoteInput } from '../llm/scoped'
import { createThread, getMessages, insertChatMessage, notesForScopeApi } from './chatStore'

interface RawRecipeRow {
  id: string
  name: string
  shortcut: string
  description: string | null
  prompt_body: string
  scope: string
  is_builtin: number
  sort_order: number
}

export function listRecipes(db: Database.Database): RecipeDto[] {
  const rows = db
    .prepare(
      `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes ORDER BY sort_order ASC, name ASC`
    )
    .all() as RawRecipeRow[]
  return rows.map(toRecipe)
}

function toRecipe(r: RawRecipeRow): RecipeDto {
  return {
    id: r.id,
    name: r.name,
    shortcut: r.shortcut,
    description: r.description,
    prompt_body: r.prompt_body,
    scope: r.scope as RecipeDto['scope'],
    is_builtin: r.is_builtin === 1,
    sort_order: r.sort_order
  }
}

/**
 * Shortcut -> bosluksuz, kucuk harf.
 *
 * DIKKAT (gercek hata): `toLocaleLowerCase('tr')` Turkce'de "MAIL" -> "maıl"
 * (noktasiz i) yapiyordu; bu yuzden "/MAIL" -> "maıl" olusuyordu ve kullanici
 * recipe'yi bulamiyordu. Cozum: once I varyantlarini tek harfe indir, SONRA
 * yerel-bagimsiz kucuk harfe cevir (people/extract.ts ile ayni yaklasim).
 *
 * Turkce harfler (ığüşöç) KORUNUR ki kullanici kendi dilinde shortcut yazabilsin.
 */
export function normalizeShortcut(input: string): string {
  return (input ?? '')
    .trim()
    .replace(/^\//, '')
    .replace(/[İIı]/g, 'i')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9ğüşöç_-]/g, '')
}

export function saveRecipe(
  db: Database.Database,
  input: { id?: string; name: string; shortcut: string; description?: string | null; promptBody: string; scope?: RecipeDto['scope'] }
): RecipeDto | null {
  const name = (input.name ?? '').trim()
  const prompt = (input.promptBody ?? '').trim()
  const shortcut = normalizeShortcut(input.shortcut || name)
  if (!name || !prompt || !shortcut) return null

  const id = input.id?.trim() || `rec_${randomUUID().slice(0, 8)}`
  const existing = db.prepare('SELECT is_builtin, sort_order FROM recipes WHERE id = ?').get(id) as
    | { is_builtin: number; sort_order: number }
    | undefined

  db.prepare(
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
    scope: input.scope ?? 'note',
    isBuiltin: existing?.is_builtin ?? 0,
    sortOrder: existing?.sort_order ?? 100
  })

  const row = db
    .prepare(
      `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes WHERE id = ?`
    )
    .get(id) as RawRecipeRow | undefined
  return row ? toRecipe(row) : null
}

export function deleteRecipe(db: Database.Database, id: string): boolean {
  // Yerlesik recipe silinmesin (kullanici sifirlayabilir diye korunur)
  const row = db.prepare('SELECT is_builtin FROM recipes WHERE id = ?').get(id) as
    | { is_builtin: number }
    | undefined
  if (!row || row.is_builtin === 1) return false
  db.prepare('DELETE FROM recipes WHERE id = ?').run(id)
  return true
}

// --- calistirma ------------------------------------------------------------

export interface RunRecipeDeps {
  db: Database.Database
  onProgress?: (m: string) => void
  log?: (m: string) => void
}

const RECIPE_SYSTEM_SUFFIX = [
  'Sana kullanıcının notları ([N#] etiketli) verilecek ve belirli bir GÖREV istenecek.',
  '',
  'Kurallar:',
  '(1) YALNIZCA verilen notlardaki bilgiyi kullan; uydurma.',
  '(2) Görevde istenen biçime uy (madde listesi, e-posta, tablo vb.).',
  '(3) Bilgi yetersizse bunu açıkça belirt; eksik kısmı uydurma.',
  '(4) Kısa ve doğrudan yaz; gereksiz giriş cümlesi yazma.',
  '(5) Her iddiayı bir not etiketine dayandır ([N2]).',
  '',
  'Çıktı YALNIZCA şu JSON olsun:',
  '{ "answer_md": "istenen çıktı (markdown)", "citations": [ { "source": "N2", "excerpt": "kısa alıntı" } ] }'
].join('\n')

/**
 * Recipe'yi calistirir, sonucu sohbete kaydeder.
 * @param scope hedef kapsam (recipe.scope yalnizca oneri; kullanici secer)
 */
export async function runRecipe(
  deps: RunRecipeDeps,
  recipeId: string,
  scope: { kind: 'note' | 'person' | 'company' | 'all'; id?: string | null }
): Promise<RecipeRunResult> {
  const { db } = deps
  const recipeRow = db
    .prepare(
      `SELECT id, name, shortcut, description, prompt_body, scope, is_builtin, sort_order
         FROM recipes WHERE id = ?`
    )
    .get(recipeId) as RawRecipeRow | undefined
  if (!recipeRow) {
    return {
      ok: false,
      threadId: '',
      answer_md: '',
      citations: [],
      provider: null,
      model: null,
      usedFallback: false,
      error: 'Recipe bulunamadi'
    }
  }
  const recipe = toRecipe(recipeRow)

  const settings = repo.getAllSettings(db)
  const limit = Math.max(1, Math.min(50, settings.chat_max_context_notes || 12))
  const ids = notesForScopeApi(db, scope.kind, scope.id ?? null, limit)

  const notes: ScopedNoteInput[] = []
  for (const id of ids) {
    const d = repo.getNoteDetail(db, id)
    if (!d) continue
    notes.push({
      noteId: d.note.id,
      title: d.note.title,
      startedAt: d.note.started_at,
      source: d.note.source,
      transcript: repo.transcriptTextOf(db, id),
      rawNotes: rawNotesToPlain(d.raw_notes_md),
      enhanced: d.enhanced?.content_md ?? ''
    })
  }

  const scopeLabel =
    scope.kind === 'note'
      ? notes[0]?.title ?? 'not'
      : scope.kind === 'person'
        ? repo.getPerson(db, scope.id ?? '')?.name ?? 'kisi'
        : scope.kind === 'company'
          ? repo.getCompany(db, scope.id ?? '')?.name ?? 'sirket'
          : 'tum notlar'

  const threadId = createThread(db, scope.kind, scope.id ?? null, `${recipe.name} — ${scopeLabel}`)
  insertChatMessage(db, {
    threadId,
    role: 'user',
    contentMd: `/${recipe.shortcut} — ${recipe.name}`
  })

  const ctx = buildScopedContext(notes, { maxCharsPerNote: 3000, maxTotalChars: 20000 })
  const llm = resolveLlmProvider(settings.llm_provider)
  const opts = llmOptionsFor(db, llm)
  const system = `${RECIPE_SYSTEM_SUFFIX}\n\nGOREV: ${recipe.prompt_body}`
  const user = ['### NOTLAR', ctx.block || '(not yok)'].join('\n')

  const finish = (p: {
    answerMd: string
    citations: AskCitationDto[]
    provider: string | null
    model: string | null
    usedFallback: boolean
    error?: string
  }): RecipeRunResult => {
    insertChatMessage(db, {
      threadId,
      role: 'assistant',
      contentMd: p.answerMd,
      citations: p.citations,
      provider: p.provider,
      model: p.model,
      usedFallback: p.usedFallback,
      scannedNotes: notes.length,
      error: p.error ?? null
    })
    return {
      ok: true,
      threadId,
      answer_md: p.answerMd,
      citations: p.citations,
      provider: p.provider,
      model: p.model,
      usedFallback: p.usedFallback,
      error: p.error
    }
  }

  if (llm.requiresApiKey && !opts.apiKey) {
    return finish({
      answerMd:
        'Bu recipe LLM gerektirir; API anahtari tanimli degil. Ayarlar > AI not uretimi bolumunden bir saglayici anahtari ekleyin.',
      citations: [],
      provider: null,
      model: null,
      usedFallback: true,
      error: 'LLM anahtari yok'
    })
  }

  try {
    deps.onProgress?.(`${recipe.name} calistiriliyor...`)
    const res = await llm.complete({ system, user, maxTokens: 1800, temperature: 0.2 }, opts)
    const payload = extractJsonObject(res.text) as { answer_md?: string; citations?: Array<{ source?: string; excerpt?: string }> }
    const resolved = resolveScopedCitations(payload.citations ?? [], ctx.index)
    deps.log?.(
      `[recipe] ${recipe.shortcut} kapsam=${scope.kind} not=${notes.length} kaynak=${resolved.citations.length}`
    )
    return finish({
      answerMd: (payload.answer_md ?? '').trim() || '(bos yanit)',
      citations: resolved.citations.map((c) => ({
        note_id: c.note_id,
        note_title: c.note_title,
        source_type: 'previous_note' as const,
        excerpt: c.excerpt
      })),
      provider: res.provider,
      model: res.model,
      usedFallback: false
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.log?.(`[recipe] hata: ${message}`)
    return finish({
      answerMd: `Recipe calistirilamadi: ${message}`,
      citations: [],
      provider: null,
      model: null,
      usedFallback: true,
      error: message
    })
  }
}

export { getMessages }