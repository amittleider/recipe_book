import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { AuthScreen } from './src/screens/AuthScreen'
import { FolderScreen } from './src/screens/FolderScreen'
import { RecipeListScreen } from './src/screens/RecipeListScreen'
import { RecipeDetailScreen } from './src/screens/RecipeDetailScreen'
import { EditorScreen } from './src/screens/EditorScreen'
import { restoreAuthSession, signOut, type AuthUser } from './src/auth/googleAuth'
import { clearRootFolder, getRootFolder, setRootFolder } from './src/storage/keychain'
import type { DriveFolder, RecipeSummary } from './src/types'
import { colors } from './src/theme'

type Screen = 'loading' | 'auth' | 'folder' | 'list' | 'detail' | 'editor'

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [rootFolder, setRootFolderState] = useState<DriveFolder | null>(null)
  const [current, setCurrent] = useState<RecipeSummary | null>(null)
  const [editing, setEditing] = useState<RecipeSummary | null>(null)

  useEffect(() => {
    let mounted = true
    Promise.all([restoreAuthSession(), getRootFolder()])
      .then(([restoredUser, savedFolder]) => {
        if (!mounted) return
        setUser(restoredUser)
        setRootFolderState(savedFolder)
        setScreen(restoredUser ? (savedFolder ? 'list' : 'folder') : 'auth')
      })
      .catch(() => mounted && setScreen('auth'))
    return () => {
      mounted = false
    }
  }, [])

  async function handleFolder(folder: DriveFolder) {
    await setRootFolder(folder)
    setRootFolderState(folder)
    setScreen('list')
  }

  async function handleSignOut() {
    await Promise.all([signOut(), clearRootFolder()])
    setUser(null)
    setRootFolderState(null)
    setScreen('auth')
  }

  function handleSessionExpired() {
    setUser(null)
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
            setScreen(rootFolder ? 'list' : 'folder')
          }}
        />
      )}
      {screen === 'folder' && (
        <FolderScreen onPicked={handleFolder} onSignOut={handleSignOut} />
      )}
      {screen === 'list' && rootFolder && (
        <RecipeListScreen
          rootId={rootFolder.id}
          user={user}
          onOpen={(recipe) => {
            setCurrent(recipe)
            setScreen('detail')
          }}
          onNew={() => {
            setEditing(null)
            setScreen('editor')
          }}
          onSignOut={handleSignOut}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'detail' && current && (
        <RecipeDetailScreen
          recipe={current}
          onBack={() => setScreen('list')}
          onEdit={(recipe) => {
            setEditing(recipe)
            setScreen('editor')
          }}
          onAuthError={handleSessionExpired}
        />
      )}
      {screen === 'editor' && rootFolder && (
        <EditorScreen
          recipe={editing}
          rootId={rootFolder.id}
          onCancel={() => setScreen(editing ? 'detail' : 'list')}
          onSaved={(recipe) => {
            setCurrent(recipe)
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
