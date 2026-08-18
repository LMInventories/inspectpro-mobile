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
 * Retry strategy:
 *   • Up to MAX_SYNC_RETRIES attempts with exponential backoff (2^n seconds)
 *   • Retries on: network errors, 502, 503, 504, 429
 *   • No retry on: 4xx auth errors (401, 403), 409 conflict, 413 too large
 *
 * Conflict detection:
 *   • `server_updated_at` (the updated_at value from the last download/sync)
 *     is sent with every sync request so the server can reject with HTTP 409
 *     if another device has pushed changes since we last pulled.
 *
 * Audio cleanup:
 *   • After a successful sync, local audio files are deleted from device storage
 *     and their DB rows are marked synced — they are no longer needed on-device.
 */
import { getLocalInspection, getAudioRecordings, markSynced, markAudioSynced, updateReportData } from './database'
import { api } from './api'
import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Alert } from 'react-native'

export type SyncResult = {
  id: number; address: string; success: boolean; error?: string; conflict?: boolean
  // Count of photos that could neither upload to S3 nor encode as base64 —
  // their local files are deliberately kept (cleanup is skipped) so they
  // aren't lost; the clerk should retry sync to pick them up.
  photosFailed?: number
}

export type SyncProgress = {
  phase: 'audio' | 'photos' | 'uploading' | 'retrying'
  done: number
  total: number
  attempt?: number
}

const MAX_PHOTO_PX    = 1400   // longest edge in pixels
const SYNC_QUALITY    = 0.72   // JPEG quality (0 = worst, 1 = lossless)

// Floor plan exports are line art + small text, not photographs — the photo
// profile above blurs them illegibly once printed full-page in the PDF, so
// they get their own, higher-fidelity profile.
const FLOORPLAN_MAX_PX = 2200
const FLOORPLAN_QUALITY = 0.85

const MAX_SYNC_RETRIES = 3     // max upload attempts (1 initial + 2 retries)

// Status codes that are safe to retry (transient server / network issues)
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

// ── Delay helper ─────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

