import { useState } from 'react'
import { signIn } from '../auth/googleAuth.js'

export default function AuthScreen({ onSignedIn }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function connect() {
    setError('')
    setBusy(true)
    try {
      await signIn()
      onSignedIn()
    } catch (e) {
      setError(e.message || 'Connexion échouée')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="brand">Nos Recettes</div>
      <p>Votre livre de recettes, synchronisé avec Google Drive.</p>
      {error && <div className="error">{error}</div>}
      <button className="btn block" onClick={connect} disabled={busy}>
        {busy ? 'Connexion…' : 'Connecter Google Drive'}
      </button>
    </div>
  )
}
