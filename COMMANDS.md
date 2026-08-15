# Commands

## Main dev loop

- `npm start`
    - Use this for normal typescript/ui changes. Starts Metro with Fast Refresh.
    - Save a file and the simulator updates in seconds. No rebuild.
    - Needs the dev build already installed on the simulator (see `npm run ios`).
    - Leave it running in its own terminal.

- `npm run ios`
    - Use this when native deps or native config change: `package.json` deps with
      native code, `app.config.ts`, plugins, the Google client ID in `.env`.
    - Runs prebuild + pod install + xcodebuild, then installs and launches on the
      simulator. Takes about a minute from clean.
    - `expo prebuild` wipes and regenerates `ios/`, so this is always a full
      rebuild. Don't reach for it when `npm start` will do.
    - Once it launches, `npm start` is enough until native config changes again.

## Checks

- `npm run typecheck`
    - `tsc --noEmit`. Run after changes (required by CLAUDE.md).

- `npx expo install --check`
    - Flags dependency versions that don't match the Expo SDK.

## iPhone releases

- `npm run release:ios`
    - Creates a production iOS build and submits it to App Store Connect/TestFlight.
    - EAS increments the iOS build number automatically, so every upload is valid.
    - Requires the one-time setup in `IPHONE_INSTALL.md` and interactive Apple/Expo
      authentication unless credentials have already been saved.

- `npm run submit:ios`
    - Submits the latest completed EAS iOS build without rebuilding it.
    - Useful if the build succeeded but automatic submission did not.

## Occasional

- `npm run pods`
    - Just the CocoaPods step. Useful after editing the Podfile without wanting a
      full prebuild.
    - Runs under Homebrew Ruby (`/opt/homebrew/opt/ruby/bin/bundle`). System Ruby
      2.6 is too old — Expo's precompiled-module resolver needs 2.7+ or it
      silently falls back to building every module from source.
    - After changing the Gemfile:
      `env BUNDLE_PATH=vendor/bundle /opt/homebrew/opt/ruby/bin/bundle install`

- `npm run android`
    - Android equivalent of `npm run ios`.

## Xcode

- Open `ios/NosRecettes.xcworkspace`, not the `.xcodeproj`.
- Select the `NosRecettes` scheme and a simulator, then Cmd-R.
- Keep `npm start` running so the Debug build can load its JS bundle.

## Gotchas

- Don't run two builds at once. They fight over the same `ios/` workspace and
  DerivedData, and the symptom looks like a build that never finishes.
- Native Google Sign-In means Expo Go can't run this app. Dev build only.
- Never set `buildReactNativeFromSource` in `app.config.ts`. It forces React
  Native to compile from source and turns a 1 minute build into 10+.
