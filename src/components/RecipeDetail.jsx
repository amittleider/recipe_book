import { useEffect, useState } from 'react'
import { findRecipeFile, readFile, AuthError } from '../api/drive.js'
import { renderMarkdown } from '../lib/markdown.js'

// Renders a recipe's recipe.md as formatted HTML.
export default function RecipeDetail({ recipe, onBack, onEdit, onAuthError }) {
  const [md, setMd] = useState('')
  const [fileId, setFileId] = useState(recipe.fileId || null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const id = fileId || (await findRecipeFile(recipe.folderId))
        if (!active) return
        setFileId(id)
        const text = id ? await readFile(id) : ''
        if (active) setMd(text)
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
  }, [recipe.folderId])

  return (
    <div className="app">
      <div className="topbar">
        <button className="btn link" onClick={onBack}>
          ‹ Retour
        </button>
        <h2 style={{ flex: 1 }}></h2>
        <button
          className="btn ghost"
          onClick={() => onEdit({ ...recipe, fileId })}
        >
          Modifier
        </button>
      </div>
      <div className="content">
        {error && <div className="error">{error}</div>}
        {loading ? (
          <div className="state">Chargement…</div>
        ) : (
          <div
            className="recipe-md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }}
          />
        )}
      </div>
    </div>
  )
}
