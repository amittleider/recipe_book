export function parseTitle(markdown: string, fallback: string) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || slugToTitle(fallback)
}

export function parseTime(markdown: string) {
  return markdown.match(/\*\*Time:\*\*\s*([^\n*]+)/i)?.[1]?.trim() || ''
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
 * Deliberately just the title and the meta line. The editor's toolbar offers
 * every section the recipe does not have yet, so pre-writing `## Ingredients`
 * here would only hide those buttons on the one screen that needs them most.
 * The `**Time:**` key stays as-is: `parseTime` and every recipe on Drive
 * already speak it.
 */
export const NEW_RECIPE_TEMPLATE = `# Nouvelle recette

**Serves:** 4  **Time:** 30min
`
