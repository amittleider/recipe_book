/**
 * The recipe document: the structure behind the form.
 *
 * Markdown stays the storage format. This module is the only place that knows
 * how to get from a `recipe.md` to fields on a screen and back, so no screen
 * ever has to show markdown to the cook.
 *
 * Structure is only imposed where it is unambiguous. A section whose lines are
 * all plain bullets becomes a bullet list, one whose lines are all `1.` becomes
 * a numbered list, and *everything else* — a table, a nested list, prose, an
 * HTML comment, a sub-heading — is kept verbatim as a free-text section. That
 * rule is what keeps a recipe someone wrote on a laptop from being quietly
 * flattened by an edit made on a phone.
 */

export type SectionKind = 'bullet' | 'ordered' | 'text'

export type Item = { id: string; text: string }
export type MetaField = { id: string; key: string; value: string }

export type Section = {
  id: string
  name: string
  kind: SectionKind
  /** Used by `bullet` and `ordered`. */
  items: Item[]
  /** Used by `text`, verbatim including any markdown the model cannot model. */
  body: string
}

export type RecipeDocument = {
  title: string
  meta: MetaField[]
  /** Anything between the meta line and the first section, kept as written. */
  preamble: string
  sections: Section[]
}

/**
 * Meta keys the form gives a dedicated field. The keys are the ones already
 * written to Drive — `parseTime` in `markdown.ts` reads `**Time:**` — so they
 * stay English while the labels the cook sees are French.
 */
export const KNOWN_META: Array<{ key: string; label: string; placeholder: string }> = [
  { key: 'Serves', label: 'Portions', placeholder: '4' },
  { key: 'Time', label: 'Temps', placeholder: '45 min' },
]

/** Empty sections take their shape from their name, so a fresh recipe round-trips. */
const SECTION_DEFAULTS: Array<{ names: string[]; kind: SectionKind }> = [
  { names: ['ingredients'], kind: 'bullet' },
  { names: ['methode', 'method', 'preparation', 'instructions', 'etapes'], kind: 'ordered' },
]

const TITLE = /^#\s+(.*)$/
const SECTION = /^##\s+(.*)$/
const BULLET = /^[-*+]\s+(.*)$/
const ORDERED = /^\d+\.\s+(.*)$/
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/
const META_PAIR = /\*\*\s*([^*:]+?)\s*:\s*\*\*\s*([^*]*)/g

let sequence = 0
function id(): string {
  sequence += 1
  return `f${sequence}`
}

export function newItem(text = ''): Item {
  return { id: id(), text }
}

export function newSection(name = '', kind: SectionKind = 'text'): Section {
  return { id: id(), name, kind, items: kind === 'text' ? [] : [newItem()], body: '' }
}

