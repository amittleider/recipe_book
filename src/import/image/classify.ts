/**
 * Deciding what each block of a photographed page actually is.
 *
 * The signals are the ones a person uses at a glance, and they are deliberately
 * *typographic and textual* rather than positional. "Ingredients are on the
 * right" is true of the page this was built against and false of the next one;
 * "a run of short lines that start with a quantity is a shopping list" holds for
 * both, and for a handwritten card photographed at an angle.
 *
 * Size is always measured as average character advance rather than box height —
 * see `typeSize` in `layout.ts` for why the obvious measure is the wrong one.
 *
 * Every block gets a score per kind and the best score wins, so no single signal
 * can carry a misclassification on its own.
 */

import type { OcrLine } from '../../ocr/types'
import { typeSize, type Block } from './layout'

export type BlockKind = 'title' | 'meta' | 'ingredients' | 'method' | 'heading' | 'noise'

export type Classified = Block & { kind: BlockKind; text: string }

/** What the page as a whole looks like, for judging any one block against. */
export type PageMetrics = {
  /** Median character advance across the page: the body text's size. */
  typeSize: number
}

/** Bullet glyphs a printer or a cook might use, plus what OCR turns them into. */
const BULLET = /^\s*[•·◦‣∙●○*▪+–—-]\s+/

/**
 * A line that opens with an amount. Covers `400 g`, `2 avocats`, `½ cuil.`,
 * `1/2 tasse` and `6 cuil. à soupe`, in either language. This is the signal that
 * survives when a cook's handwritten list has no bullets at all.
 */
const QUANTITY = /^\s*(?:\d+[.,]?\d*|[½¼¾⅓⅔⅛]|\d+\s*\/\s*\d+)\s*(?:[a-zà-ÿ.]{0,12})?\b/i

/** Words that only appear in a recipe's header block. */
const META_PATTERNS: RegExp[] = [
  /\bpour\s+\d+\s*(?:[-–à]\s*\d+\s*)?(?:personnes?|parts?|portions?)/i,
  /\b(?:pr[ée]paration|cuisson|repos|attente|marinade|r[ée]frig[ée]ration)\s*:/i,
  /\bniveau\s+de\s+difficult[ée]\s*:/i,
  /\b(?:serves|servings|yield|makes)\b\s*:?\s*\d/i,
  /\b(?:prep|cook|total|resting|chill)(?:\s+time)?\s*:/i,
  /\b(?:difficulty|temps)\s*:/i,
  /\b\d+\s*(?:min(?:utes?)?|h(?:eures?|rs?)?|hours?)\b/i,
]

/** Page furniture: nothing a cook wants in the recipe. */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*\d{1,3}\s*$/,
  /^\s*(?:page|p\.)\s*\d+\s*$/i,
  /^\s*[ivxlc]{1,6}\s*$/i,
]

/**
 * A footnote is set smaller than the body and sits at the foot of the page.
 * Both halves are required: small type in the middle of a page is an aside worth
 * keeping, and ordinary type at the bottom is just where the recipe ended.
 */
const FOOTNOTE_SIZE = 0.8
const FOOTNOTE_TOP = 0.75

/** Ingredient-group and method headings a page uses, in both languages. */
const SECTION_WORDS = [
  'salade', 'sauce', 'garniture', 'marinade', 'pâte', 'pate', 'farce', 'glaçage', 'glacage',
  'crème', 'creme', 'sirop', 'accompagnement', 'assaisonnement', 'vinaigrette', 'décoration',
  'ingrédients', 'ingredients', 'méthode', 'methode', 'préparation', 'preparation',
  'dressing', 'filling', 'topping', 'crust', 'base', 'frosting', 'glaze', 'method',
  'instructions', 'directions', 'steps', 'garnish', 'to serve', 'for the',
]

const blockText = (lines: OcrLine[]): string => lines.map((line) => line.text).join('\n')

const share = (lines: OcrLine[], test: (text: string) => boolean): number =>
  lines.length ? lines.filter((line) => test(line.text)).length / lines.length : 0

export function isSectionWord(text: string): boolean {
  const key = text.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s*:\s*$/, '')
  if (!key || key.length > 28) return false
  return SECTION_WORDS.some((word) => {
    const bare = word.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return key === bare || key.startsWith(`${bare} `)
  })
}

/** Prose runs long; a list item does not. */
const averageLength = (lines: OcrLine[]): number =>
  lines.length ? lines.reduce((total, line) => total + line.text.trim().length, 0) / lines.length : 0

const CAPS = /^[^a-zà-ÿ]*$/

/** How big this block's type is next to the rest of the page. */
function sizeRatio(block: Block, page: PageMetrics): number {
  const sizes = block.lines.map(typeSize).filter((size) => size > 0)
  if (!sizes.length || page.typeSize <= 0) return 1
  return Math.max(...sizes) / page.typeSize
}

/**
 * Scores for each kind. Weights are rounded numbers chosen to let two weak
 * signals outvote one strong one; they are not tuned against any single page,
 * and the test suite covers several layouts precisely so they cannot be.
 */
function score(block: Block, page: PageMetrics): Record<BlockKind, number> {
  const { lines } = block
  const text = blockText(lines)
  const bullets = share(lines, (value) => BULLET.test(value))
  const quantities = share(lines, (value) => QUANTITY.test(value.replace(BULLET, '')))
  const metaHits = META_PATTERNS.filter((pattern) => pattern.test(text)).length
  const relative = sizeRatio(block, page)
  const caps = share(lines, (value) => CAPS.test(value.trim()) && value.trim().length > 1)
  const length = averageLength(lines)
  const footnote = relative < FOOTNOTE_SIZE && block.y > FOOTNOTE_TOP

  return {
    // Big type, near the top, not many words. Size is the strongest signal and
    // the one that survives a page photographed crooked.
    title: (relative > 1.6 ? 2 : 0) + (block.y < 0.3 ? 1 : 0) + (caps > 0.6 ? 1 : 0) + (length < 40 ? 0.5 : -1),
    // Capped: a block is not more of a header for mentioning three durations,
    // and a long block is not a header at all however many it mentions.
    meta: Math.min(metaHits, 2) * 1.5 + (lines.length <= 6 ? 0.5 : -1.5) + (block.y < 0.35 ? 0.5 : 0),
    ingredients: bullets * 2.5 + quantities * 2 + (length < 60 ? 0.5 : -1) + (lines.length >= 2 ? 0.5 : 0),
    method:
      // Graded rather than a threshold: a method whose lines average 54
      // characters is not categorically different from one averaging 56.
      Math.min(length / 40, 2) +
      (/[.!?]\s*$/.test(text.trim()) ? 0.5 : 0) +
      (bullets < 0.5 ? 0.5 : -1) +
      (lines.length >= 2 ? 0.5 : 0) -
      (quantities > 0.6 ? 1.5 : 0),
    heading: lines.length === 1 && isSectionWord(text) ? 4 : 0,
    noise: (NOISE_PATTERNS.some((pattern) => pattern.test(text.trim())) ? 5 : 0) + (footnote ? 4 : 0),
  }
}

export function classify(blocks: Block[], page: PageMetrics): Classified[] {
  return blocks.map((block) => {
    const scores = score(block, page)
    const kind = (Object.keys(scores) as BlockKind[]).reduce((best, current) =>
      (scores[current] ?? 0) > (scores[best] ?? 0) ? current : best,
    )
    return { ...block, kind, text: blockText(block.lines) }
  })
}

export { BULLET, QUANTITY, blockText }
