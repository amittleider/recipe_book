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

import { lineBottom, lineRight, type OcrLine, type OcrPage } from '../../ocr/types'

/**
 * Neither side of a split may be narrower than this share of the span being
 * split, or it is a margin rather than a column.
 *
 * A *share* rather than a fixed width because this runs at two scales: across a
 * whole page, and again inside a single block of it.
 */
const MIN_COLUMN_SHARE = 0.25

/** How many times a region may be cut before we stop looking. */
const MAX_SUBDIVISION = 4

/**
 * A horizontal band break: whitespace this many times the region's usual line
 * pitch. Deliberately far looser than `LEADING_BREAK`, which separates
 * paragraphs — this separates *regions*, the bands a page is designed in.
 */
const BAND_BREAK = 2.5

/**
 * A split is only believed if both sides carry real text. A page number sitting
 * alone in the margin is not a column.
 */
const MIN_COLUMN_LINES = 3

/** Most of a column's lines must stay on its own side for the split to be real. */
const MAX_CROSSING = 0.06

/**
 * A gutter must be this many characters of clear space wide.
 *
 * Measured in characters rather than page widths, because that is the only unit
 * in which the question makes sense: what separates a column gutter from the
 * space between two words is that it is several characters across, and a real
 * photograph narrows a gutter without narrowing the type.
 */
const MIN_GUTTER_CHARS = 1.5

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

/**
 * Below this the page is level enough to leave alone, and rotating it would
 * only add arithmetic noise.
 */
const MIN_SKEW_DEGREES = 0.25

/**
 * Residual tilt further than this, once the page is the right way up, is not
 * evidence about the page — it is a single word read at an odd angle, or a
 * caption running up the margin.
 */
const MAX_SKEW_DEGREES = 20

/** The four ways a page can sit in a photograph. */
const CARDINALS = [0, 90, 180, -90]

/**
 * How far off the page's grain a line may lie and still be part of its text.
 *
 * Past this it is running the other way: a thumb tab up the edge of a cookbook,
 * an author's name set vertically down the margin. Such a line is not merely
 * irrelevant, it is actively destructive — one running head turned on its side
 * reports a box seventeen per cent of the page tall, which straddles the gap
 * between the ingredients and the method and silently prevents the page from
 * ever being cut into regions there.
 */
const CROSS_GRAIN_DEGREES = 30

export type Block = {
  lines: OcrLine[]
  /** Index of the column this block came from, left to right. */
  column: number
  x: number
  y: number
  width: number
  height: number
}

// --- skew --------------------------------------------------------------------

