import { Alert, Linking } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { PickedAsset } from '../data/mediaStore'

/**
 * The camera and the gallery, as the app wants them.
 *
 * Both entry points come from `expo-image-picker` rather than a camera view of
 * our own: the system camera is the one the cook already knows, it handles
 * focus, flash and video in one screen, and it keeps this app out of the
 * business of writing a viewfinder.
 */

/**
 * Photos are re-encoded before they go anywhere.
 *
 * Two reasons, both of them about the shared Drive folder. An iPhone hands back
 * HEIC, which Android cannot display, and this codebase is meant to ship there
 * one day. And a modern phone photo is several megabytes — at 2048px and this
 * quality it is a few hundred kilobytes, on a folder a family syncs to several
 * devices. Videos are passed through untouched: re-encoding one on a phone is
 * slow enough to be felt, and the picker has already applied its own quality.
 */
const MAX_DIMENSION = 2048
const JPEG_QUALITY = 0.85

type Source = 'camera' | 'library'

const DENIED: Record<Source, { title: string; body: string }> = {
  camera: {
    title: 'Accès à l’appareil photo refusé',
    body: 'Autorisez l’appareil photo dans les réglages pour photographier vos plats.',
  },
  library: {
    title: 'Accès aux photos refusé',
    body: 'Autorisez l’accès à vos photos dans les réglages pour les ajouter à vos recettes.',
  },
}

async function allowed(source: Source): Promise<boolean> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (permission.granted) return true

  // A refusal that cannot be undone from inside the app is a dead end, so the
  // way out is offered rather than described.
  const { title, body } = DENIED[source]
  Alert.alert(title, body, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Réglages', onPress: () => void Linking.openSettings() },
  ])
  return false
}

function mimeOf(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType
  return asset.type === 'video' ? 'video/mp4' : 'image/jpeg'
}

async function normalise(asset: ImagePicker.ImagePickerAsset): Promise<PickedAsset> {
  const mimeType = mimeOf(asset)
  if (asset.type === 'video') return { uri: asset.uri, mimeType }

  try {
    const context = ImageManipulator.manipulate(asset.uri)
    // Only the long edge is given, so the other is computed and the photo keeps
    // its proportions. A photo already smaller than the cap is scaled up by
    // neither, because `resize` never enlarges beyond the source.
    if (asset.width >= asset.height) context.resize({ width: Math.min(asset.width, MAX_DIMENSION) })
    else context.resize({ height: Math.min(asset.height, MAX_DIMENSION) })
    const rendered = await context.renderAsync()
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })
    return { uri: saved.uri, mimeType: 'image/jpeg' }
  } catch {
    // A photo that will not re-encode is still a photo. Uploading the original
    // costs more bytes than it should, which beats losing it.
    return { uri: asset.uri, mimeType }
  }
}

async function collect(result: ImagePicker.ImagePickerResult): Promise<PickedAsset[]> {
  if (result.canceled || !result.assets?.length) return []
  const picked: PickedAsset[] = []
  for (const asset of result.assets) picked.push(await normalise(asset))
  return picked
}

/** Opens the system camera for a photo or a video. */
export async function captureMedia(): Promise<PickedAsset[]> {
  if (!(await allowed('camera'))) return []
  return collect(
    await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    }),
  )
}

/** Opens the system gallery, several at a time. */
export async function pickMedia(): Promise<PickedAsset[]> {
  if (!(await allowed('library'))) return []
  return collect(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1,
    }),
  )
}

/**
 * The two ways in, as one choice. Used from the recipe view and the editor so
 * adding a photo means the same thing in both places.
 */
export function chooseMedia(onPicked: (assets: PickedAsset[]) => void): void {
  const run = (pick: () => Promise<PickedAsset[]>) => {
    void pick().then((assets) => {
      if (assets.length) onPicked(assets)
    })
  }
  Alert.alert('Ajouter une photo', undefined, [
    { text: 'Appareil photo', onPress: () => run(captureMedia) },
    { text: 'Galerie', onPress: () => run(pickMedia) },
    { text: 'Annuler', style: 'cancel' },
  ])
}
