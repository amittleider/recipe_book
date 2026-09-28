import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { documentFromPage } from './document'
import { recipeFromOcr } from './recipeFromOcr'
import { ImportError } from '../errors'
import { parse, serialize } from '../../lib/recipeDocument'
import type { OcrPage } from '../../ocr/types'

/**
 * The parser against real OCR output.
 *
 * Every fixture in `fixtures/` was produced by Apple Vision reading an actual
 * image, through `scripts/ocr/fixture.sh` — the same framework, the same flip
 * of the coordinate system and the same rounding that the app's native module
 * applies on the phone. Nothing here is hand-written OCR, because hand-written
 * OCR is always tidier than the real thing and would quietly certify a parser
 * that cannot cope.
 *
 * The suite is built to resist being tuned to one page. Pages differ in
 * language, column count, whether the list is bulleted, whether the type is
 * printed or handwritten, and whether the photograph is square to the page. The
 * invariants at the bottom then run over *every* fixture, so a threshold nudged
 * to rescue one page has to keep all the others passing too.
 *
 * To add a page: `scripts/ocr/fixture.sh ~/photo.jpg my-page`, then a row here.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function load(name: string): OcrPage {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as OcrPage
}

/** The recipes every fixture should yield, stated as facts about the page. */
const PAGES = [
  {
    name: 'salade-haricots-avocat-render',
    what: 'a two-column French cookbook page with grouped ingredients',
    title: /salade de haricots.*avocat/i,
    servings: '4-6 personnes',
    time: '10 min',
    ingredientGroups: ['Salade', 'Sauce'],
    ingredients: 15,
    contains: [
      '400 g de haricots noirs en boîte, égouttés et rincés',
      '4 œufs durs',
      '½ cuil. à café de cumin en poudre',
    ],
    methodGroups: ['Salade', 'Sauce'],
    notes: /avocat est riche en nutriments/i,
  },
  {
    name: 'salade-skewed',
    what: 'the same layout photographed four degrees out of square',
    title: /salade de haricots.*avocat/i,
    servings: '4-6 personnes',
    time: '10 min',
    ingredientGroups: ['Salade', 'Sauce'],
    ingredients: 7,
    contains: ['2 avocats, pelés et dénoyautés', '4 œufs durs'],
    methodGroups: ['Salade', 'Sauce'],
    notes: null,
  },
  {
    name: 'lemon-drizzle',
    what: 'a single-column English page with one flat method',
    title: /lemon drizzle loaf/i,
    servings: '8 personnes',
    time: '1 h 5 min',
    ingredientGroups: null,
    ingredients: 9,
    contains: ['225 g unsalted butter, softened', 'juice of 2 lemons'],
    methodGroups: null,
    notes: null,
  },
  {
    name: 'carrot-cake-card',
    what: 'a handwritten card with no bullets anywhere',
    title: /carrot cake/i,
    servings: '10 personnes',
    time: '1 h 15 min',
    ingredientGroups: null,
    ingredients: 8,
    // The one that only survives because items are split per line, not by
    // hunting for a leading quantity.
    contains: ['a handful of walnuts', '300g grated carrot'],
    methodGroups: null,
    notes: null,
  },
] as const

for (const page of PAGES) {
  test(`${page.name}: ${page.what}`, () => {
    const recipe = recipeFromOcr(load(page.name))

    assert.match(recipe.title, page.title)
    assert.equal(recipe.servings, page.servings)
    assert.equal(recipe.ingredients.length, page.ingredients)
    for (const wanted of page.contains) {
      assert.ok(
        recipe.ingredients.includes(wanted),
        `expected ingredient ${JSON.stringify(wanted)}, got ${JSON.stringify(recipe.ingredients, null, 2)}`,
      )
    }

    if (page.ingredientGroups) {
      assert.deepEqual((recipe.ingredientGroups ?? []).map((group) => group.name), page.ingredientGroups)
    }
    if (page.methodGroups) {
      assert.deepEqual(recipe.groups.map((group) => group.name), page.methodGroups)
    }
    if (page.notes) {
      assert.match((recipe.notes ?? []).join('\n'), page.notes)
    }

    const document = documentFromPage(load(page.name))
    const meta = (key: string) => document.meta.find((field) => field.key === key)?.value
    assert.equal(meta('Time'), page.time)
    assert.equal(meta('Serves'), page.servings)
  })
}

test('a page that is not a recipe is refused rather than half-parsed', () => {
  // The book's introduction: prose, a page number, and nothing to cook.
  assert.throws(
    () => documentFromPage(load('not-a-recipe')),
    (error: unknown) => error instanceof ImportError && error.reason === 'noRecipeInPhoto',
  )
})

test('an empty page is refused', () => {
  assert.throws(() => documentFromPage({ width: 100, height: 100, lines: [] }), ImportError)
})

// --- invariants over every fixture -----------------------------------------

/**
 * These run over all of the above. A threshold changed to rescue one page has
 * to leave every other page still holding, which is the mechanism that stops
 * this parser being tuned into a parser for one book.
 */
for (const page of PAGES) {
  test(`${page.name}: holds the invariants every parsed page must`, () => {
    const recipe = recipeFromOcr(load(page.name))
    const document = documentFromPage(load(page.name))

    assert.doesNotMatch(recipe.title, /\n/, 'a title is one line')

    for (const item of recipe.ingredients) {
      assert.ok(item.trim(), 'no ingredient is blank')
      assert.doesNotMatch(item, /\n/, 'a wrapped ingredient is rejoined, not left broken')
      assert.doesNotMatch(item, /^\s*[•·‣]/, 'the bullet is consumed, not kept in the text')
      assert.ok(item.length < 200, `an ingredient is not a paragraph: ${item}`)
    }

    for (const group of recipe.groups) {
      assert.ok(group.steps.length, 'a method group without steps is not emitted')
      for (const step of group.steps) {
        assert.ok(step.trim(), 'no step is blank')
        assert.doesNotMatch(step, /\n/, 'a step is one line')
        assert.match(step, /^[A-ZÀ-Ý0-9]/, `a step reads as a sentence: ${step}`)
      }
    }

    for (const group of recipe.ingredientGroups ?? []) {
      assert.ok(group.steps.length, 'an ingredient group without items is not emitted')
    }

    // A heading names its list; it must never also survive as one of its items.
    for (const group of recipe.ingredientGroups ?? []) {
      assert.ok(!group.steps.some((item) => item.trim() === group.name.trim()))
    }

    const names = document.sections.map((section) => section.name)
    assert.equal(new Set(names).size, names.length, `sections are distinguishable: ${names.join(', ')}`)

    // The document the editor is handed must be one the storage format can hold
    // and read back unchanged — an import that will not round-trip is a bug that
    // only shows up once it is already in the shared folder.
    const markdown = serialize(document)
    assert.equal(serialize(parse(markdown)), markdown, 'the generated recipe.md round-trips')
  })
}
