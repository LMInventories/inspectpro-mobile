// AI action tags for check-out rooms.
//
// - fetchActionSuggestions()  one /action-tags/suggest call for a room's untagged condition lines
// - applyActionTag()          writes an accepted (action, responsibility) onto a line in report_data
// - queueActionDecision()     best-effort log of accept / edit / decline to the server, where it
//   becomes the memory the suggester learns from. Decisions that can't be sent (offline) stay
//   queued and are retried on the next flush - same pattern as services/proofread.ts.

import { api } from './api'

export type ActionTagSource = 'rule' | 'learned' | 'ai'

export type ActionTagSuggestion = {
  id: string
  itemId: string          // template item id, sub-item _sid, or custom item _cid
  itemName: string
  line: string
  actionId: string
  responsibility: string
  confidence: 'high' | 'low'
  source: ActionTagSource
  reason: string
}

// kind 'additional' = an Additional Item (added during tenancy): the server always tags it Additional Item / Tenant.
export type ActionTagItemInput = { id: string; name: string; lines: string[]; checkIn?: string; kind?: 'additional' }

export type ActionTagDecision = {
  room: string
  itemName: string
  line: string
  suggestedActionId: string
  suggestedResp: string
  finalActionId: string | null
  finalResp: string | null
  decision: 'accepted' | 'edited' | 'declined'
  source: ActionTagSource
}

// "As Inventory+" is boilerplate, never a real condition to tag (same rule as the Actions modal).
const BOILERPLATE = /^as\s+inventory\+?$/i

// Condition text -> taggable lines, exactly as the Actions modal splits them, so that the line
// strings stored in `conditions` always match what that modal shows.
export function conditionLines(text: string): string[] {
  return String(text || '').split('\n').map(l => l.trim()).filter(l => l && !BOILERPLATE.test(l))
}

// Lines that no existing action on this item already covers.
export function untaggedLines(text: string, existingActions: any[]): string[] {
  const covered = new Set<string>()
  for (const a of existingActions || []) for (const c of a?.conditions || []) covered.add(c)
  return conditionLines(text).filter(l => !covered.has(l))
}

export async function fetchActionSuggestions(
  inspectionId: number, roomName: string, items: ActionTagItemInput[],
): Promise<ActionTagSuggestion[]> {
  const res = await api.suggestActionTags({ inspectionId, roomName, items })
  return res.data?.suggestions || []
}

function newId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// Adds `line` to the item's action list: joins an existing entry with the same action +
// responsibility, otherwise creates one. Mutates rd; returns false if nothing was written
// (line already tagged, which keeps double-taps harmless).
export function applyActionTag(
  rd: any, sectionKey: string, itemId: string, line: string, actionId: string, responsibility: string,
): boolean {
  if (!rd[sectionKey]) rd[sectionKey] = {}
  const key = `_actions_${itemId}`
  const list: any[] = rd[sectionKey][key] || []
  if (list.some(a => (a.conditions || []).includes(line) && a.actionId === actionId && a.responsibility === responsibility)) {
    return false
  }
  const existing = list.find(a => a.actionId === actionId && (a.responsibility ?? '') === responsibility)
  if (existing) {
    existing.conditions = [...(existing.conditions || []), line]
  } else {
    list.push({ _id: newId(), actionId, responsibility, conditions: [line] })
  }
  rd[sectionKey][key] = list
  return true
}

// ── Decision log (feeds the suggester's memory) ──────────────────────────────

const pending = new Map<number, ActionTagDecision[]>()
let flushing = false

export function queueActionDecision(inspectionId: number, d: ActionTagDecision) {
  const list = pending.get(inspectionId) || []
  list.push(d)
  pending.set(inspectionId, list)
  flushActionDecisions()
}

export async function flushActionDecisions() {
  if (flushing) return
  flushing = true
  try {
    for (const [inspectionId, list] of Array.from(pending.entries())) {
      if (!list.length) { pending.delete(inspectionId); continue }
      const batch = list.slice()
      try {
        await api.logActionTagDecisions({ inspectionId, decisions: batch })
        const rest = (pending.get(inspectionId) || []).slice(batch.length)
        if (rest.length) pending.set(inspectionId, rest)
        else pending.delete(inspectionId)
      } catch {
        // offline or server error - keep queued, retry on next flush
      }
    }
  } finally {
    flushing = false
  }
}
