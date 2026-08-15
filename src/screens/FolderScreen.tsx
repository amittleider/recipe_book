import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { createFolder, listFolders } from '../api/drive'
import { Button, ErrorBanner, Header, LoadingState, Screen } from '../components/ui'
import type { DriveFolder } from '../types'
import { colors } from '../theme'

export function FolderScreen({ onPicked, onSignOut }: { onPicked: (folder: DriveFolder) => void; onSignOut: () => void }) {
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [search, setSearch] = useState('')
  const [name, setName] = useState('Nos Recettes')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function load(query = search) {
    setLoading(true)
    setError('')
    try {
      setFolders(await listFolders(query))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de charger les dossiers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load('') }, [])

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      onPicked(await createFolder(name.trim()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Screen>
      <Header title="Choisir un dossier" right={<Button variant="link" onPress={onSignOut}>Quitter</Button>} />
      <View style={styles.content}>
        <ErrorBanner message={error} />
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.searchInput]}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => load()}
            returnKeyType="search"
            placeholder="Rechercher dans Drive…"
            placeholderTextColor={colors.muted}
          />
          <Button variant="secondary" onPress={() => load()}>Chercher</Button>
        </View>
        {loading ? <LoadingState /> : (
          <FlatList
            data={folders}
            keyExtractor={(folder) => folder.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Aucun dossier trouvé.</Text>}
            renderItem={({ item }) => (
              <Pressable style={({ pressed }) => [styles.folder, pressed ? styles.pressed : undefined]} onPress={() => onPicked(item)}>
                <Text style={styles.folderIcon}>📁</Text>
                <Text style={styles.folderName} numberOfLines={1}>{item.name}</Text>
              </Pressable>
            )}
          />
        )}
        <View style={styles.createBox}>
          <Text style={styles.label}>Ou créer un nouveau dossier</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nom du dossier" />
          <Button variant="secondary" onPress={create} disabled={creating || !name.trim()} busy={creating}>Créer ce dossier</Button>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: { flex: 1 },
  input: { minHeight: 46, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, color: colors.text, fontSize: 16 },
  list: { gap: 10, paddingBottom: 18 },
  folder: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14 },
  folderIcon: { fontSize: 20, marginRight: 12 },
  folderName: { flex: 1, fontSize: 16, color: colors.text },
  pressed: { opacity: 0.7 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 30 },
  createBox: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 16, gap: 10 },
  label: { color: colors.muted, fontSize: 14 },
} as const)
