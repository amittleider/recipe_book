/**
 * Editing commands over a markdown buffer.
 *
 * Every command is a pure function of `(text, selection)` returning the next
 * text and where the caret should land. Nothing here imports React Native, so
 * the same vocabulary drives a plain `TextInput` today and could drive a block
 * editor later without the toolbar changing.
 *
 * Commands only rewrite the lines the selection actually touches. Markdown they
 * do not recognise is left byte-for-byte alone, which is what lets a recipe
 * hand-edited on a laptop survive a round trip through the phone.
 */

export type Selection = { start: number; end: number }
export type Edit = { text: string; selection: Selection }
export type ListKind = 'bullet' | 'ordered'

/** indent, bullet char, ordinal, gap, content. */
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)\.)(\s+)(.*)$/
const HEADING = /^(#{1,6})\s+/
const INDENT = '  '

function caret(index: number): Selection {
  return { start: index, end: index }
}

/** Bounds of the line containing `index`, excluding its newline. */
function lineAt(text: string, index: number) {
  const start = index <= 0 ? 0 : text.lastIndexOf('\n', index - 1) + 1
  const next = text.indexOf('\n', index)
  return { start, end: next === -1 ? text.length : next }
}

/** The full lines a selection covers. A selection ending on a line break does
 *  not drag in the line that follows it. */
function lineSpan(text: string, selection: Selection) {
  const first = lineAt(text, selection.start)
  if (selection.end <= selection.start) return first
  const tail = text[selection.end - 1] === '\n' ? selection.end - 1 : selection.end
  return { start: first.start, end: lineAt(text, tail).end }
}

function splice(text: string, from: number, to: number, replacement: string): string {
  return text.slice(0, from) + replacement + text.slice(to)
}

function parseItem(line: string) {
  const match = line.match(LIST_ITEM)
  if (!match) return null
  const [, indent = '', bullet, ordinal, , content = ''] = match
  return { indent, bullet, ordinal, content }
}

// --- block commands ---------------------------------------------------------

/**
 * Toggles a heading on the caret's line. Re-applying the same level strips it;
 * a different level replaces it. The caret lands at the end of the line, which
 * is where the next keystroke belongs after tapping a toolbar button.
 */
export function toggleHeading(text: string, selection: Selection, level = 2): Edit {
  const line = lineAt(text, selection.start)
  const body = text.slice(line.start, line.end)
  const hashes = '#'.repeat(level)
  const match = body.match(HEADING)
  const stripped = match ? body.slice(match[0].length) : body
  const next = match?.[1] === hashes ? stripped : `${hashes} ${stripped}`
  return {
    text: splice(text, line.start, line.end, next),
    selection: caret(line.start + next.length),
  }
}

/**
 * Turns the touched lines into a list, or strips the markers if they are
 * already that kind of list. Ordered lists are renumbered from one so the
 * markdown stays tidy even after items are reordered by hand.
 */
export function toggleList(text: string, selection: Selection, kind: ListKind): Edit {
  const span = lineSpan(text, selection)
  const lines = text.slice(span.start, span.end).split('\n')
  const items = lines.map(parseItem)

  const matches = (item: ReturnType<typeof parseItem> | undefined) =>
    kind === 'bullet' ? !!item?.bullet : !!item?.ordinal
  const strip = items.some(matches) && lines.every((line, i) => matches(items[i]) || !line.trim())

  let counter = 0
  const rewritten = lines.map((line, index) => {
    const item = items[index]
    if (!item) {
      // Blank separators inside a selection stay blank rather than becoming
      // empty bullets.
      if (!line.trim()) return line
      if (strip) return line
      counter += 1
      return `${line.match(/^\s*/)?.[0] ?? ''}${marker(kind, counter)}${line.trim()}`
    }
    if (strip) return `${item.indent}${item.content}`
    counter += 1
    return `${item.indent}${marker(kind, counter)}${item.content}`
  })

  const next = rewritten.join('\n')
  return {
    text: splice(text, span.start, span.end, next),
    selection:
      selection.end > selection.start
        ? { start: span.start, end: span.start + next.length }
        : caret(span.start + next.length),
  }
}

function marker(kind: ListKind, ordinal: number) {
  return kind === 'bullet' ? '- ' : `${ordinal}. `
}

/** Which kind of list the caret sits in, if any. Drives the toolbar's shape. */
export function listAt(text: string, selection: Selection): ListKind | null {
  const line = lineAt(text, selection.start)
  const item = parseItem(text.slice(line.start, line.end))
  if (!item) return null
  return item.bullet ? 'bullet' : 'ordered'
}

/**
 * Shifts the touched lines by one indent step. The caret moves by whatever
 * happened to *its own* line, so it keeps its place in the word it was in.
 */
function reindent(text: string, selection: Selection, step: (line: string) => string): Edit {
  const span = lineSpan(text, selection)
  const home = lineAt(text, selection.start).start
  let shift = 0
  let cursor = span.start

  const next = text
    .slice(span.start, span.end)
    .split('\n')
    .map((line) => {
      const moved = line.trim() ? step(line) : line
      if (cursor === home) shift = moved.length - line.length
      cursor += line.length + 1
      return moved
    })
    .join('\n')

  return {
    text: splice(text, span.start, span.end, next),
    selection: caret(Math.max(span.start, selection.start + shift)),
  }
}

export function indent(text: string, selection: Selection): Edit {
  return reindent(text, selection, (line) => INDENT + line)
}

export function outdent(text: string, selection: Selection): Edit {
  return reindent(text, selection, (line) =>
    line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^[ \t]/, ''),
  )
}

