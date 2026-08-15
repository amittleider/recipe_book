# Install and update Nos Recettes on iPhone

## Recommended setup: TestFlight

Use Apple's TestFlight for both phones. It avoids device-ID registration and
reinstalling development builds. Each phone installs the app once from a
TestFlight invitation; later builds appear as normal TestFlight updates.

An active Apple Developer Program membership is required. Apple currently
charges USD 99 per membership year (or the local-currency equivalent). An Expo
account is also required; EAS Build can be used on its free plan within its
current build limits.

TestFlight builds expire after 90 days. Publish a fresh build before the current
one expires. This is a beta distribution workflow, not a public App Store
release.

## One-time setup on the Mac

1. Join the [Apple Developer Program](https://developer.apple.com/programs/), if
   needed, and accept any pending agreements in
   [App Store Connect](https://appstoreconnect.apple.com/).
2. Install and sign in to the EAS CLI:

   ```sh
   npm install --global eas-cli
   eas login
   eas whoami
   ```

3. Link this repository to an Expo project:

   ```sh
   eas init
   ```

   This adds an EAS `projectId` to `app.config.ts`. Commit that change. Keep the
   existing project slug (`nos-recettes`) and bundle ID
   (`com.nosrecettes.app`).

4. In the Expo project dashboard, open **Project settings → Environment
   variables**. Add `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` to the **production**
   environment as a plain-text project variable, using the real value from the
   local `.env` file. The OAuth client ID is public application configuration,
   not a password. Do not upload or commit `.env`.
5. Confirm that the Google Cloud iOS OAuth client uses bundle ID
   `com.nosrecettes.app`, that the Google Drive API is enabled, and that both
   Google accounts are OAuth consent-screen test users while the Google project
   remains in Testing.
6. Run the first release:

   ```sh
   npm run typecheck
   npm run release:ios
   ```

   On the first run, EAS asks for the Apple account and permission to create or
   reuse signing credentials. It may also ask to create the App Store Connect
   app record. Let EAS manage the distribution certificate, provisioning
   profile, and App Store Connect API key.

7. Wait for Apple to process the upload. It commonly takes several minutes, then
   open the app in App Store Connect and select its **TestFlight** tab.

## Invite both phones

The least bureaucratic option for two people is an internal TestFlight group:

1. In **App Store Connect → Users and Access**, invite your wife's Apple Account
   as an App Store Connect user with the **Developer** role and access to Nos
   Recettes. This gives access to the app's developer-facing TestFlight metadata,
   so only use this route for someone you trust.
2. In **Nos Recettes → TestFlight**, create an internal group named `Family`.
3. Enable **automatic distribution** for the group and add both App Store Connect
   users.
4. On each iPhone, install Apple's free **TestFlight** app, open the email invite,
   accept it, and tap **Install**.
5. In TestFlight, enable automatic updates if desired.

Internal testing avoids TestFlight App Review. If you do not want to make your
wife an App Store Connect user, create an external testing group instead. The
first external build of a version must go through Apple's TestFlight App Review;
after approval, invite her by email or a private link.

## Normal update workflow

For every tested update:

```sh
npm run typecheck
npm run release:ios
```

That command builds the production app, automatically increments its build
number, and uploads it to App Store Connect. With automatic distribution enabled,
the new build becomes available to the `Family` group after Apple finishes
processing it. TestFlight can update both phones automatically, or either person
can open TestFlight and tap **Update**.

If building succeeds but submission fails, retry only the upload:

```sh
npm run submit:ios
```

Change the human-facing `version` in `app.config.ts` only for a meaningful app
release (for example, `2.0.0` to `2.1.0`). EAS handles the required unique iOS
build number on every run.

## What not to use for this workflow

- `npm run ios` is for local simulator/device development, not family
  distribution. A Debug build also depends on Metro running on the Mac.
- The `preview` EAS profile creates an ad hoc build. It requires registering each
  device and is less convenient for repeated family updates than TestFlight.
- Expo Go cannot run this app because native Google Sign-In is included.

## Optional later: near-instant JavaScript updates

EAS Update can deliver compatible TypeScript, styling, and bundled-image changes
over the air, usually on the next app launch. It requires adding `expo-updates`,
configuring a runtime version and production channel, and making one new
TestFlight build. Changes to native dependencies, Expo SDK, plugins,
`app.config.ts`, entitlements, or other native configuration still require the
normal TestFlight build.

Start with TestFlight alone. Add EAS Update only after the first production build
and sign-in flow work on both phones; this keeps the initial distribution path
easy to diagnose and gives every update a single dependable command.
