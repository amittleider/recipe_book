// Google OAuth via Google Identity Services (GIS).
//
// Note on the spec: a pure client-side app cannot obtain a long-lived *refresh
// token* (that requires a confidential client with a secret on a backend).
// GIS instead issues short-lived access tokens and supports *silent* re-auth:
// once the user has granted consent, we can request a fresh access token
// without a prompt. We persist the token + expiry in localStorage and refresh
// silently on load — which delivers the behaviour the spec describes ("silently
// refresh on every load; fall back to the auth screen if it fails").

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
// Full `drive` scope: the app must see (and edit) recipe files that were added
// to the shared folder manually through the Drive UI — not just ones it created.
// The narrower `drive.file` scope only grants access to files the app itself
// created or that were opened via the Picker, so manually-uploaded recipes were
// invisible. See CLAUDE.md for the original (now superseded) privacy decision.
const SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_KEY = 'nr.token'

let tokenClient = null
let gisReady = null

function loadGis() {
  if (gisReady) return gisReady
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisReady
}

async function getTokenClient() {
  if (tokenClient) return tokenClient
  if (!CLIENT_ID) {
    throw new Error(
      'Missing VITE_GOOGLE_CLIENT_ID. Copy .env.example to .env and set it.'
    )
  }
  await loadGis()
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}, // replaced per-request below
  })
  return tokenClient
}

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
  } catch {
    return null
  }
}

function store(token, expiresInSec) {
  // Refresh a minute early to avoid edge-of-expiry failures.
  const expiresAt = Date.now() + (expiresInSec - 60) * 1000
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }))
}

export function getStoredToken() {
  const t = readStored()
  if (t && t.expiresAt > Date.now()) return t.token
  return null
}

export function signOut() {
  const t = readStored()
  localStorage.removeItem(TOKEN_KEY)
  if (t?.token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(t.token, () => {})
  }
}

// Request an access token. `interactive: false` attempts a silent refresh and
// rejects if consent is required; `interactive: true` shows the Google popup.
function requestToken({ interactive }) {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getTokenClient()
      client.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error))
        store(resp.access_token, Number(resp.expires_in))
        resolve(resp.access_token)
      }
      client.error_callback = (err) =>
        reject(new Error(err?.type || 'oauth_failed'))
      client.requestAccessToken({ prompt: interactive ? 'consent' : '' })
    } catch (e) {
      reject(e)
    }
  })
}

// Public: ensure we have a valid token, refreshing silently when possible.
export async function ensureToken({ interactive = false } = {}) {
  const cached = getStoredToken()
  if (cached) return cached
  return requestToken({ interactive })
}

// Public: explicit sign-in from the auth screen (always interactive).
export function signIn() {
  return requestToken({ interactive: true })
}
