import * as SecureStore from 'expo-secure-store'
import type { DriveFolder } from '../types'

const ROOT_FOLDER_KEY = 'nr.drive.root-folder'
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

export async function getRootFolder(): Promise<DriveFolder | null> {
  const value = await SecureStore.getItemAsync(ROOT_FOLDER_KEY)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as DriveFolder
    return parsed.id && parsed.name ? parsed : null
  } catch {
    return null
  }
}

export function setRootFolder(folder: DriveFolder) {
  return SecureStore.setItemAsync(ROOT_FOLDER_KEY, JSON.stringify(folder), options)
}

export function clearRootFolder() {
  return SecureStore.deleteItemAsync(ROOT_FOLDER_KEY)
}
