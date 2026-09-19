import { memo, useCallback, useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { AuthError } from '../api/drive'
import { deleteRecipe, sync, useRecipeStore } from '../data/recipeStore'
import type { AuthUser } from '../auth/googleAuth'
import { Button, ErrorBanner, Header, Screen } from '../components/ui'
import { SwipeableRow } from '../components/SwipeableRow'
import { colors, fonts } from '../theme'
import type { RecipeSummary } from '../types'

type Props = {
  user: AuthUser | null
  onOpen: (recipe: RecipeSummary) => void
  onNew: () => void
  onImport: () => void
  onSignOut: () => void
  onAuthError: () => void
}

type RowProps = {
  recipe: RecipeSummary
  open: boolean
  deleting: boolean
  onOpen: (recipe: RecipeSummary) => void
  onOpenChange: (folderId: string, open: boolean) => void
  onDelete: (recipe: RecipeSummary) => void
}

/**
 * Memoised so opening one row's action does not re-render the whole cookbook,
 * and so each row's gesture callbacks stay stable between renders.
 */
const RecipeRow = memo(function RecipeRow({ recipe, open, deleting, onOpen, onOpenChange, onDelete }: RowProps) {
  const handleOpenChange = useCallback(
    (next: boolean) => onOpenChange(recipe.folderId, next),
    [onOpenChange, recipe.folderId],
  )
  const handleDelete = useCallback(() => onDelete(recipe), [onDelete, recipe])
  // While the trash is showing, a tap on the card puts it away rather than
  // opening a recipe the cook was about to delete.
  const handlePress = useCallback(
    () => (open ? onOpenChange(recipe.folderId, false) : onOpen(recipe)),
    [onOpen, onOpenChange, open, recipe],
  )

  return (
    <SwipeableRow
      open={open}
      onOpenChange={handleOpenChange}
      onDelete={handleDelete}
      busy={deleting}
      deleteLabel={`Supprimer ${recipe.title}`}
    >
      <Pressable
        style={({ pressed }) => [styles.card, pressed ? styles.pressed : undefined]}
        onPress={handlePress}
      >
        <Text style={styles.recipeName}>{recipe.title}</Text>
        {!!recipe.time && <Text style={styles.meta}>⏱ {recipe.time}</Text>}
      </Pressable>
    </SwipeableRow>
  )
})

export function RecipeListScreen({ user, onOpen, onNew, onImport, onSignOut, onAuthError }: Props) {
  const { recipes, syncing, error } = useRecipeStore()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  // The list is always rendered from cache; refreshing only revalidates.
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await sync({ force: true })
    } catch (caught) {
      if (caught instanceof AuthError) onAuthError()
    } finally {
      setRefreshing(false)
    }
  }, [onAuthError])

  const remove = useCallback(
    async (recipe: RecipeSummary) => {
      setDeletingFolderId(recipe.folderId)
      setDeleteError('')
      try {
        await deleteRecipe(recipe.folderId)
        setOpenFolderId(null)
      } catch (caught) {
        if (caught instanceof AuthError) return onAuthError()
        setDeleteError(caught instanceof Error ? caught.message : 'Suppression impossible')
      } finally {
        setDeletingFolderId(null)
      }
    },
    [onAuthError],
  )

  // The folder is shared, so a mis-swipe would take the recipe away from
  // everyone. One confirmation before that happens.
  const confirmDelete = useCallback(
    (recipe: RecipeSummary) => {
      Alert.alert(
        'Supprimer la recette ?',
        `« ${recipe.title} » sera déplacée vers la corbeille de Google Drive.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Supprimer', style: 'destructive', onPress: () => void remove(recipe) },
        ],
      )
    },
    [remove],
  )

  // Adding a recipe now has two ways in. The choice lives behind the existing
  // button rather than a second one in the header, which has room for one.
  const chooseHowToAdd = useCallback(() => {
    Alert.alert('Ajouter une recette', undefined, [
      { text: 'Partir de zéro', onPress: onNew },
      { text: 'Importer depuis un lien', onPress: onImport },
      { text: 'Annuler', style: 'cancel' },
    ])
  }, [onNew, onImport])

  const handleOpenChange = useCallback((folderId: string, open: boolean) => {
    setOpenFolderId(open ? folderId : null)
  }, [])

  const closeOpenRow = useCallback(() => setOpenFolderId(null), [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr')
    return normalized
      ? recipes.filter((recipe) => recipe.title.toLocaleLowerCase('fr').includes(normalized))
      : recipes
  }, [query, recipes])

  return (
    <Screen>
      <Header title="Nos Recettes" right={<Button onPress={chooseHowToAdd}>+ Nouvelle</Button>} />
      <View style={styles.content}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
        />
        <ErrorBanner message={deleteError || error} />
        <FlatList
          data={filtered}
          keyExtractor={(recipe) => recipe.folderId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          onScrollBeginDrag={closeOpenRow}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {recipes.length ? 'Aucun résultat.' : 'Aucune recette. Touchez « + Nouvelle ».'}
            </Text>
          }
          renderItem={({ item }) => (
            <RecipeRow
              recipe={item}
              open={openFolderId === item.folderId}
              deleting={deletingFolderId === item.folderId}
              onOpen={onOpen}
              onOpenChange={handleOpenChange}
              onDelete={confirmDelete}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              {syncing && !refreshing && <Text style={styles.syncing}>Mise à jour…</Text>}
              {!!user?.email && <Text style={styles.account}>{user.email}</Text>}
              <Button variant="link" onPress={onSignOut}>Se déconnecter</Button>
            </View>
          }
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20 },
  search: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, marginBottom: 16, color: colors.text },
  list: { gap: 12, paddingBottom: 30, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 18 },
  recipeName: { fontFamily: fonts.serif, fontSize: 21, color: colors.text, marginBottom: 5 },
  meta: { color: colors.muted, fontSize: 14 },
  pressed: { opacity: 0.7 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 48 },
  footer: { alignItems: 'center', paddingTop: 24 },
  account: { color: colors.muted, fontSize: 12 },
  syncing: { color: colors.muted, fontSize: 12, paddingBottom: 8 },
} as const)
