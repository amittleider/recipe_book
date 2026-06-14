import { useEffect, useState } from 'react'
import {
  listAccessibleFolders,
  createFolder,
  AuthError,
} from '../api/drive.js'
import { pickFolder } from '../auth/googlePicker.js'

// Lets the user pick an existing app-accessible folder as the recipe root, or
// create a new one. (With the drive.file scope the list only contains folders
// this app created/opened — see api/drive.js.)
export default function FolderPicker({ onPicked, onAuthError }) {
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [opening, setOpening] = useState(false)
  const [name, setName] = useState('Nos Recettes')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setFolders(await listAccessibleFolders())
    } catch (e) {
      if (e instanceof AuthError) return onAuthError()
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Open the Google Picker to select a folder shared by the other user.
  async function openShared() {
    setOpening(true)
    setError('')
    try {
      const folder = await pickFolder()
      if (folder) onPicked(folder)
    } catch (e) {
      if (e instanceof AuthError) return onAuthError()
      setError(e.message)
    } finally {
      setOpening(false)
    }
  }

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      const folder = await createFolder(name.trim())
      onPicked(folder)
    } catch (e) {
      if (e instanceof AuthError) return onAuthError()
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h2>Choisir un dossier</h2>
      </div>
      <div className="content">
        {error && <div className="error">{error}</div>}

        {loading ? (
          <div className="state">Chargement…</div>
        ) : (
          <>
            {folders.length > 0 && (
              <div className="card-list" style={{ marginBottom: 24 }}>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    className="folder-row"
                    onClick={() => onPicked(f)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}

            <button
              className="btn ghost block"
              onClick={openShared}
              disabled={opening}
              style={{ marginBottom: 24 }}
            >
              {opening ? 'Ouverture…' : '📂 Ouvrir un dossier partagé'}
            </button>

            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Ou créer un nouveau dossier&nbsp;:
            </p>
            <input
              className="search"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom du dossier"
            />
            <button
              className="btn block"
              onClick={create}
              disabled={creating || !name.trim()}
            >
              {creating ? 'Création…' : 'Créer ce dossier'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
