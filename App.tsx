import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { AuthScreen } from './src/screens/AuthScreen'
import { FolderScreen } from './src/screens/FolderScreen'
import { SyncScreen } from './src/screens/SyncScreen'
import { RecipeListScreen } from './src/screens/RecipeListScreen'
import { RecipeDetailScreen } from './src/screens/RecipeDetailScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { ImportScreen } from './src/screens/ImportScreen'
import { restoreAuthSession, signOut, type AuthUser } from './src/auth/googleAuth'
import { AuthError } from './src/api/drive'
import { hydrate, reset, sync } from './src/data/recipeStore'
import { flushUploads, resetMedia } from './src/data/mediaStore'
import { clearRootFolder, getRootFolder, setRootFolder } from './src/storage/keychain'
import type { RecipeDocument } from './src/lib/recipeDocument'
import type { DriveFolder } from './src/types'
import { colors } from './src/theme'

type Screen = 'loading' | 'auth' | 'folder' | 'sync' | 'list' | 'detail' | 'editor' | 'import'

/** Screens that render from cache and can revalidate quietly behind the user. */
const CACHED_SCREENS: Screen[] = ['list', 'detail', 'editor']

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [rootFolder, setRootFolderState] = useState<DriveFolder | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  // A recipe read off a web page, waiting to seed the editor. Import never
  // writes to Drive itself; it stops at a filled-in form the cook approves.
  const [importedDocument, setImportedDocument] = useState<RecipeDocument | null>(null)
  const [importedUrl, setImportedUrl] = useState('')
  // The list screen unmounts whenever a recipe is opened, and a filter is a view
  // the cook expects to still be there on the way back. The search box is not:
  // it lives in the screen and is meant to be transient.
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const handleSessionExpired = useCallback(() => {
    setUser(null)
    setScreen('auth')
  }, [])

  /** Loading the cache is synchronous, so a warm launch lands straight on the list. */
  const openFolder = useCallback((folder: DriveFolder) => {
    // Tags belong to a folder's recipes, so a different cookbook starts unfiltered.
    setSelectedTags([])
    setScreen(hydrate(folder.id) ? 'list' : 'sync')
  }, [])

  useEffect(() => {
    let mounted = true
    Promise.all([restoreAuthSession(), getRootFolder()])
      .then(([restoredUser, savedFolder]) => {
        if (!mounted) return
        setUser(restoredUser)
        setRootFolderState(savedFolder)
        if (!restoredUser) return setScreen('auth')
        if (!savedFolder) return setScreen('folder')
        openFolder(savedFolder)
      })
      .catch(() => mounted && setScreen('auth'))
    return () => {
      mounted = false
    }
  }, [openFolder])

  // Revalidate when the cookbook is on screen and whenever the app comes back to
  // the foreground, so a recipe another device edited shows up on its own. The
  // store throttles and de-duplicates these calls.
  const revalidating = !!rootFolder && CACHED_SCREENS.includes(screen)
  useEffect(() => {
    if (!revalidating) return
    const revalidate = () => {
      // A photo taken with no signal is waiting on exactly this moment, so the
      // queue is drained wherever the app already checks back in with Drive.
      flushUploads()
      sync().catch((caught: unknown) => {
        if (caught instanceof AuthError) handleSessionExpired()
      })
    }
    revalidate()
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') revalidate()
    })
    return () => subscription.remove()
  }, [revalidating, rootFolder?.id, handleSessionExpired])

  async function handleFolder(folder: DriveFolder) {
    await setRootFolder(folder)
    setRootFolderState(folder)
    openFolder(folder)
  }

  async function handleSignOut() {
    reset()
    resetMedia()
    await Promise.all([signOut(), clearRootFolder()])
    setUser(null)
    setRootFolderState(null)
    setSelectedTags([])
    setScreen('auth')
  }

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      {screen === 'loading' && <ActivityIndicator style={styles.loader} />}
      {screen === 'auth' && (
        <AuthScreen
          onSignedIn={(signedInUser) => {
            setUser(signedInUser)
            if (rootFolder) openFolder(rootFolder)
            else setScreen('folder')
          }}
        />
      )}
      {screen === 'folder' && (
        <FolderScreen onPicked={handleFolder} onSignOut={handleSignOut} />
      )}
      {screen === 'sync' && rootFolder && (
        <SyncScreen
          folderName={rootFolder.name}
          onReady={() => setScreen('list')}
          onChangeFolder={() => setScreen('folder')}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'list' && rootFolder && (
        <RecipeListScreen
          user={user}
          selectedTags={selectedTags}
          onSelectedTags={setSelectedTags}
          onOpen={(recipe) => {
            setCurrentFolderId(recipe.folderId)
            setScreen('detail')
          }}
          onNew={() => {
            setEditingFolderId(null)
            setImportedDocument(null)
            setScreen('editor')
          }}
          // A fresh import starts from an empty field; the remembered link is
          // only for stepping back out of the editor.
          onImport={() => {
            setImportedUrl('')
            setScreen('import')
          }}
          onSignOut={handleSignOut}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'detail' && currentFolderId && (
        <RecipeDetailScreen
          folderId={currentFolderId}
          onBack={() => setScreen('list')}
          onEdit={(folderId) => {
            setEditingFolderId(folderId)
            setImportedDocument(null)
            setScreen('editor')
          }}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'import' && rootFolder && (
        <ImportScreen
          initialUrl={importedUrl}
          onCancel={() => setScreen('list')}
          onImported={(document, url) => {
            setEditingFolderId(null)
            setImportedDocument(document)
            setImportedUrl(url)
            setScreen('editor')
          }}
        />
      )}
      {screen === 'editor' && rootFolder && (
        <EditorScreen
          folderId={editingFolderId}
          initialDocument={importedDocument}
          // Backing out of an imported recipe returns to the link field rather
          // than the cookbook, so a wrong paste costs one tap to correct.
          onCancel={() => setScreen(editingFolderId ? 'detail' : importedDocument ? 'import' : 'list')}
          onSaved={(recipe) => {
            setCurrentFolderId(recipe.folderId)
            setImportedDocument(null)
            setImportedUrl('')
            setScreen('detail')
          }}
          // The detail screen behind the editor now has nothing to show, so a
          // delete lands back on the cookbook rather than an empty recipe.
          onDeleted={() => {
            setCurrentFolderId(null)
            setEditingFolderId(null)
            setImportedDocument(null)
            setScreen('list')
          }}
          onAuthError={handleSessionExpired}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  loader: { flex: 1 },
} as const)
