import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native'
import {
  AuthError,
  createRecipe,
  createRecipeFile,
  findRecipeFile,
  readFile,
  updateFile,
} from '../api/drive'
import { Button, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { NEW_RECIPE_TEMPLATE, parseTime, parseTitle, titleToSlug } from '../lib/markdown'
import { colors, fonts } from '../theme'
import type { RecipeSummary } from '../types'

type Props = {
  recipe: RecipeSummary | null
  rootId: string
  onSaved: (recipe: RecipeSummary) => void
  onCancel: () => void
  onAuthError: () => void
}

export function EditorScreen({ recipe, rootId, onSaved, onCancel, onAuthError }: Props) {
  const isNew = !recipe
  const [text, setText] = useState(isNew ? NEW_RECIPE_TEMPLATE : '')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!recipe) return
    let mounted = true
    async function load() {
      try {
        const id = recipe?.fileId ?? await findRecipeFile(recipe!.folderId)
        const content = id ? await readFile(id) : NEW_RECIPE_TEMPLATE
        if (mounted) setText(content)
      } catch (caught) {
        if (caught instanceof AuthError) return onAuthError()
        if (mounted) setError(caught instanceof Error ? caught.message : 'Lecture impossible')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => { mounted = false }
  }, [recipe?.folderId])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const title = parseTitle(text, recipe?.slug ?? 'recette')
      const time = parseTime(text)
      if (!recipe) {
        const slug = titleToSlug(title) || 'recette'
        const created = await createRecipe(rootId, slug, text)
        onSaved({ folderId: created.id, fileId: created.fileId, slug, title, time })
      } else {
        let fileId = recipe.fileId ?? await findRecipeFile(recipe.folderId)
        if (fileId) await updateFile(fileId, text)
        else fileId = await createRecipeFile(recipe.folderId, text)
        onSaved({ ...recipe, fileId, title, time })
      }
    } catch (caught) {
      if (caught instanceof AuthError) return onAuthError()
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen>
      <Header title={isNew ? 'Nouvelle recette' : 'Modifier'} />
      {loading ? <LoadingState /> : (
        <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={58}>
          <ErrorBanner message={error} />
          <TextInput
            style={styles.editor}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
          />
          <View style={styles.actions}>
            <Button style={styles.action} variant="secondary" onPress={onCancel} disabled={saving}>Annuler</Button>
            <Button style={styles.action} onPress={save} disabled={saving} busy={saving}>Enregistrer</Button>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20 },
  editor: { flex: 1, minHeight: 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, color: colors.text, fontFamily: fonts.mono, fontSize: 15, lineHeight: 23 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  action: { flex: 1 },
} as const)
