import { useSyncExternalStore } from 'react'
import {
  AuthError,
  createRecipe as createDriveRecipe,
  createRecipeFile,
  fileValidator,
  findRecipeFile,
  getFileMeta,
  listRecipeFiles,
  listRecipeFolders,
  readFile,
  trashRecipe,
  updateFile,
  type DriveFileMeta,
} from '../api/drive'
import { parseTime, parseTitle, slugToTitle, titleToSlug } from '../lib/markdown'
import {
  bodyExists,
  buildManifest,
  clearAllCaches,
  deleteBody,
  dropOtherRoots,
  pruneBodies,
  readBody,
  readManifest,
  writeBody,
  writeManifest,
  type CachedRecipe,
} from '../storage/recipeCache'
import type { RecipeSummary } from '../types'

/**
 * The single source of truth the screens read from.
 *
 * Reads are synchronous and always answered from cache, so every screen paints
 * immediately. Freshness is a background concern: Drive is consulted to
 * *revalidate*, never to render.
 *
 * Revalidation deliberately does not use HTTP `If-None-Match`. Drive v3 exposes
 * per-file validators (`md5Checksum`, `modifiedTime`) inside a `files.list`
 * response, so one batched query tells us which of the whole cookbook's recipes
 * changed. Conditional GETs would cost one round trip per recipe to learn the
 * same thing.
 */

/** Parallel body downloads. Enough to saturate a phone link, few enough to avoid Drive throttling. */
const DOWNLOAD_CONCURRENCY = 8

/** A foreground revalidation this recent is treated as good enough. */
const MIN_SYNC_INTERVAL_MS = 30_000

/** Upper bound on bodies held in memory; disk is the backing store. */
const MAX_MEMORY_BODIES = 120

export type StoreState = {
  rootId: string
  recipes: CachedRecipe[]
  syncedAt: number
  syncing: boolean
  error: string
}

export type SyncProgress = { done: number; total: number }

const EMPTY_STATE: StoreState = {
  rootId: '',
  recipes: [],
  syncedAt: 0,
  syncing: false,
  error: '',
}

let state: StoreState = EMPTY_STATE
const listeners = new Set<() => void>()
const bodies = new Map<string, string>()
let inFlightSync: Promise<void> | null = null

/**
 * Folders written locally while a sync is in flight. That sync's folder listing
 * predates the write, so its result must not roll the write back. Deletions
 * count as writes: the folder is recorded here and dropped from `state.recipes`,
 * which together tell the sync to leave it out rather than restore it.
 */
let writesDuringSync: Set<string> | null = null

function notify() {
  for (const listener of listeners) listener()
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch }
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getState() {
  return state
}

// --- body cache -------------------------------------------------------------

function rememberBody(fileId: string, markdown: string) {
  bodies.set(fileId, markdown)
  while (bodies.size > MAX_MEMORY_BODIES) {
    const oldest = bodies.keys().next().value
    if (oldest === undefined) break
    bodies.delete(oldest)
  }
}

function storeBody(rootId: string, fileId: string, markdown: string) {
  writeBody(rootId, fileId, markdown)
  rememberBody(fileId, markdown)
}

/** Synchronous body read: memory, then disk, then nothing. */
export function getBody(fileId: string | null): string | null {
  if (!fileId) return null
  const remembered = bodies.get(fileId)
  if (remembered !== undefined) return remembered
  const stored = state.rootId ? readBody(state.rootId, fileId) : null
  if (stored !== null) rememberBody(fileId, stored)
  return stored
}

function hasBody(rootId: string, fileId: string) {
  return bodies.has(fileId) || bodyExists(rootId, fileId)
}

/** Current entry for a folder, outside of React's render cycle. */
export function getRecipe(folderId: string): CachedRecipe | null {
  return state.recipes.find((recipe) => recipe.folderId === folderId) ?? null
}

// --- lifecycle --------------------------------------------------------------

