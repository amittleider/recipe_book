/**
 * Shows what the parser made of a page, and why.
 *
 * When an import comes out wrong the useful question is *which stage* went
 * wrong — did the columns split, did the blocks break in the right places, was a
 * block classified as the wrong thing — and the finished `recipe.md` does not
 * say. This prints every stage.
 *
 *   scripts/ocr/fixture.sh ~/Desktop/page.jpg my-page
 *   npm run ocr:inspect src/import/image/fixtures/my-page.json
 */
import { readFileSync } from 'node:fs'
import { classify } from '../../src/import/image/classify'
import { columns, readingOrder, typeSize } from '../../src/import/image/layout'
import { recipeFromOcr } from '../../src/import/image/recipeFromOcr'
import { documentFromPage } from '../../src/import/image/document'
import { serialize } from '../../src/lib/recipeDocument'
import type { OcrPage } from '../../src/ocr/types'

const path = process.argv[2]
if (!path) {
  console.error('usage: npm run ocr:inspect <fixture.json>')
  process.exit(1)
}

const page = JSON.parse(readFileSync(path, 'utf8')) as OcrPage
// The same filter `recipeFromOcr` applies, so what is printed is what it saw.
const lines = page.lines.filter((line) => line.text.trim() && line.confidence >= 0.3)
const sizes = lines.filter((line) => line.text.trim().length >= 4).map(typeSize).sort((a, b) => a - b)
const metrics = { typeSize: sizes[Math.floor(sizes.length / 2)] ?? 0 }

console.log(`${page.width}×${page.height}px · ${page.lines.length} lines read, ${lines.length} kept`)
console.log(`columns: ${columns(lines).length} · body type size: ${metrics.typeSize.toFixed(5)}\n`)

console.log('── blocks ────────────────────────────────────────────────')
for (const block of classify(readingOrder(lines), metrics)) {
  const preview = block.text.replace(/\n/g, ' ⏎ ').slice(0, 74)
  console.log(`col${block.column} ${block.kind.padEnd(11)} y=${block.y.toFixed(3)}  ${preview}`)
}

const recipe = recipeFromOcr(page)
console.log('\n── recipe ────────────────────────────────────────────────')
console.log(`title    ${recipe.title || '(none)'}`)
console.log(`serves   ${recipe.servings || '(none)'}`)
console.log(`time     ${recipe.totalTime || '(none)'}`)
console.log(`${recipe.ingredients.length} ingredients · ${recipe.groups.length} method group(s) · ${(recipe.notes ?? []).length} note(s)`)

try {
  console.log('\n── recipe.md ─────────────────────────────────────────────')
  console.log(serialize(documentFromPage(page)))
} catch (caught) {
  console.log(`\nrefused: ${caught instanceof Error ? caught.message : String(caught)}`)
}
