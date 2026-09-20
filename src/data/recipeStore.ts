import { useMemo, useSyncExternalStore } from 'react'
import {
  AuthError,
  createRecipe as createDriveRecipe,
  createRecipeFile,
  fileValidator,
  findRecipeFile,
  listFolderFiles,
  listRecipeFolders,
  pickRecipeFile,
  readFile,
  trashRecipe,
  updateFile,
  type DriveFileMeta,
} from '../api/drive'
import { parseMedia, parseTags, parseTime, parseTitle, slugToTitle, titleToSlug } from '../lib/markdown'
import { isMediaMime } from '../lib/media'
import { collectTags } from '../lib/tags'
import {
  bodyExists,
  buildManifest,
  clearAllCaches,
  clearMedia,
  deleteBody,
  dropOtherRoots,
  pruneBodies,
  pruneMedia,
  pruneThumbs,
  readBody,
  readManifest,
  writeBody,
  writeManifest,
  type CachedRecipe,
} from '../storage/recipeCache'
import type { RecipeMedia, RecipeSummary } from '../types'

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
 * Thumbnail links from the last listing, in memory only.
 *
 * Drive hands these out alongside every other field, so they cost nothing to
 * collect, but they expire after a few hours — writing them to the manifest
 * would persist something guaranteed to be wrong by tomorrow.
 */
const thumbnailLinks = new Map<string, string>()

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

/** The most recent thumbnail link Drive offered for a file, if it is still held. */
export function getThumbnailLink(fileId: string): string {
  return thumbnailLinks.get(fileId) ?? ''
}

/** The folder the cookbook is pointed at, for the stores layered on top of this one. */
export function getRootId(): string {
  return state.rootId
}

/** The whole cookbook, outside of React's render cycle. */
export function getRecipes(): CachedRecipe[] {
  return state.recipes
}

/** Current entry for a folder, outside of React's render cycle. */
export function getRecipe(folderId: string): CachedRecipe | null {
  return state.recipes.find((recipe) => recipe.folderId === folderId) ?? null
}

/**
 * Tags for an entry whose body is known to be current.
 *
 * Both revalidation paths skip reading the body when the validator still
 * matches, which is what makes a quiet sync cheap — but it also means an entry
 * cached before tags existed would never gain any. The body is already on this
 * device, so filling them in costs a local read and no network at all. Bumping
 * the manifest version instead would throw the whole cache away and re-download
 * every recipe to learn what disk could have said for free.
 *
 * It reads straight from disk rather than through `getBody`, because this runs
 * once over the whole cookbook and has no business evicting the bodies the cook
 * is actually reading from the in-memory cache.
 */
function backfilledTags(prior: CachedRecipe, rootId: string, fileId: string): string[] {
  if (prior.tags !== undefined) return prior.tags
  const markdown = readBody(rootId, fileId)
  return markdown === null ? [] : parseTags(markdown)
}

/**
 * The order the cook put their photos in, without asking Drive or re-parsing.
 *
 * Once an entry has a media list, that list *is* the order — Drive's listing is
 * unordered, so the sequence can only come from the markdown. A cache written
 * before media existed has none, and reads it off the body already on disk, for
 * exactly the reason `backfilledTags` does.
 */
function mediaOrder(prior: CachedRecipe | undefined, rootId: string, fileId: string): string[] {
  if (prior?.media) return prior.media.map((entry) => entry.name)
  const markdown = readBody(rootId, fileId)
  return markdown === null ? [] : parseMedia(markdown)
}

/**
 * Reconciles what the recipe says it has against what the folder actually holds.
 *
 * Both directions are forgiving on purpose. A file the markdown never mentions
 * is still shown — that is what makes dropping a photo into the Drive folder
 * from a laptop work. A name with no file behind it is skipped rather than
 * rendered broken. The exception is a photo taken on this device and not yet
 * uploaded: Drive has never heard of it and its only copy is local, so it is
 * carried across untouched.
 */
