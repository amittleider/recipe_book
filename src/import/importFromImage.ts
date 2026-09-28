import { documentFromPage } from './image/document'
import { recognizeText } from '../ocr/textRecognition'
import type { RecipeDocument } from '../lib/recipeDocument'

/**
 * A photograph of a recipe, turned into a filled-in editor.
 *
 * The same contract as the link importer: nothing is written to Drive, the cook
 * reads the result and decides. That is what makes a parser that is right most
 * of the time good enough — a miss costs a few taps, not a bad recipe in a
 * shared folder.
 *
 * Everything interesting happens in `./image/document`, which knows nothing
 * about cameras and is tested without one.
 */
export async function importFromImage(uri: string): Promise<RecipeDocument> {
  return documentFromPage(await recognizeText(uri))
}

export { isUsablePhoto } from './image/document'
