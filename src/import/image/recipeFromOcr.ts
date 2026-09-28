/**
 * A photographed page, reassembled into a recipe.
 *
 * The page is not read top to bottom. A cookbook prints the ingredients beside
 * the method as often as above it, so the blocks are *classified* and then put
 * back in the order a recipe is written in, not the order the eye met them.
 *
 * Two rules do most of the work and are worth stating plainly, because they are
 * what keep this from being a parser for one particular book:
 *
 * - A line break inside a block is **wrapping, not meaning**. `400 g de haricots
 *   noirs / en boîte, égouttés / et rincés` is one ingredient the column was too
 *   narrow to hold, and joining it back is the difference between a shopping
 *   list and confetti. A new item starts at a bullet, or failing that at a
 *   quantity — never merely at a new line.
 * - Nothing is thrown away. Text that matches nothing lands in a closing note,
 *   so a misread block costs the cook a delete rather than a lost ingredient.
 */

import type { ImportedRecipe, InstructionGroup } from '../structuredData'
import type { OcrLine, OcrPage } from '../../ocr/types'
import { BULLET, classify, isSectionWord, type Classified } from './classify'
import { median, readingOrder, typeSize } from './layout'

/** Below this the engine is guessing, and its guess is usually not a word. */
const MIN_CONFIDENCE = 0.3

/**
 * A `Sauce :` label opening a part of the method, at the start of the text or
 * after a finished sentence.
 *
 * The preceding boundary is a capture group rather than a lookbehind: Hermes,
 * the engine this ships on, has not always supported lookbehind assertions, and
 * a regex that works in Node but throws on the phone is the worst kind of bug.
 */
const INLINE_LABEL = /(^|[.!?…]\s+)([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ ]{1,24}?)\s*:\s+/g

/**
 * Bullets that split a step when they appear *inside* a line. Only unambiguous
 * glyphs qualify — a dash mid-sentence is punctuation, and splitting French
 * prose on every `—` would shred it. A dash at the *start* of a line is still a
 * bullet, which `BULLET` handles.
 */
const INLINE_BULLET = /\s*[•·◦‣∙●○▪]\s*/g

/** Stands in for a step boundary while the prose is reflowed. */
const BREAK = '\u0000'

/**
 * The end of a sentence, followed by the start of another.
 *
 * A printed method is often one unbroken paragraph, and handing the cook a
 * single 500-character step is not a recipe they can follow with wet hands. The
 * capital letter is what distinguishes a real sentence break from `1 tsp. salt`
 * or `180 °C. ` mid-clause, and it is a lookahead rather than a lookbehind
 * because Hermes has not always supported the latter.
 */
