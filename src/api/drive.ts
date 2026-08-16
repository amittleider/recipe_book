import { AuthError, getAccessToken } from '../auth/googleAuth'
import type { DriveFolder } from '../types'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const RECIPE_FILE = 'recipe.md'

// Drive v3 dropped resource ETags, but a files.list response carries everything
// needed to decide whether a cached body is still current. Asking for these
// fields lets one query revalidate the whole cookbook.
const FILE_FIELDS = 'id,name,parents,modifiedTime,md5Checksum,size,version'

// Number of parent folders folded into a single `... in parents or ...` query.
// Drive rejects very long queries, and 40 keeps a typical cookbook at one request.
const PARENT_BATCH = 40

const sharedDriveParams = {
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true',
}

export type DriveFileMeta = {
  id: string
  name?: string
  parents?: string[]
  modifiedTime?: string
  md5Checksum?: string
  size?: string
  version?: string
}

/** A failed Drive call, carrying the status so callers can tolerate specific ones. */
export class DriveError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Google Drive (${status}): ${detail}`)
    this.name = 'DriveError'
  }
}

async function request(url: string, options: RequestInit = {}) {
  const accessToken = await getAccessToken()
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {}),
    },
  })
  if (response.status === 401) throw new AuthError('Google session expired')
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new DriveError(response.status, detail)
  }
  return response
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/**
 * A cache key for one Drive file. `md5Checksum` is exact and is present for the
 * uploaded markdown files this app writes; the modified time is the fallback for
 * anything Drive refuses to checksum. An empty string means "unknown", which
 * callers must treat as "always refetch".
 */
export function fileValidator(meta: DriveFileMeta | null | undefined) {
  if (!meta) return ''
  if (meta.md5Checksum) return `md5:${meta.md5Checksum}`
  if (meta.modifiedTime) return `mtime:${meta.modifiedTime}:${meta.size ?? ''}`
  if (meta.version) return `ver:${meta.version}`
  return ''
}

async function listAllPages<T>(params: Record<string, string>, fields: string): Promise<T[]> {
  const collected: T[] = []
  let pageToken: string | undefined
  do {
    const search = new URLSearchParams({
      ...params,
      ...sharedDriveParams,
      fields: `nextPageToken,${fields}`,
      pageSize: '1000',
      spaces: 'drive',
    })
    if (pageToken) search.set('pageToken', pageToken)
    const response = await request(`${API}/files?${search}`)
    const data = (await response.json()) as { files?: T[]; nextPageToken?: string }
    if (data.files) collected.push(...data.files)
    pageToken = data.nextPageToken
  } while (pageToken)
  return collected
}

export async function listFolders(search = ''): Promise<DriveFolder[]> {
  const clauses = [`mimeType='${FOLDER_MIME}'`, 'trashed=false']
  if (search.trim()) clauses.push(`name contains '${escapeDriveQuery(search.trim())}'`)
  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '100',
    spaces: 'drive',
    ...sharedDriveParams,
  })
  const response = await request(`${API}/files?${params}`)
  return ((await response.json()) as { files?: DriveFolder[] }).files ?? []
}

export async function createFolder(name: string, parentId?: string): Promise<DriveFolder> {
  const metadata: { name: string; mimeType: string; parents?: string[] } = {
    name,
    mimeType: FOLDER_MIME,
  }
  if (parentId) metadata.parents = [parentId]
  const response = await request(`${API}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  return response.json() as Promise<DriveFolder>
}

export function listRecipeFolders(rootId: string): Promise<DriveFolder[]> {
  const q = `'${escapeDriveQuery(rootId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`
  return listAllPages<DriveFolder>({ q, orderBy: 'name' }, 'files(id,name)')
}

/**
 * Finds every `recipe.md` under the given recipe folders in a handful of
 * requests rather than one per folder, and returns the metadata needed to tell
 * whether each cached body is stale.
 */
export async function listRecipeFiles(folderIds: string[]): Promise<DriveFileMeta[]> {
  if (!folderIds.length) return []
  const batches = await Promise.all(
    chunk(folderIds, PARENT_BATCH).map((ids) => {
      const parents = ids.map((id) => `'${escapeDriveQuery(id)}' in parents`).join(' or ')
      const q = `(${parents}) and name='${RECIPE_FILE}' and trashed=false`
      return listAllPages<DriveFileMeta>({ q }, `files(${FILE_FIELDS})`)
    }),
  )
  return batches.flat()
}

export async function findRecipeFile(folderId: string): Promise<DriveFileMeta | null> {
  const q = `'${escapeDriveQuery(folderId)}' in parents and name='${RECIPE_FILE}' and trashed=false`
  const params = new URLSearchParams({
    q,
    fields: `files(${FILE_FIELDS})`,
    pageSize: '1',
    ...sharedDriveParams,
  })
  const response = await request(`${API}/files?${params}`)
  const data = (await response.json()) as { files?: DriveFileMeta[] }
  return data.files?.[0] ?? null
}

export async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, ...sharedDriveParams })
  const response = await request(`${API}/files/${encodeURIComponent(fileId)}?${params}`)
  return response.json() as Promise<DriveFileMeta>
}

export async function readFile(fileId: string) {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
  const response = await request(`${API}/files/${encodeURIComponent(fileId)}?${params}`)
  return response.text()
}

async function createTextFile(folderId: string, name: string, content: string) {
  const boundary = `nr_boundary_${Math.random().toString(36).slice(2)}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, parents: [folderId] })}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  })
  const response = await request(`${UPLOAD}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return response.json() as Promise<DriveFileMeta>
}

export function createRecipeFile(folderId: string, content: string) {
  return createTextFile(folderId, RECIPE_FILE, content)
}

export async function updateFile(fileId: string, content: string): Promise<DriveFileMeta> {
  const params = new URLSearchParams({
    uploadType: 'media',
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  })
  const response = await request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  })
  return response.json() as Promise<DriveFileMeta>
}

/**
 * Deletes a recipe by moving its whole folder to Drive's trash.
 *
 * Trashing rather than permanently deleting matters for a shared cookbook: the
 * folder is recoverable from Drive for anyone who deletes the wrong recipe, and
 * every query in this module already filters on `trashed=false`, so the recipe
 * disappears from each device on its next revalidation regardless.
 */
export async function trashRecipe(folderId: string): Promise<void> {
  const params = new URLSearchParams({ fields: 'id', supportsAllDrives: 'true' })
  try {
    await request(`${API}/files/${encodeURIComponent(folderId)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    })
  } catch (caught) {
    // Someone else already deleted it. The caller's intent is satisfied.
    if (caught instanceof DriveError && caught.status === 404) return
    throw caught
  }
}

export async function createRecipe(rootId: string, slug: string, content: string) {
  const folder = await createFolder(slug, rootId)
  const file = await createTextFile(folder.id, RECIPE_FILE, content)
  return { folderId: folder.id, file }
}

export { AuthError }
