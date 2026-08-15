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
- `src/storage/recipeCache.ts` persists recipe metadata and bodies to files.
- `src/storage/keychain.ts` persists the selected root folder securely.
- `src/screens` contains native React Native screens.
- Recipe format remains one `recipe.md` per Drive subfolder.

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

Run `npm run typecheck` after changes. Native Google Sign-In requires a
development build, so it cannot be tested in Expo Go.
