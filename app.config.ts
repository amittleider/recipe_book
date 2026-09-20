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
  icon: './assets/icon.png',
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
    'expo-image',
    'expo-video',
    [
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: reversedClientId },
    ],
    // The permission strings iOS shows the cook. They live here rather than in
    // ios/Info.plist, which prebuild regenerates from this file.
    [
      'expo-image-picker',
      {
        cameraPermission:
          'Nos Recettes utilise l\u2019appareil photo pour ajouter des photos et vid\u00e9os \u00e0 vos recettes.',
        photosPermission:
          'Nos Recettes acc\u00e8de \u00e0 votre galerie pour ajouter des photos et vid\u00e9os \u00e0 vos recettes.',
        microphonePermission:
          'Nos Recettes utilise le micro pour enregistrer le son de vos vid\u00e9os.',
      },
    ],
  ],
})
