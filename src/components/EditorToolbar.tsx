import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import {
  appendSection,
  endList,
  indent,
  insertRule,
  insertText,
  listAt,
  newListItem,
  normalise,
  outdent,
  sectionNames,
  toggleEmphasis,
  toggleHeading,
  toggleList,
  type Edit,
  type ListKind,
  type Selection,
} from '../lib/markdownCommands'
import { colors } from '../theme'

/**
 * The keyboard's companion: recipe scaffolds on top, markdown tools below.
 *
 * It holds no state. Everything it offers is derived from the text and the
 * caret, so the same bar serves a blank recipe and a half-written one.
 */

type Props = {
  text: string
  selection: Selection
  onEdit: (edit: Edit) => void
}

/**
 * Suggested sections. Nothing here is required; `+ section` covers the rest.
 *
 * `also` lists other spellings that count as already present, so a recipe
 * written against the older English template does not get offered a duplicate
 * French section alongside the one it already has.
 */
const SECTIONS: Array<{ label: string; body: ListKind | 'none'; also?: string[] }> = [
  { label: 'Ingrédients', body: 'bullet', also: ['ingredients'] },
  { label: 'Méthode', body: 'ordered', also: ['method', 'preparation', 'instructions', 'etapes'] },
  { label: 'Notes', body: 'none', also: ['note', 'notes'] },
]

/** Characters a recipe needs constantly and the keyboard buries. */
const SYMBOLS = ['½', '⅓', '¼', '¾', '°', '×']

export function EditorToolbar({ text, selection, onEdit }: Props) {
  const present = new Set(sectionNames(text))
  // A section already in the recipe drops off the bar, so the row doubles as a
  // list of what is still missing.
  const missing = SECTIONS.filter(
    (section) => ![normalise(section.label), ...(section.also ?? [])].some((name) => present.has(name)),
  )
  const list = listAt(text, selection)

  return (
    <View style={styles.bar}>
      <Row>
        {missing.map((section) => (
          <Key
            key={section.label}
            label={section.label}
            variant="chip"
            onPress={() => onEdit(appendSection(text, section.label, section.body))}
          />
        ))}
        <Key label="+ section" variant="chip" onPress={() => onEdit(appendSection(text, ''))} />
      </Row>
      <Row>
        {list ? (
          <>
            <Key label="+ élément" onPress={() => onEdit(newListItem(text, selection))} />
            <Key label="⇥" hint="Indenter" onPress={() => onEdit(indent(text, selection))} />
            <Key label="⇤" hint="Désindenter" onPress={() => onEdit(outdent(text, selection))} />
            <Key label="Terminer" onPress={() => onEdit(endList(text, selection))} />
          </>
        ) : (
          <>
            <Key label="H" hint="Titre de section" onPress={() => onEdit(toggleHeading(text, selection))} />
            <Key label="•" hint="Liste" onPress={() => onEdit(toggleList(text, selection, 'bullet'))} />
            <Key label="1." hint="Liste numérotée" onPress={() => onEdit(toggleList(text, selection, 'ordered'))} />
            <Key label="—" hint="Séparateur" onPress={() => onEdit(insertRule(text, selection))} />
          </>
        )}
        <Divider />
        <Key label="B" style={styles.bold} hint="Gras" onPress={() => onEdit(toggleEmphasis(text, selection, '**'))} />
        <Key label="i" style={styles.italic} hint="Italique" onPress={() => onEdit(toggleEmphasis(text, selection, '*'))} />
        <Divider />
        {SYMBOLS.map((symbol) => (
          <Key key={symbol} label={symbol} onPress={() => onEdit(insertText(text, selection, symbol))} />
        ))}
      </Row>
    </View>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  )
}

function Key({
  label,
  hint,
  variant = 'key',
  style,
  onPress,
}: {
  label: string
  hint?: string
  variant?: 'key' | 'chip'
  style?: StyleProp<TextStyle>
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ?? label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.key,
        variant === 'chip' ? styles.chip : undefined,
        pressed ? styles.pressed : undefined,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.keyText, variant === 'chip' ? styles.chipText : undefined, style]}>{label}</Text>
    </Pressable>
  )
}

function Divider() {
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: 6,
    gap: 6,
  },
  row: { paddingHorizontal: 10, gap: 8, alignItems: 'center' },
  key: {
    minWidth: 42,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chip: { borderRadius: 19, borderColor: colors.text, backgroundColor: colors.surface },
  keyText: { color: colors.text, fontSize: 16 },
  chipText: { fontSize: 14, fontWeight: '600' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 4, backgroundColor: colors.border },
  pressed: { opacity: 0.6 },
} as const)
