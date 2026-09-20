import { Directory, File, Paths } from 'expo-file-system'
import type { RecipeSummary } from '../types'

/**
 * On-disk mirror of the recipe folder.
 *
 * Recipe markdown is ordinary user content, not a credential, so it lives in
 * plain application-sandbox files rather than SecureStore (which is capped at a
 * couple of kilobytes per entry and reserved for secrets). Every call here is
 * synchronous and failure-tolerant: a cache that cannot be read or written must
 * degrade to a slower app, never a broken one.
 */

const CACHE_ROOT = 'recipe-cache'
const MANIFEST_NAME = 'index.json'
const BODIES_DIR = 'bodies'
const MEDIA_DIR = 'media'
const THUMBS_DIR = 'thumbs'
const MANIFEST_VERSION = 1

export type CachedRecipe = RecipeSummary & {
  /** Drive validator for the cached body; empty means "body is not trusted". */
  validator: string
}

export type RecipeManifest = {
  version: number
  rootId: string
  syncedAt: number
  recipes: CachedRecipe[]
}

/** Drive ids are already filename-safe, but never trust a remote id blindly. */
function safeName(id: string) {
  return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
}

/**
 * The same idea for a media file name, except the extension is kept: the image
 * and video players read the type off the path, so a cached `.mp4` that lost its
 * suffix would not play. Leading dots go, so no name can climb out of its folder.
 */
function safeFileName(name: string) {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || '_'
}

function rootDirectory(rootId: string) {
  return new Directory(Paths.document, CACHE_ROOT, safeName(rootId))
}

function bodiesDirectory(rootId: string) {
  return new Directory(rootDirectory(rootId), BODIES_DIR)
}

function bodyFile(rootId: string, fileId: string) {
  return new File(bodiesDirectory(rootId), `${safeName(fileId)}.md`)
}

/**
 * Media lives in directories *beside* `bodies/`, never inside it: `pruneBodies`
 * deletes every file it does not recognise, and a photo filed under `bodies/`
 * would be swept away on the next sync.
 */
function mediaDirectory(rootId: string, folderId: string) {
  return new Directory(rootDirectory(rootId), MEDIA_DIR, safeName(folderId))
}

function thumbsDirectory(rootId: string) {
  return new Directory(rootDirectory(rootId), THUMBS_DIR)
}

function ensureDirectory(directory: Directory) {
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
}

function writeText(file: File, contents: string) {
  ensureDirectory(file.parentDirectory)
  if (!file.exists) file.create({ intermediates: true })
  file.write(contents)
}

