// Background room transcription.
//
// Pressing ✨ in a room hands the room's saved clips to this service, which uploads them, writes
// the AI fill into the report and cleans up - none of it tied to the room screen, so the clerk can
// leave the room (or open another and start a second one) while it runs. If there's no connection
// the job waits and is retried when the app is next active and online. The clips stay in SQLite
// until a fill has been applied, so a job that fails or is interrupted just leaves the room in its
// "clips saved - tap ✨" state.

import { Alert, AppState, Platform } from 'react-native'
import { create } from 'zustand'
import * as FileSystem from 'expo-file-system/legacy'
import BackgroundService from 'react-native-background-actions'
import { api } from './api'
import { getLocalInspection, updateTranscription } from './database'
import { useInspectionStore } from '../stores/inspectionStore'
import { useToastStore } from '../stores/toastStore'
import { runInForegroundService } from './foregroundService'
import { mimeTypeForUri } from '../utils/audioMime'
import { probe } from '../hooks/useNetworkStatus'

export type RoomJobItem = {
  id: string
  name: string
  hasCondition?: boolean
  hasDescription?: boolean
  isTranscribed?: boolean
  subs?: Array<{ _sid: string; description: string }>
}

export type RoomJobRequest = {
  inspectionId: number
  sectionKey: string
  sectionName: string
  sectionType: string          // 'room' or a fixed-section type
  isDamageReport?: boolean
  items: RoomJobItem[]
  clips: Array<{ id?: number; uri: string }>
}

type JobState = 'sending' | 'waiting'

type JobStore = {
  jobs: Record<string, { sectionName: string; state: JobState }>
}

export const useRoomTranscriptionStore = create<JobStore>(() => ({ jobs: {} }))

export const jobKey = (inspectionId: number, sectionKey: string) => `${inspectionId}:${sectionKey}`

function setJob(key: string, job: { sectionName: string; state: JobState } | null) {
  useRoomTranscriptionStore.setState(s => {
    const jobs = { ...s.jobs }
    if (job) jobs[key] = job
    else delete jobs[key]
    return { jobs }
  })
}

const requests = new Map<string, RoomJobRequest>()   // jobs not finished, kept for retry

// ── Fill helpers (pure: they work on report_data and never touch a screen) ─────

const normLine = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

function appendUnique(existing: string, incoming: string): string {
  if (!existing) return incoming
  if (!incoming) return existing
  const have = new Set(existing.split('\n').map(normLine).filter(Boolean))
  const fresh = incoming.split('\n').filter(l => normLine(l) && !have.has(normLine(l)))
  return fresh.length ? existing + '\n' + fresh.join('\n') : existing
}

// The AI prefixes check-out conditions with "As Inventory+"; the merge below decides itself when
// to add it, so strip the AI's copy first or it doubles up.
const AS_INVENTORY_PREFIX_RE = /^as\s+inventory\+?[,\s]*\n?/i
const stripAsInventoryPrefix = (s: string) => (s || '').replace(AS_INVENTORY_PREFIX_RE, '')

function isDuplicateSub(subs: any[], sub: any): boolean {
  return (subs || []).some((s: any) =>
    normLine(s.description || '') === normLine(sub.description || '') &&
    normLine(s.condition   || '') === normLine(sub.condition   || ''))
}

// Only "please delete" on its own counts as a delete, so ordinary dictation is never misread.
function isNoneSeen(fields: Record<string, any>): boolean {
  const text = [fields.description, fields.condition].filter(Boolean).join(' ').toLowerCase().trim()
  return text === 'please delete'
}

type FillResult = { changed: boolean; summary: string }

