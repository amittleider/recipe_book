import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button, ErrorBanner, Header, Screen } from '../components/ui'
import { ImportError } from '../import/errors'
import { importRecipe } from '../import/importRecipe'
import type { RecipeDocument } from '../lib/recipeDocument'
import { colors, fonts } from '../theme'

type Props = {
  /** The link last imported, so backing out of the editor does not lose it. */
  initialUrl?: string
  onImported: (document: RecipeDocument, url: string) => void
  onCancel: () => void
}

/**
 * Paste a link, get a filled-in editor.
 *
 * Nothing is written to Drive from here. A successful import hands the cook the
 * ordinary recipe form with the fields already populated, so the last word on
 * what gets saved stays theirs — which is what makes a parser that is right
 * most of the time good enough.
 */
export function ImportScreen({ initialUrl = '', onImported, onCancel }: Props) {
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (busy || !url.trim()) return
    setBusy(true)
    setError('')
    try {
      const imported = await importRecipe(url)
      onImported(imported.document, imported.url)
    } catch (caught) {
      // The link stays in the field either way: a failed import is usually one
      // typo or one other site away from working.
      setError(
        caught instanceof ImportError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Import impossible',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Header title="Importer une recette" left={<Button variant="link" onPress={onCancel}>Annuler</Button>} />
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={58}
      >
        <View style={styles.form}>
          <ErrorBanner message={error} />
          <Text style={styles.label}>Lien de la recette</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.marmiton.org/recettes/…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            autoFocus={!initialUrl}
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={() => void run()}
          />
          <Text style={styles.hint}>
            La recette est lue depuis la page, puis ouverte dans l’éditeur pour que vous puissiez la
            relire avant de l’enregistrer.
          </Text>
        </View>
        <View style={styles.actions}>
          <Button onPress={() => void run()} disabled={busy || !url.trim()} busy={busy}>
            Importer
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  form: { flex: 1, padding: 20, gap: 8 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: {
    minHeight: 48,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 21, fontFamily: fonts.serif, marginTop: 6 },
  actions: {
    padding: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
} as const)