/**
 * Loads the cached cookbook for a folder. Synchronous by design: the first
 * frame after launch can already show the full recipe list.
 *
 * @returns whether usable cached content is available.
 */
export function hydrate(rootId: string): boolean {
  if (state.rootId !== rootId) {
    bodies.clear()
    dropOtherRoots(rootId)
  }
  const manifest = readManifest(rootId)
  state = {
    rootId,
    recipes: manifest?.recipes ?? [],
    syncedAt: manifest?.syncedAt ?? 0,
    syncing: false,
    error: '',
  }
  notify()
  return state.recipes.length > 0
}

/** Forgets everything on sign-out; cached recipes are the signed-in user's data. */
export function reset() {
  clearAllCaches()
  bodies.clear()
  inFlightSync = null
  state = EMPTY_STATE
  notify()
}

// --- sync -------------------------------------------------------------------

async function mapWithConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function indexByFolder(metas: DriveFileMeta[], folderIds: Set<string>) {
  const byFolder = new Map<string, DriveFileMeta>()
  for (const meta of metas) {
    const parent = meta.parents?.find((id) => folderIds.has(id))
    if (!parent) continue
    const existing = byFolder.get(parent)
    // A folder should hold one recipe.md; if it holds more, prefer the newest
    // so every device converges on the same choice.
    if (!existing || (meta.modifiedTime ?? '') > (existing.modifiedTime ?? '')) {
      byFolder.set(parent, meta)
    }
  }
  return byFolder
}

const progressListeners = new Set<(progress: SyncProgress) => void>()
let lastProgress: SyncProgress = { done: 0, total: 0 }

function emitProgress(progress: SyncProgress) {
  lastProgress = progress
  for (const listener of progressListeners) listener(progress)
}

async function runSync(rootId: string) {
  const folders = await listRecipeFolders(rootId)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const metas = await listRecipeFiles(folders.map((folder) => folder.id))
  const metaByFolder = indexByFolder(metas, folderIds)

  const previous = new Map(state.recipes.map((recipe) => [recipe.folderId, recipe]))
  const resolved = new Map<string, CachedRecipe>()
  const stale: Array<{ folderId: string; slug: string; meta: DriveFileMeta; validator: string }> = []

  for (const folder of folders) {
    const meta = metaByFolder.get(folder.id)
    const prior = previous.get(folder.id)

    if (!meta) {
      // A recipe folder with no recipe.md yet. Still listed, nothing to cache.
      resolved.set(folder.id, {
        folderId: folder.id,
        fileId: null,
        slug: folder.name,
        title: slugToTitle(folder.name),
        time: '',
        validator: '',
      })
      continue
    }

    const validator = fileValidator(meta)
    const unchanged =
      prior &&
      prior.fileId === meta.id &&
      !!validator &&
      prior.validator === validator &&
      hasBody(rootId, meta.id)

    if (unchanged) {
      // Folder renames still need to land, so rebuild rather than reuse verbatim.
      resolved.set(folder.id, { ...prior, slug: folder.name })
      continue
    }
    stale.push({ folderId: folder.id, slug: folder.name, meta, validator })
  }

  emitProgress({ done: 0, total: stale.length })

  let done = 0
  const downloaded = await mapWithConcurrency(stale, DOWNLOAD_CONCURRENCY, async (item) => {
    try {
      const markdown = await readFile(item.meta.id)
      storeBody(rootId, item.meta.id, markdown)
      return {
        folderId: item.folderId,
        fileId: item.meta.id,
        slug: item.slug,
        title: parseTitle(markdown, item.slug),
        time: parseTime(markdown),
        validator: item.validator,
      } satisfies CachedRecipe
    } catch (caught) {
      if (caught instanceof AuthError) throw caught
      // One unreadable recipe must not lose the rest of the cookbook.
      const prior = previous.get(item.folderId)
      return {
        folderId: item.folderId,
        fileId: item.meta.id,
        slug: item.slug,
        title: prior?.title ?? slugToTitle(item.slug),
        time: prior?.time ?? '',
        validator: '',
      } satisfies CachedRecipe
    } finally {
      done += 1
      emitProgress({ done, total: stale.length })
    }
  })

  for (const recipe of downloaded) resolved.set(recipe.folderId, recipe)

  // Drive is authoritative: anything it no longer reports is gone, including
  // recipes another device deleted. The exception is a local save that landed
  // after this sync read the folder listing.
  const localWins = writesDuringSync ?? new Set<string>()
  const local = new Map(state.recipes.map((recipe) => [recipe.folderId, recipe]))
  const recipes = folders.flatMap((folder) => {
    if (!localWins.has(folder.id)) return [resolved.get(folder.id)!]
    // A folder written locally keeps the local entry. A folder deleted locally
    // no longer has one, and must stay gone rather than fall back to Drive.
    const localRecipe = local.get(folder.id)
    return localRecipe ? [localRecipe] : []
  })
  for (const folderId of localWins) {
    if (folderIds.has(folderId)) continue
    const created = local.get(folderId)
    if (created) recipes.push(created)
  }

  const keep = new Set(recipes.map((recipe) => recipe.fileId).filter((id): id is string => !!id))
  pruneBodies(rootId, keep)
  for (const fileId of [...bodies.keys()]) {
    if (!keep.has(fileId)) bodies.delete(fileId)
  }

  const syncedAt = Date.now()
  writeManifest(buildManifest(rootId, recipes, syncedAt))
  setState({ recipes, syncedAt, error: '' })
}

