import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { ensureMedia, getMedia, mediaUri, thumbUri, useMediaVersion } from '../data/mediaStore'
import { colors } from '../theme'

/**
 * A photo referenced from inside the recipe text rather than from the gallery.
 *
 * Nothing in this app writes one yet — the editor puts photos in the `## Photos`
 * section — but a cook who drops `![](etape-3.jpg)` next to a step from a laptop
 * should see the picture there, not the markdown for it.
 */
export function InlineMedia({ folderId, name }: { folderId: string; name: string }) {
  useMediaVersion()
  const entry = getMedia(folderId).find((item) => item.name === name)
  const source = entry ? (mediaUri(folderId, entry) ?? thumbUri(entry)) : null

  useEffect(() => {
    if (entry) void ensureMedia(folderId, entry)
  }, [folderId, entry?.fileId, entry?.validator])

  // A reference to a file the folder does not hold renders as nothing at all,
  // which is friendlier than a broken tile for a photo someone has since moved.
  if (!entry) return null

  return (
    <View style={styles.frame}>
      {source && <Image source={{ uri: source }} style={styles.image} contentFit="contain" transition={160} />}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    marginVertical: 10,
    aspectRatio: 4 / 3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
} as const)
