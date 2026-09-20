import { useSyncExternalStore } from 'react'
import { File } from 'expo-file-system'
import {
  AuthError,
  authHeaders,
  fileValidator,
  mediaUrl,
  refreshThumbnailLink,
  trashFile,
  uploadMedia,
} from '../api/drive'
import { getRecipe, getRecipes, getRootId, getThumbnailLink, setRecipeMedia } from './recipeStore'
import { isImageMime, mediaName } from '../lib/media'
import {
  adoptMedia,
  clearMedia,
  mediaExists,
  mediaFile,
  moveMediaFolder,
  prepareMediaFile,
  prepareThumbFile,
  thumbExists,
  thumbFile,
} from '../storage/recipeCache'
import type { RecipeMedia } from '../types'

/**
 * The bytes behind a recipe's photos.
 *
 * `recipeStore` owns what media a recipe *has* — that list lives in the manifest
 * alongside the title and the tags. This owns what is actually on the device and
 * what is moving over the network. The two have completely different lifetimes:
 * the list is small, synchronous and always present, while a 200 MB video is
 * none of those things.
 *
 * Transfers live here rather than in a screen because `App.tsx` unmounts a
 * screen the moment the cook navigates away, and an upload started in the recipe
 * view has to survive going back to the list.
 */

/** Parallel transfers. Photos are small; a handful saturates a phone link. */
const TRANSFER_CONCURRENCY = 3

/** Thumbnails Drive renders for us, asked for a little larger than the default. */
const THUMB_SIZE = 400

/** Past this, a missing thumbnail is not worth standing in for with the original. */
const THUMB_FALLBACK_LIMIT = 3 * 1024 * 1024

export type TransferPhase = 'idle' | 'uploading' | 'downloading' | 'failed'
export type Transfer = { phase: TransferPhase; progress: number; error: string }

const IDLE: Transfer = { phase: 'idle', progress: 0, error: '' }

const transfers = new Map<string, Transfer>()
/**
 * Two audiences, deliberately.
 *
 * Almost every component only needs to know when a file arrived or a transfer
 * changed state, and re-rendering it is not free: resolving a tile's path is a
 * synchronous stat. An upload reports progress many times a second, so the
 * progress bar gets its own subscription and nothing else pays for it.
 */
const listeners = new Set<() => void>()
const progressListeners = new Set<() => void>()
/** Media staged for recipes that do not exist on Drive yet. */
const drafts = new Map<string, RecipeMedia[]>()
const queue: string[] = []
const running = new Set<string>()
let version = 0
let progressVersion = 0

/** Drive ids and file names never contain a space, so one separates them safely. */
function key(folderId: string, name: string) {
  return `${folderId} ${name}`
}

function split(value: string): [string, string] {
  const at = value.indexOf(' ')
  return [value.slice(0, at), value.slice(at + 1)]
}

function notify() {
  version += 1
  progressVersion += 1
  for (const listener of listeners) listener()
  for (const listener of progressListeners) listener()
}

