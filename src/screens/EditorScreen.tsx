import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  InputAccessoryView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { AuthError } from '../api/drive'
import { deleteRecipe, getBody, getRecipe, revalidateRecipe, saveRecipe, useRecipe } from '../data/recipeStore'
import { Button, DeleteButton, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { EditorToolbar } from '../components/EditorToolbar'
import { NEW_RECIPE_TEMPLATE } from '../lib/markdown'
import { continueList, typedNewlineAt, type Edit, type Selection } from '../lib/markdownCommands'
import { colors, fonts } from '../theme'
import type { RecipeSummary } from '../types'

type Props = {
  folderId: string | null
  onSaved: (recipe: RecipeSummary) => void
  onCancel: () => void
  onDeleted: () => void
  onAuthError: () => void
}

/** Ties the toolbar to this screen's input rather than the focused field generally. */
const ACCESSORY_ID = 'recipe-editor-toolbar'

export function EditorScreen({ folderId, onSaved, onCancel, onDeleted, onAuthError }: Props) {
  const isNew = !folderId
  const recipe = useRecipe(folderId ?? '')
  const cached = isNew ? null : getBody(recipe?.fileId ?? null)

  const [text, setText] = useState(isNew ? NEW_RECIPE_TEMPLATE : (cached ?? ''))
  const [loading, setLoading] = useState(!isNew && cached === null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 })
  // Where a command asked the caret to go. Applied imperatively after the text
  // lands, so the input stays uncontrolled while the cook is typing.
  const [pending, setPending] = useState<Selection | null>(null)
  const input = useRef<TextInput>(null)
  // Once the cook types, nothing may replace what is in the box.
  const dirty = useRef(false)

  useEffect(() => {
    if (!folderId) return
    let mounted = true
    // Editing a shared recipe from a stale cache would silently clobber someone
    // else's change on save, so confirm the body is current before seeding it.
    revalidateRecipe(folderId)
      .then(() => {
        if (!mounted || dirty.current) return
        const fresh = getBody(getRecipe(folderId)?.fileId ?? null)
        if (fresh !== null) setText(fresh)
      })
      .catch((caught: unknown) => {
        if (caught instanceof AuthError) return onAuthError()
        if (mounted && getBody(getRecipe(folderId)?.fileId ?? null) === null) {
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

  useEffect(() => {
    if (!pending) return
    input.current?.setSelection(pending.start, pending.end)
    setPending(null)
  }, [pending])

  function apply(next: Edit) {
    dirty.current = true
    setText(next.text)
    setSelection(next.selection)
    setPending(next.selection)
    // Toolbar taps must not cost the keyboard, on either platform.
    input.current?.focus()
  }

  function edit(next: string) {
    dirty.current = true
    // Carry lists across a line break. The caret is read by diffing rather than
    // from state, because onChangeText runs before the selection catches up.
    const newline = typedNewlineAt(text, next)
    const continued = newline === null ? null : continueList(next, newline)
    if (!continued) return setText(next)
    setText(continued.text)
    setSelection(continued.selection)
    setPending(continued.selection)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      onSaved(await saveRecipe(recipe, text))
    } catch (caught) {
      if (caught instanceof AuthError) return onAuthError()
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!folderId) return
    setDeleting(true)
    setError('')
    try {
      await deleteRecipe(folderId)
      onDeleted()
    } catch (caught) {
      if (caught instanceof AuthError) return onAuthError()
      setError(caught instanceof Error ? caught.message : 'Suppression impossible')
    } finally {
      setDeleting(false)
    }
  }

  // The folder is shared, so deleting takes the recipe away from everyone.
  // One confirmation before that happens.
  function confirmDelete() {
    Alert.alert(
      'Supprimer la recette ?',
      `« ${recipe?.title ?? 'Cette recette'} » sera déplacée vers la corbeille de Google Drive.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => void remove() },
      ],
    )
  }

  const busy = saving || deleting
  const toolbar = <EditorToolbar text={text} selection={selection} onEdit={apply} />

  return (
    <Screen>
      <Header
        title={isNew ? 'Nouvelle recette' : 'Modifier'}
        right={isNew ? undefined : <DeleteButton onPress={confirmDelete} busy={deleting} />}
      />
      {loading ? (
        <LoadingState />
      ) : (
        <KeyboardAvoidingView
          style={styles.content}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={58}
        >
          <View style={styles.body}>
            <ErrorBanner message={error} />
            <TextInput
              ref={input}
              style={styles.editor}
              value={text}
              onChangeText={edit}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect
              inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
            />
          </View>
          {/* iOS pins the bar to the keyboard; elsewhere it sits above the actions. */}
          {Platform.OS === 'ios' ? (
            <InputAccessoryView nativeID={ACCESSORY_ID}>{toolbar}</InputAccessoryView>
          ) : (
            toolbar
          )}
          <View style={styles.actions}>
            <Button style={styles.action} variant="secondary" onPress={onCancel} disabled={busy}>Annuler</Button>
            <Button style={styles.action} onPress={save} disabled={busy} busy={saving}>Enregistrer</Button>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  editor: { flex: 1, minHeight: 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, color: colors.text, fontFamily: fonts.mono, fontSize: 15, lineHeight: 23 },
  actions: { flexDirection: 'row', gap: 12, padding: 20, paddingTop: 14 },
  action: { flex: 1 },
} as const)
