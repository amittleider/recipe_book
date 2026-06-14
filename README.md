# Nos Recettes — Recipe Book PWA

A personal recipe book PWA for two people. Recipes are markdown files stored in
a Google Drive folder (one subfolder per recipe). No backend — everything runs
client-side. See [CLAUDE.md](CLAUDE.md) for the full design spec.

## Stack

React + Vite • Google Drive REST API v3 • Google OAuth (GIS) • PWA (manifest +
service worker) • GitHub Pages.

## Setup

1. **Install dependencies**

   ```sh
   npm install
   ```

2. **Create a Google OAuth client**
   - Go to <https://console.cloud.google.com/apis/credentials>.
   - Enable the **Google Drive API** for your project.
   - Create an **OAuth client ID** → *Web application*.
   - Add **Authorized JavaScript origins**:
     - `http://localhost:5173` (dev)
     - `https://<your-user>.github.io` (production)
   - Copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID`.

3. **Enable the Picker API + create an API key** (for opening shared folders)
   - Enable <https://console.cloud.google.com/apis/library/picker.googleapis.com>.
   - Credentials → **Create credentials → API key**; restrict it to the Picker
     API and your origins. Set it in `.env` as `VITE_GOOGLE_API_KEY`.

4. **Run locally**

   ```sh
   npm run dev
   ```

## Build & deploy

```sh
npm run build      # outputs to dist/
npm run preview    # preview the production build
```

A GitHub Actions workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))
builds and publishes to GitHub Pages on every push to `master`. Add your client
ID as a repository secret named `VITE_GOOGLE_CLIENT_ID`, and set
**Settings → Pages → Source** to *GitHub Actions*.

## How it works

- **Auth** — Google Identity Services issues short-lived access tokens with the
  `drive.file` scope. The token + expiry live in `localStorage`; on load the app
  silently refreshes, falling back to the sign-in screen if consent is needed.

  > Note: a pure client-side app can't get a long-lived *refresh token* (that
  > needs a backend with a client secret). GIS silent re-auth provides the same
  > "stay signed in" behaviour the spec describes.

- **Folder picker** — because `drive.file` only exposes folders the app created
  or opened, the picker lists app-accessible folders and lets you create a new
  root (e.g. *Nos Recettes*). The chosen folder ID is saved to `localStorage`.

- **Sharing one folder between two people** — the second user can't see a folder
  the first user created (drive.file is per-user). They tap **Ouvrir un dossier
  partagé**, which launches the **Google Picker**; selecting the shared folder
  grants their token `drive.file` access to it, pointing both users at the same
  root. (Share the folder via Google Drive first.)

- **Recipes** — each recipe is a subfolder containing `recipe.md`. The list
  reads each file to show the title (first `# heading`) and time (`**Time:**`).

## Project layout

```
src/
  auth/googleAuth.js   OAuth via Google Identity Services
  api/drive.js         Google Drive REST wrapper
  lib/markdown.js      markdown render + title/time/slug parsing
  components/          AuthScreen, FolderPicker, RecipeList, RecipeDetail, Editor
  App.jsx              screen routing + config persistence
public/
  manifest.json        PWA manifest
  sw.js                offline shell service worker
  icon.svg             app icon
```
