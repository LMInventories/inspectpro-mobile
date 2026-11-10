/**
 * Availability helpers — labels and date maths shared by AvailabilityScreen.
 * Wording matches the web Availability overview ("All Day Unavailable",
 * "12pm–6pm Unavailable"). Dates are handled in LOCAL time throughout:
 * toISOString() would shift the day near midnight in UK summer time.
 */

export interface AvailabilityBlock {
  id: number
  kind: 'repeating' | 'holiday'
  weekday: number | null          // 0 = Monday … 6 = Sunday
  start_date: string | null       // YYYY-MM-DD
  end_date: string | null
  start_min: number | null        // minutes from midnight; null (both) = all day
  end_min: number | null
}

export interface AvailabilityPayload {
  kind: 'repeating' | 'holiday'
  weekday?: number
  start_date?: string
  end_date?: string
  start_min: number | null
  end_min: number | null
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const pad = (n: number) => String(n).padStart(2, '0')

/** 720 -> "12pm", 390 -> "6:30am" */
export function clock(min: number): string {
  const m = min % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h % 12 || 12}${mm ? ':' + pad(mm) : ''}${h < 12 ? 'am' : 'pm'}`
}

export function isAllDay(b: Pick<AvailabilityBlock, 'start_min' | 'end_min'>): boolean {
  return b.start_min == null || b.end_min == null
}

/** "All day" or "12pm–6pm" */
export function timeLabel(b: Pick<AvailabilityBlock, 'start_min' | 'end_min'>): string {
  return isAllDay(b) ? 'All day' : `${clock(b.start_min!)}–${clock(b.end_min!)}`
}

/** Local Date -> "YYYY-MM-DD" */
export function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "YYYY-MM-DD" -> local Date at midnight */
export function dateFromIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayIso(): string {
  return isoFromDate(new Date())
}

/** Date -> minutes from midnight (local) */
export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** minutes from midnight -> a Date today at that time (for the time picker) */
export function dateAtMinutes(min: number): Date {
  const d = new Date()
  d.setHours(Math.floor(min / 60), min % 60, 0, 0)
  return d
}

function shortDate(iso: string): string {
  return dateFromIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "Mon 9 Nov" or "Mon 9 Nov – Fri 13 Nov" */
export function dateRangeLabel(start: string, end?: string | null): string {
  return !end || end === start ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`
}

/** Sort: all-day first, then by start time */
export function byStart(a: AvailabilityBlock, b: AvailabilityBlock): number {
  return (a.start_min ?? -1) - (b.start_min ?? -1)
}
