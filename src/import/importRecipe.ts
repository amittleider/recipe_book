import { ImportError } from './errors'
import { fetchPage, normalizeUrl } from './fetchPage'
import { parseRecipe } from './structuredData'
import { toDocument } from './toDocument'
import type { RecipeDocument } from '../lib/recipeDocument'

/**
 * Fetch a page and hand back a recipe the editor can show, or fail with a
 * reason worth reading. The tiers this orchestrates are deliberately ordered
 * cheapest and most exact first; a model-based tier, if one is ever added,
 * belongs after `parseRecipe` and before the failure.
 */
export async function importRecipe(input: string): Promise<{ document: RecipeDocument; url: string }> {
  const url = normalizeUrl(input)
  const html = await fetchPage(url)
  const recipe = parseRecipe(html)
  if (!recipe) throw new ImportError('noRecipe')
  return { document: toDocument(recipe, url), url }
}
