/**
 * Reading a recipe out of a page's structured data.
 *
 * This is not really parsing. Sites that want Google's recipe rich results
 * publish a `schema.org/Recipe` object in a `<script type="application/ld+json">`
 * tag, so on those sites the recipe is already a data structure and the job is
 * to find it and normalise it. That is why this tier runs first: where it works
 * it is exact, instant, and needs no model and no network beyond the page.
 *
 * Every awkward case handled below was found in a live page, not imagined:
 *
 * - Marmiton wraps everything in `@graph`, with the Recipe last of six nodes.
 * - BBC Good Food ships three separate `ld+json` blocks and the Recipe is one.
 * - Ricardo puts the Recipe's fields at the top level *and* carries its own
 *   `@graph` key, so descending into the graph and ignoring the node it hangs
 *   off loses the recipe entirely.
 * - Ricardo groups its steps as `HowToSection`s with nested `itemListElement`,
 *   while everyone else uses a flat `HowToStep[]`.
 * - 750g leaves `&#039;` un-decoded inside step text, and hard-wraps steps
 *   with newlines that would break a one-line list item.
 */

export type InstructionGroup = {
  /** A `HowToSection` name, or empty when the steps are one flat list. */
  name: string
  steps: string[]
}

export type ImportedRecipe = {
  title: string
  ingredients: string[]
  groups: InstructionGroup[]
  /** ISO 8601 duration as published, formatted later. */
  totalTime: string
  prepTime: string
  cookTime: string
  servings: string
}

type JsonObject = Record<string, unknown>

const LD_JSON = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** Guards against a pathological document turning node collection into a hang. */
const MAX_DEPTH = 8

/**
 * The bar a parse has to clear: a name, this many ingredients, and a step.
 * Deliberately a constant — if real pages turn out to fail it often, relaxing
 * the bar and letting the editor carry the rest is a one-line change here.
 */
export const MIN_INGREDIENTS = 2

// --- text ------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', auml: 'ä', aacute: 'á', ccedil: 'ç',
  ugrave: 'ù', ucirc: 'û', uuml: 'ü', uacute: 'ú',
  ocirc: 'ô', ouml: 'ö', ograve: 'ò', oacute: 'ó',
  icirc: 'î', iuml: 'ï', igrave: 'ì', iacute: 'í',
  ntilde: 'ñ', szlig: 'ß',
  // French cooking is full of œufs and bœuf; a site writing them as entities
  // is common enough that missing these shows up on the first import.
  oelig: 'œ', aelig: 'æ',
  deg: '°', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  times: '×', middot: '·', euro: '€', bull: '•', reg: '®', copy: '©',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const digits = body.slice(1)
      const code = digits.startsWith('x') || digits.startsWith('X')
        ? parseInt(digits.slice(1), 16)
        : parseInt(digits, 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    // Case matters: `&Eacute;` opens a sentence and must not come back as `é`.
    // Rather than spell out both halves of every pair, an unknown capitalised
    // name is resolved from its lowercase twin and re-capitalised.
    const exact = NAMED_ENTITIES[body]
    if (exact) return exact
    const lowered = NAMED_ENTITIES[body.toLowerCase()]
    if (lowered) return /^[A-Z]/.test(body) ? lowered.toUpperCase() : lowered
    return whole
  })
}

/**
 * Structured data is supposed to hold plain text and frequently holds markup
 * anyway, so tags are reduced to the line breaks they imply and then dropped.
 */
export function toText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
}

/** A list item has to survive on one line — `serialize` writes it as one. */
function oneLine(value: string): string {
  return toText(value).replace(/\s+/g, ' ').trim()
}

function toLines(value: string): string[] {
  return toText(value)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// The step is about to be rendered into a numbered list, so a number the site
// already wrote into the prose would show up twice.
const STEP_PREFIX = /^(?:(?:étape|etape|step)\s*)?\d+\s*[.):-]\s+/i

function cleanStep(value: string): string {
  return oneLine(value).replace(STEP_PREFIX, '').trim()
}

