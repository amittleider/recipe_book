import { Pressable, StyleSheet, Text, View } from 'react-native'
import { TagChip } from './TagChip'
import { hasTag } from '../lib/tags'
import { colors } from '../theme'

/**
 * The cookbook's tags, as filters.
 *
 * It sits above the list rather than over it so that every tap visibly reduces
 * what is underneath — which is the whole point of filtering by hand instead of
 * typing a query.
 */
export function TagFilterPanel({
  tags,
  selected,
  onToggle,
  onClear,
}: {
  tags: string[]
  selected: string[]
  onToggle: (tag: string) => void
  onClear: () => void
}) {
  if (!tags.length) {
    return (
      <View style={styles.panel}>
        <Text style={styles.empty}>Aucun tag pour l’instant. Ajoutez-en depuis « Modifier ».</Text>
      </View>
    )
  }

  return (
    <View style={styles.panel}>
      <View style={styles.chips}>
        {tags.map((tag) => (
          <TagChip
            key={tag}
            label={tag}
            variant={hasTag(selected, tag) ? 'selected' : 'plain'}
            onPress={() => onToggle(tag)}
          />
        ))}
      </View>
      {selected.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={onClear}
          style={({ pressed }) => [styles.clear, pressed ? styles.pressed : undefined]}
          hitSlop={8}
        >
          <Text style={styles.clearText}>Tout effacer</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  clear: { alignSelf: 'flex-start' },
  clearText: { color: colors.muted, fontSize: 13, textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
} as const)
