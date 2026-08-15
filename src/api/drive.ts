import { AuthError, getAccessToken } from '../auth/googleAuth'
import type { DriveFolder } from '../types'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

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
    throw new Error(`Google Drive (${response.status}): ${detail}`)
  }
  return response
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
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
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
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
  const response = await request(`${API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  return response.json() as Promise<DriveFolder>
}

export async function listRecipeFolders(rootId: string): Promise<DriveFolder[]> {
  const q = `'${escapeDriveQuery(rootId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '200',
  })
  const response = await request(`${API}/files?${params}`)
  return ((await response.json()) as { files?: DriveFolder[] }).files ?? []
}

export async function findRecipeFile(folderId: string): Promise<string | null> {
  const q = `'${escapeDriveQuery(folderId)}' in parents and name='recipe.md' and trashed=false`
  const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })
  const response = await request(`${API}/files?${params}`)
  const data = (await response.json()) as { files?: Array<{ id: string }> }
  return data.files?.[0]?.id ?? null
}

export async function readFile(fileId: string) {
  const response = await request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)
  return response.text()
}

async function createTextFile(folderId: string, name: string, content: string) {
  const boundary = `nr_boundary_${Math.random().toString(36).slice(2)}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, parents: [folderId] })}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  const response = await request(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return ((await response.json()) as { id: string }).id
}

export function createRecipeFile(folderId: string, content: string) {
  return createTextFile(folderId, 'recipe.md', content)
}

export async function updateFile(fileId: string, content: string) {
  await request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  })
}

export async function createRecipe(rootId: string, slug: string, content: string) {
  const folder = await createFolder(slug, rootId)
  const fileId = await createTextFile(folder.id, 'recipe.md', content)
  return { id: folder.id, fileId }
}

export { AuthError }
