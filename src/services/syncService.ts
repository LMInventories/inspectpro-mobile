/**
 * syncService.ts
 * Shared logic for syncing a single inspection to the server.
 * Used by both SyncScreen (bulk) and PropertyOverviewScreen (single).
 */
import { getLocalInspection, getAudioRecordings, markSynced } from './database'
import { api } from './api'
import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'

export type SyncResult = { id: number; address: string; success: boolean; error?: string }

export type SyncProgress = {
  phase: 'audio' | 'photos' | 'uploading'
  done: number
  total: number
}

// ── Photo compression + encoding ──────────────────────────────────────────────
//
// Raw iPhone/Android photos are typically 3–8 MB each.
// 108 photos × 5 MB × 1.33 (base64 overhead) ≈ 720 MB — this crashes the
// Hermes JS engine which has a ~530 MB string limit.
//
// We compress each photo to max 1400 px wide at 72 % JPEG quality before
// encoding.  That yields ~120–200 KB per photo, so 108 photos ≈ 18–22 MB
// total — well under any JS, network, or server limit.
// Quality is still more than sufficient to see defects and details clearly.

const MAX_PHOTO_PX  = 1400   // longest edge in pixels
const SYNC_QUALITY  = 0.72   // JPEG quality (0 = worst, 1 = lossless)

async function encodeOnePhoto(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri
  try {
    // Step 1 — compress/resize
    const compressed = await manipulateAsync(
      uri,
      [{ resize: { width: MAX_PHOTO_PX } }],
      { compress: SYNC_QUALITY, format: SaveFormat.JPEG }
    )
    // Step 2 — read as base64
    const b64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    // Step 3 — delete the temp compressed file (keep device storage clean)
    FileSystem.deleteAsync(compressed.uri, { idempotent: true }).catch(() => {})
    return `data:image/jpeg;base64,${b64}`
  } catch (compressErr) {
    console.warn('[Sync] compression failed, trying raw encode:', uri, compressErr)
    // Fall back to encoding the original file uncompressed
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      return `data:image/jpeg;base64,${b64}`
    } catch (e) {
      console.warn('[Sync] could not encode photo at all:', uri, e)
      return uri
    }
  }
}

