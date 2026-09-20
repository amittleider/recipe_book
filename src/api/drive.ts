import { File, UploadType } from 'expo-file-system'
import { AuthError, getAccessToken } from '../auth/googleAuth'
import type { DriveFolder } from '../types'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const RECIPE_FILE = 'recipe.md'

// Drive v3 dropped resource ETags, but a files.list response carries everything
// needed to decide whether a cached body is still current. Asking for these
// fields lets one query revalidate the whole cookbook.
const FILE_FIELDS = 'id,name,parents,modifiedTime,md5Checksum,size,version,mimeType'

// `thumbnailLink` is only worth asking for when listing, and only ever used
// immediately: Drive's thumbnail links expire after a few hours, so they are
// never written to the manifest.
const LIST_FIELDS = `${FILE_FIELDS},thumbnailLink`

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
  mimeType?: string
  /** Short-lived link to a Drive-generated thumbnail. Never persist it. */
  thumbnailLink?: string
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
 * Every file held by the given recipe folders, in a handful of requests rather
 * than one per folder, with the metadata needed to tell whether each cached
 * copy is stale.
 *
 * The query deliberately does not filter by name. A recipe folder holds its
 * `recipe.md` *and* its photos, and asking for both in the same response makes
 * media cost no extra round trip at all — the caller sorts them out by name and
 * mime type. Filtering per folder, or issuing a second query for media, would
 * reintroduce exactly the per-folder cost this batching exists to avoid.
 */
export async function listFolderFiles(folderIds: string[]): Promise<DriveFileMeta[]> {
  if (!folderIds.length) return []
  const batches = await Promise.all(
    chunk(folderIds, PARENT_BATCH).map((ids) => {
      const parents = ids.map((id) => `'${escapeDriveQuery(id)}' in parents`).join(' or ')
      const q = `(${parents}) and mimeType!='${FOLDER_MIME}' and trashed=false`
      return listAllPages<DriveFileMeta>({ q }, `files(${LIST_FIELDS})`)
    }),
  )
  return batches.flat()
}

/** The one `recipe.md` a folder should hold, newest first if it somehow holds several. */
export function pickRecipeFile(files: DriveFileMeta[]): DriveFileMeta | null {
  let best: DriveFileMeta | null = null
  for (const file of files) {
    if (file.name !== RECIPE_FILE) continue
    if (!best || (file.modifiedTime ?? '') > (best.modifiedTime ?? '')) best = file
  }
  return best
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

// --- media ------------------------------------------------------------------

/**
 * Bearer headers for the streaming transfer APIs.
 *
 * Photos and videos never pass through `request()`: a multi-megabyte body has no
 * business being held in JavaScript, so uploads and downloads are handed to
 * expo-file-system, which streams them natively. Those calls cannot reuse the
 * fetch wrapper, so they need the token on their own.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` }
}

/** The URL that serves a file's bytes, for a streaming download. */
export function mediaUrl(fileId: string): string {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
  return `${API}/files/${encodeURIComponent(fileId)}?${params}`
}

/**
 * A fresh thumbnail link for one file. Drive's links last on the order of hours,
 * so a cached tile that outlives its link re-asks for just this one field.
 */
export async function refreshThumbnailLink(fileId: string): Promise<string> {
  const params = new URLSearchParams({ fields: 'thumbnailLink', ...sharedDriveParams })
  const response = await request(`${API}/files/${encodeURIComponent(fileId)}?${params}`)
  return ((await response.json()) as { thumbnailLink?: string }).thumbnailLink ?? ''
}

/**
 * Uploads one photo or video into a recipe folder.
 *
 * This uses Drive's resumable protocol rather than the multipart upload the
 * markdown files use, for one reason: the bytes stay on disk. The session is
 * opened here, and expo-file-system streams the file into it natively, so a
 * 200 MB video costs no JavaScript memory and can report progress. The session
 * URI carries its own authorisation, which also means a long upload survives the
 * access token that started it expiring underneath it.
 */
export async function uploadMedia(
  folderId: string,
  file: File,
  name: string,
  mimeType: string,
  options: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<DriveFileMeta> {
  const params = new URLSearchParams({
    uploadType: 'resumable',
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  })
  const opened = await request(`${UPLOAD}/files?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name, parents: [folderId], mimeType }),
  })
  const session = opened.headers.get('location')
  if (!session) throw new DriveError(opened.status, 'Session de téléversement absente')

  const { onProgress, signal } = options
  // `upload` resolves for any completed response, including failures, so the
  // status has to be checked by hand to get the same errors as `request()`.
  const result = await file.upload(session, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType,
    headers: { 'Content-Type': mimeType },
    onProgress: onProgress ? ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes) : undefined,
    signal,
  })
  if (result.status === 401) throw new AuthError('Google session expired')
  if (result.status < 200 || result.status >= 300) {
    throw new DriveError(result.status, result.body.slice(0, 300))
  }

  const meta = JSON.parse(result.body) as DriveFileMeta
  if (!meta?.id) throw new DriveError(result.status, 'Réponse de téléversement inattendue')
  return meta
}

/**
 * Moves one file to Drive's trash.
 *
 * Trashing rather than permanently deleting matters for a shared cookbook: it is
 * recoverable from Drive for anyone who deletes the wrong thing, and every query
 * in this module already filters on `trashed=false`, so it disappears from each
 * device on its next revalidation regardless.
 */
export async function trashFile(fileId: string): Promise<void> {
  const params = new URLSearchParams({ fields: 'id', supportsAllDrives: 'true' })
  try {
    await request(`${API}/files/${encodeURIComponent(fileId)}?${params}`, {
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

/**
 * Deletes a recipe by moving its whole folder to Drive's trash, media included:
 * the photos live inside the folder, so they travel with it.
 */
export function trashRecipe(folderId: string): Promise<void> {
  return trashFile(folderId)
}

export async function createRecipe(rootId: string, slug: string, content: string) {
  const folder = await createFolder(slug, rootId)
  const file = await createTextFile(folder.id, RECIPE_FILE, content)
  return { folderId: folder.id, file }
}

export { AuthError }
