# Nos Recettes — Recipe Book PWA

## Project overview

A personal recipe book PWA for two users (a couple), hosted on GitHub Pages. Recipes are stored as markdown files in a Google Drive folder, with one subfolder per recipe. Both users authenticate via Google OAuth and can read and edit recipes from their phones. No backend — everything runs client-side.

---

## Tech stack

- **Frontend:** React (Vite)
- **Hosting:** GitHub Pages
- **Storage:** Google Drive (via Google Drive REST API v3)
- **Auth:** Google OAuth 2.0 (token stored in localStorage)
- **PWA:** Web App Manifest + Service Worker for home screen installation

---

## File structure (Google Drive)

```
/Nos Recettes/              ← root folder, chosen by user on first launch
  poulet-roti-aux-herbes/
    recipe.md
  tarte-tatin/
    recipe.md
  chocolate-cake/
    recipe.md
```

Each recipe lives in its own subfolder. The subfolder name is the recipe slug. The only file for now is `recipe.md`. Images and videos may be added in a future iteration.

---

## Markdown format (recipe.md)

```markdown
# Recipe Name

**Serves:** 4  **Time:** 1h 20min

---

## Ingredients

- ingredient one
- ingredient two

## Method

1. Step one
2. Step two

---

*Optional note or serving suggestion.*
```

---

## App screens & navigation

1. **Auth screen** — shown when no Google token exists in localStorage. Single large "Connect Google Drive" button triggering OAuth flow.
2. **Folder picker** — shown after first auth, or if no root folder is configured. Lists Drive folders; user picks or creates one. Choice saved to localStorage.
3. **Recipe list** — main screen. Shows all recipe subfolders as cards (name + cook time parsed from markdown frontmatter or heading). Search bar filters by name. "+ New" button opens the editor.
4. **Recipe detail** — renders the `recipe.md` file as formatted HTML. "Edit" button opens the editor.
5. **Editor** — raw markdown textarea. "Save" writes back to Drive via API. "Cancel" discards changes.

---

## Auth & config persistence

- After OAuth, store the **refresh token** and **root folder ID** in `localStorage`.
- On every app load, silently refresh the access token using the stored refresh token.
- If refresh fails (token revoked, cleared storage), fall back to the auth screen.
- Use Google's JavaScript OAuth client (`@react-oauth/google` or similar).

### Required Google OAuth scopes

```
https://www.googleapis.com/auth/drive.file
```

`drive.file` scope limits access to files created or opened by the app — sufficient and more privacy-friendly than full Drive access.

---

## Google Drive API usage

| Action | API call |
|---|---|
| List recipe folders | `GET /drive/v3/files?q='FOLDER_ID'+in+parents+and+mimeType='application/vnd.google-apps.folder'` |
| Read recipe.md | `GET /drive/v3/files/FILE_ID?alt=media` |
| Create new recipe folder | `POST /drive/v3/files` (mimeType: folder) |
| Create recipe.md | `POST /upload/drive/v3/files?uploadType=multipart` |
| Update recipe.md | `PATCH /upload/drive/v3/files/FILE_ID?uploadType=media` |

---

## PWA requirements

- `manifest.json` with app name, icons, `display: standalone`, `start_url`
- Service worker caching shell assets for offline load
- Works on iOS Safari (add to home screen) and Android Chrome

---

## UI design decisions

- **Fonts:** Georgia for recipe names and headings (warm, editorial); system-ui for all UI chrome
- **Palette:** Off-white background `#FAFAF7`, near-black text `#1A1A18`, light borders `#E5E5E0`
- **Tone:** Feels like a cookbook, not a productivity app — minimal chrome, generous whitespace
- **Mobile-first:** All screens designed for ~390px width; no desktop-specific layout needed for v1

---

## Out of scope for v1

- Images and video attachments
- Recipe categories or tags
- Sharing with users outside the two owners
- Conflict resolution (last write wins for now)
- Backend / serverless functions

---

## Key decisions made in design session

- **No backend** — Google Drive is the source of truth; auth token lives in localStorage. Acceptable for a private two-person tool.
- **PWA over native** — avoids Apple Developer account ($99/year) and App Store friction. Can be converted to a Capacitor app later if needed.
- **One markdown file per recipe** — simple, human-readable, easy to edit manually in Drive if needed.
- **drive.file scope** — app only sees files it creates/opens, not the user's entire Drive.