// --- finding the recipe node ------------------------------------------------

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** `@type` may be a string, an array, or a full `http://schema.org/Recipe` IRI. */
function hasType(node: JsonObject, wanted: string): boolean {
  const raw = node['@type']
  const types = Array.isArray(raw) ? raw : [raw]
  return types.some(
    (entry) => typeof entry === 'string' && entry.split(/[/#]/).pop()?.toLowerCase() === wanted.toLowerCase(),
  )
}

/**
 * Every object reachable in the document, *including* each node that carries an
 * `@graph` rather than only its contents. Ricardo depends on that distinction.
 */
function collectNodes(value: unknown, found: JsonObject[], depth = 0): void {
  if (depth > MAX_DEPTH || !value) return
  if (Array.isArray(value)) {
    for (const entry of value) collectNodes(entry, found, depth + 1)
    return
  }
  if (!isObject(value)) return
  found.push(value)
  if (value['@graph']) collectNodes(value['@graph'], found, depth + 1)
}

function readJsonLdNodes(html: string): JsonObject[] {
  const found: JsonObject[] = []
  for (const match of html.matchAll(LD_JSON)) {
    const body = (match[1] ?? '')
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .replace(/^\s*(?:\/\/|\/\*)?\s*<!\[CDATA\[/, '')
      .replace(/\]\]>\s*(?:\*\/)?\s*$/, '')
      .trim()
    if (!body) continue
    try {
      collectNodes(JSON.parse(body), found)
    } catch {
      // One malformed block must not cost us the others.
    }
  }
  return found
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') return toLines(value)
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string') return toLines(entry)
      if (isObject(entry) && typeof entry['name'] === 'string') return toLines(entry['name'])
      return []
    })
  }
  return []
}

function asText(value: unknown): string {
  if (typeof value === 'string') return oneLine(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return asText(value[0])
  if (isObject(value)) return asText(value['name'] ?? value['value'] ?? '')
  return ''
}

/** Flattens the four shapes `recipeInstructions` is published in. */
function readInstructions(value: unknown, depth = 0): InstructionGroup[] {
  if (depth > 3 || !value) return []

  if (typeof value === 'string') {
    const steps = toLines(value).map(cleanStep).filter(Boolean)
    return steps.length ? [{ name: '', steps }] : []
  }

  if (Array.isArray(value)) {
    const flat: string[] = []
    const groups: InstructionGroup[] = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        flat.push(...toLines(entry).map(cleanStep).filter(Boolean))
        continue
      }
      if (!isObject(entry)) continue
      if (hasType(entry, 'HowToSection') || entry['itemListElement']) {
        const nested = readInstructions(entry['itemListElement'], depth + 1)
        const name = asText(entry['name'])
        for (const group of nested) groups.push({ name: group.name || name, steps: group.steps })
        continue
      }
      const step = cleanStep(asText(entry['text'] ?? entry['name'] ?? entry['description']))
      if (step) flat.push(step)
    }
    // A site that mixes loose steps with sections keeps both, loose ones first.
    return [...(flat.length ? [{ name: '', steps: flat }] : []), ...groups.filter((group) => group.steps.length)]
  }

  if (isObject(value)) return readInstructions(value['itemListElement'] ?? value['text'] ?? '', depth + 1)
  return []
}

function fromNode(node: JsonObject): ImportedRecipe {
  return {
    title: asText(node['name'] ?? node['headline']),
    // `ingredients` is the pre-2017 spelling and is still in the wild.
    ingredients: asStringList(node['recipeIngredient'] ?? node['ingredients']).map(oneLine).filter(Boolean),
    groups: readInstructions(node['recipeInstructions']),
    totalTime: asText(node['totalTime']),
    prepTime: asText(node['prepTime']),
    cookTime: asText(node['cookTime']),
    servings: asText(node['recipeYield'] ?? node['yield']),
  }
}

// --- microdata fallback -----------------------------------------------------