// Rooms: description / condition (check-in) or checkOutCondition (check-out), sub-items, deletes.
export function applyRoomFill(
  rd: any, sectionKey: string, filled: Record<string, Record<string, any>>,
  opts: { isCheckOut: boolean; sectionName: string; itemNames: Record<string, string>; transcript?: string; ambiguous?: any[] },
): FillResult {
  const { isCheckOut, sectionName, itemNames, transcript, ambiguous } = opts
  if (!rd[sectionKey]) rd[sectionKey] = {}
  let changed = false
  let subItemsCreated = 0
  const deletedItems: string[] = []

  for (const [itemId, fields] of Object.entries(filled)) {
    if ((fields as any)._delete === true || isNoneSeen(fields)) {
      if (rd[sectionKey][String(itemId)]) delete rd[sectionKey][String(itemId)]
      if (rd[sectionKey]['_extra']) {
        rd[sectionKey]['_extra'] = rd[sectionKey]['_extra'].filter((e: any) => e._eid !== itemId)
      }
      if (!rd[sectionKey]['_deleted']) rd[sectionKey]['_deleted'] = []
      if (!rd[sectionKey]['_deleted'].includes(itemId)) rd[sectionKey]['_deleted'].push(itemId)
      deletedItems.push(itemId)
      changed = true
      continue
    }

    if (!rd[sectionKey][itemId]) rd[sectionKey][itemId] = {}
    const row = rd[sectionKey][itemId]
    if (!row._transcribed) { row._transcribed = true; changed = true }

    const descAction = (fields as any)._descAction || 'fill'   // 'fill' | 'overwrite' | 'append'
    const condAction = (fields as any)._condAction || 'fill'

    if (isCheckOut) {
      const aiCondition = stripAsInventoryPrefix(fields.checkOutCondition || fields.condition || fields.description || '')
      if (aiCondition) {
        const existing = row.checkOutCondition || ''
        const blank = !existing.trim() || existing.trim() === 'As Inventory+'
        const merged = blank ? `As Inventory+\n${aiCondition}` : appendUnique(existing, aiCondition)
        if (merged !== existing) { row.checkOutCondition = merged; changed = true }
      }
    } else {
      if (fields.description) {
        if (descAction === 'overwrite' || (descAction === 'fill' && !row.description)) {
          row.description = fields.description; changed = true
        } else if (descAction === 'append') {
          const merged = row.description ? appendUnique(row.description, fields.description) : fields.description
          if (merged !== row.description) { row.description = merged; changed = true }
        }
      }
      if (fields.condition) {
        if (condAction === 'overwrite' || (condAction === 'fill' && !row.condition)) {
          row.condition = fields.condition; changed = true
        } else if (condAction === 'append') {
          const merged = row.condition ? appendUnique(row.condition, fields.condition) : fields.condition
          if (merged !== row.condition) { row.condition = merged; changed = true }
        }
      }
    }

    if (Array.isArray(fields._subs) && fields._subs.length > 0) {
      if (!row._subs) row._subs = []
      for (const sub of fields._subs) {
        if (isCheckOut && sub._sid) {
          const existing = row._subs.find((s: any) => s._sid === sub._sid)
          const subAi = stripAsInventoryPrefix(sub.checkOutCondition || '')
          if (existing && subAi) {
            const existingCO = existing.checkOutCondition || ''
            const blank = !existingCO.trim() || existingCO.trim() === 'As Inventory+'
            const merged = blank ? `As Inventory+\n${subAi}` : appendUnique(existingCO, subAi)
            if (merged !== existingCO) { existing.checkOutCondition = merged; changed = true }
          }
        } else if (!isCheckOut) {
          if (isDuplicateSub(row._subs, sub)) continue
          row._subs.push({
            _sid: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            description: sub.description || '',
            condition:   sub.condition   || '',
          })
          changed = true
          subItemsCreated++
        }
      }
    }
  }

  const parts: string[] = []
  const filledCount = Object.keys(filled).length - deletedItems.length
  if (filledCount > 0) parts.push(`${filledCount} item${filledCount !== 1 ? 's' : ''} filled`)
  if (subItemsCreated > 0) parts.push(`${subItemsCreated} sub-item${subItemsCreated !== 1 ? 's' : ''} created`)
  if (deletedItems.length > 0) parts.push(`${deletedItems.length} removed (none seen)`)

  // Room-mode log entry so admins can review the full transcript + fill
  if (transcript) {
    if (!rd._transcriptionLog) rd._transcriptionLog = []
    const logFilled: Record<string, any> = {}
    for (const [itemId, fields] of Object.entries(filled)) {
      logFilled[itemId] = { name: itemNames[String(itemId)] || itemId, ...fields }
    }
    rd._transcriptionLog.push({
      mode: 'room', timestamp: new Date().toISOString(), room: sectionName, transcript, filled: logFilled,
      ...(ambiguous && ambiguous.length > 0 ? { ambiguous } : {}),
    })
    changed = true
  }
  return { changed, summary: parts.join(' · ') }
}

