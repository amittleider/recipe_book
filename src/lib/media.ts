/**
 * Media as the recipe format sees it.
 *
 * A photo is referenced by its **file name**, written as ordinary markdown image
 * syntax, because that is the reference that keeps working: Drive file ids change
 * when a file is replaced from a laptop, and a `recipe.md` full of opaque ids
 * would stop being something a person can read. The file itself sits next to
 * `recipe.md` in the same folder, so the name is enough to find it.
 */

/** Section headings, in either language, that hold nothing but a photo list. */
const MEDIA_SECTIONS = ['photos', 'photo', 'images', 'image', 'medias', 'media']

/** The heading written back out. */
export const MEDIA_SECTION = 'Photos'

/**
 * `![alt](name)`, with markdown's two ways of spelling a name that has spaces in
 * it: wrapped in angle brackets, or percent-encoded.
 */
const MEDIA_REF = /!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]*))\s*\)/
const MEDIA_REF_LINE = new RegExp(`^${MEDIA_REF.source}$`)
const MEDIA_REF_ALL = new RegExp(MEDIA_REF.source, 'g')

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
}

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]),
)

export function isMediaSection(name: string): boolean {
  const key = name.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return MEDIA_SECTIONS.includes(key)
}

function decodeName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    // A stray `%` is not an escape; the name is whatever was written.
    return trimmed
  }
}

/** The file name a line references, or null if the line is not one image and nothing else. */
export function parseMediaRef(line: string): string | null {
  const match = line.trim().match(MEDIA_REF_LINE)
  if (!match) return null
  const name = decodeName(match[1] ?? match[2] ?? '')
  // A remote URL is somebody else's picture, not a file in this folder.
  return name && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(name) ? name : null
}

/** Every file this markdown references, in order, ignoring repeats. */
export function collectMediaRefs(markdown: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(MEDIA_REF_ALL)) {
    const name = decodeName(match[1] ?? match[2] ?? '')
    if (!name || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function formatMediaRef(name: string): string {
  return `![](${name.replace(/ /g, '%20')})`
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export function extensionFor(mimeType: string): string {
  const known = EXTENSIONS[mimeType.toLowerCase()]
  if (known) return known
  const subtype = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? ''
  return subtype ? `.${subtype.toLowerCase()}` : '.bin'
}

/** Best guess for a file Drive described vaguely, such as `application/octet-stream`. */
export function mimeForName(name: string): string {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? ''
}

function resolved(mimeType: string, name = ''): string {
  const mime = mimeType.toLowerCase()
  if (mime.startsWith('image/') || mime.startsWith('video/')) return mime
  return mimeForName(name)
}

export function isImageMime(mimeType: string, name = ''): boolean {
  return resolved(mimeType, name).startsWith('image/')
}

export function isVideoMime(mimeType: string, name = ''): boolean {
  return resolved(mimeType, name).startsWith('video/')
}

export function isMediaMime(mimeType: string, name = ''): boolean {
  const mime = resolved(mimeType, name)
  return mime.startsWith('image/') || mime.startsWith('video/')
}

/**
 * A name for a freshly captured file.
 *
 * The timestamp makes the folder read chronologically in Drive; the random
 * suffix is what stops two phones adding a photo in the same second from
 * choosing the same name. Drive allows duplicate names in one folder, so that
 * collision would not fail loudly — it would quietly point both references at
 * one file.
 */
export function mediaName(mimeType: string): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Math.random().toString(36).slice(2, 6)
  const kind = isVideoMime(mimeType) ? 'video' : 'photo'
  return `${kind}-${stamp}-${suffix}${extensionFor(mimeType)}`
}
