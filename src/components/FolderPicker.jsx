import { useState } from 'react'
import { createFolder, AuthError } from '../api/drive.js'
import { pickFolder } from '../auth/googlePicker.js'

// Lets the user pick their recipe root folder via the Google Picker (which can
// navigate the whole Drive hierarchy, owned and shared), or create a new one.
// We no longer list folders via the API: with the full `drive` scope that query
// returns every folder in the user's Drive and is capped at 100, so the target
// folder could be missing. The Picker avoids both problems.
export default function FolderPicker({ onPicked, onAuthError, onSignOut }) {
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [opening, setOpening] = useState(false)
  const [name, setName] = useState('Nos Recettes')

  // Open the Google Picker to select an existing folder.
  async function openPicker() {
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

        <button
          className="btn block"
          onClick={openPicker}
          disabled={opening}
          style={{ marginBottom: 24 }}
        >
          {opening ? 'Ouverture…' : '📂 Parcourir Google Drive'}
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
          className="btn ghost block"
          onClick={create}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Création…' : 'Créer ce dossier'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <button className="btn link" onClick={onSignOut}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  )
}
