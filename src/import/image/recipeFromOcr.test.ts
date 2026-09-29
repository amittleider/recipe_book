import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsFrom, minutesIn, sentenceCase, servingsIn, stepsFrom } from './recipeFromOcr'
import type { OcrLine } from '../../ocr/types'

/** A line of `text` whose box is sized as a real one would be. */
function line(text: string, x = 0.1, y = 0.1, size = 0.007): OcrLine {
  return { text, x, y, width: text.length * size, height: 0.015, confidence: 1 }
}

function stack(texts: Array<string | [string, number]>, top = 0.1): OcrLine[] {
  return texts.map((entry, index) => {
    const [text, x] = Array.isArray(entry) ? entry : [entry, 0.1]
    return line(text, x, top + index * 0.02)
  })
}

// --- titles -----------------------------------------------------------------

test('a title printed in capitals becomes sentence case', () => {
  assert.equal(sentenceCase("SALADE DE HARICOTS ET D'AVOCAT"), "Salade de haricots et d'avocat")
})

test('a title that was already sentence case is left alone', () => {
  assert.equal(sentenceCase('Lemon Drizzle Loaf'), 'Lemon Drizzle Loaf')
  assert.equal(sentenceCase("Mum's Carrot Cake"), "Mum's Carrot Cake")
})

// --- ingredient lists -------------------------------------------------------

test('bullets mark where one ingredient ends and the next begins', () => {
  const items = itemsFrom(
    stack([
      '• 400 g de haricots noirs',
      'en boîte, égouttés',
      'et rincés',
      '• 4 œufs durs',
    ]),
  )
  assert.deepEqual(items, ['400 g de haricots noirs en boîte, égouttés et rincés', '4 œufs durs'])
})

test('without bullets, an indent marks a continuation', () => {
  const items = itemsFrom(
    stack([
      ['400 g de haricots noirs', 0.1],
      ['en boîte, égouttés', 0.13],
      ['4 œufs durs', 0.1],
    ]),
  )
  assert.deepEqual(items, ['400 g de haricots noirs en boîte, égouttés', '4 œufs durs'])
})

test('a flush-left handwritten list is one ingredient per line', () => {
  // The failure this guards against is real: guessing from quantities instead
  // swallows `a handful of walnuts` into the line above it, because it opens
  // with no number at all.
  const items = itemsFrom(stack(['2 tsp cinnamon', 'I tsp bicarbonate of soda', 'a handful of walnuts']))
  assert.deepEqual(items, ['2 tsp cinnamon', 'I tsp bicarbonate of soda', 'a handful of walnuts'])
})

test('wrapped lines never leave a newline inside an item', () => {
  for (const item of itemsFrom(stack(['• 1 cuil. à soupe de', 'jus de citron vert', 'fraîchement pressé']))) {
    assert.doesNotMatch(item, /\n/)
  }
})

// --- method -----------------------------------------------------------------

test('a bullet inside a line still ends the step', () => {
  // The page breaks its steps with `•` mid-paragraph, not only at line starts.
  const groups = stepsFrom(stack(['et le cumin. • Verser la sauce sur la salade.']))
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0]?.steps, ['Et le cumin.', 'Verser la sauce sur la salade.'])
})

test('a labelled part of the method becomes a named group', () => {
  const groups = stepsFrom(
    stack([
      'Salade : émincer les avocats.',
      'Sauce : mélanger l’huile avec le jus de citron.',
    ]),
  )
  assert.deepEqual(groups.map((group) => group.name), ['Salade', 'Sauce'])
  assert.deepEqual(groups[0]?.steps, ['Émincer les avocats.'])
  assert.deepEqual(groups[1]?.steps, ['Mélanger l’huile avec le jus de citron.'])
})

test('a word that is not a section name is left in the prose', () => {
  // `Attention :` must not become a heading just for carrying a colon.
  const groups = stepsFrom(stack(['Attention : ne pas faire bouillir la crème.']))
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.name, '')
  assert.match(groups[0]?.steps[0] ?? '', /^Attention/)
})

