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
import { lineRight, type OcrLine, type OcrPage } from '../../ocr/types'
import { BULLET, MARK, classify, isSectionWord, markOf, marksEntries, type Classified } from './classify'
import { byGrain, median, orient, readingOrder, typeSize, type Block } from './layout'

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

/** How much a set of edges wanders: the mean distance from their middle. */
function spread(values: number[]): number {
  if (!values.length) return 0
  const middle = median(values)
  return values.reduce((total, value) => total + Math.abs(value - middle), 0) / values.length
}

/**
 * Joins wrapped lines into the items they were before the column narrowed.
 *
 * Three rules, tried in order, each one the page's own answer to "where does an
 * item end":
 *
 * 1. The mark the block uses for its list, whatever glyph that turns out to be.
 * 2. Failing that, indentation — but only on a list actually set flush left.
 *    `en boîte, égouttés` sits a character to the right of the `400 g` it
 *    continues, and that offset is what a typesetter uses to say "still the same
 *    item". On a **right**-aligned list, which is one real cookbook's house
 *    style, every line begins somewhere different, and reading those offsets as
 *    indentation collapses seventeen ingredients into two.
 * 3. Failing both, one item per line, which is how a person writes a shopping
 *    list on a card. Guessing from quantities instead would lose `a handful of
 *    walnuts`, and an ingredient lost is worse than one split.
 */