/** Smallest signed difference between two angles, in degrees. */
function difference(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * Which way up the page is: 0, 90, 180 or -90 degrees.
 *
 * A photograph of an open cookbook is very often sideways — the spread is wider
 * than it is tall, so the phone gets turned, and the text then runs up the
 * frame. Vision reads that text perfectly well and says so, reporting every
 * line at 90°; it is the *layout* that cannot cope, because "a column" and "a
 * line of prose" both stop meaning anything when the page is on its side.
 *
 * Votes are weighted by how much text a line holds, so a page's worth of prose
 * outranks a stray fragment in the margin read at an angle of its own.
 */
export function orientationOf(lines: OcrLine[]): number {
  const votes = new Map<number, number>()
  for (const line of lines) {
    const length = line.text.trim().length
    if (length < 4) continue
    const angle = line.angle ?? 0
    const nearest = CARDINALS.reduce((best, cardinal) =>
      Math.abs(difference(angle, cardinal)) < Math.abs(difference(angle, best)) ? cardinal : best,
    )
    votes.set(nearest, (votes.get(nearest) ?? 0) + length)
  }
  let winner = 0
  let most = 0
  for (const [cardinal, weight] of votes) {
    if (weight > most) {
      most = weight
      winner = cardinal
    }
  }
  return winner
}

/**
 * The page's residual tilt once it is the right way up, from the lines most
 * likely to be prose.
 *
 * Taken as a median rather than a mean: a page photographed over a curved spine
 * has lines tilting from -8° to +7°, and the average of those is meaningless
 * while the middle of them is the page's true lie.
 */
export function skewOf(lines: OcrLine[], cardinal = orientationOf(lines)): number {
  const angles = lines
    .filter((line) => line.text.trim().length >= 4)
    .map((line) => difference(cardinal, line.angle ?? 0))
    .filter((angle) => Math.abs(angle) <= MAX_SKEW_DEGREES)
  return angles.length ? median(angles) : 0
}

/**
 * Puts the page the right way up and levels it.
 *
 * Two corrections in one pass, because they are the same arithmetic: the
 * quarter-turn that rights a sideways photograph, and the fraction of a degree
 * that remains afterwards.
 *
 * This is what stands between a photographed page and nonsense. Columns are
 * found by looking for a vertical strip no line crosses; on a page lying on its
 * side there are no vertical strips to find, and even a degree of tilt closes
 * the gutter, because the left column's lines reach further right at the foot of
 * the page than the right column's do at its head. A page that is plainly two
 * columns to a human then reads as one, after which ingredients and method
 * interleave and the import is ruined.
 *
 * The rotation happens in pixel space so the page's proportions are respected: a
 * degree of tilt moves a point much further across a tall page than a square
 * one, and rotating normalised coordinates directly would quietly stretch it. A
 * quarter turn also swaps the page's own dimensions, so the result is a new
 * `OcrPage` rather than a list of lines.
 */
export function orient(page: OcrPage): OcrPage {
  const cardinal = orientationOf(page.lines)
  const residual = skewOf(page.lines, cardinal)
  const degrees = cardinal + residual
  if (Math.abs(degrees) < MIN_SKEW_DEGREES) return page

  // Coordinates here are y-down while the reported angle is anticlockwise in a
  // y-up frame, so this matrix undoes the tilt as written — for a quarter turn
  // exactly as for a fraction of a degree.
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const width = page.width || 1
  const height = page.height || 1
  // A quarter turn stands the page on its side, so the frame's own proportions
  // turn with it. Everything downstream measures against these.
  const turned = Math.abs(cardinal) === 90
  const outWidth = turned ? height : width
  const outHeight = turned ? width : height

  const lines = page.lines.map((line) => {
    const x = (line.x + line.width / 2) * width - width / 2
    const y = (line.y + line.height / 2) * height - height / 2
    const turnedX = x * cos - y * sin + outWidth / 2
    const turnedY = x * sin + y * cos + outHeight / 2

    // A line's own box turns with the page: what was its length becomes its
    // length again, measured against the frame's new proportions. Beyond the
    // quarter turn the residual is a fraction of a degree, over which a box's
    // footprint does not measurably change.
    const pixelWidth = turned ? line.height * height : line.width * width
    const pixelHeight = turned ? line.width * width : line.height * height

    return {
      ...line,
      // Normalised, not merely subtracted: an upside-down page holds lines
      // reported at both +180 and -180, and the raw difference turns one of
      // those into a full turn rather than into nothing.
      angle: difference(degrees, line.angle ?? 0),
      x: (turnedX - pixelWidth / 2) / outWidth,
      y: (turnedY - pixelHeight / 2) / outHeight,
      width: pixelWidth / outWidth,
      height: pixelHeight / outHeight,
    }
  })

  return { width: outWidth, height: outHeight, lines }
}

// --- columns ----------------------------------------------------------------

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
 * Swept rather than derived from the widest hole in the text, and the reason is
 * worth recording. The first version of this required a clear strip of 3.5% of
 * the page width. On a photograph of a real cookbook the gutter survives but
 * *narrows* — the correction that squares the page also stretches the wide
 * column outwards — and a perfectly clean gutter measuring 1.5% was rejected by
 * a constant, collapsing a two-column page into one and interleaving the
 * ingredients with the method. Page width was simply the wrong unit: what
 * separates a column gutter from the space between two words is that it is
 * several *characters* wide, which is why nothing here is measured in page
 * widths any more.
 *
 * What makes the sweep safe on a single-column page is `after`: it counts lines
 * that *begin* to the right of the cut, and left-aligned prose has none, however
 * ragged its right margin.
 */
function bestSplit(lines: OcrLine[]): number | null {
  const left = Math.min(...lines.map((line) => line.x))
  const right = Math.max(...lines.map(lineRight))
  const span = right - left
  const low = left + span * MIN_COLUMN_SHARE
  const high = right - span * MIN_COLUMN_SHARE
  if (high <= low) return null

  // Half a character: fine enough to land inside a narrow gutter, coarse enough
  // that a page of five hundred lines is still swept in no time.
  const character = median(lines.map(typeSize).filter((size) => size > 0))
  const step = Math.max(character / 2, 0.002)

  let best: { at: number; score: number } | null = null
  for (let at = low; at <= high; at += step) {
    const before = lines.filter((line) => lineRight(line) <= at)
    const after = lines.filter((line) => line.x >= at)
    if (before.length < MIN_COLUMN_LINES || after.length < MIN_COLUMN_LINES) continue
    const score = crossing(lines, at)
    if (score > MAX_CROSSING) continue
    // Clear space actually at the cut, as opposed to merely few lines crossing it.
    const clearance =
      Math.min(...after.map((line) => line.x)) - Math.max(...before.map(lineRight))
    if (clearance < character * MIN_GUTTER_CHARS) continue
    // Ties go to the cut that balances the two sides, which on a real page is
    // the middle of the gutter rather than either of its edges.
    const balance = Math.abs(before.length - after.length) / lines.length
    const total = score + balance * 0.25
    if (!best || total < best.score) best = { at, score: total }
  }
  return best ? best.at : null
}

/**
 * The page's text, and whatever was running across it.
 *
 * Call this after `orient`, when the page is square and anything still lying at
 * an angle is lying at one on purpose.
 */
export function byGrain(lines: OcrLine[]): { flowing: OcrLine[]; crossGrain: OcrLine[] } {
  const flowing: OcrLine[] = []
  const crossGrain: OcrLine[] = []
  for (const line of lines) {
    if (Math.abs(line.angle ?? 0) <= CROSS_GRAIN_DEGREES) flowing.push(line)
    else crossGrain.push(line)
  }
  return { flowing, crossGrain }
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
 * The widest horizontal gap that cleanly separates this region into two bands,
 * or null when it reads as one.
 */
function bestBand(lines: OcrLine[]): number | null {
  const ordered = [...lines].sort((a, b) => a.y - b.y)
  const pitch = ordered.slice(1).map((line, index) => line.y - (ordered[index] as OcrLine).y)
  const typical = median(pitch)
  if (typical <= 0) return null

  let best: { at: number; gap: number } | null = null
  for (let index = MIN_COLUMN_LINES; index <= ordered.length - MIN_COLUMN_LINES; index += 1) {
    const above = ordered.slice(0, index)
    const below = ordered.slice(index)
    const bottom = Math.max(...above.map(lineBottom))
    const top = Math.min(...below.map((line) => line.y))
    const gap = top - bottom
    if (gap < typical * BAND_BREAK) continue
    if (!best || gap > best.gap) best = { at: (bottom + top) / 2, gap }
  }
  return best ? best.at : null
}

/**
 * The page cut into regions, in reading order.
 *
 * An alternating cut — vertical where a gutter runs clear, horizontal where a
 * band of whitespace does — applied recursively. This is the classic way to read
 * a printed page, and the reason it is worth the recursion is that **columns are
 * not always a property of the whole page**.
 *
 * One cookbook here sets a single-column page: a title, then a method running
 * the full width. But between them it prints the ingredients as *two*
 * side-by-side lists. No page-wide gutter exists, because the method crosses
 * every candidate cut; and splitting blocks after the fact does not work either,
 * because by then the two interleaved lists have already been shattered into
 * fragments of a line or two. The band has to be found first, and the gutter
 * looked for inside it.
 *
 * Vertical is tried before horizontal so that a two-column page is separated
 * into columns before either column is cut into paragraphs — which is the order
 * a person reads it in.
 */
export function regions(lines: OcrLine[], depth = 0): OcrLine[][] {
  if (depth >= MAX_SUBDIVISION || lines.length < MIN_COLUMN_LINES * 2) return [lines]

  const gutter = bestSplit(lines)
  if (gutter !== null) {
    const middle = (line: OcrLine) => (line.x + lineRight(line)) / 2
    return [
      lines.filter((line) => middle(line) < gutter),
      lines.filter((line) => middle(line) >= gutter),
    ].flatMap((part) => (part.length ? regions(part, depth + 1) : []))
  }

  const band = bestBand(lines)
  if (band !== null) {
    return [
      lines.filter((line) => line.y < band),
      lines.filter((line) => line.y >= band),
    ].flatMap((part) => (part.length ? regions(part, depth + 1) : []))
  }

  return [lines]
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
  // The column a region belongs to is still the page-level one, because that is
  // what `recipeFromOcr` uses to decide whether two lists are the same list.
  // Two ingredient columns printed side by side are one list to a cook.
  const page = columns(lines)
  const index = (line: OcrLine) => page.findIndex((column) => column.includes(line))
  return regions(lines).flatMap((region) => blocksIn(region, index(region[0] as OcrLine)))
}