/** Case- and accent-insensitive, so "Methode" matches "Méthode". */
export function normalise(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

// --- parsing ----------------------------------------------------------------

function trimBlank(lines: string[]): string[] {
  const kept = [...lines]
  while (kept.length && !kept[0]?.trim()) kept.shift()
  while (kept.length && !kept[kept.length - 1]?.trim()) kept.pop()
  return kept
}

/**
 * Meta fields, if the line is *nothing but* `**Key:** value` pairs. A line that
 * mixes prose with a bold run is prose, and belongs in the preamble untouched.
 */
function parseMetaLine(line: string): MetaField[] | null {
  const trimmed = line.trim()
  const pairs = [...trimmed.matchAll(META_PAIR)]
  if (!pairs.length) return null
  const consumed = pairs.reduce((total, pair) => total + pair[0].length, 0)
  if (consumed < trimmed.length) return null
  return pairs.map((pair) => ({ id: id(), key: (pair[1] ?? '').trim(), value: (pair[2] ?? '').trim() }))
}

/**
 * The shape a section's name takes for granted: ingredients are a bullet list,
 * a method is a numbered one. The form does not offer to change those, so this
 * also decides whether a section shows its shape control at all.
 */
export function pinnedKind(name: string): SectionKind | null {
  const key = normalise(name)
  return SECTION_DEFAULTS.find((entry) => entry.names.includes(key))?.kind ?? null
}

function defaultKind(name: string): SectionKind {
  return pinnedKind(name) ?? 'text'
}

function buildSection(name: string, raw: string[]): Section {
  const lines = trimBlank(raw)
  const content = lines.filter((line) => line.trim())
  // Indented lines mean a nested structure this model would flatten, so they
  // disqualify the section from becoming a list.
  const flat = content.every((line) => !/^\s/.test(line))

  if (!content.length) return { id: id(), name, kind: defaultKind(name), items: [newItem()], body: '' }

  if (flat && content.every((line) => BULLET.test(line))) {
    return { id: id(), name, kind: 'bullet', items: content.map((line) => newItem(line.match(BULLET)?.[1]?.trim() ?? '')), body: '' }
  }
  if (flat && content.every((line) => ORDERED.test(line))) {
    return { id: id(), name, kind: 'ordered', items: content.map((line) => newItem(line.match(ORDERED)?.[1]?.trim() ?? '')), body: '' }
  }
  return { id: id(), name, kind: 'text', items: [], body: lines.join('\n') }
}

export function parse(markdown: string): RecipeDocument {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let title = ''
  const meta: MetaField[] = []
  const head: string[] = []
  const sections: Section[] = []
  let open: { name: string; lines: string[] } | null = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = line.match(SECTION)
    if (heading) {
      if (open) sections.push(buildSection(open.name, open.lines))
      open = { name: (heading[1] ?? '').trim(), lines: [] }
      continue
    }
    if (open) {
      // A horizontal rule closes the section it sits in. The old template put
      // one before its closing note, which would otherwise drag the whole
      // Method section into free text and cost it its numbered steps.
      if (RULE.test(line.trim())) {
        sections.push(buildSection(open.name, open.lines))
        open = { name: '', lines: [] }
        continue
      }
      open.lines.push(line)
      continue
    }
    const titled = line.match(TITLE)
    if (titled && !title) {
      title = (titled[1] ?? '').trim()
      continue
    }
    const fields = parseMetaLine(line)
    if (fields) {
      meta.push(...fields)
      continue
    }
    head.push(line)
  }
  if (open) sections.push(buildSection(open.name, open.lines))

  // Rules are dropped only from the preamble, where the old template used them
  // as decoration. Inside a section they are content and stay put.
  const preamble = trimBlank(head.filter((line) => !RULE.test(line.trim()))).join('\n')
  return withKnownMeta({ title, meta, preamble, sections })
}

/** Guarantees a field for every known key so the form always offers them. */
export function withKnownMeta(document: RecipeDocument): RecipeDocument {
  const present = new Set(document.meta.map((field) => normalise(field.key)))
  const missing = KNOWN_META.filter((known) => !present.has(normalise(known.key)))
  const meta = [...document.meta, ...missing.map((known) => ({ id: id(), key: known.key, value: '' }))]
  const rank = (field: MetaField) => {
    const index = KNOWN_META.findIndex((known) => normalise(known.key) === normalise(field.key))
    return index === -1 ? KNOWN_META.length : index
  }
  return { ...document, meta: meta.sort((a, b) => rank(a) - rank(b)) }
}

export function blankDocument(): RecipeDocument {
  return withKnownMeta({
    title: '',
    meta: [],
    preamble: '',
    sections: [newSection('Ingrédients', 'bullet'), newSection('Méthode', 'ordered')],
  })
}

// --- serialising ------------------------------------------------------------

