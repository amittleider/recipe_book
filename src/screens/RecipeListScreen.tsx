import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { AuthError } from '../api/drive'
import { sync, useRecipeStore } from '../data/recipeStore'
import type { AuthUser } from '../auth/googleAuth'
import { Button, ErrorBanner, Header, Screen } from '../components/ui'
import { colors, fonts } from '../theme'
import type { RecipeSummary } from '../types'

type Props = {
  user: AuthUser | null
  onOpen: (recipe: RecipeSummary) => void
  onNew: () => void
  onSignOut: () => void
  onAuthError: () => void
}

export function RecipeListScreen({ user, onOpen, onNew, onSignOut, onAuthError }: Props) {
  const { recipes, syncing, error } = useRecipeStore()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr')
    return normalized
      ? recipes.filter((recipe) => recipe.title.toLocaleLowerCase('fr').includes(normalized))
      : recipes
  }, [query, recipes])

  return (
    <Screen>
      <Header title="Nos Recettes" right={<Button onPress={onNew}>+ Nouvelle</Button>} />
      <View style={styles.content}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
        />
        <ErrorBanner message={error} />
        <FlatList
          data={filtered}
          keyExtractor={(recipe) => recipe.folderId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {recipes.length ? 'Aucun résultat.' : 'Aucune recette. Touchez « + Nouvelle ».'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed ? styles.pressed : undefined]}
              onPress={() => onOpen(item)}
            >
              <Text style={styles.recipeName}>{item.title}</Text>
              {!!item.time && <Text style={styles.meta}>⏱ {item.time}</Text>}
            </Pressable>
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