// ── Compress a photo to a local temp JPEG, returns its URI ───────────────────
async function compressPhoto(uri: string, profile: 'photo' | 'floorplan' = 'photo'): Promise<string> {
  const maxPx   = profile === 'floorplan' ? FLOORPLAN_MAX_PX : MAX_PHOTO_PX
  const quality = profile === 'floorplan' ? FLOORPLAN_QUALITY : SYNC_QUALITY
  try {
    const compressed = await manipulateAsync(
      uri,
      [{ resize: { width: maxPx } }],
      { compress: quality, format: SaveFormat.JPEG }
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
async function encodeOnePhoto(uri: string, profile: 'photo' | 'floorplan' = 'photo'): Promise<string> {
  if (uri.startsWith('data:'))  return uri
  if (uri.startsWith('https:')) return uri   // already an S3 URL — leave as-is
  try {
    const compressedUri = await compressPhoto(uri, profile)
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
type UriRef = { path: string[]; uri: string; kind?: 'photo' | 'floorplan' }

function collectLocalUris(rd: any): UriRef[] {
  const refs: UriRef[] = []

  // Property overview photo
  const overviewUri = (rd['_overview'] as any)?.items?.photo?.uri
  if (overviewUri && overviewUri.startsWith('file://')) {
    refs.push({ path: ['_overview', 'items', 'photo', 'uri'], uri: overviewUri })
  }

  // Floor plan images — one per floor, uploaded from Property Overview's
  // Floorplan button (see FloorPlanImagesScreen.tsx). Compressed with the
  // higher-fidelity 'floorplan' profile (line art/text, not a photograph).
  const fpImages = (rd['_floorplan'] as any)?.images
  if (Array.isArray(fpImages)) {
    fpImages.forEach((img: any, idx: number) => {
      if (img?.uri && typeof img.uri === 'string' && img.uri.startsWith('file://')) {
        refs.push({ path: ['_floorplan', 'images', String(idx), 'uri'], uri: img.uri, kind: 'floorplan' })
      }
    })
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
//
// Returns { rd, unresolved, resolved }:
//   - unresolved: count of photos that could neither upload to S3 nor encode
//     as base64 (their setAtPath value is still the original file:// URI).
//     The caller MUST NOT delete local photo files when unresolved > 0 —
//     doing so was the cause of permanently lost photos: the device's local
//     copy was wiped by cleanupPhotoFiles() even though the server never
//     received a usable copy, leaving a dead file:// path in report_data
//     with nothing behind it, on-device or on the server.
//   - resolved: { path, value } pairs for every photo that DID get a real
//     URL/data-URI. The caller must write these back into the device's own
//     local report_data (not just the copy sent to the server) — otherwise
//     local storage keeps the stale file:// path forever, and the next
//     unrelated edit-and-resync from this device re-sends that stale path,
//     silently reverting an already-working photo back to a dead local
//     reference on the server (the file itself having long since been
//     deleted by the FIRST sync's cleanup).
export async function uploadPhotosToS3(
  rd: any,
  inspectionId: number,
  onProgress?: (p: SyncProgress) => void
): Promise<{ rd: any; unresolved: number; resolved: Array<{ path: string[]; value: string }> }> {
  const refs = collectLocalUris(rd)
  const totalPhotos = refs.length

  if (totalPhotos === 0) return { rd, unresolved: 0, resolved: [] }

  onProgress?.({ phase: 'photos', done: 0, total: totalPhotos })
  let unresolved = 0
  const resolved: Array<{ path: string[]; value: string }> = []

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
    for (const { path, uri, kind } of refs) {
      const encoded = await encodeOnePhoto(uri, kind)
      setAtPath(rd, path, encoded)
      if (encoded.startsWith('file://')) {
        unresolved++
        console.warn(`[Sync] photo left unresolved (base64-only mode): ${uri}`)
      } else {
        resolved.push({ path, value: encoded })
      }
      done++
      onProgress?.({ phase: 'photos', done, total: totalPhotos })
    }
    return { rd, unresolved, resolved }
  }

  // ── S3 available: upload each photo directly ───────────────────────────────
  let done = 0
  for (let i = 0; i < refs.length; i++) {
    const { path, uri, kind } = refs[i]
    const slot = presigned[i]

    try {
      const compressedUri = await compressPhoto(uri, kind)

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
        resolved.push({ path, value: slot.final_url })
        console.log(`[Sync] photo ${i + 1}/${totalPhotos} → S3`)
      } else {
        console.warn(`[Sync] S3 upload returned ${result.status} for photo ${i + 1} — falling back to base64`)
        const encoded = await encodeOnePhoto(uri, kind)
        setAtPath(rd, path, encoded)
        if (encoded.startsWith('file://')) {
          unresolved++
          console.warn(`[Sync] photo left unresolved after S3+base64 both failed: ${uri}`)
        } else {
          resolved.push({ path, value: encoded })
        }
      }
    } catch (uploadErr) {
      console.warn(`[Sync] S3 upload failed for photo ${i + 1} — falling back to base64:`, uploadErr)
      try {
        const encoded = await encodeOnePhoto(uri, kind)
        setAtPath(rd, path, encoded)
        if (encoded.startsWith('file://')) {
          unresolved++
          console.warn(`[Sync] photo left unresolved after S3+base64 both failed: ${uri}`)
        } else {
          resolved.push({ path, value: encoded })
        }
      } catch (encodeErr) {
        console.warn('[Sync] base64 fallback also failed, leaving URI as-is:', encodeErr)
        unresolved++
      }
    }

    done++
    onProgress?.({ phase: 'photos', done, total: totalPhotos })
  }

  return { rd, unresolved, resolved }
}

// ── Photo cleanup — delete the inspection's local photo directory after sync ──
// Photos are stored in the app's private documentDirectory (never in the device
// gallery) and are only needed until the report reaches the server. Once synced,
// S3 URLs in the server's report_data are the source of truth.
async function cleanupPhotoFiles(inspectionId: number): Promise<void> {
  const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
  try {
    const info = await FileSystem.getInfoAsync(dir)
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true })
      console.log(`[Sync] deleted photo directory for inspection ${inspectionId}`)
    }
  } catch (e) {
    console.warn(`[Sync] could not delete photo directory for inspection ${inspectionId}:`, e)
  }
}

// ── Audio cleanup — delete local files after successful server sync ───────────
async function cleanupAudioFiles(inspectionId: number): Promise<void> {
  try {
    const recs = getAudioRecordings(inspectionId)
    for (const rec of recs) {
      const uri = rec.file_uri || rec.fileUri
      if (uri) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true })
          console.log(`[Sync] deleted audio file: ${uri}`)
        } catch (e) {
          console.warn(`[Sync] could not delete audio file ${uri}:`, e)
        }
      }
    }
    markAudioSynced(inspectionId)
    console.log(`[Sync] audio cleanup complete for inspection ${inspectionId} (${recs.length} files)`)
  } catch (e) {
    // Non-fatal — audio files will be cleaned up on next sync or when storage runs low
    console.warn('[Sync] audio cleanup failed:', e)
  }
}

