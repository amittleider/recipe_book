import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { RecipeGallery } from './RecipeGallery'
import { inlineText, RecipeMarkdown } from './RecipeMarkdown'
import { TagChip } from './TagChip'
import { getMedia, useMediaVersion } from '../data/mediaStore'
import { getTags, isTagsKey, metaLabel, parse } from '../lib/recipeDocument'
import { colors, fonts } from '../theme'

/**
 * A recipe, laid out as a recipe.
 *
 * It renders the same parsed document the editor edits, so what the cook typed
 * into a field is what shows up here. Free-text sections still go through the
 * markdown renderer, because that is the one place a recipe may hold structure
 * the document model deliberately leaves alone.
 */
export function RecipeView({
  markdown,
  folderId,
  onOpenMedia,
}: {
  markdown: string
  folderId: string
  onOpenMedia: (index: number) => void
}) {
  const document = useMemo(() => parse(markdown), [markdown])
  // The gallery renders the store's list, not the document's: the store has
  // reconciled it against the folder, so it shows a photo added from a laptop
  // and skips a name whose file has gone.
  useMediaVersion()
  const media = getMedia(folderId)
  // Tags are a list, so they get one chip each rather than one pill holding a
  // comma-separated string.
  const meta = document.meta.filter((field) => field.value.trim() && !isTagsKey(field.key))
  const tags = getTags(document)

  return (
    <View style={styles.page}>
      {!!document.title && <Text style={styles.title}>{document.title}</Text>}

      {(meta.length > 0 || tags.length > 0) && (
        <View style={styles.meta}>
          {meta.map((field) => (
            <View key={field.id} style={styles.pill}>
              <Text style={styles.pillLabel}>{metaLabel(field.key)}</Text>
              <Text style={styles.pillValue}>{field.value}</Text>
            </View>
          ))}
          {tags.map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
        </View>
      )}

      <RecipeGallery folderId={folderId} media={media} onOpen={onOpenMedia} />

      {!!document.preamble.trim() && (
        <View style={styles.block}>
          <RecipeMarkdown folderId={folderId}>{document.preamble}</RecipeMarkdown>
        </View>
      )}

      {document.sections.map((section) => (
        <View key={section.id} style={styles.block}>
          {!!section.name && <Text style={styles.heading}>{section.name}</Text>}
          {section.kind === 'text' ? (
            <RecipeMarkdown folderId={folderId}>{section.body}</RecipeMarkdown>
          ) : (
            section.items
              .filter((item) => item.text.trim())
              .map((item, index) => (
                <View key={item.id} style={styles.row}>
                  <Text style={styles.marker}>{section.kind === 'bullet' ? '•' : `${index + 1}.`}</Text>
                  <Text style={styles.itemText}>{inlineText(item.text)}</Text>
                </View>
              ))
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 4 },
  title: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 40, color: colors.text, marginBottom: 10 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  pillValue: { color: colors.text, fontSize: 15 },
  block: { marginTop: 14 },
  heading: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, color: colors.text, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 4 },
  marker: { minWidth: 26, color: colors.muted, fontSize: 16, lineHeight: 24 },
  itemText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 },
} as const)
