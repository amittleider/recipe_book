import { useEffect, useState } from 'react'
import {
  findRecipeFile,
  readFile,
  updateFile,
  createRecipe,
  createRecipeFile,
  AuthError,
} from '../api/drive.js'
import {
  NEW_RECIPE_TEMPLATE,
  parseTitle,
  titleToSlug,
} from '../lib/markdown.js'

// Raw markdown editor. `recipe` is null when creating a new recipe.
export default function Editor({ recipe, rootId, onSaved, onCancel, onAuthError }) {
  const isNew = !recipe
  const [text, setText] = useState(isNew ? NEW_RECIPE_TEMPLATE : '')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isNew) return
    let active = true
    ;(async () => {
      try {
        const id = recipe.fileId || (await findRecipeFile(recipe.folderId))
        const md = id ? await readFile(id) : NEW_RECIPE_TEMPLATE
        if (active) setText(md)
      } catch (e) {
        if (e instanceof AuthError) return onAuthError()
        if (active) setError(e.message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (isNew) {
        const title = parseTitle(text, 'recette')
        const slug = titleToSlug(title) || 'recette'
        const created = await createRecipe(rootId, slug, text)
        onSaved({ folderId: created.id, fileId: created.fileId, slug })
      } else {
        let id = recipe.fileId || (await findRecipeFile(recipe.folderId))
        if (id) {
          await updateFile(id, text)
        } else {
          // Folder exists but recipe.md doesn't — create it in that folder.
          id = await createRecipeFile(recipe.folderId, text)
        }
        onSaved({ ...recipe, fileId: id })
      }
    } catch (e) {
      if (e instanceof AuthError) return onAuthError()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h2>{isNew ? 'Nouvelle recette' : 'Modifier'}</h2>
      </div>
      <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        {error && <div className="error">{error}</div>}
        {loading ? (
          <div className="state">Chargement…</div>
        ) : (
          <>
            <textarea
              className="editor-area"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
            />
            <div className="editor-actions">
              <button className="btn ghost" onClick={onCancel} disabled={saving}>
                Annuler
              </button>
              <button className="btn" onClick={save} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