test('an unbroken paragraph is cut into steps at its sentences', () => {
  const groups = stepsFrom(
    stack([
      'Heat the oven to 180 degrees and line a tin.',
      'Beat the butter and sugar until pale.',
      'Fold in the flour.',
    ]),
  )
  assert.equal(groups[0]?.steps.length, 3)
})

test('an abbreviation mid-sentence does not start a new step', () => {
  // `1 tsp. salt` and `180 °C. ` both end in a full stop and neither ends a step.
  const groups = stepsFrom(stack(['Add 1 tsp. salt and bake at 180 °C. until risen']))
  assert.equal(groups[0]?.steps.length, 1)
})

test('every step opens with a capital, even after its label is stripped', () => {
  const groups = stepsFrom(stack(['Sauce : dans un saladier, mélanger l’huile.']))
  assert.match(groups[0]?.steps[0] ?? '', /^[A-ZÀ-Ý]/)
})

// --- header block -----------------------------------------------------------

test('durations are summed across the header', () => {
  assert.equal(minutesIn('Préparation : 20 minutes\nCuisson : 45 minutes'), 65)
  assert.equal(minutesIn('Prep: 1 h 30 min'), 90)
  assert.equal(minutesIn('Niveau de difficulté : 1'), 0)
})

test('servings are read in either language, range intact', () => {
  assert.equal(servingsIn('Pour 4-6 personnes'), '4-6 personnes')
  assert.equal(servingsIn('Pour 6 personnes'), '6 personnes')
  assert.equal(servingsIn('Serves 8'), '8 personnes')
  assert.equal(servingsIn('Niveau de difficulté : 1'), '')
})

test('a right-aligned list is one ingredient per line', () => {
  // This book sets its ingredients flush right, so every line begins somewhere
  // different. Reading those offsets as indentation — which is correct for a
  // flush-left list — folded seventeen ingredients into two.
  const lines = [
    line('3 poivrons', 0.42, 0.10),
    line('2 branches de céleri', 0.30, 0.13),
    line('2 saucisses fumées (ou 240 g de chorizo)', 0.10, 0.16),
    line('Sel et poivre', 0.39, 0.19),
  ]
  assert.deepEqual(itemsFrom(lines), [
    '3 poivrons',
    '2 branches de céleri',
    '2 saucisses fumées (ou 240 g de chorizo)',
    'Sel et poivre',
  ])
})

test('a flush-left list still joins its wrapped lines', () => {
  // The counterpart to the test above: the same code must keep reading real
  // indentation as continuation when the list is set the ordinary way.
  const lines = [
    line('400 g de haricots noirs', 0.10, 0.10),
    line('en boîte, égouttés', 0.13, 0.13),
    line('4 œufs durs', 0.10, 0.16),
    line('pain pita grillé', 0.10, 0.19),
  ]
  assert.deepEqual(itemsFrom(lines), [
    '400 g de haricots noirs en boîte, égouttés',
    '4 œufs durs',
    'pain pita grillé',
  ])
})

test("a page's own step markers are not split further at sentences", () => {
  // The page already said where its steps begin. Cutting those at every full
  // stop would impose a structure the author did not write.
  const marked = stepsFrom([
    line('❖ Pelez les oignons. Ciselez-les finement. Réservez.', 0.1, 0.10),
    line('❖ Rincez le céleri. Taillez-le en brunoise.', 0.1, 0.14),
  ])
  assert.deepEqual(marked[0]?.steps.length, 2)

  // With no markers, an unbroken paragraph still gets cut into readable steps.
  const unmarked = stepsFrom([
    line('Pelez les oignons. Ciselez-les finement. Réservez.', 0.1, 0.10),
  ])
  assert.equal(unmarked[0]?.steps.length, 3)
})
