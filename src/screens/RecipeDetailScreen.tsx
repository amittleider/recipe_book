import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { AuthError } from '../api/drive'
import { getBody, revalidateRecipe, saveRecipe, useRecipe } from '../data/recipeStore'
import { addMedia, getMedia, useMediaVersion, type PickedAsset } from '../data/mediaStore'
import { Button, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { MediaViewer } from '../components/MediaViewer'
import { RecipeView } from '../components/RecipeView'
import { chooseMedia } from '../lib/mediaPicker'
import { parse, serialize, setMedia } from '../lib/recipeDocument'
import { colors } from '../theme'

type Props = {
  folderId: string
  onBack: () => void
  onEdit: (folderId: string) => void
  onAuthError: () => void
}

export function RecipeDetailScreen({ folderId, onBack, onEdit, onAuthError }: Props) {
  const recipe = useRecipe(folderId)
  const markdown = getBody(recipe?.fileId ?? null)
  const [error, setError] = useState('')
  // Only ever block on the network when there is nothing cached to show.
  const [loading, setLoading] = useState(markdown === null)
  const [viewing, setViewing] = useState<number | null>(null)
  useMediaVersion()
  const media = getMedia(folderId)

  useEffect(() => {
    let mounted = true
    revalidateRecipe(folderId)
      .catch((caught: unknown) => {
        if (caught instanceof AuthError) return onAuthError()
        // A failed refresh is silent while cached content is on screen.
        if (mounted && markdown === null) {
          setError(caught instanceof Error ? caught.message : 'Lecture impossible')
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [folderId])

  /**
   * Adding a photo from the recipe itself, without passing through the form.
   *
   * The picture is on screen before this returns: `addMedia` writes the bytes
   * and the entry first, and the upload runs behind it. Writing the reference
   * into `recipe.md` is the only part that can fail here, and it failing costs
   * the ordering, not the photo — an uploaded file the markdown does not mention
   * is still shown, which is the same rule that makes a photo dropped into the
   * Drive folder from a laptop appear.
   */
  const addPhotos = useCallback(
    async (assets: PickedAsset[]) => {
      setError('')
      const added = addMedia(folderId, assets)
      if (!added.length || markdown === null) return
      try {
        const document = parse(markdown)
        const names = [...document.media, ...added.map((entry) => entry.name)]
        await saveRecipe(recipe, serialize(setMedia(document, names)))
      } catch (caught) {
        if (caught instanceof AuthError) return onAuthError()
        setError('Photo ajoutée, mais la recette n’a pas pu être enregistrée.')
      }
    },
    [folderId, markdown, recipe, onAuthError],
  )

  return (
    <Screen>
      <Header
        title="Recette"
        left={<Button variant="link" onPress={onBack}>‹ Retour</Button>}
        right={<Button variant="secondary" onPress={() => onEdit(folderId)}>Modifier</Button>}
      />
      {loading && markdown === null ? (
        <LoadingState />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ErrorBanner message={error} />
          {markdown === null ? (
            <Text style={styles.missing}>Cette recette n’a pas encore de contenu.</Text>
          ) : (
            <RecipeView markdown={markdown} folderId={folderId} onOpenMedia={setViewing} />
          )}
        </ScrollView>
      )}

      {markdown !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter une photo"
          onPress={() => chooseMedia((assets) => void addPhotos(assets))}
          style={({ pressed }) => [styles.capture, pressed ? styles.pressed : undefined]}
        >
          <Text style={styles.captureIcon}>📷</Text>
        </Pressable>
      )}

      {viewing !== null && media.length > 0 && (
        <MediaViewer
          folderId={folderId}
          media={media}
          index={Math.min(viewing, media.length - 1)}
          onClose={() => setViewing(null)}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 96 },
  missing: { color: colors.muted, textAlign: 'center', paddingVertical: 40 },
  capture: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.text,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  captureIcon: { fontSize: 24 },
  pressed: { opacity: 0.7 },
} as const)