function notifyProgress() {
  progressVersion += 1
  for (const listener of progressListeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function subscribeProgress(listener: () => void) {
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}

function getVersion() {
  return version
}

function getProgressVersion() {
  return progressVersion
}

/**
 * Bumped whenever a file lands or a transfer starts, finishes or fails.
 *
 * Components read their file paths synchronously and use this only to know when
 * to look again, which keeps a screen full of tiles from allocating a snapshot
 * object per tile on every frame.
 */
export function useMediaVersion(): number {
  return useSyncExternalStore(subscribe, getVersion)
}

/** The same, plus every progress tick. Only a progress bar should want this. */
export function useTransferVersion(): number {
  return useSyncExternalStore(subscribeProgress, getProgressVersion)
}

function setTransfer(id: string, transfer: Transfer | null) {
  const before = transfers.get(id)
  if (transfer) transfers.set(id, transfer)
  else transfers.delete(id)
  // A moving progress bar is not news to anything but the bar itself.
  if (before && transfer && before.phase === transfer.phase && before.error === transfer.error) {
    notifyProgress()
    return
  }
  notify()
}

export function getTransfer(folderId: string, name: string): Transfer {
  return transfers.get(key(folderId, name)) ?? IDLE
}

// --- drafts -----------------------------------------------------------------

/** A stand-in folder id for a recipe the cook has started but not yet saved. */
export function newDraftId(): string {
  return `draft:${Math.random().toString(36).slice(2, 10)}`
}

export function isDraftId(folderId: string): boolean {
  return folderId.startsWith('draft:')
}

// --- reading ----------------------------------------------------------------

/** The media a folder holds, whether it is a saved recipe or an unsaved draft. */
export function getMedia(folderId: string): RecipeMedia[] {
  return getRecipe(folderId)?.media ?? drafts.get(folderId) ?? []
}

function putMedia(folderId: string, media: RecipeMedia[]) {
  if (isDraftId(folderId)) {
    drafts.set(folderId, media)
    notify()
    return
  }
  setRecipeMedia(folderId, media)
}

function replaceEntry(folderId: string, name: string, change: (entry: RecipeMedia) => RecipeMedia) {
  const media = getMedia(folderId)
  if (!media.some((entry) => entry.name === name)) return
  putMedia(
    folderId,
    media.map((entry) => (entry.name === name ? change(entry) : entry)),
  )
}

/** The local file for a photo, if its bytes are on this device. Synchronous. */
export function mediaUri(folderId: string, entry: RecipeMedia): string | null {
  const rootId = getRootId()
  if (!rootId || !mediaExists(rootId, folderId, entry.name)) return null
  // A file replaced from another device leaves the old bytes here; they stay on
  // screen while the new ones download rather than blanking the gallery.
  return mediaFile(rootId, folderId, entry.name).uri
}

export function thumbUri(entry: RecipeMedia): string | null {
  const rootId = getRootId()
  if (!rootId || !entry.fileId) return null
  return thumbExists(rootId, entry.fileId) ? thumbFile(rootId, entry.fileId).uri : null
}

function isStale(rootId: string, folderId: string, entry: RecipeMedia): boolean {
  if (!mediaExists(rootId, folderId, entry.name)) return true
  return !!entry.validator && entry.cached !== entry.validator
}

/**
 * Downloads a photo's bytes if they are missing or out of date.
 *
 * Safe to call from an effect on every render: a file already in flight is
 * dropped, and a file already on disk costs one synchronous existence check.
 */
export async function ensureMedia(folderId: string, entry: RecipeMedia): Promise<void> {
  const rootId = getRootId()
  // A photo with no file id exists only here; there is nothing to fetch.
  if (!rootId || !entry.fileId) return
  if (!isStale(rootId, folderId, entry)) return

  const id = key(folderId, entry.name)
  if (running.has(id)) return
  running.add(id)
  setTransfer(id, { phase: 'downloading', progress: 0, error: '' })
  try {
    const headers = await authHeaders()
    await File.downloadFileAsync(mediaUrl(entry.fileId), prepareMediaFile(rootId, folderId, entry.name), {
      headers,
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) {
          setTransfer(id, { phase: 'downloading', progress: bytesWritten / totalBytes, error: '' })
        }
      },
    })
    replaceEntry(folderId, entry.name, (current) => ({ ...current, cached: current.validator }))
    setTransfer(id, null)
  } catch (caught) {
    if (caught instanceof AuthError) {
      setTransfer(id, null)
      throw caught
    }
    setTransfer(id, { phase: 'failed', progress: 0, error: message(caught, 'Téléchargement impossible') })
  } finally {
    running.delete(id)
    // Downloads and uploads share one budget, so finishing one may have made
    // room for the other.
    pump()
  }
}

/**
 * Drive's thumbnail links end in a size hint. Asking for a larger one keeps a
 * tile from looking soft on a modern screen; anything unfamiliar is left alone.
 */
