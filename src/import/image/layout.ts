/**
 * Turning a bag of OCR lines back into a page you can read in order.
 *
 * A cookbook page is the hard case this exists for. Printed recipes are very
 * often two columns — method on one side, ingredients on the other — and an OCR
 * engine reports lines in roughly raster order, so the two columns arrive
 * interleaved. Sorting by `y` alone produces a stripe of alternating method and
 * ingredients that no parser can recover. The columns have to be found first.
 *
 * Nothing here knows anything about recipes. It finds columns, orders lines, and
 * groups them into blocks by the whitespace the typesetter already put there.
 */

import { lineBottom, lineRight, type OcrLine } from '../../ocr/types'

/**
 * A gutter has to be this wide, as a fraction of page width, before it counts.
 * Word spacing inside a justified line can leave surprisingly large holes; a
 * real column gutter is wider still.
 */
const MIN_GUTTER = 0.035

/** Neither side of a split may be narrower than this, or it is a margin. */
const MIN_COLUMN = 0.15

/**
 * A split is only believed if both sides carry real text. A page number sitting
 * alone in the margin is not a column.
 */
const MIN_COLUMN_LINES = 3

/** Most of a column's lines must stay on its own side for the split to be real. */
const MAX_CROSSING = 0.06

/**
 * A line set this many times further from its neighbour than the lines around it
 * starts a new block.
 *
 * Measured against a *local* window rather than the column average, because one
 * column routinely holds two different leadings — a 54pt title is set looser than
 * the 21pt body beneath it, and judging both against one number either shatters
 * the title into three blocks or welds the body onto it. Comparing each spacing
 * only to its immediate neighbours asks the question that actually matters: is
 * this line further away than the lines right here usually are?
 */
const LEADING_BREAK = 1.35

/** Spacings either side of a boundary that set the local expectation. */
const WINDOW = 2

/**
 * A change in type size this large also starts a block — that is a title
 * meeting its body.
 *
 * Size is measured as **average character width**, not box height. Vision sizes
 * a line's box to the glyphs actually in it, so `coriandre et les tomates` comes
 * back 46% shorter than the line above it in the very same font simply for
 * having no descenders. Character advance does not move for that reason, which
 * makes it the honest measure of how big the type is.
 */
const SIZE_BREAK = 1.5

/** Below this, one wide glyph skews the average and the size test is not trusted. */
const MIN_CHARS = 4

export type Block = {
  lines: OcrLine[]
  /** Index of the column this block came from, left to right. */
  column: number
  x: number
  y: number
  width: number
  height: number
}

// --- columns ----------------------------------------------------------------

/**
 * The x positions where a vertical cut would pass between lines rather than
 * through them. Built by sweeping the line intervals and recording the holes.
 */
function gaps(lines: OcrLine[]): Array<{ from: number; to: number }> {
  const intervals = lines
    .map((line) => ({ from: line.x, to: lineRight(line) }))
    .sort((a, b) => a.from - b.from)

  const holes: Array<{ from: number; to: number }> = []
  let reach = intervals[0]?.to ?? 0
  for (const interval of intervals.slice(1)) {
    if (interval.from > reach) holes.push({ from: reach, to: interval.from })
    reach = Math.max(reach, interval.to)
  }
  return holes
}

/**
 * How badly a cut at `at` disagrees with the page: the share of lines it would
 * slice through. A true gutter scores zero.
 */
function crossing(lines: OcrLine[], at: number): number {
  const through = lines.filter((line) => line.x < at && lineRight(line) > at).length
  return lines.length ? through / lines.length : 1
}

/**
 * The single best vertical cut, or null when the page is one column.
 *
 * Every candidate comes from an actual hole in the text, so this cannot invent a
 * gutter on a dense page — the widest hole on a single-column page is a ragged
 * right margin, which fails `MIN_COLUMN` on the right-hand side.
 */
function bestSplit(lines: OcrLine[]): number | null {
  const left = Math.min(...lines.map((line) => line.x))
  const right = Math.max(...lines.map(lineRight))

  const candidates = gaps(lines)
    .filter((hole) => hole.to - hole.from >= MIN_GUTTER)
    .map((hole) => (hole.from + hole.to) / 2)
    .filter((at) => at - left >= MIN_COLUMN && right - at >= MIN_COLUMN)

  let best: { at: number; score: number } | null = null
  for (const at of candidates) {
    const before = lines.filter((line) => lineRight(line) <= at)
    const after = lines.filter((line) => line.x >= at)
    if (before.length < MIN_COLUMN_LINES || after.length < MIN_COLUMN_LINES) continue
    const score = crossing(lines, at)
    if (score > MAX_CROSSING) continue
    // Ties go to the cut that balances the two sides, which on a real page is
    // the gutter rather than an accidental hole near one edge.
    const balance = Math.abs(before.length - after.length) / lines.length
    const total = score + balance * 0.25
    if (!best || total < best.score) best = { at, score: total }
  }
  return best ? best.at : null
}

