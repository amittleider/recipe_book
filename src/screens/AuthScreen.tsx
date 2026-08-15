import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { signIn, type AuthUser } from '../auth/googleAuth'
import { Button, ErrorBanner, Screen } from '../components/ui'
import { colors, fonts } from '../theme'

export function AuthScreen({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    setBusy(true)
    setError('')
    try {
      const user = await signIn()
      if (user) onSignedIn(user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connexion échouée')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.brand}>Nos Recettes</Text>
        <Text style={styles.subtitle}>Votre livre de recettes, synchronisé avec Google Drive.</Text>
        <View style={styles.action}>
          <ErrorBanner message={error} />
          <Button onPress={connect} disabled={busy} busy={busy}>Continuer avec Google</Button>
        </View>
        <Text style={styles.privacy}>Votre connexion est conservée de manière sécurisée dans le Trousseau iOS.</Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 20 },
  brand: { fontFamily: fonts.serif, fontSize: 36, color: colors.text },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center', maxWidth: 300 },
  action: { width: '100%', maxWidth: 340, marginTop: 12 },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', maxWidth: 300 },
} as const)