function sized(link: string): string {
  return link.replace(/=s\d+(-c)?$/, `=s${THUMB_SIZE}`)
}

/** Fetches the small tile for a photo. Cheap enough to do for a whole list. */
export async function ensureThumb(entry: RecipeMedia): Promise<void> {
  const rootId = getRootId()
  if (!rootId || !entry.fileId || thumbExists(rootId, entry.fileId)) return

  const id = `thumb ${entry.fileId}`
  if (running.has(id)) return
  running.add(id)
  try {
    const link = getThumbnailLink(entry.fileId) || (await refreshThumbnailLink(entry.fileId))
    const headers = await authHeaders()
    const destination = prepareThumbFile(rootId, entry.fileId)
    if (link) {
      await File.downloadFileAsync(sized(link), destination, { headers, idempotent: true })
    } else if (isImageMime(entry.mimeType, entry.name) && entry.size > 0 && entry.size <= THUMB_FALLBACK_LIMIT) {
      // Drive renders a thumbnail for everything it understands. When it has
      // not, a small enough original stands in rather than showing a blank.
      await File.downloadFileAsync(mediaUrl(entry.fileId), destination, { headers, idempotent: true })
    } else {
      return
    }
    notify()
  } catch {
    // A tile that will not load is a placeholder, never an error the cook sees.
  } finally {
    running.delete(id)
    pump()
  }
}

// --- writing ----------------------------------------------------------------

export type PickedAsset = { uri: string; mimeType: string }

/**
 * Takes captured or picked files into the recipe, bytes first.
 *
 * The file is copied to the place it will live for good *before* anything
 * touches the network, and the reference is its name rather than a Drive id, so
 * nothing has to be rewritten once the upload lands. That is what lets the photo
 * appear the instant it is taken, and what lets it be taken at all in a kitchen
 * with no signal.
 */
export function addMedia(folderId: string, assets: PickedAsset[]): RecipeMedia[] {
  const rootId = getRootId()
  if (!rootId) return []

  const added: RecipeMedia[] = []
  for (const asset of assets) {
    const name = mediaName(asset.mimeType)
    try {
      adoptMedia(rootId, folderId, name, new File(asset.uri))
    } catch {
      continue
    }
    added.push({
      name,
      fileId: '',
      mimeType: asset.mimeType,
      validator: '',
      size: mediaFile(rootId, folderId, name).size,
      pending: true,
    })
  }
  if (!added.length) return []

  putMedia(folderId, [...getMedia(folderId), ...added])
  // A draft has no folder on Drive to upload into. Its turn comes at the save.
  if (!isDraftId(folderId)) {
    for (const entry of added) enqueue(folderId, entry.name)
    pump()
  }
  return added
}

/** Removes a photo from the recipe, Drive first, for the reason `deleteRecipe` is. */
export async function removeMedia(folderId: string, name: string): Promise<void> {
  const entry = getMedia(folderId).find((item) => item.name === name)
  if (!entry) return
  if (entry.fileId) await trashFile(entry.fileId)

  const id = key(folderId, name)
  const position = queue.indexOf(id)
  if (position !== -1) queue.splice(position, 1)
  setTransfer(id, null)
  putMedia(
    folderId,
    getMedia(folderId).filter((item) => item.name !== name),
  )

  const rootId = getRootId()
  if (!rootId) return
  try {
    const file = mediaFile(rootId, folderId, name)
    if (file.exists) file.delete()
  } catch {
    // The cache keeps a stray file until the next prune; the recipe is right.
  }
}

/** Reorders, which is also how the cover is chosen: the cover is the first one. */
export function reorderMedia(folderId: string, names: string[]): void {
  const media = getMedia(folderId)
  const byName = new Map(media.map((entry) => [entry.name, entry]))
  const ordered = names.map((name) => byName.get(name)).filter((entry): entry is RecipeMedia => !!entry)
  for (const entry of media) {
    if (!names.includes(entry.name)) ordered.push(entry)
  }
  putMedia(folderId, ordered)
}

