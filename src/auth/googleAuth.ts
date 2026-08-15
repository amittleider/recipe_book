import * as SecureStore from 'expo-secure-store'
import {
  GoogleSignin,
  isSuccessResponse,
  type User,
} from '@react-native-google-signin/google-signin'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const SESSION_METADATA_KEY = 'nr.auth.session'
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

export type AuthUser = User['user']

let configured = false

function configure() {
  if (configured) return
  if (!iosClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is missing. Copy .env.example to .env and configure the iOS OAuth client.',
    )
  }
  GoogleSignin.configure({
    iosClientId,
    scopes: [DRIVE_SCOPE],
    offlineAccess: false,
  })
  configured = true
}

async function rememberUser(user: AuthUser) {
  // Google Sign-In owns the actual credentials and persists them in iOS
  // Keychain. This small Keychain record is only non-sensitive session metadata.
  await SecureStore.setItemAsync(
    SESSION_METADATA_KEY,
    JSON.stringify({ email: user.email, name: user.name }),
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
  )
}

export async function restoreAuthSession(): Promise<AuthUser | null> {
  if (!iosClientId) return null
  configure()
  const response = await GoogleSignin.signInSilently()
  if (response.type !== 'success') return null
  await rememberUser(response.data.user)
  return response.data.user
}

export async function signIn(): Promise<AuthUser | null> {
  configure()
  const response = await GoogleSignin.signIn()
  if (!isSuccessResponse(response)) return null
  await rememberUser(response.data.user)
  return response.data.user
}

export async function getAccessToken(): Promise<string> {
  configure()
  if (!GoogleSignin.getCurrentUser()) {
    const response = await GoogleSignin.signInSilently()
    if (response.type !== 'success') throw new AuthError('Sign-in required')
  }
  // On iOS the native SDK refreshes the token when necessary. Its durable
  // credential remains in Keychain; access tokens are never stored by JS.
  const { accessToken } = await GoogleSignin.getTokens()
  if (!accessToken) throw new AuthError('No Google access token')
  return accessToken
}

export async function signOut(): Promise<void> {
  if (iosClientId) {
    configure()
    await GoogleSignin.signOut().catch(() => null)
  }
  await SecureStore.deleteItemAsync(SESSION_METADATA_KEY)
}

export class AuthError extends Error {}
