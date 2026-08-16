import type { ExpoConfig, ConfigContext } from 'expo/config'

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? ''
const reversedClientId = iosClientId
  ? `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`
  : 'com.googleusercontent.apps.REPLACE_WITH_IOS_CLIENT_ID'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Nos Recettes',
  slug: 'nos-recettes',
  owner: 'amittleider',
  version: '2.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: 'nosrecettes',
  extra: {
    ...config.extra,
    eas: {
      projectId: 'c6e97315-fe8d-4cb1-b31b-0543b30473da',
    },
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.nosrecettes.app',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.nosrecettes.app',
  },
  plugins: [
    'expo-secure-store',
    [
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: reversedClientId },
    ],
  ],
})
