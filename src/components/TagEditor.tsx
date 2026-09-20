import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { TagChip } from './TagChip'
import { addTag, cleanTag, hasTag, removeTag, resolveTag, tagKey } from '../lib/tags'
import { colors } from '../theme'

/**
 * Tagging a recipe.
 *
 * Tags are created by using them, the way an email label is: there is no
 * separate place to define one first. One field does both jobs — it filters the
 * cookbook's vocabulary as you type, and offers to create what you typed when
 * nothing matches — so choosing an existing tag and inventing a new one are the
 * same gesture rather than two different controls to choose between.
 */

/** Tags shown before the cook has typed anything. Enough to browse, not a wall. */
const BROWSE_LIMIT = 12

type Props = {
  tags: string[]
  /** The whole cookbook's vocabulary; applied ones are filtered out here. */
  vocabulary: string[]
  onChange: (tags: string[]) => void
}

export function TagEditor({ tags, vocabulary, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState(false)

  const typed = cleanTag(draft)
  const key = tagKey(typed)

  const unapplied = useMemo(
    () => vocabulary.filter((tag) => !hasTag(tags, tag)),
    [tags, vocabulary],
  )

  const matches = useMemo(
    () => (key ? unapplied.filter((tag) => tagKey(tag).includes(key)) : unapplied),
    [key, unapplied],
  )

  // Typing a tag the recipe already carries should say so, rather than leaving
  // the list mysteriously empty and the return key apparently broken.
  const alreadyApplied = !!typed && hasTag(tags, typed)
  const known = !!key && vocabulary.some((tag) => tagKey(tag) === key)
  const canCreate = !!typed && !known && !alreadyApplied

  const browsing = !typed
  const visible = browsing && !expanded ? matches.slice(0, BROWSE_LIMIT) : matches
  const hidden = matches.length - visible.length

  function apply(tag: string) {
    onChange(addTag(tags, resolveTag(vocabulary, tag)))
    setDraft('')
  }

  /** Return takes the obvious action: the one exact match, or what was typed. */
  function commit() {
    if (!typed || alreadyApplied) return
    apply(typed)
  }

  return (
    <View style={styles.editor}>
      {tags.length > 0 && (
        <View style={styles.chips}>
          {tags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              variant="selected"
              onRemove={() => onChange(removeTag(tags, tag))}
            />
          ))}
        </View>
      )}

      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commit}
        // Recipes get several tags at once, so the keyboard stays up and the
        // field empties itself, ready for the next one.
        blurOnSubmit={false}
        returnKeyType="done"
        placeholder={vocabulary.length ? 'Chercher ou créer un tag…' : 'Créer un tag…'}
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />

      {alreadyApplied && (
        <Text style={styles.note}>« {typed} » est déjà sur cette recette.</Text>
      )}

      {(canCreate || visible.length > 0) && (
        <View style={styles.chips}>
          {canCreate && <TagChip label={`＋ ${typed}`} variant="new" onPress={() => apply(typed)} />}
          {visible.map((tag) => (
            <TagChip key={tag} label={tag} onPress={() => apply(tag)} />
          ))}
          {hidden > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(true)}
              style={({ pressed }) => [styles.more, pressed ? styles.pressed : undefined]}
            >
              <Text style={styles.moreText}>+{hidden} autres</Text>
            </Pressable>
          )}
        </View>
      )}

      {!typed && !unapplied.length && (
        <Text style={styles.note}>
          {vocabulary.length
            ? 'Tous les tags du carnet sont déjà sur cette recette.'
            : 'Le premier tag que vous créez sera proposé sur les autres recettes.'}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  editor: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  more: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 4 },
  moreText: { color: colors.muted, fontSize: 13, textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
} as const)
