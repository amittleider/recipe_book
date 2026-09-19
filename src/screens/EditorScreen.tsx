import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { AuthError } from '../api/drive'
import { deleteRecipe, getBody, getRecipe, revalidateRecipe, saveRecipe, useRecipe } from '../data/recipeStore'
import { Button, DeleteButton, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import { SectionCard } from '../components/SectionCard'
import {
  addItem,
  addSection,
  blankDocument,
  metaLabel,
  metaPlaceholder,
  parse,
  removeItem,
  removeSection,
  serialize,
  setItem,
  setMeta,
  setSection,
  setSectionKind,
  splitItem,
  type RecipeDocument,
} from '../lib/recipeDocument'
import { colors, fonts } from '../theme'
import type { RecipeSummary } from '../types'

type Props = {
  folderId: string | null
  /** A recipe read off a web page, used to seed a new one instead of a blank form. */
  initialDocument?: RecipeDocument | null
  onSaved: (recipe: RecipeSummary) => void
  onCancel: () => void
  onDeleted: () => void
  onAuthError: () => void
}

export function EditorScreen({ folderId, initialDocument, onSaved, onCancel, onDeleted, onAuthError }: Props) {
  const isNew = !folderId
  const recipe = useRecipe(folderId ?? '')
  const cached = isNew ? null : getBody(recipe?.fileId ?? null)

  const [document, setDocument] = useState<RecipeDocument>(() =>
    isNew ? (initialDocument ?? blankDocument()) : parse(cached ?? ''),
  )
  const [loading, setLoading] = useState(!isNew && cached === null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  // A field that a structural edit just created and should now be typed into.
  const [focus, setFocus] = useState<string | null>(null)
  const inputs = useRef(new Map<string, TextInput | null>())
  // Once the cook types, nothing may replace what is on the form.
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
        if (fresh !== null) setDocument(parse(fresh))
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
    if (!focus) return
    inputs.current.get(focus)?.focus()
    setFocus(null)
  }, [focus])

  function register(id: string, node: TextInput | null) {
    if (node) inputs.current.set(id, node)
    else inputs.current.delete(id)
  }

  function change(next: RecipeDocument) {
    dirty.current = true
    setDocument(next)
  }

  /** Structural edits report which new field the cook should land in. */
  function grow(result: { document: RecipeDocument; focus: string }) {
    change(result.document)
    setFocus(result.focus)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      onSaved(await saveRecipe(recipe, serialize(document)))
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
  // The title names the Drive folder for a new recipe, so it has to exist.
  const titled = !!document.title.trim()

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
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <ErrorBanner message={error} />

            <Field label="Titre">
              <TextInput
                style={styles.title}
                value={document.title}
                onChangeText={(title) => change({ ...document, title })}
                placeholder="Tarte aux pommes"
                placeholderTextColor={colors.muted}
                autoCapitalize="sentences"
              />
            </Field>

            <View style={styles.meta}>
              {document.meta.map((field) => (
                <Field key={field.id} label={metaLabel(field.key)} style={styles.metaField}>
                  <TextInput
                    style={styles.metaInput}
                    value={field.value}
                    onChangeText={(value) => change(setMeta(document, field.id, value))}
                    placeholder={metaPlaceholder(field.key)}
                    placeholderTextColor={colors.muted}
                  />
                </Field>
              ))}
            </View>

            {document.sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                register={register}
                onName={(name) => change(setSection(document, section.id, { name }))}
                onKind={(kind) => change(setSectionKind(document, section.id, kind))}
                onBody={(body) => change(setSection(document, section.id, { body }))}
                onItem={(itemId, text) => change(setItem(document, section.id, itemId, text))}
                onSplit={(itemId, text) => grow(splitItem(document, section.id, itemId, text))}
                onAddItem={(afterId) => grow(addItem(document, section.id, afterId))}
                onRemoveItem={(itemId) => change(removeItem(document, section.id, itemId))}
                onRemove={() => change(removeSection(document, section.id))}
              />
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => grow(addSection(document))}
              style={({ pressed }) => [styles.newSection, pressed ? styles.pressed : undefined]}
            >
              <Text style={styles.newSectionText}>+ Nouvelle section</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.actions}>
            <Button style={styles.action} variant="secondary" onPress={onCancel} disabled={busy}>Annuler</Button>
            <Button style={styles.action} onPress={save} disabled={busy || !titled} busy={saving}>Enregistrer</Button>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  )
}

function Field({
  label,
  style,
  children,
}: {
  label: string
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  form: { padding: 20, paddingBottom: 32, gap: 16 },
  field: { gap: 4 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 34,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  meta: { flexDirection: 'row', gap: 12 },
  metaField: { flex: 1 },
  metaInput: {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  newSection: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSectionText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: { flex: 1 },
  pressed: { opacity: 0.6 },
} as const)
