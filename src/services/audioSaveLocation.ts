/**
 * audioSaveLocation
 *
 * Optional user setting: also copy every finalised audio clip out to a
 * clerk-chosen folder on the device (via Android's Storage Access
 * Framework), so the raw recording is recoverable outside the app — e.g. to
 * re-upload or transcribe manually if the AI API is unavailable.
 *
 * Hooked into database.ts's saveAudioRecording() as a single fire-and-forget
 * choke point, so every recording module (Room dictation, per-item AI
 * Instant, Human Typist) gets this behaviour automatically and consistently.
 *
 * Settings are small, non-sensitive strings, stored in expo-secure-store —
 * the app has no general-purpose key/value store and this avoids adding one
 * just for a single on/off + folder-uri pair.
 */
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { mimeTypeForUri } from '../utils/audioMime'

const KEY_ENABLED = 'audio_save_location_enabled'
const KEY_FOLDER  = 'audio_save_location_folder_uri'
const KEY_FOLDER_NAME = 'audio_save_location_folder_name'

export interface AudioSaveLocationSettings {
  enabled: boolean
  folderUri: string | null
  folderName: string | null
}

export async function getAudioSaveLocation(): Promise<AudioSaveLocationSettings> {
  const [enabledStr, folderUri, folderName] = await Promise.all([
    SecureStore.getItemAsync(KEY_ENABLED),
    SecureStore.getItemAsync(KEY_FOLDER),
    SecureStore.getItemAsync(KEY_FOLDER_NAME),
  ])
  return {
    enabled:    enabledStr === '1',
    folderUri:  folderUri || null,
    folderName: folderName || null,
  }
}

export async function setAudioSaveEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_ENABLED, enabled ? '1' : '0')
}

/**
 * Opens Android's folder picker (Storage Access Framework) and persists the
 * granted directory URI. Returns the picked { uri, name }, or null if the
 * user cancelled, denied permission, or the platform doesn't support SAF.
 */
export async function pickAudioSaveFolder(): Promise<{ uri: string; name: string } | null> {
  if (Platform.OS !== 'android') return null
  try {
    const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!res.granted) return null
    // Derive a short display name from the tree URI's trailing segment.
    const decoded = decodeURIComponent(res.directoryUri)
    const name = decoded.split('/').pop() || decoded
    await SecureStore.setItemAsync(KEY_FOLDER, res.directoryUri)
    await SecureStore.setItemAsync(KEY_FOLDER_NAME, name)
    return { uri: res.directoryUri, name }
  } catch (err) {
    console.warn('[audioSaveLocation] folder pick failed:', err)
    return null
  }
}

export async function clearAudioSaveFolder(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_FOLDER)
  await SecureStore.deleteItemAsync(KEY_FOLDER_NAME)
}

/**
 * Fire-and-forget copy of a finalised clip into the clerk's chosen folder.
 * No-op when the setting is off, no folder is chosen, or the platform isn't
 * Android. Failures are logged only — this must never disrupt recording.
 */
export async function copyClipToSaveLocation(sourceUri: string, filename: string): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    const { enabled, folderUri } = await getAudioSaveLocation()
    if (!enabled || !folderUri) return

    const base64 = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
      folderUri, filename, mimeTypeForUri(sourceUri)
    )
    await FileSystem.writeAsStringAsync(destUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    })
  } catch (err) {
    console.warn('[audioSaveLocation] copy-out failed (non-fatal):', err)
  }
}
