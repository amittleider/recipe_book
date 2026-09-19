import {
  newItem,
  newSection,
  withKnownMeta,
  type RecipeDocument,
  type Section,
} from '../lib/recipeDocument'
import type { ImportedRecipe } from './structuredData'

/**
 * An imported recipe, in the shape the editor already knows how to show.
 *
 * Import stops here on purpose. It never writes to Drive; it hands the cook a
 * filled-in form and lets them save it through the same path as a recipe typed
 * by hand. That is what makes a parser that is right most of the time good
 * enough: a miss costs a few taps rather than a bad recipe in a shared folder.
 */

const ISO_DURATION = /^P(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i

function toNumber(value: string | undefined): number {
  return value ? Number(value.replace(',', '.')) || 0 : 0
}

/** ISO 8601 duration to the minute. `PT0S` and junk both come back as zero. */
export function durationMinutes(iso: string): number {
  const parts = iso.trim().match(ISO_DURATION)
  if (!parts) return 0
  const [, days, hours, minutes, seconds] = parts
  return Math.round(
    toNumber(days) * 1440 + toNumber(hours) * 60 + toNumber(minutes) + toNumber(seconds) / 60,
  )
}

/** Written the way the Temps field's own placeholder is: `45 min`, `1 h 20 min`. */
export function formatMinutes(total: number): string {
  if (total <= 0) return ''
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`
}

/**
 * The published total, or prep plus cook when a site gives only the parts.
 * Marmiton publishes `totalTime`; Ricardo publishes all three; some publish
 * only the two halves.
 */
export function totalTime(recipe: ImportedRecipe): string {
  const published = durationMinutes(recipe.totalTime)
  if (published > 0) return formatMinutes(published)
  return formatMinutes(durationMinutes(recipe.prepTime) + durationMinutes(recipe.cookTime))
}

/**
 * `recipeYield` arrives as `6`, `6 personnes`, `12 portion(s)` or
 * `Makes 8 pancakes`. A bare number gets the French unit it was missing;
 * anything already carrying words is left in the site's own wording.
 */
export function servings(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const bare = trimmed.match(/^(\d+)$/)
  if (bare?.[1]) {
    return `${bare[1]} personne${Number(bare[1]) > 1 ? 's' : ''}`
  }
  return trimmed
}

function listSection(name: string, kind: 'bullet' | 'ordered', texts: string[]): Section {
  return { ...newSection(name, kind), items: texts.map((text) => newItem(text)) }
}

export function toDocument(recipe: ImportedRecipe, sourceUrl: string): RecipeDocument {
  const sections: Section[] = [listSection('Ingrédients', 'bullet', recipe.ingredients)]

  const groups = recipe.groups.filter((group) => group.steps.length)
  if (groups.length === 1 && groups[0]) {
    // One flat list of steps is the ordinary case and keeps the usual heading,
    // so an imported recipe reads exactly like one written here.
    sections.push(listSection('Méthode', 'ordered', groups[0].steps))
  } else {
    for (const group of groups) {
      sections.push(listSection(group.name || 'Méthode', 'ordered', group.steps))
    }
  }

  return withKnownMeta({
    title: recipe.title,
    meta: [
      { id: 'import-serves', key: 'Serves', value: servings(recipe.servings) },
      { id: 'import-time', key: 'Time', value: totalTime(recipe) },
    ],
    // The editor does not show the preamble, so only something worth keeping
    // untouched belongs here. The source link is; a site's SEO blurb is not,
    // because the cook would have no way to delete it.
    preamble: sourceUrl ? `Source : ${sourceUrl}` : '',
    sections,
  })
}
