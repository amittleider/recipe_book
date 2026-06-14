// Google Picker — the sanctioned way to let a user "open" an existing Drive
// folder under the drive.file scope. Selecting a folder here grants the app
// drive.file access to it (even if it was merely *shared* with the user and
// not created by the app), which is exactly what the second user needs to
// point at the shared recipe root.

import { ensureToken } from './googleAuth.js'

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID // Cloud project number (optional)
const FOLDER_MIME = 'application/vnd.google-apps.folder'

let pickerReady = null

function loadPicker() {
  if (pickerReady) return pickerReady
  pickerReady = new Promise((resolve, reject) => {
    const onApiLoaded = () =>
      window.gapi.load('picker', { callback: resolve, onerror: reject })
    if (window.google?.picker) return resolve()
    if (window.gapi) return onApiLoaded()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.defer = true
    s.onload = onApiLoaded
    s.onerror = () => reject(new Error('Failed to load Google Picker'))
    document.head.appendChild(s)
  })
  return pickerReady
}

// Opens the Picker in folder-selection mode. Resolves to { id, name } for the
// chosen folder, or null if the user cancels.
export async function pickFolder() {
  if (!API_KEY) {
    throw new Error(
      'Missing VITE_GOOGLE_API_KEY. Create an API key (Picker API) and set it in .env.'
    )
  }
  const token = await ensureToken({ interactive: true })
  await loadPicker()

  const picker = window.google.picker
  // Two views so the target folder is findable whether the user owns it
  // ("My Drive") or it was shared with them ("Shared with me").
  const mkView = (ownedByMe) =>
    new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setOwnedByMe(ownedByMe)

  return new Promise((resolve, reject) => {
    try {
      const builder = new picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .setTitle('Choisir le dossier de recettes')
        .addView(mkView(true))
        .addView(mkView(false))
        .setCallback((data) => {
          const action = data[picker.Response.ACTION]
          if (action === picker.Action.PICKED) {
            const doc = data[picker.Response.DOCUMENTS][0]
            resolve({ id: doc[picker.Document.ID], name: doc[picker.Document.NAME] })
          } else if (action === picker.Action.CANCEL) {
            resolve(null)
          }
        })
      if (APP_ID) builder.setAppId(APP_ID)
      builder.build().setVisible(true)
    } catch (e) {
      reject(e)
    }
  })
}
