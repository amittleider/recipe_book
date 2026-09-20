import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { ensureMedia, getTransfer, mediaUri, thumbUri, useTransferVersion } from '../data/mediaStore'
import { isVideoMime } from '../lib/media'
import type { RecipeMedia } from '../types'

/**
 * One photo at a time, filling the screen.
 *
 * Video is played from the local file rather than streamed from Drive. Drive's
 * media URL needs an Authorization header that a player would have to keep
 * refreshing mid-playback, and downloading first has the better ending anyway:
 * the video is then on the device, so the next time it plays instantly and
 * plays offline.
 */
export function MediaViewer({
  folderId,
  media,
  index,
  onClose,
}: {
  folderId: string
  media: RecipeMedia[]
  index: number
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const [current, setCurrent] = useState(index)

  useEffect(() => setCurrent(index), [index])

  useEffect(() => {
    const entry = media[current]
    if (entry) void ensureMedia(folderId, entry)
  }, [folderId, current, media])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width)
      setCurrent(Math.min(Math.max(next, 0), media.length - 1))
    },
    [width, media.length],
  )

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <FlatList
          data={media}
          keyExtractor={(entry) => entry.name}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          onMomentumScrollEnd={onScroll}
          getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
          renderItem={({ item, index: position }) => (
            <View style={{ width, height }}>
              <Page folderId={folderId} entry={item} active={position === current} onClose={onClose} />
            </View>
          )}
        />

        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
          {media.length > 1 && (
            <Text style={styles.counter}>
              {current + 1}/{media.length}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  )
}

function Page({
  folderId,
  entry,
  active,
  onClose,
}: {
  folderId: string
  entry: RecipeMedia
  active: boolean
  onClose: () => void
}) {
  useTransferVersion()
  const local = mediaUri(folderId, entry)
  const transfer = getTransfer(folderId, entry.name)

  if (isVideoMime(entry.mimeType, entry.name)) {
    // The player is built only for the page being looked at; the others show
    // their poster frame, so flicking through a recipe does not spin up a
    // decoder per video.
    if (active && local) return <VideoPage uri={local} />
    return <Poster entry={entry} transfer={transfer.phase === 'downloading' ? transfer.progress : -1} />
  }

  const source = local ?? thumbUri(entry)
  return (
    <Pressable style={styles.page} onPress={onClose}>
      {source ? (
        <Image source={{ uri: source }} style={styles.full} contentFit="contain" transition={160} />
      ) : (
        <ActivityIndicator color="#FFFFFF" />
      )}
    </Pressable>
  )
}

function VideoPage({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false
    instance.play()
  })
  return <VideoView player={player} style={styles.full} contentFit="contain" nativeControls />
}

/** A video whose bytes are still on their way, with its poster and its progress. */
function Poster({ entry, transfer }: { entry: RecipeMedia; transfer: number }) {
  const poster = thumbUri(entry)
  return (
    <View style={styles.page}>
      {poster && <Image source={{ uri: poster }} style={styles.full} contentFit="contain" />}
      <View style={styles.posterOverlay}>
        <ActivityIndicator color="#FFFFFF" />
        <Text style={styles.posterText}>
          {transfer >= 0 ? `Téléchargement ${Math.round(transfer * 100)} %` : 'Téléchargement…'}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0D0D0C' },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  bar: {
    position: 'absolute',
    top: 54,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: { color: '#FFFFFF', fontSize: 22, lineHeight: 26 },
  counter: { color: '#FFFFFF', fontSize: 14, opacity: 0.8 },
  posterOverlay: { position: 'absolute', alignItems: 'center', gap: 10 },
  posterText: { color: '#FFFFFF', fontSize: 13 },
} as const)
