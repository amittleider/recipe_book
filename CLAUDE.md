# Nos Recettes — native application

## Product

An Expo/React Native recipe book for iOS, designed so the same TypeScript code
can later ship on Android. Google Drive is the source of truth and no application
backend is required.

## Architecture

- `App.tsx` owns the small screen-state router.
- `src/auth/googleAuth.ts` is the platform authentication boundary.
- `src/api/drive.ts` owns all Google Drive operations.
- `src/data/recipeStore.ts` is the cache-first read model every screen renders
  from. Screens never call Drive directly.
- `src/data/mediaStore.ts` owns media *bytes* and transfers; `recipeStore` owns
  the media *list*, which lives in the manifest. The dependency runs one way,
  media store to recipe store.
- `src/storage/recipeCache.ts` persists recipe metadata, bodies and media to files.
- `src/storage/keychain.ts` persists the selected root folder securely.
- `src/screens` contains native React Native screens.
- Recipe format remains one `recipe.md` per Drive subfolder, with photos and
  videos as ordinary files beside it in the same folder.

## Caching

The Drive folder is shared, so the cache must be fast *and* must notice edits
made on someone else's device.

- Reads are answered from cache and are synchronous, so screens paint on the
  first frame. Drive is consulted to revalidate, never to render.
- Freshness comes from Drive's per-file validators (`md5Checksum`, falling back
  to `modifiedTime`), not HTTP ETags. Those fields arrive inside a `files.list`
  response, so two batched queries revalidate the entire cookbook and only
  genuinely changed bodies are downloaded. Conditional GETs would cost one round
  trip per recipe to learn the same thing.
- `listRecipeFiles` folds many folders into one `... in parents or ...` query.
  Never reintroduce a per-folder lookup; that was the original slowness.
- Saves are written through with the validator from the upload response, so a
  device never re-downloads what it just wrote.
- Picking a folder fills the cache behind a progress screen. That one-time cost
  buys an instant app afterwards, including offline.
- Revalidation runs on launch, on foreground, and on pull-to-refresh, throttled
  and de-duplicated in the store.

## Media

Photos and videos live next to `recipe.md` in the recipe's folder, named
`photo-<timestamp>-<suffix>.jpg` at capture. The random suffix is not decoration:
Drive allows duplicate names in one folder, so two phones adding a photo in the
same second would otherwise point one name at two files.

- Order is recorded in `recipe.md` as a `## Photos` section of plain markdown
  image references, **by file name, not by Drive id** — ids change when a file is
  replaced, and a name is something a person can read. `recipeDocument.parse`
  lifts that section into `document.media`, but only when every line in it is an
  image reference; anything else and it stays an ordinary section, written back
  untouched. A recipe with no photos gets no section, so it is stored exactly as
  it was before media existed.
- The first photo is the cover. That is the whole ordering model, and it is why
  reordering in the editor is what chooses the cover shown on the recipe list.
- Reconciliation is forgiving in both directions. A file in the folder that the
  markdown never mentions is still shown, which is what makes dropping a photo in
  from a laptop work; a name with no file behind it is skipped rather than drawn
  broken.
- `listFolderFiles` deliberately does not filter by name: one batched query
  returns `recipe.md` and the folder's media together, so media revalidation
  costs no extra round trip. Never split it back into two queries.
- Capture is local-first. The bytes are written to their final cache path and the
  entry is recorded *before* anything touches the network, so the photo is on
  screen immediately and a photo taken with no signal is never lost. The upload
  queue drains on add, on foreground, and on each sync. A failed upload keeps its
  local copy, which is still the only copy.
- A new recipe has no folder yet, so its photos stage under a `draft:` id and the
  first save hands them to the folder Drive creates.
- Downloads are lazy and tiered, because a shared cookbook on cellular should not
  cost hundreds of megabytes: thumbnails (from Drive's `thumbnailLink`, never
  persisted — they expire in hours) as tiles appear, full images when a recipe is
  opened, and videos only when one is played. Media freshness uses the same
  validator scheme as bodies, via `RecipeMedia.cached`.
- Media is cached in `media/<folderId>/` and `thumbs/`, both *beside* `bodies/`.
  `pruneBodies` deletes every file it does not recognise, so a photo filed under
  `bodies/` would be swept away on the next sync.
- Images are re-encoded to JPEG at 2048px before upload: iOS hands back HEIC,
  which Android cannot display, and a raw phone photo is several megabytes on a
  folder the family syncs to several devices. Videos are passed through.

Authentication must use the native Google SDK. Never persist access tokens in
AsyncStorage, local files, or application state beyond the current process. On
iOS the SDK persists its durable sign-in credential in Keychain and refreshes
access tokens as needed. SecureStore is used for application-owned persistent
metadata.

The app requests full Google Drive access because the native folder browser must
find an existing folder shared by another user. If a future native Picker or a
backend-mediated sharing workflow is introduced, reconsider the narrower
`drive.file` scope.

## Visual direction

- Warm cookbook feel rather than productivity software.
- Off-white `#FAFAF7`, near-black `#1A1A18`, subtle `#E5E5E0` borders.
- Georgia for recipe headings and system fonts for controls.
- Mobile-first, with generous whitespace and native touch targets.

## Verification

Run `npm run typecheck` after changes. Native Google Sign-In, the camera, the
gallery and video playback all require a development build (`npm run ios`), so
none of them can be tested in Expo Go.
