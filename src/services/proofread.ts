// AI Proofread for the pre-finalise Review Report.
//
// - runProofread()          one /transcribe/proofread call per room, a few in parallel, with progress
// - applySuggestionToReport() writes an accepted suggestion back into report_data
// - a per-inspection session (module memory, so it outlives the Review screen being closed or left)
//   keeps open suggestions, remembers which rooms were already checked and what the clerk dismissed,
//   so re-opening Review and "Proofread again" only pay for rooms whose text actually changed
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
  decision?: 'accepted' | 'dismissed'   // unset while still open; actioned ones stay listed
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

export type ProofreadStatus = null | { kind: 'done' | 'offline' | 'partial'; failed: string[] }

export type ProofreadResult = {
  bySection: Record<string, ProofreadSuggestion[]>
  failedRooms: string[]
  offline: boolean
  checked: Record<string, string>   // sectionKey -> fingerprint of the text last checked successfully
  calls: number                     // AI calls actually made (0 = nothing had changed)
}

// What survives between visits to the Review screen for one inspection.
export type ProofreadSession = {
  suggestions: Record<string, ProofreadSuggestion[]>
  status: ProofreadStatus
  checked: Record<string, string>
  dismissed: string[]               // suggestionKey()s the clerk dismissed - never show these again
}

const sessions = new Map<number, ProofreadSession>()

export function getSession(inspectionId: number): ProofreadSession {
  let s = sessions.get(inspectionId)
  if (!s) {
    s = { suggestions: {}, status: null, checked: {}, dismissed: [] }
    sessions.set(inspectionId, s)
  }
  return s
}

export function clearSession(inspectionId: number) {
  sessions.delete(inspectionId)
}

export function suggestionKey(s: Pick<ProofreadSuggestion, 'itemId' | 'subId' | 'field' | 'original' | 'suggested'>): string {
  return [s.itemId, s.subId || '', s.field, s.original, s.suggested].join('\u0001')
}

// Cheap, stable fingerprint of what would be sent for a room (djb2) - equal text => no new AI call.
function fingerprint(payload: unknown): string {
  const str = JSON.stringify(payload)
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return `${str.length}:${h}`
}

export function openCount(suggestions: Record<string, ProofreadSuggestion[]>): number {
  return Object.values(suggestions).reduce((n, l) => n + l.filter(s => !s.decision).length, 0)
}

// Lays a run's results over what is on screen without forgetting anything the clerk has actioned,
// including during the run. `decidedBefore` holds the ids already actioned when the run started: a
// fix actioned since then is not offered again by a result computed from the older text.
export function carryDecisions(
  next: Record<string, ProofreadSuggestion[]>,
  current: Record<string, ProofreadSuggestion[]>,
  decidedBefore: Set<string>,
): Record<string, ProofreadSuggestion[]> {
  const out: Record<string, ProofreadSuggestion[]> = {}
  for (const sectionKey of Object.keys({ ...current, ...next })) {
    const decided = (current[sectionKey] || []).filter(s => s.decision)
    const justDecided = new Set(decided.filter(s => !decidedBefore.has(s.id)).map(suggestionKey))
    const incoming = (next[sectionKey] || [])
      .filter(s => decided.some(d => d.id === s.id) || !justDecided.has(suggestionKey(s)))
      .map(s => decided.find(d => d.id === s.id) || s)
    const missing = decided.filter(d => !incoming.some(s => s.id === d.id))
    if (missing.length || incoming.length) out[sectionKey] = [...missing, ...incoming]
  }
  return out
}

// Drop suggestions that no longer apply to the report as it is now: the room or item is gone, or the
// clerk has since edited the snippet away (so the suggestion can't be applied any more). Everything
// else - including suggestions the clerk simply hasn't got to yet - is kept, as are actioned ones.
export function reconcileSuggestions(
  rooms: ProofreadRoom[],
  suggestions: Record<string, ProofreadSuggestion[]>,
): Record<string, ProofreadSuggestion[]> {
  const out: Record<string, ProofreadSuggestion[]> = {}
  for (const [sectionKey, list] of Object.entries(suggestions)) {
    const room = rooms.find(r => r.sectionKey === sectionKey)
    if (!room) continue
    const kept = list.filter(sg => {
      const item = room.items.find(it => it.itemId === sg.itemId)
      if (!item) return false
      // An actioned suggestion is a record: its original wording is expected to be gone.
      if (sg.decision) return !sg.subId || item.subs.some(x => x.subId === sg.subId)
      let text = ''
      if (sg.field === 'description') text = item.desc
      else if (sg.field === 'condition') text = item.cond
      else {
        const sub = item.subs.find(x => x.subId === sg.subId)
        if (!sub) return false
        text = sg.field === 'sub_label' ? (sub.label === NO_LABEL ? '' : sub.label) : sub.cond
      }
      return typeof text === 'string' && text.includes(sg.original)
    })
    if (kept.length) out[sectionKey] = kept
  }
  return out
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
  prior?: { suggestions: Record<string, ProofreadSuggestion[]>; checked: Record<string, string>; dismissed: string[] },
): Promise<ProofreadResult> {
  const dismissed = new Set(prior?.dismissed || [])
  const all = rooms
    .map(room => ({ room, items: roomPayload(room), fp: '' }))
    .filter(j => j.items.length > 0)
  all.forEach(j => { j.fp = fingerprint(j.items) })
  // Rooms whose text is unchanged since they were last checked keep their open suggestions and cost nothing.
  const jobs = all.filter(j => prior?.checked[j.room.sectionKey] !== j.fp)
  const result: ProofreadResult = {
    bySection: {}, failedRooms: [], offline: false,
    checked: { ...(prior?.checked || {}) }, calls: 0,
  }
  // Start from what is already open: unchanged rooms keep it for good, changed rooms keep it until
  // their fresh result replaces it (so a failed or offline re-check never loses open suggestions).
  for (const j of all) {
    const open = prior?.suggestions[j.room.sectionKey]
    if (open?.length) result.bySection[j.room.sectionKey] = open
  }
  // Server ids repeat from one check to the next; stamp them so a new result is never mistaken
  // for an actioned one.
  const run = Date.now().toString(36)
  let done = 0
  let next = 0
  onProgress(0, jobs.length, { ...result.bySection })

  async function worker() {
    while (!result.offline) {
      const job = jobs[next++]
      if (!job) return
      try {
        result.calls++
        const res = await api.proofreadRoom({
          inspectionId, roomName: job.room.name, isCheckOut, items: job.items,
        })
        const suggestions: ProofreadSuggestion[] = (res.data?.suggestions || [])
          .filter((sg: ProofreadSuggestion) => !dismissed.has(suggestionKey(sg)))
          .map((sg: ProofreadSuggestion) => ({ ...sg, id: `${run}:${sg.id}` }))
        if (suggestions.length) result.bySection[job.room.sectionKey] = suggestions
        else delete result.bySection[job.room.sectionKey]
        result.checked[job.room.sectionKey] = job.fp
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