export function itemsFrom(lines: OcrLine[]): string[] {
  const texts = lines.map((line) => line.text).filter((text) => text.trim())
  if (!texts.length) return []

  const marked = marksEntries(lines)
  const leftEdge = Math.min(...lines.map((line) => line.x))
  // A character's width is the natural unit for "indented": it is what the eye
  // is comparing, and it scales with the photograph.
  const character = median(lines.map(typeSize).filter((size) => size > 0))
  // Which edge the typesetter lined the list up on is the one that holds still.
  const flushLeft = spread(lines.map((line) => line.x)) <= spread(lines.map(lineRight))
  const indented = flushLeft && lines.some((line) => line.x > leftEdge + character)

  const starts = (line: OcrLine): boolean => {
    if (marked) return !!markOf(line.text)
    if (indented) return line.x <= leftEdge + character
    return true
  }

  const items: string[] = []
  for (const line of lines) {
    if (!line.text.trim()) continue
    const body = line.text.replace(MARK, '')
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
  // The mark this block opens its steps with, whatever glyph the printer chose
  // and however unevenly the page was read.
  const marked = lines.filter((line) => markOf(line.text)).length >= 2
  const opens = (text: string) => (marked ? !!markOf(text) : BULLET.test(text))
  const flowed = lines
    .map((line) => (opens(line.text) ? `${BREAK}${line.text.replace(MARK, '')}` : line.text))
    .join(' ')
    .replace(INLINE_BULLET, BREAK)

  // A page that bulleted or numbered its own steps has already said where they
  // begin; splitting those further at every full stop would impose a structure
  // the author did not write. Sentences are consulted only when the page offers
  // nothing of its own.
  const cut = (text: string): string[] => (marked ? [clean(text)].filter(Boolean) : sentences(text))

  const groups: InstructionGroup[] = []
  let current: InstructionGroup = { name: '', steps: [] }

  for (const piece of flowed.split(BREAK).map(clean).filter(Boolean)) {
    let cursor = 0
    INLINE_LABEL.lastIndex = 0
    for (let match = INLINE_LABEL.exec(piece); match; match = INLINE_LABEL.exec(piece)) {
      const name = match[2]
      if (!name || !isSectionWord(name)) continue
      const at = (match.index ?? 0) + (match[1] ?? '').length
      for (const sentence of cut(piece.slice(cursor, at))) current.steps.push(asStep(sentence))
      if (current.steps.length) groups.push(current)
      current = { name: sentenceCase(name), steps: [] }
      cursor = (match.index ?? 0) + match[0].length
    }
    for (const sentence of cut(piece.slice(cursor))) current.steps.push(asStep(sentence))
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

/**
 * A title set in one size may still arrive as several blocks — generous leading
 * between its lines looks like a break — so consecutive title blocks are taken
 * together. Size is what stops this swallowing the strapline underneath: one
 * title is set in one size, and `JAMBALAYA AUX ÉPICES, CREVETTES ET POULET` is a
 * third the height of the `JAMBALAYA DE LA CONFRÉRIE` above it.
 */
const TITLE_SIZE_MATCH = 1.3

function titleRun(blocks: Classified[]): Classified[] {
  const first = blocks.findIndex((block) => block.kind === 'title')
  if (first === -1) return []
  const sizeOf = (block: Classified) => Math.max(...block.lines.map(typeSize), 0)

  const run = [blocks[first] as Classified]
  const size = sizeOf(blocks[first] as Classified)
  for (let index = first + 1; index < blocks.length; index += 1) {
    const block = blocks[index] as Classified
    if (block.kind !== 'title' || block.column !== run[0]?.column) break
    const other = sizeOf(block)
    if (!size || !other || Math.max(size, other) / Math.min(size, other) > TITLE_SIZE_MATCH) break
    run.push(block)
  }
  return run
}

/**
 * Whether `next` sits below `first` rather than beside it.
 *
 * Judged by how much of the narrower block's width the two share. Two lists
 * printed side by side share none; a list broken across a page fold shares
 * nearly all of it.
 */
const STACKED_OVERLAP = 0.5

function stacked(first: Block, next: Block): boolean {
  const left = Math.max(first.x, next.x)
  const right = Math.min(first.x + first.width, next.x + next.width)
  const shared = right - left
  return shared > 0 && shared >= Math.min(first.width, next.width) * STACKED_OVERLAP
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
  // Righting the page comes before anything reads its layout: every rule below
  // this line assumes columns run down the frame and lines run across it.
  const upright = orient(page)
  const legible = upright.lines.filter(
    (line) => line.text.trim() && line.confidence >= MIN_CONFIDENCE,
  )
  // Anything still lying across the page once it is square is a thumb tab or a
  // running head. It is kept — nothing is discarded — but it takes no part in
  // deciding where the columns are.
  const { flowing, crossGrain } = byGrain(legible)
  const blocks = classify(readingOrder(flowing), { typeSize: medianTypeSize(flowing) })

  const titles = titleRun(blocks)
  const title = sentenceCase(clean(titles.flatMap((block) => block.lines.map((line) => line.text)).join(' ')))

  const metaText = blocks.filter((block) => block.kind === 'meta').map((block) => block.text).join('\n')
  const minutes = minutesIn(metaText)

  const ingredientGroups: InstructionGroup[] = []
  const groups: InstructionGroup[] = []
  const notes: string[] = crossGrain.map((line) => clean(line.text)).filter(Boolean)

  /**
   * A run of blocks that belong to one list. Blocks are gathered as *lines*
   * rather than as finished items, because a list broken across two blocks is
   * usually broken mid-item: a page photographed over a curved spine splits
   * `6 cuil. à soupe d'huile / d'olive` down the middle, and only rejoining the
   * lines before reading them puts that ingredient back together.
   */
  type Segment = {
    kind: 'ingredients' | 'method'
    name: string
    lines: OcrLine[]
    column: number
    /** The last block folded in, so the next one can be judged against it. */
    last: Classified
  }

  const segments: Segment[] = []
  let openIngredients: Segment | null = null
  let openMethod: Segment | null = null

  blocks.forEach((block, index) => {
    if (block.kind === 'ingredients' || block.kind === 'method') {
      const heading = named(blocks, index)
      // A heading starts a list; its absence continues the one above.
      const open = block.kind === 'ingredients' ? openIngredients : openMethod
      // Continues the list above only if it sits *below* it. A block beside the
      // open one is a parallel column, not more of the same list: a cookbook
      // that prints its ingredients as two side-by-side lists would otherwise
      // have them folded together, and the mixed alignment of the two then
      // defeats the flush-left test that tells an item from a continuation.
      if (!heading && open && open.column === block.column && stacked(open.last, block)) {
        open.lines.push(...block.lines)
        open.last = block
        return
      }
      const segment: Segment = {
        kind: block.kind,
        name: heading,
        lines: [...block.lines],
        column: block.column,
        last: block,
      }
      segments.push(segment)
      if (block.kind === 'ingredients') openIngredients = segment
      else openMethod = segment
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
    if (block.kind === 'noise' || (block.kind === 'title' && !titles.includes(block))) {
      notes.push(clean(block.text))
    }
  })

  for (const segment of segments) {
    if (segment.kind === 'ingredients') {
      const items = itemsFrom(segment.lines)
      if (items.length) ingredientGroups.push({ name: segment.name, steps: items })
      continue
    }
    const found = stepsFrom(segment.lines)
    // The heading names the first part only; a `Sauce :` label inside the prose
    // has already named the ones after it.
    if (found[0] && !found[0].name && segment.name) found[0] = { ...found[0], name: segment.name }
    groups.push(...found.filter((group) => group.steps.length))
  }

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