function sectionLines(section: Section): string[] {
  if (section.kind === 'text') return trimBlank(section.body.split('\n'))
  // A stray newline inside an item would break the list, so items stay on one line.
  const items = section.items.map((item) => item.text.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
  return items.map((text, index) => (section.kind === 'bullet' ? `- ${text}` : `${index + 1}. ${text}`))
}

export function serialize(document: RecipeDocument): string {
  const blocks: string[] = []

  const title = document.title.trim()
  if (title) blocks.push(`# ${title}`)

  const meta = document.meta.filter((field) => field.key.trim() && field.value.trim())
  if (meta.length) {
    blocks.push(meta.map((field) => `**${field.key.trim()}:** ${field.value.trim()}`).join('  '))
  }

  const preamble = document.preamble.trim()
  if (preamble) blocks.push(preamble)

  for (const section of document.sections) {
    const name = section.name.trim()
    const lines = sectionLines(section)
    if (!name && !lines.length) continue
    // A named section keeps its heading even while empty, so a recipe reopens
    // with the same shape the cook left it in. An unnamed one is a loose block
    // and is written back the way it was read: behind a rule.
    blocks.push(name ? `## ${name}` : '---')
    if (lines.length) blocks.push(lines.join('\n'))
  }

  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}

// --- editing ----------------------------------------------------------------

function mapSection(
  document: RecipeDocument,
  sectionId: string,
  change: (section: Section) => Section,
): RecipeDocument {
  return {
    ...document,
    sections: document.sections.map((section) => (section.id === sectionId ? change(section) : section)),
  }
}

export function setSection(document: RecipeDocument, sectionId: string, patch: Partial<Section>): RecipeDocument {
  return mapSection(document, sectionId, (section) => ({ ...section, ...patch }))
}

/** Switching shape carries the content across rather than discarding it. */
export function setSectionKind(document: RecipeDocument, sectionId: string, kind: SectionKind): RecipeDocument {
  return mapSection(document, sectionId, (section) => {
    if (section.kind === kind) return section
    if (kind === 'text') {
      const body = sectionLines({ ...section, kind: section.kind })
        .map((line) => line.replace(BULLET, '$1').replace(ORDERED, '$1'))
        .join('\n')
      return { ...section, kind, body: section.kind === 'text' ? section.body : body, items: [] }
    }
    const items =
      section.kind === 'text'
        ? trimBlank(section.body.split('\n')).filter((line) => line.trim()).map((line) => newItem(line.trim()))
        : section.items
    return { ...section, kind, items: items.length ? items : [newItem()], body: '' }
  })
}

export function setItem(document: RecipeDocument, sectionId: string, itemId: string, text: string): RecipeDocument {
  return mapSection(document, sectionId, (section) => ({
    ...section,
    items: section.items.map((item) => (item.id === itemId ? { ...item, text } : item)),
  }))
}

export function removeItem(document: RecipeDocument, sectionId: string, itemId: string): RecipeDocument {
  return mapSection(document, sectionId, (section) => {
    const items = section.items.filter((item) => item.id !== itemId)
    // A list always offers one row to type into.
    return { ...section, items: items.length ? items : [newItem()] }
  })
}

/** Adds a row after `afterId` (or at the end) and reports which one to focus. */
export function addItem(
  document: RecipeDocument,
  sectionId: string,
  afterId?: string,
): { document: RecipeDocument; focus: string } {
  const created = newItem()
  return {
    document: mapSection(document, sectionId, (section) => {
      const at = afterId ? section.items.findIndex((item) => item.id === afterId) + 1 : section.items.length
      const items = [...section.items]
      items.splice(at, 0, created)
      return { ...section, items }
    }),
    focus: created.id,
  }
}

/**
 * Turns one row into several. Typing or pasting a line break inside an item
 * means "next item", which is also what makes pasting a block of ingredients
 * from somewhere else land as a proper list.
 */
export function splitItem(
  document: RecipeDocument,
  sectionId: string,
  itemId: string,
  text: string,
): { document: RecipeDocument; focus: string } {
  const parts = text.split('\n')
  const created = parts.slice(1).map((part) => newItem(part.trim()))
  const last = created[created.length - 1]
  return {
    document: mapSection(document, sectionId, (section) => ({
      ...section,
      items: section.items.flatMap((item) =>
        item.id === itemId ? [{ ...item, text: (parts[0] ?? '').trim() }, ...created] : [item],
      ),
    })),
    focus: last?.id ?? itemId,
  }
}

export function addSection(document: RecipeDocument): { document: RecipeDocument; focus: string } {
  const created = newSection()
  return { document: { ...document, sections: [...document.sections, created] }, focus: created.id }
}

export function removeSection(document: RecipeDocument, sectionId: string): RecipeDocument {
  return { ...document, sections: document.sections.filter((section) => section.id !== sectionId) }
}

export function setMeta(document: RecipeDocument, fieldId: string, value: string): RecipeDocument {
  return {
    ...document,
    meta: document.meta.map((field) => (field.id === fieldId ? { ...field, value } : field)),
  }
}

/** The French label for a meta key, falling back to the key as written. */
export function metaLabel(key: string): string {
  return KNOWN_META.find((known) => normalise(known.key) === normalise(key))?.label ?? key
}

export function metaPlaceholder(key: string): string {
  return KNOWN_META.find((known) => normalise(known.key) === normalise(key))?.placeholder ?? ''
}
