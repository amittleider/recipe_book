import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { AuthError } from '../api/drive'
import { getBody, revalidateRecipe, useRecipe } from '../data/recipeStore'
import { Button, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { RecipeMarkdown } from '../components/RecipeMarkdown'
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
            <RecipeMarkdown>{markdown}</RecipeMarkdown>
          )}
        </ScrollView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 50 },
  missing: { color: colors.muted, textAlign: 'center', paddingVertical: 40 },
} as const)