function resolveMedia(files: DriveFileMeta[], order: string[], prior: RecipeMedia[] | undefined): RecipeMedia[] {
  const known = new Map((prior ?? []).map((entry) => [entry.name, entry]))
  const available = new Map<string, RecipeMedia>()
  for (const meta of files) {
    const name = meta.name ?? ''
    if (!name || !isMediaMime(meta.mimeType ?? '', name)) continue
    if (meta.thumbnailLink) thumbnailLinks.set(meta.id, meta.thumbnailLink)
    available.set(name, {
      name,
      fileId: meta.id,
      mimeType: meta.mimeType ?? '',
      validator: fileValidator(meta),
      size: Number(meta.size ?? 0),
      // What is already downloaded stays downloaded. Dropping this would make
      // every quiet sync look like every photo had gone stale.
      cached: known.get(name)?.cached,
    })
  }
  for (const entry of prior ?? []) {
    if (entry.pending && !available.has(entry.name)) available.set(entry.name, entry)
  }

  const media: RecipeMedia[] = []
  const placed = new Set<string>()
  for (const name of order) {
    const entry = available.get(name)
    if (!entry || placed.has(name)) continue
    placed.add(name)
    media.push(entry)
  }
  // Timestamped names sort chronologically, so an unlisted file lands where it
  // was taken rather than at a random spot.
  const extra = [...available.keys()].filter((name) => !placed.has(name)).sort()
  for (const name of extra) media.push(available.get(name)!)
  return media
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

/** Groups one flat listing back into the folders it came from. */
function indexByFolder(metas: DriveFileMeta[], folderIds: Set<string>) {
  const byFolder = new Map<string, DriveFileMeta[]>()
  for (const meta of metas) {
    const parent = meta.parents?.find((id) => folderIds.has(id))
    if (!parent) continue
    const existing = byFolder.get(parent)
    if (existing) existing.push(meta)
    else byFolder.set(parent, [meta])
  }
  return byFolder
}

function mediaNames(recipe: CachedRecipe): string[] {
  return (recipe.media ?? []).map((entry) => entry.name)
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
  const metas = await listFolderFiles(folders.map((folder) => folder.id))
  const filesByFolder = indexByFolder(metas, folderIds)

  const previous = new Map(state.recipes.map((recipe) => [recipe.folderId, recipe]))
  const resolved = new Map<string, CachedRecipe>()
  const stale: Array<{
    folderId: string
    slug: string
    meta: DriveFileMeta
    validator: string
    files: DriveFileMeta[]
  }> = []

  for (const folder of folders) {
    const files = filesByFolder.get(folder.id) ?? []
    const meta = pickRecipeFile(files)
    const prior = previous.get(folder.id)

    if (!meta) {
      // A recipe folder with no recipe.md yet. Still listed, and its photos are
      // still worth knowing about: this is how a folder someone filled with
      // pictures first shows up.
      resolved.set(folder.id, {
        folderId: folder.id,
        fileId: null,
        slug: folder.name,
        title: slugToTitle(folder.name),
        time: '',
        tags: [],
        media: resolveMedia(files, [], prior?.media),
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
      // Media is rebuilt too even though the body did not change, because a
      // photo added from another device adds a file without touching recipe.md.
      resolved.set(folder.id, {
        ...prior,
        slug: folder.name,
        tags: backfilledTags(prior, rootId, meta.id),
        media: resolveMedia(files, mediaOrder(prior, rootId, meta.id), prior.media),
      })
      continue
    }
    stale.push({ folderId: folder.id, slug: folder.name, meta, validator, files })
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
        tags: parseTags(markdown),
        media: resolveMedia(item.files, parseMedia(markdown), previous.get(item.folderId)?.media),
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
        tags: prior?.tags,
        media: resolveMedia(item.files, prior?.media?.map((entry) => entry.name) ?? [], prior?.media),
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

  // Photos are pruned by folder and name rather than by file id, because a
  // photo still waiting to upload has no id yet and must survive.
  pruneMedia(rootId, new Map(recipes.map((recipe) => [recipe.folderId, new Set(mediaNames(recipe))])))
  const mediaIds = new Set(recipes.flatMap((recipe) => (recipe.media ?? []).map((entry) => entry.fileId)))
  pruneThumbs(rootId, [...mediaIds].filter(Boolean))
  for (const fileId of [...thumbnailLinks.keys()]) {
    if (!mediaIds.has(fileId)) thumbnailLinks.delete(fileId)
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
 * Revalidates a single recipe, for when one is opened. Costs one small listing
 * request unless the body actually changed.
 *
 * Listing the folder rather than fetching the cached file id by hand is both
 * cheaper and more robust: it survives another device replacing `recipe.md`
 * instead of editing it — which used to need a second request to notice — and it
 * returns the folder's photos in the same breath.
 */
export async function revalidateRecipe(folderId: string): Promise<void> {
  const rootId = state.rootId
  if (!rootId) return
  const current = state.recipes.find((recipe) => recipe.folderId === folderId)
  const files = await listFolderFiles([folderId])
  const meta = pickRecipeFile(files)
  // A delete that landed while the request was in flight must not be undone.
  if (!state.recipes.some((recipe) => recipe.folderId === folderId)) return
  if (!meta) {
    if (current?.fileId) {
      upsert({ ...current, fileId: null, validator: '', media: resolveMedia(files, [], current.media) })
    }
    return
  }

  const validator = fileValidator(meta)
  const fresh =
    current &&
    current.fileId === meta.id &&
    !!validator &&
    current.validator === validator &&
    hasBody(rootId, meta.id)
  if (fresh) {
    // Nothing to download, but the folder listing may still have brought news:
    // a photo added elsewhere, or tags for an entry cached before they existed.
    const media = resolveMedia(files, mediaOrder(current, rootId, meta.id), current.media)
    if (current.tags === undefined || changedMedia(current.media, media)) {
      upsert({ ...current, tags: backfilledTags(current, rootId, meta.id), media })
    }
    return
  }

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
    tags: parseTags(markdown),
    media: resolveMedia(files, parseMedia(markdown), current?.media),
    validator,
  })
}

/** Cheap enough to run on every quiet revalidation, and it keeps one from re-rendering. */
function changedMedia(before: RecipeMedia[] | undefined, after: RecipeMedia[]): boolean {
  if (!before || before.length !== after.length) return true
  return before.some((entry, index) => {
    const next = after[index]
    return !next || next.name !== entry.name || next.fileId !== entry.fileId || next.validator !== entry.validator
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
  const tags = parseTags(text)
  const media = mediaForSave(existing, text)

  if (!existing) {
    const slug = titleToSlug(title) || 'recette'
    const created = await createDriveRecipe(rootId, slug, text)
    return commitSave({ folderId: created.folderId, slug, title, time, tags, media }, created.file, text)
  }

  const fileId = existing.fileId ?? (await findRecipeFile(existing.folderId))?.id ?? null
  const saved = fileId
    ? await updateFile(fileId, text)
    : await createRecipeFile(existing.folderId, text)
  return commitSave({ folderId: existing.folderId, slug: existing.slug, title, time, tags, media }, saved, text)
}

/**
 * The media list a save should keep, reordered to match what was just written.
 *
 * Only files this device already knows about are resolved here; anything else
 * the markdown mentions is left for the next sync to find on Drive. A photo
 * still waiting to upload is kept whether or not the text mentions it, because
 * this device holds its only copy.
 */
function mediaForSave(existing: RecipeSummary | null, text: string): RecipeMedia[] {
  // Read through the store rather than the caller's copy: a photo added moments
  // ago is in the store but not yet in the snapshot a screen is holding, and
  // saving from the stale copy would drop it back out of the manifest.
  const current = existing ? (getRecipe(existing.folderId)?.media ?? existing.media) : undefined
  const known = new Map((current ?? []).map((entry) => [entry.name, entry]))
  const written = parseMedia(text)
  const media = written.map((name) => known.get(name)).filter((entry): entry is RecipeMedia => !!entry)
  const placed = new Set(media.map((entry) => entry.name))
  for (const entry of known.values()) {
    if (entry.pending && !placed.has(entry.name)) media.push(entry)
  }
  return media
}

/**
 * Replaces a recipe's media list. The one way the media store writes back what
 * it learned from uploading, downloading or deleting a file.
 */
export function setRecipeMedia(folderId: string, media: RecipeMedia[]): void {
  const current = state.recipes.find((recipe) => recipe.folderId === folderId)
  if (!current) return
  upsert({ ...current, media })
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
  // Videos are the largest thing this app caches; waiting for the next sync to
  // reclaim the space would be careless.
  if (rootId) {
    clearMedia(rootId, folderId)
    for (const entry of recipe?.media ?? []) thumbnailLinks.delete(entry.fileId)
  }
  const syncedAt = state.syncedAt || Date.now()
  writeManifest(buildManifest(rootId, recipes, syncedAt))
  setState({ recipes, syncedAt })
}

function commitSave(
  base: { folderId: string; slug: string; title: string; time: string; tags: string[]; media: RecipeMedia[] },
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

/**
 * The cookbook's tag vocabulary. There is no registry of tags anywhere: a tag
 * exists exactly as long as a recipe carries it, which is what makes creating
 * one nothing more than typing it.
 */
export function useAllTags(): string[] {
  const snapshot = useSyncExternalStore(subscribe, getState)
  return useMemo(() => collectTags(snapshot.recipes.map((recipe) => recipe.tags)), [snapshot.recipes])
}