export function readManifest(rootId: string): RecipeManifest | null {
  try {
    const file = new File(rootDirectory(rootId), MANIFEST_NAME)
    if (!file.exists) return null
    const parsed = JSON.parse(file.textSync()) as RecipeManifest
    if (parsed.version !== MANIFEST_VERSION || parsed.rootId !== rootId) return null
    if (!Array.isArray(parsed.recipes)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeManifest(manifest: RecipeManifest) {
  try {
    writeText(new File(rootDirectory(manifest.rootId), MANIFEST_NAME), JSON.stringify(manifest))
  } catch {
    // A cookbook that cannot be cached still works; it is only slower.
  }
}

export function buildManifest(rootId: string, recipes: CachedRecipe[], syncedAt: number): RecipeManifest {
  return { version: MANIFEST_VERSION, rootId, syncedAt, recipes }
}

export function readBody(rootId: string, fileId: string): string | null {
  try {
    const file = bodyFile(rootId, fileId)
    return file.exists ? file.textSync() : null
  } catch {
    return null
  }
}

/** Cheap existence probe, so a sync can trust a validator without reading bodies. */
export function bodyExists(rootId: string, fileId: string): boolean {
  try {
    return bodyFile(rootId, fileId).exists
  } catch {
    return false
  }
}

export function writeBody(rootId: string, fileId: string, markdown: string) {
  try {
    writeText(bodyFile(rootId, fileId), markdown)
  } catch {
    // Ignored for the same reason as writeManifest.
  }
}

export function deleteBody(rootId: string, fileId: string) {
  try {
    const file = bodyFile(rootId, fileId)
    if (file.exists) file.delete()
  } catch {
    // Ignored.
  }
}

/** Removes body files for recipes that no longer exist in the folder. */
export function pruneBodies(rootId: string, keepFileIds: Iterable<string>) {
  try {
    const directory = bodiesDirectory(rootId)
    if (!directory.exists) return
    const keep = new Set(Array.from(keepFileIds, (fileId) => `${safeName(fileId)}.md`))
    for (const entry of directory.list()) {
      if (entry instanceof File && !keep.has(entry.name)) entry.delete()
    }
  } catch {
    // Ignored.
  }
}

// --- media ------------------------------------------------------------------

/** The local file for one recipe's photo, whether or not it has been downloaded. */
export function mediaFile(rootId: string, folderId: string, name: string): File {
  return new File(mediaDirectory(rootId, folderId), safeFileName(name))
}

export function mediaExists(rootId: string, folderId: string, name: string): boolean {
  try {
    return mediaFile(rootId, folderId, name).exists
  } catch {
    return false
  }
}

/** Where a download should land, with the directory guaranteed to exist. */
export function prepareMediaFile(rootId: string, folderId: string, name: string): File {
  const file = mediaFile(rootId, folderId, name)
  ensureDirectory(file.parentDirectory)
  return file
}

/** Files the cook just picked are copied in, so the picker's temporary copy can go. */
export function adoptMedia(rootId: string, folderId: string, name: string, source: File) {
  const destination = prepareMediaFile(rootId, folderId, name)
  if (destination.exists) destination.delete()
  source.copySync(destination)
}

export function deleteMedia(rootId: string, folderId: string, name: string) {
  try {
    const file = mediaFile(rootId, folderId, name)
    if (file.exists) file.delete()
  } catch {
    // Ignored.
  }
}

/** Moves a draft recipe's staged media under the folder Drive just gave it. */
export function moveMediaFolder(rootId: string, fromFolderId: string, toFolderId: string) {
  try {
    const from = mediaDirectory(rootId, fromFolderId)
    if (!from.exists) return
    const to = mediaDirectory(rootId, toFolderId)
    ensureDirectory(to)
    for (const entry of from.list()) {
      if (entry instanceof File) entry.moveSync(new File(to, entry.name))
    }
    from.delete()
  } catch {
    // Ignored: the bytes are still on Drive or still queued, only the cache moved.
  }
}

/** Drops every cached byte for one recipe, when the recipe itself goes. */
export function clearMedia(rootId: string, folderId: string) {
  try {
    const directory = mediaDirectory(rootId, folderId)
    if (directory.exists) directory.delete()
  } catch {
    // Ignored.
  }
}

export function thumbFile(rootId: string, fileId: string): File {
  return new File(thumbsDirectory(rootId), `${safeName(fileId)}.img`)
}

export function thumbExists(rootId: string, fileId: string): boolean {
  try {
    return thumbFile(rootId, fileId).exists
  } catch {
    return false
  }
}

export function prepareThumbFile(rootId: string, fileId: string): File {
  const file = thumbFile(rootId, fileId)
  ensureDirectory(file.parentDirectory)
  return file
}

/**
 * Drops cached media for recipes and files the cookbook no longer has.
 *
 * `keep` maps a folder id to the names it still holds. A name that is in the
 * map but not yet on Drive — a photo taken offline — is kept like any other:
 * its local copy is the *only* copy, so pruning it would lose the picture.
 */
export function pruneMedia(rootId: string, keep: Map<string, Set<string>>) {
  try {
    const directory = new Directory(rootDirectory(rootId), MEDIA_DIR)
    if (!directory.exists) return
    const wanted = new Map(
      Array.from(keep, ([folderId, names]) => [
        safeName(folderId),
        new Set(Array.from(names, safeFileName)),
      ]),
    )
    for (const entry of directory.list()) {
      if (!(entry instanceof Directory)) continue
      const names = wanted.get(entry.name)
      if (!names) {
        entry.delete()
        continue
      }
      for (const child of entry.list()) {
        if (child instanceof File && !names.has(child.name)) child.delete()
      }
    }
  } catch {
    // Ignored.
  }
}

export function pruneThumbs(rootId: string, keepFileIds: Iterable<string>) {
  try {
    const directory = thumbsDirectory(rootId)
    if (!directory.exists) return
    const keep = new Set(Array.from(keepFileIds, (fileId) => `${safeName(fileId)}.img`))
    for (const entry of directory.list()) {
      if (entry instanceof File && !keep.has(entry.name)) entry.delete()
    }
  } catch {
    // Ignored.
  }
}

export function clearCache(rootId: string) {
  try {
    const directory = rootDirectory(rootId)
    if (directory.exists) directory.delete()
  } catch {
    // Ignored.
  }
}

export function clearAllCaches() {
  try {
    const directory = new Directory(Paths.document, CACHE_ROOT)
    if (directory.exists) directory.delete()
  } catch {
    // Ignored.
  }
}

/** Drops caches for folders the user is no longer pointed at. */
export function dropOtherRoots(rootId: string) {
  try {
    const directory = new Directory(Paths.document, CACHE_ROOT)
    if (!directory.exists) return
    const keep = safeName(rootId)
    for (const entry of directory.list()) {
      if (entry instanceof Directory && entry.name !== keep) entry.delete()
    }
  } catch {
    // Ignored.
  }
}
