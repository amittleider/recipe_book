import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

/**
 * One tag, as a chip.
 *
 * The geometry is the meta pill's from `RecipeView` and the selected state is
 * the shape control's from `SectionCard` — a filter chip, an applied tag and a
 * suggestion are the same object in three states, so they are one component
 * rather than three lookalikes.
 */

export type TagChipVariant =
  /** Offered but not applied: an unselected filter, a tag from the vocabulary. */
  | 'plain'
  /** Applied: a selected filter, a tag this recipe carries. */
  | 'selected'
  /** Not in the cookbook yet: the offer to create what was typed. */
  | 'new'

type Props = {
  label: string
  variant?: TagChipVariant
  onPress?: () => void
  /** Shows a `✕` that removes the tag. Nothing else in this app draws icons. */
  onRemove?: () => void
  disabled?: boolean
}

export function TagChip({ label, variant = 'plain', onPress, onRemove, disabled }: Props) {
  const selected = variant === 'selected'
  const body = (
    <>
      <Text style={[styles.label, selected ? styles.labelSelected : undefined]} numberOfLines={1}>
        {label}
      </Text>
      {!!onRemove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${label}`}
          onPress={onRemove}
          disabled={disabled}
          hitSlop={10}
        >
          <Text style={[styles.remove, selected ? styles.labelSelected : undefined]}>✕</Text>
        </Pressable>
      )}
    </>
  )

  if (!onPress) {
    return <View style={[styles.chip, variantStyle(variant)]}>{body}</View>
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        variantStyle(variant),
        pressed ? styles.pressed : undefined,
        disabled ? styles.disabled : undefined,
      ]}
    >
      {body}
    </Pressable>
  )
}

function variantStyle(variant: TagChipVariant) {
  if (variant === 'selected') return styles.selected
  if (variant === 'new') return styles.new
  return undefined
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 34,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 17,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  selected: { backgroundColor: colors.text, borderColor: colors.text },
  new: { backgroundColor: colors.background, borderStyle: 'dashed' },
  label: { color: colors.text, fontSize: 15 },
  labelSelected: { color: colors.background, fontWeight: '600' },
  remove: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
} as const)
