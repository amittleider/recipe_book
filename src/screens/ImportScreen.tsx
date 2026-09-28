import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button, ErrorBanner, Header, Screen } from '../components/ui'
import { ImportError } from '../import/errors'
import { importRecipe } from '../import/importRecipe'
import { importFromImage } from '../import/importFromImage'
import { captureForScan, pickForScan } from '../lib/mediaPicker'
import { canRecognizeText } from '../ocr/textRecognition'
import type { RecipeDocument } from '../lib/recipeDocument'
import { colors, fonts } from '../theme'

type Props = {
  /** The link last imported, so backing out of the editor does not lose it. */
  initialUrl?: string
  /** Chosen "Photographier": open the camera on arrival rather than waiting. */
  scanOnOpen?: boolean
  onImported: (document: RecipeDocument, url: string) => void
  onCancel: () => void
}

/** Which import is running, so the right button shows the spinner. */
type Busy = '' | 'url' | 'camera' | 'library'

/**
 * Two ways to fill in the form: paste a link, or take a picture of the page.
 *
 * Nothing is written to Drive from here. A successful import hands the cook the
 * ordinary recipe form with the fields already populated, so the last word on
 * what gets saved stays theirs — which is what makes a parser that is right
 * most of the time good enough.
 *
 * The photo is read on the device and then forgotten. It is not uploaded, and it
 * does not become the recipe's cover: a picture of a book page is not a picture
 * of the dish, and the gallery is for the dish.
 */
export function ImportScreen({ initialUrl = '', scanOnOpen = false, onImported, onCancel }: Props) {
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState('')
  const canScan = canRecognizeText()
  const opened = useRef(false)

  // Fires once. A re-render while the camera is up must not stack a second one.
  useEffect(() => {
    if (!scanOnOpen || !canScan || opened.current) return
    opened.current = true
    void runPhoto('camera')
  }, [scanOnOpen, canScan])

  function report(caught: unknown) {
    setError(
      caught instanceof ImportError
        ? caught.message
        : caught instanceof Error
          ? caught.message
          : 'Import impossible',
    )
  }

  async function runUrl() {
    if (busy || !url.trim()) return
    setBusy('url')
    setError('')
    try {
      const imported = await importRecipe(url)
      onImported(imported.document, imported.url)
    } catch (caught) {
      // The link stays in the field either way: a failed import is usually one
      // typo or one other site away from working.
      report(caught)
    } finally {
      setBusy('')
    }
  }

  async function runPhoto(source: Exclude<Busy, '' | 'url'>) {
    if (busy) return
    setError('')
    try {
      // The picker runs before the spinner: backing out of the camera is not a
      // failure and should not leave a button spinning.
      const uri = source === 'camera' ? await captureForScan() : await pickForScan()
      if (!uri) return
      setBusy(source)
      onImported(await importFromImage(uri), '')
    } catch (caught) {
      report(caught)
    } finally {
      setBusy('')
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
            autoFocus={!initialUrl && !scanOnOpen}
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={() => void runUrl()}
          />
          <View style={styles.actions}>
            <Button onPress={() => void runUrl()} disabled={!!busy || !url.trim()} busy={busy === 'url'}>
              Importer le lien
            </Button>
          </View>

          <View style={styles.divider}>
            <View style={styles.rule} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.rule} />
          </View>

          <Text style={styles.label}>Photo d’une recette</Text>
          <View style={styles.photoRow}>
            <Button
              variant="secondary"
              style={styles.photoButton}
              onPress={() => void runPhoto('camera')}
              disabled={!!busy || !canScan}
              busy={busy === 'camera'}
            >
              Photographier
            </Button>
            <Button
              variant="secondary"
              style={styles.photoButton}
              onPress={() => void runPhoto('library')}
              disabled={!!busy || !canScan}
              busy={busy === 'library'}
            >
              Galerie
            </Button>
          </View>
          <Text style={styles.hint}>
            {canScan
              ? 'Photographiez la page entière, bien à plat et sans ombre. Les ingrédients et la préparation doivent être visibles.'
              : 'La lecture de photos n’est pas disponible dans cette version de l’application.'}
          </Text>
          <Text style={styles.hint}>
            La recette est ouverte dans l’éditeur pour que vous puissiez la relire avant de
            l’enregistrer.
          </Text>
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
  actions: { paddingTop: 6 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { color: colors.muted, fontSize: 13, fontFamily: fonts.serif },
  photoRow: { flexDirection: 'row', gap: 10, paddingTop: 2 },
  photoButton: { flex: 1 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 21, fontFamily: fonts.serif, marginTop: 6 },
} as const)
