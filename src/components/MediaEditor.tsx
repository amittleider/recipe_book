import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { AuthError } from '../api/drive'
import { MediaThumb } from './MediaThumb'
import {
  addMedia,
  getMedia,
  getTransfer,
  removeMedia,
  reorderMedia,
  retryUpload,
  useTransferVersion,
} from '../data/mediaStore'
import { chooseMedia } from '../lib/mediaPicker'
import { colors } from '../theme'
import type { RecipeMedia } from '../types'

/**
 * The photo grid in the editor.
 *
 * Unlike every other field on the form, this one does not wait for Enregistrer:
 * the bytes are written and the upload starts the moment a photo is picked. A
 * photo is a thing the cook just captured and does not want to risk, and a save
 * button that might be twenty megabytes of video away is the wrong place to put
 * it. What the save *does* carry is the order, which is why choosing a cover is
 * an edit like any other.
 */
export function MediaEditor({
  folderId,
  onChange,
  onAuthError,
}: {
  folderId: string
  onChange: (names: string[]) => void
  onAuthError: () => void
}) {
  useTransferVersion()
  const media = getMedia(folderId)
  const [busy, setBusy] = useState('')

  const add = useCallback(() => {
    chooseMedia((assets) => {
      const added = addMedia(folderId, assets)
      if (added.length) onChange(getMedia(folderId).map((entry) => entry.name))
    })
  }, [folderId, onChange])

  const promote = useCallback(
    (name: string) => {
      const names = getMedia(folderId).map((entry) => entry.name)
      reorderMedia(folderId, [name, ...names.filter((other) => other !== name)])
      onChange(getMedia(folderId).map((entry) => entry.name))
    },
    [folderId, onChange],
  )

  /**
   * Moving a photo one place at a time.
   *
   * A press-and-hold menu rather than a drag: dragging inside a wrapping grid
   * that itself sits in a scrolling form needs a gesture library and still
   * fights the scroll, and the common case — deciding which photo is the cover —
   * is already a single tap.
   */
  const move = useCallback(
    (name: string, by: -1 | 1) => {
      const names = getMedia(folderId).map((entry) => entry.name)
      const from = names.indexOf(name)
      const to = from + by
      if (from === -1 || to < 0 || to >= names.length) return
      names.splice(to, 0, ...names.splice(from, 1))
      reorderMedia(folderId, names)
      onChange(getMedia(folderId).map((entry) => entry.name))
    },
    [folderId, onChange],
  )

  const rearrange = useCallback(
    (entry: RecipeMedia, index: number, total: number) => {
      const actions: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = []
      if (index > 0) actions.push({ text: 'Mettre en couverture', onPress: () => promote(entry.name) })
      if (index > 0) actions.push({ text: 'Déplacer vers la gauche', onPress: () => move(entry.name, -1) })
      if (index < total - 1) actions.push({ text: 'Déplacer vers la droite', onPress: () => move(entry.name, 1) })
      actions.push({ text: 'Annuler', style: 'cancel' })
      Alert.alert('Déplacer la photo', undefined, actions)
    },
    [promote, move],
  )

  const remove = useCallback(
    (entry: RecipeMedia) => {
      Alert.alert('Supprimer cette photo ?', 'Elle sera déplacée vers la corbeille de Drive.', [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            setBusy(entry.name)
            removeMedia(folderId, entry.name)
              .then(() => onChange(getMedia(folderId).map((item) => item.name)))
              .catch((caught: unknown) => {
                if (caught instanceof AuthError) return onAuthError()
                Alert.alert('Suppression impossible', 'Réessayez une fois la connexion revenue.')
              })
              .finally(() => setBusy(''))
          },
        },
      ])
    },
    [folderId, onChange, onAuthError],
  )

  return (
    <View>
      <View style={styles.grid}>
        {media.map((entry, index) => {
          const transfer = getTransfer(folderId, entry.name)
          const failed = transfer.phase === 'failed'
          return (
            <View key={entry.name}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={index === 0 ? 'Photo de couverture' : 'Choisir comme couverture'}
                onPress={() => (failed ? retryUpload(folderId, entry.name) : promote(entry.name))}
                onLongPress={() => media.length > 1 && rearrange(entry, index, media.length)}
                delayLongPress={300}
                style={({ pressed }) => (pressed ? styles.pressed : undefined)}
              >
                <MediaThumb folderId={folderId} entry={entry} style={styles.tile} radius={10} />
                {index === 0 && (
                  <View style={styles.cover}>
                    <Text style={styles.coverText}>Couverture</Text>
                  </View>
                )}
                {transfer.phase === 'uploading' && (
                  <View style={styles.progress}>
                    <View style={[styles.progressBar, { width: `${Math.round(transfer.progress * 100)}%` }]} />
                  </View>
                )}
                {failed && (
                  <View style={styles.retry}>
                    <Text style={styles.retryText}>Réessayer</Text>
                  </View>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Supprimer ${entry.name}`}
                onPress={() => remove(entry)}
                disabled={!!busy}
                hitSlop={8}
                style={styles.remove}
              >
                {busy === entry.name ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.removeText}>✕</Text>
                )}
              </Pressable>
            </View>
          )
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter une photo"
          onPress={add}
          style={({ pressed }) => [styles.tile, styles.add, pressed ? styles.pressed : undefined]}
        >
          <Text style={styles.addText}>+</Text>
        </Pressable>
      </View>

      {media.length > 1 && (
        <Text style={styles.hint}>
          Touchez une photo pour en faire la couverture, restez appuyé pour la déplacer.
        </Text>
      )}
    </View>
  )
}

const TILE = 84

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: TILE, height: TILE },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addText: { color: colors.muted, fontSize: 26, lineHeight: 30 },
  cover: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 3,
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,24,0.68)',
  },
  coverText: { color: '#FFFFFF', fontSize: 10, letterSpacing: 0.4 },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  progressBar: { height: 3, backgroundColor: colors.text },
  retry: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 3,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  retryText: { color: colors.dangerText, fontSize: 10, letterSpacing: 0.4 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  removeText: { color: colors.dangerText, fontSize: 12, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8 },
  pressed: { opacity: 0.75 },
} as const)
