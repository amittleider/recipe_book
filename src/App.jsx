import { useEffect, useState } from 'react'
import { ensureToken, getStoredToken, signOut } from './auth/googleAuth.js'
import AuthScreen from './components/AuthScreen.jsx'
import FolderPicker from './components/FolderPicker.jsx'
import RecipeList from './components/RecipeList.jsx'
import RecipeDetail from './components/RecipeDetail.jsx'
import Editor from './components/Editor.jsx'

const ROOT_KEY = 'nr.rootFolderId'

// Screens: 'loading' | 'auth' | 'folder' | 'list' | 'detail' | 'editor'
export default function App() {
  const [screen, setScreen] = useState('loading')
  const [rootId, setRootId] = useState(() => localStorage.getItem(ROOT_KEY) || '')
  const [current, setCurrent] = useState(null) // selected recipe
  const [editing, setEditing] = useState(null) // recipe being edited, or null for new

  // On load, try a silent token refresh and route accordingly.
  useEffect(() => {
    ;(async () => {
      try {
        if (!getStoredToken()) await ensureToken({ interactive: false })
        if (!getStoredToken()) return setScreen('auth')
        setScreen(rootId ? 'list' : 'folder')
      } catch {
        setScreen('auth')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSignedIn() {
    setScreen(rootId ? 'list' : 'folder')
  }

  function handleAuthError() {
    signOut()
    setScreen('auth')
  }

  function handleSignOut() {
    signOut()
    localStorage.removeItem(ROOT_KEY)
    setRootId('')
    setScreen('auth')
  }

  function handlePicked(folder) {
    localStorage.setItem(ROOT_KEY, folder.id)
    setRootId(folder.id)
    setScreen('list')
  }

  function openRecipe(recipe) {
    setCurrent(recipe)
    setScreen('detail')
  }

  function newRecipe() {
    setEditing(null)
    setScreen('editor')
  }

  function editRecipe(recipe) {
    setEditing(recipe)
    setScreen('editor')
  }

  function handleSaved(recipe) {
    setCurrent(recipe)
    setScreen('detail')
  }

  switch (screen) {
    case 'loading':
      return (
        <div className="app">
          <div className="state" style={{ marginTop: '40vh' }}>
            Chargement…
          </div>
        </div>
      )

    case 'auth':
      return <AuthScreen onSignedIn={handleSignedIn} />

    case 'folder':
      return (
        <FolderPicker onPicked={handlePicked} onAuthError={handleAuthError} />
      )

    case 'list':
      return (
        <RecipeList
          rootId={rootId}
          onOpen={openRecipe}
          onNew={newRecipe}
          onAuthError={handleAuthError}
          onSignOut={handleSignOut}
        />
      )

    case 'detail':
      return (
        <RecipeDetail
          recipe={current}
          onBack={() => setScreen('list')}
          onEdit={editRecipe}
          onAuthError={handleAuthError}
        />
      )

    case 'editor':
      return (
        <Editor
          recipe={editing}
          rootId={rootId}
          onSaved={handleSaved}
          onCancel={() => setScreen(editing ? 'detail' : 'list')}
          onAuthError={handleAuthError}
        />
      )

    default:
      return null
  }
}
