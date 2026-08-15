# Nos Recettes — native application

## Product

An Expo/React Native recipe book for iOS, designed so the same TypeScript code
can later ship on Android. Google Drive is the source of truth and no application
backend is required.

## Architecture

- `App.tsx` owns the small screen-state router.
- `src/auth/googleAuth.ts` is the platform authentication boundary.
- `src/api/drive.ts` owns all Google Drive operations.
- `src/storage/keychain.ts` persists the selected root folder securely.
- `src/screens` contains native React Native screens.
- Recipe format remains one `recipe.md` per Drive subfolder.

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