/**
 * Older sites mark recipes up inline with `itemprop` instead. Matching a
 * balanced element with a regular expression is not possible, so each property
 * is read up to the next closing tag — which is what these shallow, inline
 * markups actually look like. It is a top-up for the JSON-LD path, not a
 * general HTML parser.
 */
function readMicrodataProp(html: string, props: string[]): string[] {
  const pattern = new RegExp(
    `<([a-z0-9]+)((?:\\s[^>]*)?\\sitemprop\\s*=\\s*["'](?:${props.join('|')})["'](?:[^>]*)?)>([\\s\\S]*?)<\\/\\1\\s*>`,
    'gi',
  )
  const values: string[] = []
  for (const match of html.matchAll(pattern)) {
    // Microdata says a `content` attribute carries the value when present, which
    // is how `<meta itemprop>` and abbreviated markup publish theirs.
    const content = (match[2] ?? '').match(/\scontent\s*=\s*["']([^"']*)["']/i)?.[1]
    // Line breaks are preserved here: the element boundaries inside a
    // `recipeInstructions` div are what separate one step from the next, and
    // collapsing them first merges the whole method into a single step.
    const text = toText(content ?? match[3] ?? '').replace(/[ \t]+/g, ' ').trim()
    if (text) values.push(text)
  }
  return values
}

function fromMicrodata(html: string): ImportedRecipe | null {
  const ingredients = readMicrodataProp(html, ['recipeIngredient', 'ingredients']).map(oneLine).filter(Boolean)
  if (ingredients.length < MIN_INGREDIENTS) return null
  const steps = readMicrodataProp(html, ['recipeInstructions']).flatMap((value) =>
    toLines(value).map(cleanStep).filter(Boolean),
  )
  const title = readMicrodataProp(html, ['name'])[0] ?? ''
  return {
    title: oneLine(title),
    ingredients,
    groups: steps.length ? [{ name: '', steps }] : [],
    totalTime: html.match(/itemprop\s*=\s*["']totalTime["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1] ?? '',
    prepTime: '',
    cookTime: '',
    servings: oneLine(readMicrodataProp(html, ['recipeYield'])[0] ?? ''),
  }
}

// --- entry point ------------------------------------------------------------

/** A parse worth showing the cook: it has a name, a shopping list, and steps. */
export function isUsable(recipe: ImportedRecipe | null): recipe is ImportedRecipe {
  return (
    !!recipe &&
    !!recipe.title.trim() &&
    recipe.ingredients.length >= MIN_INGREDIENTS &&
    recipe.groups.some((group) => group.steps.length > 0)
  )
}

/**
 * A recipe whose structured data forgot to name it still has a name on the
 * page. The `<h1>` is the recipe's own title; `<title>` carries the site name
 * as well, so it is the last resort and gets its suffix trimmed.
 */
function titleFromPage(html: string): string {
  const heading = oneLine(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? '')
  if (heading) return heading
  const documentTitle = oneLine(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '')
  return documentTitle.split(/\s+[|\u2013\u2014-]\s+/)[0]?.trim() ?? ''
}

function named(recipe: ImportedRecipe, html: string): ImportedRecipe {
  return recipe.title.trim() ? recipe : { ...recipe, title: titleFromPage(html) }
}

export function parseRecipe(html: string): ImportedRecipe | null {
  const nodes = readJsonLdNodes(html)

  const typed = nodes
    .filter((node) => hasType(node, 'Recipe'))
    .map((node) => named(fromNode(node), html))
    .filter(isUsable)
  if (typed[0]) return typed[0]

  // Some publishers omit `@type` but still ship the fields. If an object has a
  // list of ingredients and a set of steps, it is a recipe whatever it calls itself.
  const duckTyped = nodes
    .filter((node) => Array.isArray(node['recipeIngredient']) || Array.isArray(node['ingredients']))
    .map((node) => named(fromNode(node), html))
    .filter(isUsable)
  if (duckTyped[0]) return duckTyped[0]

  const microdata = fromMicrodata(html)
  const withName = microdata ? named(microdata, html) : null
  return isUsable(withName) ? withName : null
}
