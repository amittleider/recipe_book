import { useEffect, useMemo, useState } from 'react'
import {
  listRecipeFolders,
  findRecipeFile,
  readFile,
  AuthError,
} from '../api/drive.js'
import { parseTitle, parseTime } from '../lib/markdown.js'

// Loads recipe folders, then fetches each recipe.md to read its title + time.
export default function RecipeList({ rootId, onOpen, onNew, onAuthError, onSignOut }) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const folders = await listRecipeFolders(rootId)
      const withMeta = await Promise.all(
        folders.map(async (f) => {
          try {
            const fileId = await findRecipeFile(f.id)
            const md = fileId ? await readFile(fileId) : ''
            return {
              folderId: f.id,
              fileId,
              slug: f.name,
              title: parseTitle(md, f.name),
              time: parseTime(md),
            }
          } catch {
            return { folderId: f.id, fileId: null, slug: f.name, title: f.name, time: '' }
          }
        })
      )
      setRecipes(withMeta)
    } catch (e) {
      if (e instanceof AuthError) return onAuthError()
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [rootId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recipes
    return recipes.filter((r) => r.title.toLowerCase().includes(q))
  }, [recipes, query])

  return (
    <div className="app">
      <div className="topbar">
        <h1>Nos Recettes</h1>
        <button className="btn" onClick={onNew}>
          + Nouvelle
        </button>
      </div>
      <div className="content">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          type="search"
        />

        {error && <div className="error">{error}</div>}

        {loading ? (
          <div className="state">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="state">
            {recipes.length === 0
              ? 'Aucune recette pour le moment. Touchez « + Nouvelle ».'
              : 'Aucun résultat.'}
          </div>
        ) : (
          <div className="card-list">
            {filtered.map((r) => (
              <button
                key={r.folderId}
                className="card"
                onClick={() => onOpen(r)}
              >
                <div className="name">{r.title}</div>
                {r.time && <div className="meta">⏱ {r.time}</div>}
              </button>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <button className="btn link" onClick={onSignOut}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  )
}