export async function convertPhotoUrisToBase64(
  rd: any,
  onProgress?: (p: SyncProgress) => void
): Promise<any> {
  // First pass: count all non-data-URI photos so we can show X/Y
  let totalPhotos = 0
  for (const section of Object.values(rd)) {
    if (!section || typeof section !== 'object') continue
    for (const item of Object.values(section as object)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (Array.isArray((item as any)._photos)) {
        totalPhotos += (item as any)._photos.filter((u: string) => !u.startsWith('data:')).length
      }
    }
  }

  let donePhotos = 0
  if (totalPhotos > 0) onProgress?.({ phase: 'photos', done: 0, total: totalPhotos })

  // Special case: encode the property overview photo (stored at _overview.items.photo.uri)
  const overviewUri = (rd as any)['_overview']?.items?.photo?.uri
  if (overviewUri && !overviewUri.startsWith('data:')) {
    ;(rd as any)['_overview'].items.photo.uri = await encodeOnePhoto(overviewUri)
  }

  // Second pass: encode one at a time so progress fires per photo
  for (const sectionKey of Object.keys(rd)) {
    const section = rd[sectionKey]
    if (!section || typeof section !== 'object') continue
    for (const itemKey of Object.keys(section)) {
      const item = section[itemKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (Array.isArray(item._photos)) {
        const encoded: string[] = []
        for (const uri of item._photos) {
          encoded.push(await encodeOnePhoto(uri))
          if (!uri.startsWith('data:')) {
            donePhotos++
            onProgress?.({ phase: 'photos', done: donePhotos, total: totalPhotos })
          }
        }
        item._photos = encoded
      }
    }
  }
  return rd
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncSingleInspection(
  id: number,
  inspection: any,
  user: any,
  onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
  try {
    const fresh = getLocalInspection(id)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}

    // ── Audio encoding ───────────────────────────────────────────────────────
    const sqliteRecs = getAudioRecordings(id)
    const totalAudio = sqliteRecs.length
    console.log(`[Sync] found ${totalAudio} audio recordings in SQLite for inspection ${id}`)

    if (totalAudio > 0) {
      onProgress?.({ phase: 'audio', done: 0, total: totalAudio })
      let doneAudio = 0

      const serialised = await Promise.all(
        sqliteRecs.map(async (rec: any) => {
          let audioB64 = ''
          try {
            const info = await FileSystem.getInfoAsync(rec.file_uri)
            if (info.exists) {
              audioB64 = await FileSystem.readAsStringAsync(rec.file_uri, {
                encoding: FileSystem.EncodingType.Base64,
              })
              console.log(`[Sync] encoded clip ${rec.id}: ${audioB64.length} chars`)
            } else {
              console.warn(`[Sync] file missing for recording ${rec.id}:`, rec.file_uri)
            }
          } catch (e) {
            console.warn(`[Sync] could not read audio ${rec.id}:`, e)
          }
          doneAudio++
          onProgress?.({ phase: 'audio', done: doneAudio, total: totalAudio })
          return {
            id:         String(rec.id),
            audioB64,
            mimeType:   'audio/m4a',
            duration:   (rec.duration_ms || 0) / 1000,
            createdAt:  rec.created_at,
            label:      rec.label || rec.section_name || '',
            itemKey:    rec.item_key ? `${rec.section_key}:${rec.item_key}` : null,
            transcript: rec.transcription || null,
            gptResult:  null,
          }
        })
      )
      const withAudio = serialised.filter(r => r.audioB64.length > 0)
      if (withAudio.length > 0) {
        rd._recordings = withAudio
        console.log(`[Sync] ${withAudio.length}/${totalAudio} clips serialised successfully`)
      } else {
        console.warn('[Sync] all clips failed to encode — check file paths')
      }
    }

    // ── Photo encoding ───────────────────────────────────────────────────────
    const rdForSync = await convertPhotoUrisToBase64(
      JSON.parse(JSON.stringify(rd)),
      onProgress
    )

    // ── Upload ───────────────────────────────────────────────────────────────
    onProgress?.({ phase: 'uploading', done: 0, total: 1 })

    const payload: any = { report_data: JSON.stringify(rdForSync) }

    const role        = user?.role
    const typistMode  = (fresh as any)?.typist_mode ?? null
    const freshStatus = fresh?.status || inspection.status
    const localStatus = fresh?.local_status || inspection.local_status
    const isActive    = freshStatus === 'active' || localStatus === 'active'
    const typistName  = (fresh?.typist_name || fresh?.typist?.name || '').toLowerCase()
    const typistIsAi  = fresh?.typist_is_ai === true ||
                        fresh?.typist?.is_ai === true ||
                        typistName === 'ai typist' ||
                        typistName.startsWith('ai ')
    const isAiMode    = typistIsAi || typistMode === 'ai_instant' || typistMode === 'ai_room'
    const isFinalised = !!(fresh as any)?.is_finalised

    if (typistMode !== null) payload.typist_mode = typistMode

    if (role === 'clerk' && isActive) {
      if (isFinalised) {
        payload.status = isAiMode ? 'complete' : 'processing'
      }
    } else if (role === 'typist' && freshStatus === 'processing') {
      payload.status = 'review'
    }

    await api.syncInspection(id, payload)
    markSynced(id)
    onProgress?.({ phase: 'uploading', done: 1, total: 1 })
    return { id, address: inspection.property_address, success: true }

  } catch (err: any) {
    let msg = 'Network error'
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      msg = 'Upload timed out — the payload may be too large or the server is slow. Try again on Wi-Fi.'
    } else if (err.response?.status === 413) {
      msg = 'Payload too large — try syncing with fewer photos or shorter audio.'
    } else if (err.response?.status === 401 || err.response?.status === 403) {
      msg = 'Authentication error — please log out and back in.'
    } else if (err.response?.status >= 500) {
      msg = `Server error (${err.response.status}) — please try again shortly.`
    } else if (err.response?.data?.error) {
      msg = err.response.data.error
    } else if (err.message && err.message !== 'Network Error') {
      msg = err.message
    } else if (!err.response) {
      msg = 'No internet connection — check your network and try again.'
    }
    return { id, address: inspection.property_address, success: false, error: msg }
  }
}
