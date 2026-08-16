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