// --- inline commands --------------------------------------------------------

/**
 * Wraps the selection in `**` or `*`, or unwraps it when the markers are
 * already there. With nothing selected the caret lands between the markers so
 * the next keystroke is emphasised.
 */
export function toggleEmphasis(text: string, selection: Selection, mark: '**' | '*'): Edit {
  const width = mark.length
  const before = text.slice(Math.max(0, selection.start - width), selection.start)
  const after = text.slice(selection.end, selection.end + width)
  // `*` must not claim one star from a `**` pair and quietly demote bold.
  const bounded = mark === '**' || text.slice(Math.max(0, selection.start - 2), selection.start) !== '**'

  if (before === mark && after === mark && bounded) {
    return {
      text: splice(text, selection.start - width, selection.end + width, text.slice(selection.start, selection.end)),
      selection: { start: selection.start - width, end: selection.end - width },
    }
  }
  const inner = text.slice(selection.start, selection.end)
  return {
    text: splice(text, selection.start, selection.end, `${mark}${inner}${mark}`),
    selection: { start: selection.start + width, end: selection.end + width },
  }
}

/** Drops a literal string in at the caret, replacing any selection. */
export function insertText(text: string, selection: Selection, snippet: string): Edit {
  return {
    text: splice(text, selection.start, selection.end, snippet),
    selection: caret(selection.start + snippet.length),
  }
}

/** A thematic break on its own line, with blank lines around it. */
export function insertRule(text: string, selection: Selection): Edit {
  const line = lineAt(text, selection.start)
  const onBlankLine = !text.slice(line.start, line.end).trim()
  const at = onBlankLine ? line.start : line.end
  const block = onBlankLine ? '---\n' : '\n\n---\n'
  return {
    text: splice(text, at, onBlankLine ? line.end : at, block),
    selection: caret(at + block.length),
  }
}

// --- sections ---------------------------------------------------------------

/** Normalised `##` headings already in the document, for the section chips. */
export function sectionNames(text: string): string[] {
  return [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => normalise(match[1] ?? ''))
}

/** Case- and accent-insensitive, so "Methode" matches "Méthode". */
export function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/**
 * Appends a section at the end of the document and parks the caret on its first
 * line, ready to type. An empty `name` writes a bare `## ` so the cook names the
 * section by typing rather than through a modal.
 */
export function appendSection(text: string, name: string, body: ListKind | 'none' = 'none'): Edit {
  const trimmed = text.replace(/\s+$/, '')
  const lead = trimmed ? `${trimmed}\n\n` : ''

  if (!name) {
    const next = `${lead}## \n`
    return { text: next, selection: caret(lead.length + 3) }
  }
  const opener = body === 'none' ? '' : marker(body, 1)
  const next = `${lead}## ${name}\n\n${opener}\n`
  return { text: next, selection: caret(next.length - 1) }
}

// --- typing behaviour -------------------------------------------------------

/**
 * The index just past a newline the user typed, or null if this change was
 * anything else. Diffing beats reading the caret from state because
 * `onChangeText` fires before the selection catches up.
 */
export function typedNewlineAt(previous: string, next: string): number | null {
  if (next.length !== previous.length + 1) return null
  let index = 0
  while (index < previous.length && previous[index] === next[index]) index += 1
  return next[index] === '\n' ? index + 1 : null
}

/** A fresh item below the caret's line, for the toolbar's explicit button. */
export function newListItem(text: string, selection: Selection): Edit {
  const line = lineAt(text, selection.start)
  const broken = splice(text, line.end, line.end, '\n')
  return continueList(broken, line.end + 1) ?? { text: broken, selection: caret(line.end + 1) }
}

/** Leaves the list: a plain line below the caret's item. */
export function endList(text: string, selection: Selection): Edit {
  const line = lineAt(text, selection.start)
  const item = parseItem(text.slice(line.start, line.end))
  // Stepping off an item that was never filled in should not strand its marker.
  if (item && !item.content.trim()) {
    return { text: splice(text, line.start, line.end, ''), selection: caret(line.start) }
  }
  return { text: splice(text, line.end, line.end, '\n'), selection: caret(line.end + 1) }
}

/**
 * Carries a list across a line break: a new marker on the next line, ordered
 * lists incrementing. Return on an item with no content ends the list instead,
 * which is how every notes app behaves. Null means leave the newline alone.
 */
export function continueList(text: string, index: number): Edit | null {
  if (index <= 0 || text[index - 1] !== '\n') return null
  const start = index === 1 ? 0 : text.lastIndexOf('\n', index - 2) + 1
  const item = parseItem(text.slice(start, index - 1))
  if (!item) return null

  if (!item.content.trim()) {
    return { text: splice(text, start, index, ''), selection: caret(start) }
  }
  const next = item.bullet
    ? `${item.indent}${item.bullet} `
    : `${item.indent}${Number(item.ordinal) + 1}. `
  return {
    text: splice(text, index, index, next),
    selection: caret(index + next.length),
  }
}
