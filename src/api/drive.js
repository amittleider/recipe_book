// Thin wrapper over the Google Drive REST API v3.
//
// Scope note: with `drive.file` the app only ever sees folders/files it created
// or that were explicitly opened through it. So the "folder picker" lists the
// folders this app already has access to and lets the user create a new one;
// the created folder becomes the recipe root.

import { ensureToken } from '../auth/googleAuth.js'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class AuthError extends Error {}

async function authHeader() {
  const token = await ensureToken({ interactive: false })
  if (!token) throw new AuthError('No token')
  return { Authorization: `Bearer ${token}` }
}

async function req(url, options = {}) {
  const headers = { ...(await authHeader()), ...(options.headers || {}) }
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`Drive auth failed (${res.status})`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res
}

// --- Folders --------------------------------------------------------

// Folders the app can see (drive.file: ones it created/opened).
export async function listAccessibleFolders() {
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and trashed=false`
  )
  const url = `${API}/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=100`
  const res = await req(url)
  const data = await res.json()
  return data.files || []
}

export async function createFolder(name, parentId) {
  const metadata = { name, mimeType: FOLDER_MIME }
  if (parentId) metadata.parents = [parentId]
  const res = await req(`${API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  return res.json()
}

// --- Recipes --------------------------------------------------------

// List recipe subfolders of the root folder.
export async function listRecipeFolders(rootId) {
  const q = encodeURIComponent(
    `'${rootId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`
  )
  const url = `${API}/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=200`
  const res = await req(url)
  const data = await res.json()
  return data.files || []
}

// Find recipe.md inside a recipe folder. Returns its file id or null.
export async function findRecipeFile(folderId) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='recipe.md' and trashed=false`
  )
  const url = `${API}/files?q=${q}&fields=files(id,name)`
  const res = await req(url)
  const data = await res.json()
  return data.files?.[0]?.id || null
}

export async function readFile(fileId) {
  const res = await req(`${API}/files/${fileId}?alt=media`)
  return res.text()
}

// Multipart create of a text file inside a folder. Returns the new file id.
async function createTextFile(folderId, name, content) {
  const boundary = 'nr_boundary_' + Math.random().toString(36).slice(2)
  const metadata = { name, parents: [folderId] }
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/markdown\r\n\r\n' +
    content +
    `\r\n--${boundary}--`
  const res = await req(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await res.json()
  return data.id
}

// Create recipe.md inside an already-existing recipe folder. Returns file id.
export async function createRecipeFile(folderId, content) {
  return createTextFile(folderId, 'recipe.md', content)
}

export async function updateFile(fileId, content) {
  await req(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  })
}

// Create a new recipe: folder (named with the slug) + recipe.md inside it.
// Returns { id: folderId, fileId }.
export async function createRecipe(rootId, slug, content) {
  const folder = await createFolder(slug, rootId)
  const fileId = await createTextFile(folder.id, 'recipe.md', content)
  return { id: folder.id, fileId }
}
