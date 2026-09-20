import { collectMediaRefs } from './media'
import { parseTagList } from './tags'

export function parseTitle(markdown: string, fallback: string) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || slugToTitle(fallback)
}

export function parseTime(markdown: string) {
  return markdown.match(/\*\*Time:\*\*\s*([^\n*]+)/i)?.[1]?.trim() || ''
}

/**
 * Tags off the meta line, without building a whole document. The list screen
 * filters from the manifest, so this has to be as cheap as `parseTime`.
 */
export function parseTags(markdown: string): string[] {
  return parseTagList(markdown.match(/\*\*Tags:\*\*\s*([^\n*]+)/i)?.[1] ?? '')
}

export function slugToTitle(slug: string) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function titleToSlug(title: string) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The media a recipe references, in order, for the manifest.
 *
 * Like `parseTags`, this reads the raw markdown rather than building a document:
 * it runs over every recipe on every sync, and the list screen must never pay
 * for a parse it does not need. It deliberately collects image references from
 * anywhere in the file, not just the `## Photos` section, so a picture placed
 * beside a step is cached like any other.
 */
export function parseMedia(markdown: string): string[] {
  return collectMediaRefs(markdown)
}
