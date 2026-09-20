/**
 * What a tag is.
 *
 * Tags ride inside `recipe.md` on the meta line, as `**Tags:** Dessert, Indien`.
 * That storage decides the rules here: a comma separates tags, and the meta
 * grammar in `recipeDocument.ts` captures a value as `[^*]*`, so an asterisk
 * inside a tag would silently truncate the rest of the line the next time the
 * recipe is parsed. Both characters are therefore not escaped but removed.
 *
 * This module deliberately imports nothing, so the parser, the document model
 * and the screens can all depend on it without a cycle.
 */

/**
 * The key two tags are compared by. "Dessert", "dessert" and "DESSERT" are one
 * tag; so are "Épicé" and "epice". The cook's own spelling is what gets shown,
 * but never what gets compared.
 */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** A tag as it may be written to Drive: one line, no separators, no markdown. */
export function cleanTag(raw: string): string {
  return raw.replace(/[*,\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function parseTagList(value: string): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const tag = cleanTag(part)
    if (!tag) continue
    const key = tagKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

export function formatTagList(tags: string[]): string {
  return tags.join(', ')
}

export function hasTag(tags: string[], tag: string): boolean {
  const key = tagKey(tag)
  return tags.some((entry) => tagKey(entry) === key)
}

/**
 * The cookbook's own spelling of a tag, if it already knows one.
 *
 * Typing "dessert" where everyone else wrote "Dessert" should join that tag,
 * not open a second one beside it that only differs by a capital letter.
 */
export function resolveTag(vocabulary: string[], raw: string): string {
  const tag = cleanTag(raw)
  const key = tagKey(tag)
  return vocabulary.find((entry) => tagKey(entry) === key) ?? tag
}

/** Adding a tag the recipe already carries is a no-op, whatever its casing. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = cleanTag(raw)
  if (!tag || hasTag(tags, tag)) return tags
  return [...tags, tag]
}

export function removeTag(tags: string[], tag: string): string[] {
  const key = tagKey(tag)
  return tags.filter((entry) => tagKey(entry) !== key)
}

/**
 * The cookbook's whole vocabulary, one entry per tag however it was spelled.
 *
 * Where spellings disagree the most common one wins, so a single mis-typed
 * "desserts" never renames the chip everyone else's recipes use. Ordering is
 * alphabetical in French, which is stable as recipes come and go — frequency
 * order would reshuffle the filter chips under the cook's finger.
 */
export function collectTags(sources: Array<string[] | undefined>): string[] {
  const counts = new Map<string, Map<string, number>>()
  for (const tags of sources) {
    for (const tag of tags ?? []) {
      const key = tagKey(tag)
      if (!key) continue
      const spellings = counts.get(key) ?? new Map<string, number>()
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1)
      counts.set(key, spellings)
    }
  }

  const chosen: string[] = []
  for (const spellings of counts.values()) {
    let best = ''
    let bestCount = 0
    for (const [spelling, count] of spellings) {
      // Strictly greater keeps the first spelling seen when counts tie, because
      // Map preserves insertion order.
      if (count > bestCount) {
        best = spelling
        bestCount = count
      }
    }
    if (best) chosen.push(best)
  }
  return chosen.sort((a, b) => a.localeCompare(b, 'fr'))
}
