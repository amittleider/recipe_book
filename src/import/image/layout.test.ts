import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blocksIn, columns, median, readingOrder, typeSize } from './layout'
import type { OcrLine } from '../../ocr/types'

/**
 * Layout analysis, on made-up pages rather than photographs.
 *
 * The fixtures in `fixtures.test.ts` prove the parser works on real OCR output.
 * These prove *why* it works, on inputs small enough to reason about, so a
 * failure here names the broken rule instead of just the broken page.
 */

/** A line of `text` whose box is sized as a real one would be. */
function line(text: string, x: number, y: number, size = 0.007, height = 0.015): OcrLine {
  return { text, x, y, width: text.length * size, height, confidence: 1 }
}

/** Lines stacked down a column at a constant pitch. */
function stack(texts: string[], x: number, top: number, pitch: number, size = 0.007): OcrLine[] {
  return texts.map((text, index) => line(text, x, top + index * pitch, size))
}

test('a single-column page is not split', () => {
  const lines = stack(
    ['Heat the oven to 180 degrees', 'Beat the butter and the sugar', 'Fold in the flour gently'],
    0.1,
    0.1,
    0.03,
  )
  assert.equal(columns(lines).length, 1)
})

test('a ragged right margin is not mistaken for a gutter', () => {
  // Lines of very different lengths all starting at the same left edge: the
  // widest hole in the text is the margin, and a margin is not a column.
  const lines = [
    line('A short line', 0.1, 0.10),
    line('A considerably longer line of prose here', 0.1, 0.14),
    line('Tiny', 0.1, 0.18),
    line('Another rather long line of running prose', 0.1, 0.22),
    line('Short again', 0.1, 0.26),
    line('One more line to make up the numbers', 0.1, 0.30),
  ]
  assert.equal(columns(lines).length, 1)
})

test('two columns are separated at the gutter', () => {
  const left = stack(['Method line one', 'Method line two', 'Method line three'], 0.08, 0.10, 0.03)
  const right = stack(['2 eggs', '200 g flour', '1 tsp salt'], 0.60, 0.10, 0.03)
  const found = columns([...left, ...right])

  assert.equal(found.length, 2)
  // Left column first, whatever order the engine reported the lines in.
  assert.ok(found[0]?.every((entry) => entry.x < 0.5))
  assert.ok(found[1]?.every((entry) => entry.x > 0.5))
})

test('columns survive the interleaved order OCR actually reports', () => {
  // An engine reading roughly in raster order alternates between the columns,
  // which is the whole reason this module exists.
  const interleaved = [
    line('Method line one', 0.08, 0.10),
    line('2 eggs', 0.60, 0.10),
    line('Method line two', 0.08, 0.14),
    line('200 g flour', 0.60, 0.14),
    line('Method line three', 0.08, 0.18),
    line('1 tsp salt', 0.60, 0.18),
  ]
  const [first, second] = columns(interleaved)
  assert.deepEqual(first?.map((entry) => entry.text), ['Method line one', 'Method line two', 'Method line three'])
  assert.deepEqual(second?.map((entry) => entry.text), ['2 eggs', '200 g flour', '1 tsp salt'])
})

test('a multi-line title in large type stays one block', () => {
  // Big type is set looser than body type. Judged against the page average that
  // looser leading looks like a break, which would shatter the title.
  const title = stack(['SALADE', 'DE HARICOTS', "ET D'AVOCAT"], 0.2, 0.10, 0.038, 0.024)
  const body = stack(
    ['Emincer les avocats et les mettre', 'dans un grand saladier avec les', 'haricots et la coriandre hachee'],
    0.2,
    0.23,
    0.020,
  )
  const blocks = blocksIn([...title, ...body], 0)

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0]?.lines.length, 3)
  assert.equal(blocks[1]?.lines.length, 3)
})

test('a heading is split from the list beneath it', () => {
  const heading = [line('Ingredients', 0.1, 0.10, 0.013, 0.018)]
  const items = stack(['2 eggs and a bit', '200 g plain flour', '1 tsp fine salt', '100 ml whole milk'], 0.1, 0.15, 0.023)
  const blocks = blocksIn([...heading, ...items], 0)

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0]?.lines[0]?.text, 'Ingredients')
  assert.equal(blocks[1]?.lines.length, 4)
})

test('evenly set lines stay together however many there are', () => {
  const blocks = blocksIn(stack(Array.from({ length: 12 }, (_, i) => `Line number ${i} of prose`), 0.1, 0.1, 0.025), 0)
  assert.equal(blocks.length, 1)
})

test('reading order goes down one column then down the next', () => {
  const lines = [
    ...stack(['Left top one', 'Left top two', 'Left top three'], 0.08, 0.10, 0.025),
    ...stack(['Right one x', 'Right two x', 'Right three'], 0.60, 0.10, 0.025),
  ]
  const blocks = readingOrder(lines)
  assert.deepEqual(blocks.map((block) => block.column), [0, 1])
})

test('type size measures character advance, not box height', () => {
  // Same font, same string length, but one box is short for want of descenders.
  const tall = { ...line('abcdefghij', 0.1, 0.1), height: 0.020 }
  const short = { ...line('abcdefghij', 0.1, 0.2), height: 0.009 }
  assert.equal(typeSize(tall), typeSize(short))
})

test('median of an even count averages the middle pair', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([]), 0)
})
