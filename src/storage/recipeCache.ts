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

function rootDirectory(rootId: string) {
  return new Directory(Paths.document, CACHE_ROOT, safeName(rootId))
}

function bodiesDirectory(rootId: string) {
  return new Directory(rootDirectory(rootId), BODIES_DIR)
}

function bodyFile(rootId: string, fileId: string) {
  return new File(bodiesDirectory(rootId), `${safeName(fileId)}.md`)
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
