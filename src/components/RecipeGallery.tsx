import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { MediaThumb } from './MediaThumb'
import { ensureMedia, mediaUri, thumbUri, useMediaVersion } from '../data/mediaStore'
import { isVideoMime } from '../lib/media'
import { colors } from '../theme'
import type { RecipeMedia } from '../types'

/**
 * A recipe's photos, above the recipe.
 *
 * The hero pages sideways through everything the recipe has, the strip below
 * jumps to one, and a tap opens the full-screen viewer. A recipe with no photos
 * renders nothing at all, so a cookbook full of plain text looks exactly as it
 * did before any of this existed.
 */
export function RecipeGallery({
  folderId,
  media,
  onOpen,
}: {
  folderId: string
  media: RecipeMedia[]
  onOpen: (index: number) => void
}) {
  const { width } = useWindowDimensions()
  // The gallery sits inside the detail screen's 20pt padding.
  const heroWidth = Math.max(1, width - 40)
  const [index, setIndex] = useState(0)
  const pager = useRef<FlatList<RecipeMedia>>(null)

  // Only the visible photo and its neighbour are worth the bytes.
  useEffect(() => {
    for (const offset of [0, 1, -1]) {
      const entry = media[index + offset]
      if (entry) void ensureMedia(folderId, entry)
    }
  }, [folderId, index, media])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / heroWidth)
      setIndex(Math.min(Math.max(next, 0), media.length - 1))
    },
    [heroWidth, media.length],
  )

  const jump = useCallback(
    (to: number) => {
      setIndex(to)
      pager.current?.scrollToOffset({ offset: to * heroWidth, animated: true })
    },
    [heroWidth],
  )

  if (!media.length) return null

  return (
    <View style={styles.gallery}>
      <FlatList
        ref={pager}
        data={media}
        keyExtractor={(entry) => entry.name}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, position) => ({ length: heroWidth, offset: heroWidth * position, index: position })}
        renderItem={({ item, index: position }) => (
          <Pressable onPress={() => onOpen(position)} style={{ width: heroWidth }}>
            <Hero folderId={folderId} entry={item} />
          </Pressable>
        )}
      />

      {media.length > 1 && (
        <>
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1}/{media.length}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {media.map((entry, position) => (
              <Pressable key={entry.name} onPress={() => jump(position)}>
                <MediaThumb
                  folderId={folderId}
                  entry={entry}
                  radius={8}
                  showBadge={false}
                  style={[styles.tile, position === index ? styles.tileActive : undefined]}
                />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  )
}

/** The large image: the full-size copy once it is here, its tile until then. */
function Hero({ folderId, entry }: { folderId: string; entry: RecipeMedia }) {
  useMediaVersion()
  const source = mediaUri(folderId, entry) ?? thumbUri(entry)
  const video = isVideoMime(entry.mimeType, entry.name)

  return (
    <View style={styles.hero}>
      {source ? (
        <Image source={{ uri: source }} style={styles.heroImage} contentFit="cover" transition={200} />
      ) : (
        <View style={styles.heroImage} />
      )}
      {video && (
        <View style={styles.play}>
          <Text style={styles.playText}>▶</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  gallery: { marginBottom: 16 },
  hero: {
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: { width: '100%', height: '100%' },
  play: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.55)',
  },
  playText: { color: '#FFFFFF', fontSize: 20, marginLeft: 4 },
  counter: { alignItems: 'center', marginTop: 8 },
  counterText: { color: colors.muted, fontSize: 12, letterSpacing: 0.5 },
  strip: { gap: 8, paddingTop: 8 },
  tile: { width: 54, height: 54, opacity: 0.55 },
  tileActive: { opacity: 1, borderColor: colors.text },
} as const)
