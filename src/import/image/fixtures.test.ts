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

/**
 * The recipes every fixture should yield, stated as facts about the page.
 *
 * `real-*` are photographs the cook actually took, committed in
 * `fixtures/pages` alongside the synthetic pages. They are the ones that matter:
 * every synthetic page here was built to imitate one of them, and every time a
 * real photograph has been added it has broken something no synthetic page did.
 *
 * A page marked `hard` is one the parser does not yet read well. Its numbers are
 * **floors**, not expectations — they may rise freely and must never fall. That
 * is the ratchet: a page we read badly today is recorded as read badly, so the
 * day someone improves it the suite agrees, and the day someone breaks it
 * further the suite objects.
 */
const PAGES = [
  {
    name: 'real-salade',
    what: "the cook's own photograph of the salade page, hand-held over a book",
    title: /salade de haricots.*avocat/i,
    servings: '4-6 personnes',
    time: '10 min',
    // The page's `Salade` and `Sauce` sub-headings sit inside the list rather
    // than above it here, so they arrive as items: fifteen ingredients and one
    // stray heading. Worth improving, and recorded rather than rounded away.
    ingredients: 16,
    ingredientGroups: null,
    contains: [
      '2 avocats, pelés et dénoyautés',
      '400 g de haricots noirs en boîte, égouttés et rincés',
      'sel et poivre noir du moulin',
    ],
    methodGroups: ['Salade', 'Sauce'],
    steps: 4,
    notes: null,
    hard: false,
  },
  {
    name: 'real-jambalaya-wide',
    what: "the cook's photograph of a sideways spread whose ingredients are two lists",
    title: /jambalaya de la confr/i,
    // `Pour 4 personnes` sits in the gutter of the spread and was not read.
    servings: '',
    time: '1 h',
    ingredients: 18,
    ingredientGroups: null,
    contains: [
      // Both sub-columns, in reading order: left list first, then right.
      '3 poivrons',
      '2 saucisses fumées (ou 240 g de chorizo épicé)',
      '250 g de tomates concassées',
      'Sel et poivre',
    ],
    methodGroups: null,
    steps: 6,
    notes: /AVELINE/i,
    hard: false,
  },
  {
    name: 'real-jambalaya-close',
    what: 'the same spread shot closer and far more obliquely — the hardest page here',
    title: /jambalaya de la confr/i,
    servings: '4 personnes',
    time: '1 h',
    // Floors. This photograph is steeply angled and soft, and most of the
    // ingredient list is lost. Recorded honestly so it can only improve.
    ingredients: 3,
    ingredientGroups: null,
    contains: [],
    methodGroups: null,
    steps: 2,
    notes: null,
    hard: true,
    // A ceiling to match the floors. The two ingredient sub-columns fold into
    // one run here because the perspective squeezes the gap between the list and
    // the method to 1.07x a line gap — narrower than any threshold could catch
    // without shattering paragraphs on every other page. Recorded so it can
    // only shrink.
    longestIngredient: 361,
  },
  {
    name: 'salade',
    what: 'a two-column French cookbook page with grouped ingredients, rendered clean',
    title: /salade de haricots/i,
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
    steps: 6,
    notes: /avocat est riche en nutriments/i,
    hard: false,
  },
  {
    name: 'salade-photo',
    what: 'that page as a phone photograph: perspective, curl and a shadow gradient',
    title: /salade de haricots/i,
    servings: '4-6 personnes',
    time: '10 min',
    ingredientGroups: ['Salade', 'Sauce'],
    ingredients: 15,
    contains: [
      "6 cuil. à soupe d'huile d'olive",
      '400 g de haricots noirs en boîte, égouttés et rincés',
      'sel et poivre noir du moulin',
    ],
    methodGroups: ['Salade', 'Sauce'],
    steps: 6,
    notes: /avocat est riche en nutriments/i,
    hard: false,
  },
  {
    name: 'salade-photo-raw',
    what: 'the same photograph with no flattening at all, as a floor on robustness',
    title: /salade de haricots/i,
    servings: '4-6 personnes',
    time: '10 min',
    ingredientGroups: ['Salade', 'Sauce'],
    ingredients: 15,
    contains: ["6 cuil. à soupe d'huile d'olive", '4 œufs durs'],
    methodGroups: ['Salade', 'Sauce'],
    steps: 6,
    notes: /avocat est riche en nutriments/i,
    hard: false,
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
    steps: 5,
    notes: null,
    hard: true,
  },
  {
    name: 'salade-rot90',
    what: 'a page lying on its side, which Vision reads perfectly and layout cannot',
    title: /salade de haricots/i,
    servings: '4-6 personnes',
    time: '10 min',
    ingredientGroups: ['Salade', 'Sauce'],
    ingredients: 15,
    contains: ['4 œufs durs', 'sel et poivre noir du moulin'],
    methodGroups: ['Salade', 'Sauce'],
    steps: 6,
    notes: /avocat est riche en nutriments/i,
    hard: false,
  },
  {
    name: 'jambalaya-rot90',
    what: 'a sideways page that right-aligns its list and sets its steps with ❖',
    title: /jambalaya de la confrérie/i,
    servings: '4 personnes',
    time: '1 h',
    ingredientGroups: null,
    ingredients: 17,
    contains: [
      '3 poivrons',
      '2 saucisses fumées (ou 240 g de chorizo épicé)',
      'Sel et poivre',
    ],
    methodGroups: null,
    steps: 6,
    notes: /AVELINE/i,
    hard: false,
  },
  {
    name: 'jambalaya-upright',
    what: 'the same page the right way up, isolating format from orientation',
    title: /jambalaya de la confrérie/i,
    servings: '4 personnes',
    time: '1 h',
    ingredientGroups: null,
    ingredients: 18,
    contains: ['3 poivrons', 'Sel et poivre'],
    methodGroups: null,
    steps: 5,
    notes: null,
    hard: true,
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
    steps: 5,
    notes: null,
    hard: false,
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
    // hunting for a leading quantity. Its neighbour is pinned too, but by a
    // line OCR reads consistently — `300g` comes back as `3009` often enough
    // that asserting it would be testing the engine, not the parser.
    contains: ['a handful of walnuts', '2 tsp cinnamon'],
    methodGroups: null,
    steps: 5,
    notes: null,
    hard: false,
  },
] as const

for (const page of PAGES) {
  test(`${page.name}: ${page.what}`, () => {
    const recipe = recipeFromOcr(load(page.name))
    const steps = recipe.groups.reduce((total, group) => total + group.steps.length, 0)

    assert.match(recipe.title, page.title)
    for (const wanted of page.contains) {
      assert.ok(
        recipe.ingredients.includes(wanted),
        `expected ingredient ${JSON.stringify(wanted)}, got ${JSON.stringify(recipe.ingredients, null, 2)}`,
      )
    }

    if (page.hard) {
      // A floor, not an expectation: it may rise freely and must never fall.
      assert.ok(
        recipe.ingredients.length >= page.ingredients,
        `${page.name} read ${recipe.ingredients.length} ingredients, below its floor of ${page.ingredients}`,
      )
      assert.ok(steps >= page.steps, `${page.name} read ${steps} steps, below its floor of ${page.steps}`)
      return
    }

    assert.equal(recipe.ingredients.length, page.ingredients)
    assert.equal(steps, page.steps)
    assert.equal(recipe.servings, page.servings)
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
      // A hard page carries its own recorded ceiling; see `longestIngredient`.
      const limit = ('longestIngredient' in page ? page.longestIngredient : 0) || 200
      assert.ok(item.length <= limit, `an ingredient is not a paragraph (>${limit}): ${item}`)
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
