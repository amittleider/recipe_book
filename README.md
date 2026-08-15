# Nos Recettes — iOS app

A native Expo/React Native recipe book. Recipes remain Markdown files in Google
Drive, while Google Sign-In restores the user's account and refreshes access
tokens through the native iOS SDK.

## Stack

- Expo SDK 57 + React Native + TypeScript
- Native Google Sign-In for Google Drive authorization
- iOS Keychain through Google Sign-In and `expo-secure-store`
- Google Drive REST API v3
- A small native renderer for the app's constrained recipe Markdown format

The application code is shared with Android. Platform-specific authentication is
kept behind `src/auth/googleAuth.ts` so Android's identity implementation can be
changed later without changing recipe or screen code.

## Google Cloud setup

1. Enable the **Google Drive API** in Google Cloud Console.
2. Configure the OAuth consent screen and add the two intended users while the
   project is in Testing.
3. Create an OAuth client with application type **iOS**:
   - Bundle ID: `com.nosrecettes.app`
   - Use the same bundle ID as `app.config.ts`.
4. Copy `.env.example` to `.env` and set
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` to that iOS client ID.
5. The app currently requests the full `drive` scope because a native app has no
   Google Picker equivalent that can grant `drive.file` access to an existing
   shared folder. Limit the consent screen to the intended users and complete
   any Google verification required before broader distribution.

The Expo config derives Google's reversed URL scheme from the iOS client ID.
After changing the client ID, regenerate or rebuild the native project.

## Install and run

Requirements: a Mac with Xcode, Node.js, and an iOS simulator or registered
physical device. CocoaPods is installed project-locally through Bundler.

```sh
npm install
gem install --user-install bundler -v 2.4.22 --no-document
env BUNDLE_PATH=vendor/bundle /usr/bin/bundle _2.4.22_ install
cp .env.example .env
# Edit .env with the real iOS OAuth client ID.
npm run ios
```

Google Sign-In includes native code, so this app requires an Expo development
build and does not run in Expo Go. `npm run ios` generates the native project and
opens the simulator build. To start Metro for an already-installed development
build, run `npm start`.

To install the app on physical iPhones and deliver updates to the two intended
users, use TestFlight. See [IPHONE_INSTALL.md](IPHONE_INSTALL.md) for the one-time
Apple/Expo setup, first installation, and normal update workflow.

### Run from Xcode

1. Run `npm run ios` once so Expo generates the native project and installs its
   pods.
2. Open `ios/NosRecettes.xcworkspace` in Xcode. Do not open the `.xcodeproj`;
   the workspace includes the CocoaPods dependencies.
3. Select the **NosRecettes** scheme and an iPhone simulator, then press
   **Cmd-R**.
4. Keep `npm start` running in a terminal so the Debug build can load its
   JavaScript bundle and support Fast Refresh.

For a physical iPhone, choose the **NosRecettes** target's **Signing &
Capabilities** tab, select your Apple developer team, connect and trust the
device, choose it as the run destination, and press **Cmd-R**. Google OAuth still
uses the bundle ID `com.nosrecettes.app`.

The first native build compiles React Native from source and can take several
minutes. Later builds use Xcode's cache and are substantially faster.

## Verification

```sh
npm run typecheck
EXPO_NO_TELEMETRY=1 npx expo install --check
```

## Persistent sign-in

The app does not store Google access tokens in JavaScript storage. The Google
Sign-In iOS SDK owns its durable credential in Keychain. At startup,
`restoreAuthSession()` restores the previous Google account; `getAccessToken()`
asks the SDK for a current token before every Drive request. The selected Drive
folder and non-sensitive session metadata are also stored with SecureStore.

Signing out clears the local native session. It does not revoke the user's grant
at Google, so signing back in is quick.

## Project layout

```text
App.tsx                         App state and screen routing
src/auth/googleAuth.ts         Native auth and Keychain-backed restoration
src/storage/keychain.ts        Persistent root-folder configuration
src/api/drive.ts               Google Drive REST repository
src/lib/markdown.ts            Recipe parsing and Markdown template
src/screens/                    Native iOS/Android screens
src/components/ui.tsx          Shared native UI primitives
app.config.ts                  Expo, bundle ID, and native plugins
```

## Google Drive format

```text
/Nos Recettes/
  poulet-roti-aux-herbes/
    recipe.md
```

Each recipe is a subfolder containing one `recipe.md`. This remains compatible
with the previous web application.