/**
 * Revalidates the whole folder against Drive. Cheap when nothing changed:
 * a couple of metadata queries and no body downloads at all.
 */
export function sync(options: { force?: boolean; onProgress?: (progress: SyncProgress) => void } = {}) {
  const { force = false, onProgress } = options
  // Progress is a broadcast, so a caller that joins a sync already in flight
  // still drives its progress bar.
  if (onProgress) {
    progressListeners.add(onProgress)
    onProgress(lastProgress)
  }
  const detach = () => {
    if (onProgress) progressListeners.delete(onProgress)
  }

  const rootId = state.rootId
  if (!rootId) {
    detach()
    return Promise.resolve()
  }
  if (inFlightSync) return inFlightSync.finally(detach)
  if (!force && state.syncedAt && Date.now() - state.syncedAt < MIN_SYNC_INTERVAL_MS) {
    detach()
    return Promise.resolve()
  }

  setState({ syncing: true, error: '' })
  writesDuringSync = new Set()
  lastProgress = { done: 0, total: 0 }
  const task = runSync(rootId)
    .catch((caught: unknown) => {
      if (caught instanceof AuthError) throw caught
      setState({ error: caught instanceof Error ? caught.message : 'Synchronisation impossible' })
    })
    .finally(() => {
      inFlightSync = null
      writesDuringSync = null
      setState({ syncing: false })
    })
  inFlightSync = task
  return task.finally(detach)
}

/**
 * Revalidates a single recipe, for when one is opened. Costs one small metadata
 * request unless the body actually changed.
 */
