import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { ensureThumb, getTransfer, mediaUri, thumbUri, useMediaVersion } from '../data/mediaStore'
import { isVideoMime } from '../lib/media'
import { colors } from '../theme'
import type { RecipeMedia } from '../types'

/**
 * One photo, at tile size.
 *
 * Every media surface in the app is built out of this, so the rules about what
 * to show live in one place: Drive's small rendering when there is one, the
 * full-size copy when it happens to already be on the device, and a quiet
 * placeholder otherwise. A tile never blocks and never shows an error — a
 * picture that will not load is simply a picture that is not there yet.
 */
export function MediaThumb({
  folderId,
  entry,
  style,
  radius = 10,
  showBadge = true,
}: {
  folderId: string
  entry: RecipeMedia
  style?: StyleProp<ViewStyle>
  radius?: number
  showBadge?: boolean
}) {
  // Subscribed to, not read: the paths below are resolved synchronously and
  // this is what tells the tile a finished download is worth looking again for.
  useMediaVersion()
  const thumb = thumbUri(entry)
  const full = thumb ? null : mediaUri(folderId, entry)
  const source = thumb ?? full
  const video = isVideoMime(entry.mimeType, entry.name)
  const transfer = getTransfer(folderId, entry.name)

  useEffect(() => {
    void ensureThumb(entry)
  }, [entry.fileId])

  return (
    <View style={[styles.tile, { borderRadius: radius }, style]}>
      {source ? (
        <Image source={{ uri: source }} style={styles.image} contentFit="cover" transition={160} />
      ) : (
        <View style={styles.placeholder}>
          {transfer.phase === 'idle' ? null : <ActivityIndicator size="small" color={colors.muted} />}
        </View>
      )}
      {showBadge && video && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>▶</Text>
        </View>
      )}
      {entry.pending && (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>{transfer.phase === 'failed' ? '!' : '↑'}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    backgroundColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.65)',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, marginLeft: 2 },
  pending: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.65)',
  },
  pendingText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
} as const)
