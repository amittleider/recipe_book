import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { pinnedKind, type Section, type SectionKind } from '../lib/recipeDocument'
import { colors, fonts } from '../theme'

/**
 * One section of the recipe, as a form.
 *
 * A section is either a list or a block of free text, and the cook switches
 * between those shapes with the control in its corner. The markdown that shape
 * implies — `- `, `1. ` — is never shown.
 */

type Props = {
  section: Section
  register: (id: string, node: TextInput | null) => void
  onName: (name: string) => void
  onKind: (kind: SectionKind) => void
  onItem: (itemId: string, text: string) => void
  onSplit: (itemId: string, text: string) => void
  onAddItem: (afterId?: string) => void
  onRemoveItem: (itemId: string) => void
  onBody: (body: string) => void
  onRemove: () => void
}

const SHAPES: Array<{ kind: SectionKind; glyph: string; label: string }> = [
  { kind: 'text', glyph: '¶', label: 'Texte libre' },
  { kind: 'bullet', glyph: '•', label: 'Liste à puces' },
  { kind: 'ordered', glyph: '1.', label: 'Liste numérotée' },
]

/** Ingredients and steps get their own wording; a section the cook invented
 *  gets neutral wording, because we have no idea what is in it. */
function itemWords(name: string) {
  switch (pinnedKind(name)) {
    case 'bullet':
      return { first: 'Premier ingrédient', next: 'Ingrédient suivant', add: '+ Ajouter un ingrédient' }
    case 'ordered':
      return { first: 'Première étape', next: 'Étape suivante', add: '+ Ajouter une étape' }
    default:
      return { first: 'Première ligne', next: 'Ligne suivante', add: '+ Ajouter une ligne' }
  }
}

export function SectionCard({
  section,
  register,
  onName,
  onKind,
  onItem,
  onSplit,
  onAddItem,
  onRemoveItem,
  onBody,
  onRemove,
}: Props) {
  const list = section.kind !== 'text'
  const words = itemWords(section.name)
  // Ingredients and a method are simply a bullet list and a numbered list, so
  // the shape control stays out of the way. It reappears only if such a section
  // holds something those shapes cannot express, which would otherwise strand
  // the cook in a text box with no way back.
  const pinned = pinnedKind(section.name)
  const showShapes = pinned !== section.kind

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <TextInput
          ref={(node) => {
            register(section.id, node)
          }}
          style={styles.name}
          value={section.name}
          onChangeText={onName}
          placeholder="Titre de la section"
          placeholderTextColor={colors.muted}
          autoCapitalize="sentences"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Supprimer la section ${section.name || 'sans titre'}`}
          hitSlop={8}
          onPress={onRemove}
          style={({ pressed }) => [styles.remove, pressed ? styles.pressed : undefined]}
        >
          <Text style={styles.removeGlyph}>✕</Text>
        </Pressable>
      </View>

      {showShapes && (
      <View style={styles.shapes}>
        {SHAPES.map((shape) => {
          const active = section.kind === shape.kind
          return (
            <Pressable
              key={shape.kind}
              accessibilityRole="button"
              accessibilityLabel={shape.label}
              accessibilityState={{ selected: active }}
              onPress={() => onKind(shape.kind)}
              style={({ pressed }) => [
                styles.shape,
                active ? styles.shapeActive : undefined,
                pressed ? styles.pressed : undefined,
              ]}
            >
              <Text style={[styles.shapeGlyph, active ? styles.shapeGlyphActive : undefined]}>{shape.glyph}</Text>
            </Pressable>
          )
        })}
      </View>
      )}

      {list ? (
        <View style={styles.items}>
          {section.items.map((item, index) => (
            <View key={item.id} style={styles.item}>
              <Text style={styles.marker}>{section.kind === 'bullet' ? '•' : `${index + 1}.`}</Text>
              <TextInput
                ref={(node) => {
                  register(item.id, node)
                }}
                style={styles.itemInput}
                value={item.text}
                // A line break inside a row means "next row", which is also what
                // makes pasting a block of ingredients land as a proper list.
                onChangeText={(text) => (text.includes('\n') ? onSplit(item.id, text) : onItem(item.id, text))}
                placeholder={index === 0 ? words.first : words.next}
                placeholderTextColor={colors.muted}
                multiline
                blurOnSubmit={false}
                autoCapitalize="sentences"
                autoCorrect
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Supprimer cette ligne"
                hitSlop={8}
                onPress={() => onRemoveItem(item.id)}
                style={({ pressed }) => [styles.strike, pressed ? styles.pressed : undefined]}
              >
                <Text style={styles.strikeGlyph}>−</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => onAddItem()}
            style={({ pressed }) => [styles.add, pressed ? styles.pressed : undefined]}
          >
            <Text style={styles.addText}>{words.add}</Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          style={styles.body}
          value={section.body}
          onChangeText={onBody}
          placeholder="Écrivez ce que vous voulez ici."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          autoCapitalize="sentences"
          autoCorrect
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: fonts.serif, fontSize: 20, color: colors.text, paddingVertical: 4 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  removeGlyph: { color: colors.muted, fontSize: 17 },
  shapes: { flexDirection: 'row', gap: 6, alignSelf: 'flex-start' },
  shape: {
    minWidth: 40,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  shapeActive: { backgroundColor: colors.text, borderColor: colors.text },
  shapeGlyph: { color: colors.muted, fontSize: 15 },
  shapeGlyphActive: { color: colors.background, fontWeight: '600' },
  items: { gap: 2 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  marker: { minWidth: 22, color: colors.muted, fontSize: 16, lineHeight: 24, paddingTop: 8, textAlign: 'right' },
  itemInput: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, paddingVertical: 8, minHeight: 40 },
  strike: { width: 30, height: 40, alignItems: 'center', justifyContent: 'center' },
  strikeGlyph: { color: colors.muted, fontSize: 20 },
  add: { paddingVertical: 8, paddingLeft: 28 },
  addText: { color: colors.muted, fontSize: 15 },
  body: { minHeight: 96, color: colors.text, fontSize: 16, lineHeight: 24, paddingVertical: 6 },
  pressed: { opacity: 0.55 },
} as const)
