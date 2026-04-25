/**
 * syncService.ts
 * Shared logic for syncing a single inspection to the server.
 * Used by both SyncScreen (bulk) and PropertyOverviewScreen (single).
 *
 * Photo upload strategy:
 *   1. Collect all file:// URIs in report_data (item._photos + overview photo)
 *   2. Request pre-signed S3 PUT URLs from server (single batch call)
 *   3. Compress each photo → upload binary JPEG directly to S3 (no base64, no Flask)
 *   4. Replace file:// URIs with the final S3 HTTPS URLs
 *
 * Fallbacks:
 *   • Server returns 503 (S3 not configured)   → encode all photos as base64
 *   • Individual upload fails                   → encode that photo as base64
 *
 * This drops sync payload from ~18 MB (base64) to ~50 KB (text only) when S3
 * is configured.
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

const MAX_PHOTO_PX = 1400   // longest edge in pixels
const SYNC_QUALITY = 0.72   // JPEG quality (0 = worst, 1 = lossless)

// ── Compress a photo to a local temp JPEG, returns its URI ───────────────────
async function compressPhoto(uri: string): Promise<string> {
  try {
    const compressed = await manipulateAsync(
      uri,
      [{ resize: { width: MAX_PHOTO_PX } }],
      { compress: SYNC_QUALITY, format: SaveFormat.JPEG }
    )
    return compressed.uri
  } catch (e) {
    console.warn('[Sync] compression failed, using original:', uri, e)
    return uri
  }
}

// ── Encode one photo to a base64 data URI (fallback path) ────────────────────
//
// Raw iPhone/Android photos are typically 3–8 MB each.
// 108 photos × 5 MB × 1.33 (base64 overhead) ≈ 720 MB — this crashes the
// Hermes JS engine which has a ~530 MB string limit.
// We compress to max 1400 px / 72 % JPEG before encoding (~120–200 KB each).
//
async function encodeOnePhoto(uri: string): Promise<string> {
  if (uri.startsWith('data:'))  return uri
  if (uri.startsWith('https:')) return uri   // already an S3 URL — leave as-is
  try {
    const compressedUri = await compressPhoto(uri)
    const b64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    if (compressedUri !== uri) {
      FileSystem.deleteAsync(compressedUri, { idempotent: true }).catch(() => {})
    }
    return `data:image/jpeg;base64,${b64}`
  } catch (compressErr) {
    console.warn('[Sync] compression failed, trying raw encode:', uri, compressErr)
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

// ── Collect all local file:// URIs with their paths inside report_data ────────
//
// Returns [{path: ['sectionKey','itemKey','_photos','0'], uri: 'file://...'}, ...]
// Path is an array of keys / numeric-string indices so we can write back later.
//
type UriRef = { path: string[]; uri: string }

function collectLocalUris(rd: any): UriRef[] {
  const refs: UriRef[] = []

  // Property overview photo
  const overviewUri = (rd['_overview'] as any)?.items?.photo?.uri
  if (overviewUri && overviewUri.startsWith('file://')) {
    refs.push({ path: ['_overview', 'items', 'photo', 'uri'], uri: overviewUri })
  }

  // Section / item photos
  for (const sectionKey of Object.keys(rd)) {
    const section = rd[sectionKey]
    if (!section || typeof section !== 'object') continue
    for (const itemKey of Object.keys(section)) {
      const item = section[itemKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (Array.isArray(item._photos)) {
        ;(item._photos as string[]).forEach((uri, idx) => {
          if (uri.startsWith('file://')) {
            refs.push({ path: [sectionKey, itemKey, '_photos', String(idx)], uri })
          }
        })
      }
    }
  }

  return refs
}

// ── Write a value back into report_data at an arbitrary path ─────────────────
function setAtPath(rd: any, path: string[], value: string) {
  let cursor: any = rd
  for (let i = 0; i < path.length - 1; i++) {
    cursor = cursor[path[i]]
  }
  const last = path[path.length - 1]
  const idx  = Number.isFinite(Number(last)) ? Number(last) : NaN
  if (!Number.isNaN(idx) && Array.isArray(cursor)) {
    cursor[idx] = value
  } else {
    cursor[last] = value
  }
}

// ── Main photo handler: S3 upload with base64 fallback ───────────────────────
export async function uploadPhotosToS3(
  rd: any,
  inspectionId: number,
  onProgress?: (p: SyncProgress) => void
): Promise<any> {
  const refs = collectLocalUris(rd)
  const totalPhotos = refs.length

  if (totalPhotos === 0) return rd

  onProgress?.({ phase: 'photos', done: 0, total: totalPhotos })

  // ── Request pre-signed PUT URLs from server (one batch call) ─────────────
  let presigned: Array<{ key: string; upload_url: string; final_url: string }> | null = null

  try {
    const prefix   = `inspections/${inspectionId}/photos`
    const response = await api.getPhotoPresignedUrls(totalPhotos, prefix)
    presigned      = response.data.uploads
    console.log(`[Sync] received ${presigned?.length} pre-signed S3 URLs`)
  } catch (err: any) {
    const status = err?.response?.status
    if (status === 503) {
      console.log('[Sync] S3 not configured on server — falling back to base64 for all photos')
    } else {
      console.warn('[Sync] presign request failed, falling back to base64:', err?.message)
    }
    presigned = null
  }

  // ── No S3: encode everything as base64 ────────────────────────────────────
  if (!presigned) {
    let done = 0
    for (const { path, uri } of refs) {
      const encoded = await encodeOnePhoto(uri)
      setAtPath(rd, path, encoded)
      done++
      onProgress?.({ phase: 'photos', done, total: totalPhotos })
    }
    return rd
  }

  // ── S3 available: upload each photo directly ───────────────────────────────
  let done = 0
  for (let i = 0; i < refs.length; i++) {
    const { path, uri } = refs[i]
    const slot = presigned[i]

    try {
      const compressedUri = await compressPhoto(uri)

      const result = await FileSystem.uploadAsync(slot.upload_url, compressedUri, {
        httpMethod:   'PUT',
        uploadType:   FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers:      { 'Content-Type': 'image/jpeg' },
      })

      // Clean up temp compressed file
      if (compressedUri !== uri) {
        FileSystem.deleteAsync(compressedUri, { idempotent: true }).catch(() => {})
      }

      if (result.status >= 200 && result.status < 300) {
        setAtPath(rd, path, slot.final_url)
        console.log(`[Sync] photo ${i + 1}/${totalPhotos} → S3`)
      } else {
        console.warn(`[Sync] S3 upload returned ${result.status} for photo ${i + 1} — falling back to base64`)
        setAtPath(rd, path, await encodeOnePhoto(uri))
      }
    } catch (uploadErr) {
      console.warn(`[Sync] S3 upload failed for photo ${i + 1} — falling back to base64:`, uploadErr)
      try {
        setAtPath(rd, path, await encodeOnePhoto(uri))
      } catch (encodeErr) {
        console.warn('[Sync] base64 fallback also failed, leaving URI as-is:', encodeErr)
      }
    }

    done++
    onProgress?.({ phase: 'photos', done, total: totalPhotos })
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
    const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}

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

    // ── Photo upload (S3 preferred, base64 fallback) ─────────────────────────
    const rdForSync = await uploadPhotosToS3(
      JSON.parse(JSON.stringify(rd)),
      id,
      onProgress
    )

    // ── Upload to server ─────────────────────────────────────────────────────
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