export async function revalidateRecipe(folderId: string): Promise<void> {
  const rootId = state.rootId
  if (!rootId) return
  const current = state.recipes.find((recipe) => recipe.folderId === folderId)
  // A cached file id goes stale when another device replaces recipe.md rather
  // than editing it, so fall back to looking the file up by folder.
  let meta = current?.fileId
    ? await getFileMeta(current.fileId).catch((caught: unknown) => {
        if (caught instanceof AuthError) throw caught
        return null
      })
    : null
  if (!meta) meta = await findRecipeFile(folderId)
  // A delete that landed while these requests were in flight must not be undone.
  if (!state.recipes.some((recipe) => recipe.folderId === folderId)) return
  if (!meta) {
    if (current?.fileId) upsert({ ...current, fileId: null, validator: '' })
    return
  }

  const validator = fileValidator(meta)
  const fresh =
    current &&
    current.fileId === meta.id &&
    !!validator &&
    current.validator === validator &&
    hasBody(rootId, meta.id)
  if (fresh) return

  const markdown = await readFile(meta.id)
  storeBody(rootId, meta.id, markdown)
  // A delete that landed while this request was in flight must not be undone.
  if (!state.recipes.some((recipe) => recipe.folderId === folderId)) return
  upsert({
    folderId,
    fileId: meta.id,
    slug: current?.slug ?? folderId,
    title: parseTitle(markdown, current?.slug ?? folderId),
    time: parseTime(markdown),
    validator,
  })
}

// --- writes -----------------------------------------------------------------

function upsert(recipe: CachedRecipe) {
  writesDuringSync?.add(recipe.folderId)
  const index = state.recipes.findIndex((entry) => entry.folderId === recipe.folderId)
  const recipes =
    index === -1
      ? [...state.recipes, recipe]
      : state.recipes.map((entry, position) => (position === index ? recipe : entry))
  const syncedAt = state.syncedAt || Date.now()
  writeManifest(buildManifest(state.rootId, recipes, syncedAt))
  setState({ recipes, syncedAt })
}

/**
 * Saves a recipe and folds the result straight into the cache. The upload
 * response carries the new validator, so the next sync recognises this content
 * as current and never re-downloads what this device just wrote.
 */
export async function saveRecipe(existing: RecipeSummary | null, text: string): Promise<CachedRecipe> {
  const rootId = state.rootId
  const title = parseTitle(text, existing?.slug ?? 'recette')
  const time = parseTime(text)

  if (!existing) {
    const slug = titleToSlug(title) || 'recette'
    const created = await createDriveRecipe(rootId, slug, text)
    return commitSave({ folderId: created.folderId, slug, title, time }, created.file, text)
  }

  const fileId = existing.fileId ?? (await findRecipeFile(existing.folderId))?.id ?? null
  const saved = fileId
    ? await updateFile(fileId, text)
    : await createRecipeFile(existing.folderId, text)
  return commitSave({ folderId: existing.folderId, slug: existing.slug, title, time }, saved, text)
}

/**
 * Deletes a recipe, Drive first and cache second.
 *
 * The order matters: a failed request leaves the cookbook untouched everywhere,
 * whereas dropping the local copy first would hide a recipe on this device that
 * every other device still shows.
 */
export async function deleteRecipe(folderId: string): Promise<void> {
  const rootId = state.rootId
  const recipe = state.recipes.find((entry) => entry.folderId === folderId)
  await trashRecipe(folderId)

  writesDuringSync?.add(folderId)
  const recipes = state.recipes.filter((entry) => entry.folderId !== folderId)
  if (recipe?.fileId) {
    bodies.delete(recipe.fileId)
    if (rootId) deleteBody(rootId, recipe.fileId)
  }
  const syncedAt = state.syncedAt || Date.now()
  writeManifest(buildManifest(rootId, recipes, syncedAt))
  setState({ recipes, syncedAt })
}

function commitSave(
  base: { folderId: string; slug: string; title: string; time: string },
  meta: DriveFileMeta,
  markdown: string,
) {
  const recipe: CachedRecipe = { ...base, fileId: meta.id, validator: fileValidator(meta) }
  storeBody(state.rootId, meta.id, markdown)
  upsert(recipe)
  return recipe
}

// --- hooks ------------------------------------------------------------------

export function useRecipeStore(): StoreState {
  return useSyncExternalStore(subscribe, getState)
}

export function useRecipe(folderId: string): CachedRecipe | null {
  const snapshot = useSyncExternalStore(subscribe, getState)
  return snapshot.recipes.find((recipe) => recipe.folderId === folderId) ?? null
}
