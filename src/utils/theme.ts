// Brand palette — derived from the Inspect Pro logo
//   Navy  #1e3a8a  — house outline, wordmark
//   Cyan  #0ea5e9  — bar chart / arrow
//   Teal  #10b981  — scroll / magnifier
import { useColorScheme } from 'react-native'

// ── Light palette (default) ───────────────────────────────────────────────────
export const lightColors = {
  primary:     '#1e3a8a',  // navy — buttons, headers, active states
  primaryMid:  '#0ea5e9',  // cyan — highlights, links, AI badge
  primaryLight:'#e0f2fe',  // pale cyan — pill backgrounds, selected rows
  accent:      '#10b981',  // teal-green — success accents, sync badge
  success:     '#10b981',  // unified with accent
  successLight:'#d1fae5',
  warning:     '#d97706',
  warningLight:'#fef3c7',
  danger:      '#dc2626',
  dangerLight: '#fee2e2',
  surface:     '#ffffff',
  background:  '#f8fafc',
  border:      '#e2e8f0',
  borderDark:  '#cbd5e1',
  text:        '#1e293b',
  textMid:     '#475569',
  textLight:   '#94a3b8',
  muted:       '#f1f5f9',
}

// ── Dark palette ──────────────────────────────────────────────────────────────
// Designed for low-light inspection environments — high contrast, easy to read
// with one hand on a torch.
export const darkColors = {
  primary:     '#3b82f6',  // lighter blue — visible on dark bg
  primaryMid:  '#38bdf8',  // cyan stays similar
  primaryLight:'#1e3a5f',  // deep blue for pill/selected backgrounds
  accent:      '#34d399',  // lighter teal for dark bg
  success:     '#34d399',
  successLight:'#064e3b',
  warning:     '#fbbf24',
  warningLight:'#451a03',
  danger:      '#f87171',  // lighter red for dark bg
  dangerLight: '#450a0a',
  surface:     '#1e293b',  // dark blue-grey card surface
  background:  '#0f172a',  // near-black background
  border:      '#334155',
  borderDark:  '#475569',
  text:        '#f1f5f9',  // near-white text
  textMid:     '#94a3b8',
  textLight:   '#64748b',
  muted:       '#1e293b',
}

// ── Backward-compat export for static StyleSheet.create() ────────────────────
// Static StyleSheets are evaluated once at module load and cannot read hooks.
// Components with static StyleSheets use `colors` for layout-related colour
// (which rarely changes between themes) and apply dynamic overrides inline for
// foreground/background colours — see useColors() below.
export const colors = lightColors

// ── Hook — call inside a component to get the right palette ──────────────────
export function useColors() {
  const scheme = useColorScheme()
  return scheme === 'dark' ? darkColors : lightColors
}

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
}

export const font = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  xxl:  24,
  xxxl: 30,
}

export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  created:    { bg: '#f1f5f9', text: '#475569', label: 'Created' },
  assigned:   { bg: '#dbeafe', text: '#1e40af', label: 'Assigned' },
  active:     { bg: '#fef3c7', text: '#92400e', label: 'Active' },
  processing: { bg: '#ede9fe', text: '#5b21b6', label: 'Processing' },
  review:     { bg: '#fce7f3', text: '#9d174d', label: 'Review' },
  complete:   { bg: '#dcfce7', text: '#14532d', label: 'Complete' },
}

export const TYPE_LABELS: Record<string, string> = {
  check_in:      'Check In',
  check_out:     'Check Out',
  mid_term:      'Mid Term',
  midterm:       'Midterm',
  inventory:     'Inventory',
  damage_report: 'Damage Report',
}
