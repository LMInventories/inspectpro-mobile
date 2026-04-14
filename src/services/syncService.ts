/**
 * syncService.ts
 * Shared logic for syncing a single inspection to the server.
 * Used by both SyncScreen (bulk) and PropertyOverviewScreen (single).
 */
import { getLocalInspection, getAudioRecordings, markSynced } from './database'
import { api } from './api'
import * as FileSystem from 'expo-file-system/legacy'

export type SyncResult = { id: number; address: string; success: boolean; error?: string }

async function encodePhotoArray(photos: string[]): Promise<string[]> {
  return Promise.all(photos.map(async (uri) => {
    if (uri.startsWith('data:')) return uri
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      return `data:image/jpeg;base64,${b64}`
    } catch (e) {
      console.warn('[Sync] could not encode photo:', uri, e)
      return uri
    }
  }))
}

export async function convertPhotoUrisToBase64(rd: any): Promise<any> {
  for (const sectionKey of Object.keys(rd)) {
    const section = rd[sectionKey]
    if (!section || typeof section !== 'object') continue
    for (const itemKey of Object.keys(section)) {
      const item = section[itemKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (Array.isArray(item._photos)) {
        item._photos = await encodePhotoArray(item._photos)
      }
    }
  }
  return rd
}

export async function syncSingleInspection(
  id: number,
  inspection: any,
  user: any,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  onProgress?.(`Syncing ${inspection.property_address}…`)
  try {
    const fresh = getLocalInspection(id)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}

    const sqliteRecs = getAudioRecordings(id)
    console.log(`[Sync] found ${sqliteRecs.length} audio recordings in SQLite for inspection ${id}`)

    if (sqliteRecs.length > 0) {
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
        console.log(`[Sync] ${withAudio.length}/${sqliteRecs.length} clips serialised successfully`)
      } else {
        console.warn('[Sync] all clips failed to encode — check file paths')
      }
    }

    const rdForSync = await convertPhotoUrisToBase64(JSON.parse(JSON.stringify(rd)))
    const payload: any = { report_data: JSON.stringify(rdForSync) }

    const role = user?.role
    const typistMode = (fresh as any)?.typist_mode ?? null
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