const SENTENCE = /[.!?…][")»’']?\s+(?=[A-ZÀ-Ý])/g

const DURATION = /(\d+)\s*(h(?:eures?|rs?)?|min(?:utes?)?|hours?)\b/gi

const SERVINGS =
  /\bpour\s+(\d+(?:\s*[-–à]\s*\d+)?)\s*(personnes?|parts?|portions?)|(?:serves|makes|yield|servings)\s*:?\s*(\d+(?:\s*[-–]\s*\d+)?)/i

// --- text -------------------------------------------------------------------

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()

/**
 * A heading printed in capitals is a design choice, not the recipe's name. The
 * conversion is skipped unless the text really is mostly capitals, so a title
 * that was already sentence case survives untouched.
 */
export function sentenceCase(value: string): string {
  const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (!letters || letters.replace(/[a-zà-ÿ]/g, '').length / letters.length < 0.8) return clean(value)
  const lowered = clean(value).toLowerCase()
  return lowered.charAt(0).toUpperCase() + lowered.slice(1)
}

/**
 * Joins wrapped lines into the items they were before the column narrowed.
 *
 * Three rules, tried in order, each one the page's own answer to "where does an
 * item end":
 *
 * 1. Bullets, when the printer supplied them.
 * 2. Failing that, indentation — `en boîte, égouttés` sits a character to the
 *    right of the `400 g` it continues, and that offset is what a typesetter
 *    uses to say "still the same item".
 * 3. Failing both, one item per line, which is how a person writes a shopping
 *    list on a card. Guessing from quantities instead would lose `a handful of
 *    walnuts`, and an ingredient lost is worse than one split.
 */
export function itemsFrom(lines: OcrLine[]): string[] {
  const texts = lines.map((line) => line.text).filter((text) => text.trim())
  if (!texts.length) return []

  const bulleted = lines.filter((line) => BULLET.test(line.text)).length
  const leftEdge = Math.min(...lines.map((line) => line.x))
  // A character's width is the natural unit for "indented": it is what the eye
  // is comparing, and it scales with the photograph.
  const character = median(lines.map(typeSize).filter((size) => size > 0))
  const indented = lines.filter((line) => line.x > leftEdge + character).length

  const starts = (line: OcrLine): boolean => {
    if (bulleted >= 2) return BULLET.test(line.text)
    if (indented) return line.x <= leftEdge + character
    return true
  }

  const items: string[] = []
  for (const line of lines) {
    if (!line.text.trim()) continue
    const body = line.text.replace(BULLET, '')
    if (starts(line) || !items.length) items.push(body)
    else items[items.length - 1] = `${items[items.length - 1]} ${body}`
  }
  return items.map(clean).filter(Boolean)
}

/**
 * Method prose into steps.
 *
 * Splits only where the page itself marked a boundary — a bullet, or a `Sauce :`
 * label — and keeps whole sentences together otherwise. Splitting on every full
 * stop would read as a step list but would invent structure the author never
 * wrote, which is the one thing `recipeDocument` is careful never to do.
 */
/** A step reads as a sentence, so it starts like one — stripping `Sauce :` off
 * the front of `Sauce : dans un saladier` must not leave a lowercase step. */
function asStep(value: string): string {
  const text = clean(value)
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

/** One chunk of prose, cut at its sentence boundaries. */
function sentences(text: string): string[] {
  const parts: string[] = []
  let start = 0
  SENTENCE.lastIndex = 0
  for (let match = SENTENCE.exec(text); match; match = SENTENCE.exec(text)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length
    parts.push(text.slice(start, end))
    start = (match.index ?? 0) + match[0].length
  }
  parts.push(text.slice(start))
  return parts.map(clean).filter(Boolean)
}

export function stepsFrom(lines: OcrLine[]): InstructionGroup[] {
  // Line breaks inside a paragraph are wrapping, so the prose is reflowed into
  // one string first. Anything that genuinely marked a boundary — a bullet at
  // the head of a line, a bullet mid-sentence — becomes a `BREAK` on the way.
  const flowed = lines
    .map((line) => (BULLET.test(line.text) ? `${BREAK}${line.text.replace(BULLET, '')}` : line.text))
    .join(' ')
    .replace(INLINE_BULLET, BREAK)

  const groups: InstructionGroup[] = []
  let current: InstructionGroup = { name: '', steps: [] }

  for (const piece of flowed.split(BREAK).map(clean).filter(Boolean)) {
    let cursor = 0
    INLINE_LABEL.lastIndex = 0
    for (let match = INLINE_LABEL.exec(piece); match; match = INLINE_LABEL.exec(piece)) {
      const name = match[2]
      if (!name || !isSectionWord(name)) continue
      const at = (match.index ?? 0) + (match[1] ?? '').length
      for (const sentence of sentences(piece.slice(cursor, at))) current.steps.push(asStep(sentence))
      if (current.steps.length) groups.push(current)
      current = { name: sentenceCase(name), steps: [] }
      cursor = (match.index ?? 0) + match[0].length
    }
    for (const sentence of sentences(piece.slice(cursor))) current.steps.push(asStep(sentence))
  }

  if (current.steps.length) groups.push(current)
  return groups
}

// --- meta -------------------------------------------------------------------

/** Every duration mentioned, summed. `Préparation : 10 min` plus a cook time. */
export function minutesIn(text: string): number {
  let total = 0
  for (const match of text.matchAll(DURATION)) {
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue
    total += /^h/i.test(match[2] ?? '') ? value * 60 : value
  }
  return total
}

export function servingsIn(text: string): string {
  const match = text.match(SERVINGS)
  if (!match) return ''
  if (match[1]) return clean(`${match[1]} ${match[2] ?? ''}`)
  return match[3] ? `${match[3]} personnes` : ''
}

// --- assembly ---------------------------------------------------------------

/** The page's body type size: the yardstick every block is measured against. */
function medianTypeSize(lines: OcrLine[]): number {
  // Very short strings make a noisy average advance, so they do not get a vote.
  const sizes = lines.filter((line) => line.text.trim().length >= 4).map(typeSize).filter((size) => size > 0)
  if (!sizes.length) return 0
  return sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] ?? 0
}

/** Kinds a heading can be the title of. */
const NAMEABLE = new Set(['ingredients', 'method'])

/**
 * A heading block names whatever follows it in the same column, which is how
 * `Sauce` above six bullets becomes a group rather than an ingredient, and how
 * a bare `Method` stops being mistaken for the first step.
 */
function named(blocks: Classified[], at: number): string {
  const previous = blocks[at - 1]
  if (!previous || previous.kind !== 'heading') return ''
  if (previous.column !== blocks[at]?.column) return ''
  return sentenceCase(previous.text)
}

/**
 * Both importers end here, in the same type. A photographed page and a web page
 * are two ways of filling one form, and keeping them on one type means the
 * editor, `toDocument` and every test downstream need know nothing about which
 * way a recipe arrived.
 */
export function recipeFromOcr(page: OcrPage): ImportedRecipe {
  const usable = page.lines.filter(
    (line) => line.text.trim() && line.confidence >= MIN_CONFIDENCE,
  )
  const blocks = classify(readingOrder(usable), { typeSize: medianTypeSize(usable) })

  const titles = blocks.filter((block) => block.kind === 'title').sort((a, b) => a.y - b.y)
  const title = titles[0] ? sentenceCase(clean(titles[0].lines.map((line) => line.text).join(' '))) : ''

  const metaText = blocks.filter((block) => block.kind === 'meta').map((block) => block.text).join('\n')
  const minutes = minutesIn(metaText)

  const ingredientGroups: InstructionGroup[] = []
  const groups: InstructionGroup[] = []
  const notes: string[] = []

  blocks.forEach((block, index) => {
    if (block.kind === 'ingredients') {
      const steps = itemsFrom(block.lines)
      if (steps.length) ingredientGroups.push({ name: named(blocks, index), steps })
      return
    }
    if (block.kind === 'method') {
      const found = stepsFrom(block.lines)
      const heading = named(blocks, index)
      // The heading names the first part only; a `Sauce :` label inside the
      // prose has already named the ones after it.
      if (heading && found[0] && !found[0].name) found[0] = { ...found[0], name: heading }
      groups.push(...found)
      return
    }
    // Headings are consumed by the list they name; a heading naming nothing is
    // just text, and text is never dropped.
    if (block.kind === 'heading') {
      const next = blocks[index + 1]
      if (next && NAMEABLE.has(next.kind) && next.column === block.column) return
      notes.push(clean(block.text))
      return
    }
    if (block.kind === 'noise' || (block.kind === 'title' && block !== titles[0])) {
      notes.push(clean(block.text))
    }
  })

  return {
    title,
    ingredients: ingredientGroups.flatMap((group) => group.steps),
    ingredientGroups,
    groups,
    notes: notes.filter(Boolean),
    // Re-expressed as the ISO duration the web importer also produces, so both
    // paths hand `toDocument` the same thing and the formatting lives in one place.
    totalTime: minutes ? `PT${minutes}M` : '',
    prepTime: '',
    cookTime: '',
    servings: servingsIn(metaText),
  }
}
