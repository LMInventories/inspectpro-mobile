// AI Proofread for the pre-finalise Review Report.
//
// - runProofread()          one /transcribe/proofread call per room, a few in parallel, with progress
// - applySuggestionToReport() writes an accepted suggestion back into report_data
// - queueDecision()/flushDecisions() best-effort log of accept/dismiss decisions to the server, where
//   they feed the glossary learning agent. Decisions that can't be sent (offline) stay queued and are
//   retried on the next flush.

import { api } from './api'

export type ProofreadKind = 'spelling' | 'mistranscription' | 'grammar' | 'wording'
export type ProofreadField = 'description' | 'condition' | 'sub_label' | 'sub_cond'

export type ProofreadSuggestion = {
  id: string
  itemId: string
  subId: string | null
  itemName: string
  field: ProofreadField
  original: string   // snippet, not the whole field
  suggested: string
  kind: ProofreadKind
  reason: string
}

export type ProofreadDecision = {
  room: string
  itemName: string
  field: ProofreadField
  kind: ProofreadKind
  original: string
  suggested: string
  decision: 'accepted' | 'dismissed'
}

// Structural subset of the Review screen's room/item types.
export type ProofreadRoom = {
  name: string
  sectionKey: string
  items: Array<{
    itemId: string
    label: string
    desc: string
    cond: string
    subs: Array<{ subId: string; label: string; cond: string }>
  }>
}

export type ProofreadResult = {
  bySection: Record<string, ProofreadSuggestion[]>
  failedRooms: string[]
  offline: boolean
}

const CONCURRENCY = 3
const NO_LABEL = '—'   // the Review screen's placeholder for a sub-item with no description

function roomPayload(room: ProofreadRoom) {
  const items = room.items
    .map(it => ({
      id: it.itemId,
      name: it.label,
      description: it.desc || '',
      condition: it.cond || '',
      subs: it.subs
        .map(s => ({ id: s.subId, description: s.label === NO_LABEL ? '' : s.label, condition: s.cond || '' }))
        .filter(s => s.id && (s.description.trim() || s.condition.trim())),
    }))
    .filter(it => it.description.trim() || it.condition.trim() || it.subs.length)
  return items
}

// No HTTP response at all = no connection / timeout (as opposed to a server-side error).
function isOfflineError(e: any): boolean {
  return !!e && !e.response
}

export async function runProofread(
  rooms: ProofreadRoom[],
  inspectionId: number,
  isCheckOut: boolean,
  onProgress: (done: number, total: number, partial: Record<string, ProofreadSuggestion[]>) => void,
): Promise<ProofreadResult> {
  const jobs = rooms
    .map(room => ({ room, items: roomPayload(room) }))
    .filter(j => j.items.length > 0)
  const result: ProofreadResult = { bySection: {}, failedRooms: [], offline: false }
  let done = 0
  let next = 0
  onProgress(0, jobs.length, result.bySection)

  async function worker() {
    while (!result.offline) {
      const job = jobs[next++]
      if (!job) return
      try {
        const res = await api.proofreadRoom({
          inspectionId, roomName: job.room.name, isCheckOut, items: job.items,
        })
        const suggestions: ProofreadSuggestion[] = res.data?.suggestions || []
        if (suggestions.length) result.bySection[job.room.sectionKey] = suggestions
      } catch (e: any) {
        if (isOfflineError(e)) result.offline = true
        else result.failedRooms.push(job.room.name)
      }
      done++
      onProgress(done, jobs.length, { ...result.bySection })
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
  return result
}

// ── Applying an accepted suggestion ──────────────────────────────────────────

// Replace the first occurrence of `from` with `to`; null if the field doesn't contain it.
export function replaceSnippet(text: any, from: string, to: string): string | null {
  if (typeof text !== 'string') return null
  const i = text.indexOf(from)
  return i === -1 ? null : text.slice(0, i) + to + text.slice(i + from.length)
}

function patchKeys(blob: any, keys: string[], from: string, to: string): boolean {
  for (const k of keys) {
    const next = replaceSnippet(blob?.[k], from, to)
    if (next !== null) { blob[k] = next; return true }
  }
  return false
}

// An item's data can live in rd[section][itemId] and/or on its _extra entry (added items),
// mirroring how the Review screen merges them — so patch whichever holds the text.
export function applySuggestionToReport(
  rd: any, sectionKey: string, s: ProofreadSuggestion, isCheckOut: boolean,
): boolean {
  const sec = rd?.[sectionKey]
  if (!sec) return false
  const blobs: any[] = []
  if (sec[s.itemId] && typeof sec[s.itemId] === 'object') blobs.push(sec[s.itemId])
  for (const extra of sec._extra || []) {
    if (String(extra?._eid) === s.itemId) blobs.push(extra)
  }
  const condKeys = isCheckOut ? ['checkOutCondition', 'condition'] : ['condition']

  let changed = false
  for (const blob of blobs) {
    if (s.field === 'description') {
      changed = patchKeys(blob, ['description'], s.original, s.suggested) || changed
    } else if (s.field === 'condition') {
      changed = patchKeys(blob, condKeys, s.original, s.suggested) || changed
    } else {
      const sub = (blob._subs || []).find((x: any) => String(x?._sid) === s.subId)
      if (!sub) continue
      const keys = s.field === 'sub_label' ? ['description', 'label'] : condKeys
      changed = patchKeys(sub, keys, s.original, s.suggested) || changed
    }
  }
  return changed
}

// ── Decision log (feeds the learning pipeline) ───────────────────────────────

const pending = new Map<number, ProofreadDecision[]>()
let flushing = false

export function queueDecision(inspectionId: number, d: ProofreadDecision) {
  const list = pending.get(inspectionId) || []
  list.push(d)
  pending.set(inspectionId, list)
  flushDecisions()
}

export async function flushDecisions() {
  if (flushing) return
  flushing = true
  try {
    for (const [inspectionId, list] of Array.from(pending.entries())) {
      if (!list.length) { pending.delete(inspectionId); continue }
      const batch = list.slice()
      try {
        await api.logProofreadDecisions({ inspectionId, decisions: batch })
        const rest = (pending.get(inspectionId) || []).slice(batch.length)
        if (rest.length) pending.set(inspectionId, rest)
        else pending.delete(inspectionId)
      } catch {
        // offline or server error — keep queued, retry on next flush
      }
    }
  } finally {
    flushing = false
  }
}