// Fixed sections (meter readings, keys, ...): field names vary by section type.
export function applyFixedFill(
  rd: any, sectionKey: string, filled: Record<string, Record<string, any>>,
): FillResult {
  if (!rd[sectionKey]) rd[sectionKey] = {}
  let changed = false
  const deletedItems: string[] = []
  for (const [itemId, fields] of Object.entries(filled)) {
    if ((fields as any)._delete === true) {
      if (!rd[sectionKey]['_hidden']) rd[sectionKey]['_hidden'] = []
      if (!rd[sectionKey]['_hidden'].includes(itemId)) rd[sectionKey]['_hidden'].push(itemId)
      deletedItems.push(itemId)
      changed = true
      continue
    }
    if (!rd[sectionKey][itemId]) rd[sectionKey][itemId] = {}
    const row = rd[sectionKey][itemId]
    for (const [fieldKey, value] of Object.entries(fields)) {
      if (value && !row[fieldKey]) { row[fieldKey] = value; changed = true }
    }
  }
  const filledCount = Object.keys(filled).length - deletedItems.length
  const parts: string[] = []
  if (filledCount > 0) parts.push(`${filledCount} item${filledCount !== 1 ? 's' : ''} filled`)
  if (deletedItems.length > 0) parts.push(`${deletedItems.length} deleted`)
  return { changed, summary: parts.join(', ') }
}

// ── Job runner ────────────────────────────────────────────────────────────────

// Keeps uploads alive with the screen off. One Android foreground service covers ALL running
// transcriptions: the first job starts it, the last one to finish releases it (so a second room
// started while the first is still uploading isn't left unprotected when the first finishes).
// If the inspection sync already owns the service, uploads just run inside it.
let inFlight = 0
let releaseService: (() => void) | null = null

async function runProtected(work: () => Promise<void>) {
  inFlight++
  if (inFlight === 1 && Platform.OS === 'android' && !BackgroundService.isRunning()) {
    const hold = new Promise<void>(resolve => { releaseService = resolve })
    runInForegroundService(() => hold, { name: 'InspectProTranscribe', title: 'Transcribing dictation', desc: 'AI is filling your rooms…' })
      .catch(() => {})
  }
  try {
    await work()
  } finally {
    inFlight--
    if (inFlight === 0 && releaseService) { releaseService(); releaseService = null }
  }
}

