/**
 * importAudioClip
 *
 * Lets a clerk pick an existing audio file from the device (e.g. one recorded
 * with the phone's own Voice Recorder app when InspectPro's mic or the AI API
 * dropped out mid-inspection) and add it to a room/item's clip queue exactly
 * like a normally-recorded clip, so it still gets transcribed/uploaded.
 */
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { createAudioPlayer } from 'expo-audio'

export interface ImportedClip {
  uri: string
  durationMs: number
  mimeType: string
  name: string
}

// Best-effort duration probe — loads the file just long enough to read its
// metadata, never plays it. Short poll mirrors the recorder's own uri-poll
// pattern elsewhere in this codebase; falls back to 0 (unknown) on timeout.
async function probeDurationMs(uri: string): Promise<number> {
  let player: ReturnType<typeof createAudioPlayer> | null = null
  try {
    player = createAudioPlayer({ uri })
    for (let i = 0; i < 20 && !player.isLoaded; i++) {
      await new Promise(r => setTimeout(r, 50))
    }
    return player.isLoaded && isFinite(player.duration) ? Math.round(player.duration * 1000) : 0
  } catch {
    return 0
  } finally {
    player?.remove()
  }
}

/**
 * Opens the system file picker filtered to audio, copies the selected file
 * into documentDirectory (so it persists like a recorded clip), and returns
 * its new URI, MIME type, and best-effort duration.
 *
 * Returns null if the user cancelled or the pick/copy failed.
 */
export async function pickAndImportAudioClip(destPrefix: string): Promise<ImportedClip | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled || !result.assets?.length) return null

  const asset = result.assets[0]
  const ext = (asset.name?.split('.').pop() || 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '') || 'm4a'
  const destUri = `${FileSystem.documentDirectory}${destPrefix}_${Date.now()}.${ext}`

  try {
    await FileSystem.copyAsync({ from: asset.uri, to: destUri })
  } catch (err) {
    console.error('[importAudioClip] copy failed:', err)
    return null
  }

  const durationMs = await probeDurationMs(destUri)
  return {
    uri: destUri,
    durationMs,
    mimeType: asset.mimeType || '',
    name: asset.name || 'Imported clip',
  }
}
