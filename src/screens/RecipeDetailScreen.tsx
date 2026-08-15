import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { AuthError, findRecipeFile, readFile } from '../api/drive'
import { Button, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { RecipeMarkdown } from '../components/RecipeMarkdown'
import type { RecipeSummary } from '../types'

type Props = {
  recipe: RecipeSummary
  onBack: () => void
  onEdit: (recipe: RecipeSummary) => void
  onAuthError: () => void
}

export function RecipeDetailScreen({ recipe, onBack, onEdit, onAuthError }: Props) {
  const [markdown, setMarkdown] = useState('')
  const [fileId, setFileId] = useState(recipe.fileId)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const id = fileId ?? await findRecipeFile(recipe.folderId)
        if (!mounted) return
        setFileId(id)
        setMarkdown(id ? await readFile(id) : '')
      } catch (caught) {
        if (caught instanceof AuthError) return onAuthError()
        if (mounted) setError(caught instanceof Error ? caught.message : 'Lecture impossible')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => { mounted = false }
  }, [recipe.folderId])

  return (
    <Screen>
      <Header
        title="Recette"
        left={<Button variant="link" onPress={onBack}>‹ Retour</Button>}
        right={<Button variant="secondary" onPress={() => onEdit({ ...recipe, fileId })}>Modifier</Button>}
      />
      {loading ? <LoadingState /> : (
        <ScrollView contentContainerStyle={styles.content}>
          <ErrorBanner message={error} />
          <RecipeMarkdown>{markdown}</RecipeMarkdown>
        </ScrollView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({ content: { padding: 20, paddingBottom: 50 } } as const)