/**
 * Hands a draft's staged photos to the folder Drive has just created for it.
 * Called right after the first save of a new recipe.
 */
export function adoptDraft(draftId: string, folderId: string): void {
  const staged = drafts.get(draftId)
  drafts.delete(draftId)
  if (!staged?.length) return

  const rootId = getRootId()
  if (rootId) moveMediaFolder(rootId, draftId, folderId)

  const existing = getMedia(folderId)
  const known = new Set(existing.map((entry) => entry.name))
  const media = [...existing, ...staged.filter((entry) => !known.has(entry.name))]
  setRecipeMedia(folderId, media)
  for (const entry of media) {
    if (entry.pending) enqueue(folderId, entry.name)
  }
  pump()
}

/** Forgets everything on sign-out, alongside `reset` in the recipe store. */
export function resetMedia(): void {
  for (const draftId of drafts.keys()) drafts.delete(draftId)
  transfers.clear()
  queue.length = 0
  notify()
}

/** Throws away a draft the cook abandoned, bytes included. */
export function discardDraft(draftId: string): void {
  if (!drafts.delete(draftId)) return
  const rootId = getRootId()
  if (rootId) clearMedia(rootId, draftId)
  notify()
}

// --- uploads ----------------------------------------------------------------

function enqueue(folderId: string, name: string) {
  const id = key(folderId, name)
  if (queue.includes(id) || running.has(id)) return
  queue.push(id)
  setTransfer(id, { phase: 'uploading', progress: 0, error: '' })
}

export function retryUpload(folderId: string, name: string): void {
  enqueue(folderId, name)
  pump()
}

/**
 * Restarts anything still waiting. Called when the app comes back to the
 * foreground and after each sync, which between them cover the case that
 * matters: a photo taken with no signal, and the signal coming back later.
 */
export function flushUploads(): void {
  for (const recipe of getRecipes()) {
    for (const entry of recipe.media ?? []) {
      if (entry.pending) enqueue(recipe.folderId, entry.name)
    }
  }
  pump()
}

function pump() {
  while (running.size < TRANSFER_CONCURRENCY) {
    const id = queue.shift()
    if (!id) return
    if (running.has(id)) continue
    void run(id)
  }
}

async function run(id: string) {
  const [folderId, name] = split(id)
  const rootId = getRootId()
  const entry = getMedia(folderId).find((item) => item.name === name)
  if (!entry?.pending || !rootId || isDraftId(folderId)) {
    setTransfer(id, null)
    return
  }

  running.add(id)
  setTransfer(id, { phase: 'uploading', progress: 0, error: '' })
  try {
    const file = mediaFile(rootId, folderId, name)
    if (!file.exists) throw new Error('Fichier introuvable')
    const meta = await uploadMedia(folderId, file, name, entry.mimeType, {
      onProgress: (sent, total) => {
        if (total > 0) setTransfer(id, { phase: 'uploading', progress: sent / total, error: '' })
      },
    })
    const validator = fileValidator(meta)
    replaceEntry(folderId, name, (current) => ({
      ...current,
      fileId: meta.id,
      validator,
      // The bytes on disk are the ones just uploaded, so they are current by
      // definition. This is why a device never re-downloads what it just wrote.
      cached: validator,
      size: Number(meta.size ?? current.size),
      mimeType: meta.mimeType || current.mimeType,
      pending: undefined,
    }))
    setTransfer(id, null)
  } catch (caught) {
    // The local copy stays exactly where it is: it is still the only copy, and
    // the cook can try again. Nothing is dropped on a failed upload.
    setTransfer(id, { phase: 'failed', progress: 0, error: message(caught, 'Envoi impossible') })
  } finally {
    running.delete(id)
    pump()
  }
}

function message(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback
}
