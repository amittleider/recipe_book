import { test } from 'node:test'
import assert from 'node:assert/strict'
import { durationMinutes, formatMinutes, servings, toDocument, totalTime } from './toDocument'
import { serialize } from '../lib/recipeDocument'
import type { ImportedRecipe } from './structuredData'

/**
 * `toDocument` is shared by both importers, and image import taught it two new
 * tricks — grouped ingredients and a closing note. The point of most of these
 * tests is the *absence* of change: a recipe read off a web page has neither,
 * and must come out byte for byte as it did before.
 */

function web(patch: Partial<ImportedRecipe> = {}): ImportedRecipe {
  return {
    title: 'Tarte aux pommes',
    ingredients: ['200 g de farine', '100 g de beurre', '4 pommes'],
    groups: [{ name: '', steps: ['Étaler la pâte.', 'Enfourner 35 minutes.'] }],
    totalTime: 'PT45M',
    prepTime: '',
    cookTime: '',
    servings: '6',
    ...patch,
  }
}

test('a web recipe is unchanged by the fields image import added', () => {
  const markdown = serialize(toDocument(web(), 'https://example.com/tarte'))
  assert.equal(
    markdown,
    [
      '# Tarte aux pommes',
      '',
      '**Serves:** 6 personnes  **Time:** 45 min',
      '',
      'Source : https://example.com/tarte',
      '',
      '## Ingrédients',
      '',
      '- 200 g de farine',
      '- 100 g de beurre',
      '- 4 pommes',
      '',
      '## Méthode',
      '',
      '1. Étaler la pâte.',
      '2. Enfourner 35 minutes.',
      '',
    ].join('\n'),
  )
})

test('grouped ingredients become one section each', () => {
  const document = toDocument(
    web({
      ingredientGroups: [
        { name: 'Salade', steps: ['2 avocats'] },
        { name: 'Sauce', steps: ["6 cuil. à soupe d'huile"] },
      ],
    }),
    '',
  )
  assert.deepEqual(
    document.sections.map((section) => section.name),
    ['Salade', 'Sauce', 'Méthode'],
  )
})

test('a single unnamed group is the same thing as no grouping', () => {
  const document = toDocument(web({ ingredientGroups: [{ name: '', steps: ['200 g de farine'] }] }), '')
  assert.equal(document.sections[0]?.name, 'Ingrédients')
})

test('a method group clashing with an ingredient group is qualified', () => {
  // The page names both after the same thing; two `## Sauce` sections would
  // leave the cook unable to tell the list from the steps.
  const document = toDocument(
    web({
      ingredientGroups: [
        { name: 'Salade', steps: ['2 avocats'] },
        { name: 'Sauce', steps: ["6 cuil. à soupe d'huile"] },
      ],
      groups: [
        { name: 'Salade', steps: ['Émincer les avocats.'] },
        { name: 'Sauce', steps: ['Mélanger.'] },
      ],
    }),
    '',
  )
  assert.deepEqual(
    document.sections.map((section) => section.name),
    ['Salade', 'Sauce', 'Méthode — Salade', 'Méthode — Sauce'],
  )
})

test('a method group with a name of its own keeps it', () => {
  const document = toDocument(
    web({
      ingredientGroups: [{ name: 'Pâte', steps: ['200 g de farine'] }],
      groups: [
        { name: 'Cuisson', steps: ['Enfourner.'] },
        { name: 'Service', steps: ['Servir tiède.'] },
      ],
    }),
    '',
  )
  assert.deepEqual(
    document.sections.map((section) => section.name),
    ['Pâte', 'Cuisson', 'Service'],
  )
})

test('notes are kept last, verbatim, as free text', () => {
  const document = toDocument(web({ notes: ["L'avocat est riche en fibres.", '64'] }), '')
  const last = document.sections[document.sections.length - 1]
  assert.equal(last?.name, 'Notes')
  assert.equal(last?.kind, 'text')
  assert.match(last?.body ?? '', /L'avocat est riche en fibres\./)
  assert.match(last?.body ?? '', /64/)
})

test('no notes means no Notes section', () => {
  const document = toDocument(web({ notes: [] }), '')
  assert.ok(!document.sections.some((section) => section.name === 'Notes'))
})

// --- the duration and yield helpers both importers share --------------------

test('ISO durations convert to minutes', () => {
  assert.equal(durationMinutes('PT45M'), 45)
  assert.equal(durationMinutes('PT1H30M'), 90)
  assert.equal(durationMinutes('P1D'), 1440)
  assert.equal(durationMinutes('nonsense'), 0)
})

test('minutes are written the way the Temps field is', () => {
  assert.equal(formatMinutes(45), '45 min')
  assert.equal(formatMinutes(80), '1 h 20 min')
  assert.equal(formatMinutes(120), '2 h')
  assert.equal(formatMinutes(0), '')
})

test('a bare yield gets the French unit it was missing', () => {
  assert.equal(servings('6'), '6 personnes')
  assert.equal(servings('1'), '1 personne')
  assert.equal(servings('12 portion(s)'), '12 portion(s)')
  assert.equal(servings(''), '')
})

test('prep plus cook stands in for a missing total', () => {
  assert.equal(totalTime(web({ totalTime: '', prepTime: 'PT20M', cookTime: 'PT25M' })), '45 min')
  assert.equal(totalTime(web({ totalTime: 'PT30M', prepTime: 'PT20M', cookTime: 'PT25M' })), '30 min')
})
