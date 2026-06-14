import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

export function renderMarkdown(md) {
  return marked.parse(md || '')
}

// Pull a display name from the first H1 heading; fall back to the slug.
export function parseTitle(md, fallback) {
  const m = (md || '').match(/^#\s+(.+)$/m)
  if (m) return m[1].trim()
  return slugToTitle(fallback)
}

// Pull "Time" from a "**Serves:** 4  **Time:** 1h 20min" style line.
export function parseTime(md) {
  const m = (md || '').match(/\*\*Time:\*\*\s*([^\n*]+)/i)
  return m ? m[1].trim() : ''
}

export function slugToTitle(slug) {
  return (slug || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function titleToSlug(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const NEW_RECIPE_TEMPLATE = `# Nouvelle recette

**Serves:** 4  **Time:** 30min

---

## Ingredients

-

## Method

1.

---

*Note.*
`