/** Lines grouped into columns, left to right. One column is the normal case. */
export function columns(lines: OcrLine[]): OcrLine[][] {
  if (lines.length < MIN_COLUMN_LINES * 2) return [lines]
  const at = bestSplit(lines)
  if (at === null) return [lines]
  // A line straddling the cut belongs to whichever side holds more of it.
  const left = lines.filter((line) => (line.x + lineRight(line)) / 2 < at)
  const right = lines.filter((line) => (line.x + lineRight(line)) / 2 >= at)
  return [left, right].filter((column) => column.length)
}

// --- blocks -----------------------------------------------------------------

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function bounds(lines: OcrLine[], column: number): Block {
  const x = Math.min(...lines.map((line) => line.x))
  const y = Math.min(...lines.map((line) => line.y))
  const right = Math.max(...lines.map(lineRight))
  const bottom = Math.max(...lines.map(lineBottom))
  return { lines, column, x, y, width: right - x, height: bottom - y }
}

/** Average character advance: a stable proxy for how big the type is. */
export function typeSize(line: OcrLine): number {
  const length = line.text.trim().length
  return length ? line.width / length : 0
}

/** A change of type size across a boundary, when both lines are long enough to judge. */
function resized(before: OcrLine, after: OcrLine): boolean {
  if (before.text.trim().length < MIN_CHARS || after.text.trim().length < MIN_CHARS) return false
  const first = typeSize(before)
  const second = typeSize(after)
  if (first <= 0 || second <= 0) return false
  return Math.max(first, second) / Math.min(first, second) > SIZE_BREAK
}

/**
 * Split one column into blocks wherever the page itself leaves a break.
 *
 * Two signals, both relative to the column's own measurements so that a page
 * photographed close up and one photographed at arm's length break in the same
 * places: how far apart the lines are set, and how big the type is.
 */
export function blocksIn(lines: OcrLine[], column: number): Block[] {
  if (!lines.length) return []
  const ordered = [...lines].sort((a, b) => a.y - b.y || a.x - b.x)
  if (ordered.length === 1) return [bounds(ordered, column)]

  // `pitch[i]` is the step from line i to line i+1. Top-to-top rather than the
  // visible gap: Vision sizes each box to the glyphs in it, so a line without
  // descenders leaves a gap half again as large in the very same paragraph.
  const pitch = ordered.slice(1).map((line, index) => line.y - (ordered[index] as OcrLine).y)
  const columnPitch = median(pitch)

  const blocks: Block[] = []
  let current: OcrLine[] = [ordered[0] as OcrLine]

  for (let index = 1; index < ordered.length; index += 1) {
    const here = pitch[index - 1] ?? 0
    const before = pitch.slice(Math.max(0, index - 1 - WINDOW), index - 1)
    const after = pitch.slice(index, index + WINDOW)

    // The tighter side, not the average of both. A heading sits between the
    // loose leading of the title above and the tight leading of the list below;
    // averaging those hides the break, while asking whether this line is far
    // from the *closest-set* of its neighbours finds it.
    const sides = [before, after].filter((side) => side.length).map(median).filter((value) => value > 0)
    const local = sides.length ? Math.min(...sides) : columnPitch
    const spaced = local > 0 && here > local * LEADING_BREAK

    if (spaced || resized(ordered[index - 1] as OcrLine, ordered[index] as OcrLine)) {
      blocks.push(bounds(current, column))
      current = []
    }
    current.push(ordered[index] as OcrLine)
  }
  if (current.length) blocks.push(bounds(current, column))
  return blocks
}

/**
 * Every block on the page, in reading order: down one column, then down the next.
 *
 * This is the order a person reads the page in, which is not the order a recipe
 * is *written* in — the ingredients often sit beside the method rather than
 * before it. Reassembling the recipe is `recipeFromOcr`'s job; this only
 * guarantees that each block holds text that genuinely runs together.
 */
export function readingOrder(lines: OcrLine[]): Block[] {
  const found = columns(lines)
  return found.flatMap((column, index) => blocksIn(column, index))
}