// ── Sync upload with exponential backoff retry ────────────────────────────────
async function syncWithRetry(
  id: number,
  payload: any,
  onProgress?: (p: SyncProgress) => void
): Promise<{ data: any }> {
  let lastErr: any
  for (let attempt = 1; attempt <= MAX_SYNC_RETRIES; attempt++) {
    try {
      onProgress?.({ phase: 'uploading', done: 0, total: 1, attempt })
      const res = await api.syncInspection(id, payload)
      onProgress?.({ phase: 'uploading', done: 1, total: 1, attempt })
      return res
    } catch (err: any) {
      lastErr = err
      const status = err?.response?.status

      // Never retry auth / permission / conflict / payload-too-large errors
      if (status === 401 || status === 403 || status === 409 || status === 413) {
        throw err
      }

      if (attempt < MAX_SYNC_RETRIES && (RETRYABLE_STATUSES.has(status) || !status)) {
        const delayMs = Math.pow(2, attempt) * 1000  // 2s, 4s, 8s…
        console.log(`[Sync] attempt ${attempt} failed (${status ?? 'network'}), retrying in ${delayMs / 1000}s…`)
        onProgress?.({ phase: 'retrying', done: attempt, total: MAX_SYNC_RETRIES, attempt })
        await sleep(delayMs)
      } else {
        throw err
      }
    }
  }
  throw lastErr
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
      // Include clips that have audio OR a transcript — AI Room mode clips have
      // their audio file deleted immediately after transcription (to free space)
      // but their transcript text is saved to SQLite and must reach the server.
      const withContent = serialised.filter(r => r.audioB64.length > 0 || !!r.transcript)
      if (withContent.length > 0) {
        rd._recordings = withContent
        const withAudio = withContent.filter(r => r.audioB64.length > 0)
        console.log(`[Sync] ${withAudio.length}/${totalAudio} clips with audio, ${withContent.length - withAudio.length} transcript-only`)
      } else {
        console.warn('[Sync] all clips failed to encode — check file paths')
      }
    }

    // ── Photo upload (S3 preferred, base64 fallback) ─────────────────────────
    const { rd: rdForSync, unresolved: photosFailed, resolved: resolvedPhotos } = await uploadPhotosToS3(
      JSON.parse(JSON.stringify(rd)),
      id,
      onProgress
    )
    if (photosFailed > 0) {
      console.warn(`[Sync] ${photosFailed} photo(s) could not be uploaded or encoded for inspection ${id} — `
        + `local files will be kept (not deleted) so nothing is lost; retry sync to pick them up`)
    }

    // ── Build sync payload ───────────────────────────────────────────────────
    const payload: any = { report_data: JSON.stringify(rdForSync) }

    // Conflict detection: tell the server what updated_at we last saw.
    // The server returns 409 if someone else has pushed changes since then.
    if (fresh?.server_updated_at) {
      payload.client_updated_at = fresh.server_updated_at
    }

    const role           = user?.role
    const typistMode     = (fresh as any)?.typist_mode ?? null
    const freshStatus    = fresh?.status || inspection.status
    const localStatus    = fresh?.local_status || inspection.local_status
    const inspectionType = (fresh as any)?.inspection_type || inspection.inspection_type
    const isActive       = freshStatus === 'active' || localStatus === 'active'
    const typistName     = (fresh?.typist_name || fresh?.typist?.name || '').toLowerCase()
    const typistIsAi     = fresh?.typist_is_ai === true ||
                           fresh?.typist?.is_ai === true ||
                           typistName === 'ai typist' ||
                           typistName.startsWith('ai ')
    const isAiMode       = typistIsAi || typistMode === 'ai_instant' || typistMode === 'ai_room'
    const isFinalised    = !!(fresh as any)?.is_finalised

    if (typistMode !== null) payload.typist_mode = typistMode

    if (inspectionType === 'heads_up' && isActive && isFinalised) {
      // Heads-Up Reports have no typist step — always go straight to complete
      payload.status = 'complete'
    } else if ((role === 'admin' || role === 'manager') && isFinalised) {
      // Admins/managers bypass the review step — finalised reports go straight
      // to Complete so they can be sent to clients without a browser login.
      payload.status = 'complete'
    } else if (role === 'clerk' && isActive && isFinalised) {
      // Clerk-finalised reports go to Review for admin approval.
      payload.status = 'review'
    } else if (role === 'typist' && freshStatus === 'processing') {
      payload.status = 'review'
    }

    // ── Upload to server (with retry) ────────────────────────────────────────
    const response = await syncWithRetry(id, payload, onProgress)

    // ── Persist resolved photo URLs back into LOCAL storage ──────────────────
    // CRITICAL: without this, the device's own report_data keeps the original
    // file:// paths forever — only the copy just sent to the server gets the
    // resolved URLs. Any later edit-and-resync from this same device (even to
    // an unrelated field) would re-read those stale local file:// paths and
    // push them back to the server, silently reverting an already-working
    // photo to a dead reference (the local file having been deleted by this
    // same sync's cleanup step below). Re-read the current local report_data
    // rather than reusing `rd`, in case something else was edited locally
    // while this sync was in flight — that must not be clobbered.
    if (resolvedPhotos.length > 0) {
      const latest   = getLocalInspection(id)
      const latestRd = latest?.report_data ? JSON.parse(latest.report_data) : {}
      for (const { path, value } of resolvedPhotos) {
        setAtPath(latestRd, path, value)
      }
      updateReportData(id, JSON.stringify(latestRd))
    }

    // ── Post-sync cleanup ────────────────────────────────────────────────────
    // Store the server's new updated_at so next sync can detect conflicts.
    // Must run AFTER updateReportData above — that call sets synced=0, and
    // this is the write that should have the final say (synced=1).
    const newServerUpdatedAt = response?.data?.updated_at ?? undefined
    markSynced(id, newServerUpdatedAt)

    // Delete local audio files now that the server has them.
    // Non-fatal: if this fails the recordings stay on device until next sync.
    if (totalAudio > 0) {
      await cleanupAudioFiles(id)
    }

    // Delete the entire local photo directory — photos are now on S3.
    // This covers both the inspection's own photos and any CI photos
    // cached for check-out reference (all stored under photos/{id}/).
    // CRITICAL: skip this when any photo failed to resolve to a remote URL —
    // deleting local files in that case would permanently lose them, since
    // the server would still hold a dead file:// path with no data behind it
    // anywhere. Leaving the files in place means the next sync attempt can
    // still pick them up via collectLocalUris().
    if (photosFailed > 0) {
      console.warn(`[Sync] skipping local photo cleanup for inspection ${id} — `
        + `${photosFailed} photo(s) still unresolved`)
    } else {
      await cleanupPhotoFiles(id)
    }

    return { id, address: inspection.property_address, success: true, photosFailed }

  } catch (err: any) {
    // ── Conflict detected — another device edited this inspection ────────────
    if (err?.response?.status === 409) {
      const msg = err.response?.data?.error || 'This inspection was edited on another device since you last synced it. Please re-download it to get the latest version.'
      Alert.alert('Sync Conflict', msg, [{ text: 'OK' }])
      return { id, address: inspection.property_address, success: false, conflict: true, error: 'Conflict — inspection edited elsewhere' }
    }

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
