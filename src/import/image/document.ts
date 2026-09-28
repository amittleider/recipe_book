import { ImportError } from '../errors'
import { MIN_INGREDIENTS, type ImportedRecipe } from '../structuredData'
import { toDocument } from '../toDocument'
import { recipeFromOcr } from './recipeFromOcr'
import type { OcrPage } from '../../ocr/types'
import type { RecipeDocument } from '../../lib/recipeDocument'

/**
 * The whole of image import that does not need a phone.
 *
 * Split from `importFromImage` on purpose: that file reaches the camera and the
 * native Vision module, which cannot be loaded outside a device build. Keeping
 * everything from `OcrPage` onwards in here means the entire parse — layout,
 * classification, assembly and the finished `recipe.md` — is covered by
 * `node --test`, and only the twenty lines that actually touch the hardware are
 * not.
 */

/**
 * Worth showing the cook: a shopping list and something to do with it.
 *
 * Deliberately weaker than the web importer's `isUsable`, which also demands a
 * title. A page photographed a little too low, or a card whose heading is in
 * handwriting Vision cannot read, still yields a perfectly good recipe — and
 * the title is the one field that takes two seconds to type. Refusing the whole
 * import over it would be the parser being fussy on the cook's behalf.
 */
export function isUsablePhoto(recipe: ImportedRecipe): boolean {
  return (
    recipe.ingredients.length >= MIN_INGREDIENTS &&
    recipe.groups.some((group) => group.steps.length > 0)
  )
}

export function documentFromPage(page: OcrPage): RecipeDocument {
  const recipe = recipeFromOcr(page)
  if (!isUsablePhoto(recipe)) throw new ImportError('noRecipeInPhoto')
  // No source line: unlike a link, a photograph has no address worth recording,
  // and the editor gives the cook no way to delete a preamble they did not want.
  return toDocument(recipe, '')
}