async function runJob(key: string): Promise<void> {
  const req = requests.get(key)
  if (!req) return
  const { inspectionId, sectionKey, sectionName, sectionType, isDamageReport, items, clips } = req

  if (!(await probe())) {
    setJob(key, { sectionName, state: 'waiting' })
    useToastStore.getState().showToast(`No connection - ${sectionName} will transcribe when you're back online`, 'info')
    return
  }
  setJob(key, { sectionName, state: 'sending' })

  try {
    let response: any
    await runProtected(async () => {
      const clipPayloads = await Promise.all(clips.map(async clip => ({
        audio: await FileSystem.readAsStringAsync(clip.uri, { encoding: 'base64' }),
        mimeType: mimeTypeForUri(clip.uri),
      })))
      // Check-out rooms send their sub-items (subs defined), check-in rooms don't.
      const isCheckOut = items.some(it => it.subs !== undefined)
      const processedItemIds = items.filter(it => it.isTranscribed).map(it => it.id)
      response = await api.transcribeRoom({
        clips: clipPayloads, sectionName, sectionKey, sectionType, isCheckOut,
        isDamageReport: !!isDamageReport, inspectionId,
        processedItemIds: processedItemIds.length > 0 ? processedItemIds : undefined,
        items: items.map(it => ({
          id: it.id, name: it.name,
          hasCondition: it.hasCondition !== false, hasDescription: it.hasDescription !== false,
          subs: it.subs,
        })),
      })
    })

    const { filled, transcript, ambiguous_commands } = response.data as {
      transcript: string
      filled: Record<string, Record<string, any>>
      ambiguous_commands?: any[]
    }

    if (Object.keys(filled || {}).length === 0) {
      const heard = transcript ? `\n\nWhisper heard:\n"${transcript.slice(0, 200)}${transcript.length > 200 ? '…' : ''}"` : ''
      Alert.alert(`Nothing filled in ${sectionName}`,
        `AI could not match the dictation to the room's items. Please say each item name alone as a heading before describing it.${heard}`)
      return   // clips stay saved so it can be retried
    }

    // Fresh read: the clerk may have kept editing (this or another room) while this ran.
    const fresh = getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const isCheckOut = items.some(it => it.subs !== undefined)
    const itemNames: Record<string, string> = {}
    for (const it of items) itemNames[String(it.id)] = it.name
    const result = sectionType === 'room'
      ? applyRoomFill(rd, sectionKey, filled, { isCheckOut, sectionName, itemNames, transcript, ambiguous: ambiguous_commands })
      : applyFixedFill(rd, sectionKey, filled)

    if (result.changed) {
      useInspectionStore.getState().setReportData(inspectionId, rd)
      useToastStore.getState().showToast(`✨ ${result.summary || 'Filled'} in ${sectionName}.`)
    } else {
      useToastStore.getState().showToast(`${sectionName}: already filled - existing content preserved.`, 'info')
    }

    // Store the transcript on each clip row (for Export Transcription) and delete the audio.
    // The row stays, with a transcription, so it isn't offered for transcription again.
    for (const clip of clips) {
      if (clip.id !== undefined && transcript) updateTranscription(clip.id, transcript)
      FileSystem.deleteAsync(clip.uri, { idempotent: true }).catch(() => {})
    }
  } catch (err: any) {
    console.error('[RoomTranscription] failed:', err)
    Alert.alert(`Transcription failed - ${sectionName}`, err?.response?.data?.error || err?.message || 'Please try again.')
  } finally {
    // 'waiting' returns early above without reaching here; everything else is finished
    requests.delete(key)
    setJob(key, null)
  }
}

let appStateWatching = false
function watchForConnection() {
  if (appStateWatching) return
  appStateWatching = true
  AppState.addEventListener('change', async state => {
    if (state !== 'active') return
    const waiting = Object.entries(useRoomTranscriptionStore.getState().jobs).filter(([, j]) => j.state === 'waiting')
    if (waiting.length === 0 || !(await probe())) return
    for (const [key] of waiting) runJob(key)
  })
}

export function isRoomTranscribing(inspectionId: number, sectionKey: string): boolean {
  return !!useRoomTranscriptionStore.getState().jobs[jobKey(inspectionId, sectionKey)]
}

// Starts (or ignores, if one is already running for this room) a background transcription.
export function startRoomTranscription(req: RoomJobRequest): void {
  const key = jobKey(req.inspectionId, req.sectionKey)
  if (req.clips.length === 0 || useRoomTranscriptionStore.getState().jobs[key]) return
  requests.set(key, req)
  watchForConnection()
  runJob(key)   // a 'waiting' job keeps its request for the retry; any other outcome clears it
}
