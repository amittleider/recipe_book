import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { AuthError } from '../api/drive'
import { sync, type SyncProgress } from '../data/recipeStore'
import { Button, ErrorBanner, Screen } from '../components/ui'
import { colors, fonts } from '../theme'

type Props = {
  folderName: string
  onReady: () => void
  onChangeFolder: () => void
  onAuthError: () => void
}

/**
 * The one-time cost of a fast cookbook: fill the cache up front so every screen
 * afterwards is instant. Shown when a folder is chosen or when a launch finds
 * no cached recipes.
 */
export function SyncScreen({ folderName, onReady, onChangeFolder, onAuthError }: Props) {
  const [progress, setProgress] = useState<SyncProgress>({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const finished = useRef(false)

  useEffect(() => {
    let mounted = true
    setError('')
    sync({ force: true, onProgress: (next) => mounted && setProgress(next) })
      .then(() => {
        if (!mounted || finished.current) return
        finished.current = true
        onReady()
      })
      .catch((caught: unknown) => {
        if (caught instanceof AuthError) return onAuthError()
        if (mounted) setError(caught instanceof Error ? caught.message : 'Préparation impossible')
      })
    return () => {
      mounted = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const counted = progress.total > 0
  const ratio = counted ? Math.min(1, progress.done / progress.total) : 0

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.title}>{folderName}</Text>
        {error ? (
          <>
            <ErrorBanner message={error} />
            <View style={styles.actions}>
              <Button onPress={retry}>Réessayer</Button>
              <Button variant="secondary" onPress={onChangeFolder}>Changer de dossier</Button>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.caption}>
              {counted ? 'Préparation de votre livre…' : 'Lecture du dossier…'}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
            {counted ? (
              <Text style={styles.count}>
                {progress.done} / {progress.total} recettes
              </Text>
            ) : (
              <ActivityIndicator />
            )}
            <Text style={styles.note}>
              Une seule fois. Ensuite, tout s’ouvre sans attendre, même hors ligne.
            </Text>
          </>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 18 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.text, textAlign: 'center' },
  caption: { color: colors.text, fontSize: 16, textAlign: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.text },
  count: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  actions: { gap: 10 },
} as const)
