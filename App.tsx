import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { AuthScreen } from './src/screens/AuthScreen'
import { FolderScreen } from './src/screens/FolderScreen'
import { SyncScreen } from './src/screens/SyncScreen'
import { RecipeListScreen } from './src/screens/RecipeListScreen'
import { RecipeDetailScreen } from './src/screens/RecipeDetailScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { restoreAuthSession, signOut, type AuthUser } from './src/auth/googleAuth'
import { AuthError } from './src/api/drive'
import { hydrate, reset, sync } from './src/data/recipeStore'
import { clearRootFolder, getRootFolder, setRootFolder } from './src/storage/keychain'
import type { DriveFolder } from './src/types'
import { colors } from './src/theme'

type Screen = 'loading' | 'auth' | 'folder' | 'sync' | 'list' | 'detail' | 'editor'

/** Screens that render from cache and can revalidate quietly behind the user. */
const CACHED_SCREENS: Screen[] = ['list', 'detail', 'editor']

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [rootFolder, setRootFolderState] = useState<DriveFolder | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)

  const handleSessionExpired = useCallback(() => {
    setUser(null)
    setScreen('auth')
  }, [])

  /** Loading the cache is synchronous, so a warm launch lands straight on the list. */
  const openFolder = useCallback((folder: DriveFolder) => {
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
    await Promise.all([signOut(), clearRootFolder()])
    setUser(null)
    setRootFolderState(null)
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
          onOpen={(recipe) => {
            setCurrentFolderId(recipe.folderId)
            setScreen('detail')
          }}
          onNew={() => {
            setEditingFolderId(null)
            setScreen('editor')
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
            setScreen('editor')
          }}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'editor' && rootFolder && (
        <EditorScreen
          folderId={editingFolderId}
          onCancel={() => setScreen(editingFolderId ? 'detail' : 'list')}
          onSaved={(recipe) => {
            setCurrentFolderId(recipe.folderId)
            setScreen('detail')
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
