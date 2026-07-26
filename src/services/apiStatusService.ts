/**
 * apiStatusService
 *
 * Checks OpenAI's and Anthropic's public status pages on app launch so
 * clerks know upfront whether AI transcription is likely to work before
 * they start dictating. Both status pages are hosted on Atlassian
 * Statuspage, which exposes a standard, well-known JSON summary endpoint —
 * more reliable to parse on-device than the RSS/Atom incident-history feeds
 * (those only list past incidents, not the current live indicator).
 *
 * Anthropic's status page (status.anthropic.com) redirects to
 * status.claude.com — hit the canonical URL directly to skip that hop.
 */
import { probe } from '../hooks/useNetworkStatus'

const OPENAI_STATUS_URL    = 'https://status.openai.com/api/v2/status.json'
const ANTHROPIC_STATUS_URL = 'https://status.claude.com/api/v2/status.json'

const CHECK_TIMEOUT_MS = 6_000

export type StatusIndicator = 'none' | 'minor' | 'major' | 'critical' | 'unknown'

export interface ProviderStatus {
  name: 'OpenAI' | 'Anthropic'
  indicator: StatusIndicator
  description: string
  operational: boolean
}

export interface ApiStatusResult {
  openai: ProviderStatus
  anthropic: ProviderStatus
  allOperational: boolean
  checked: boolean   // false when skipped (offline) or both checks failed to respond
}

async function fetchProviderStatus(
  name: 'OpenAI' | 'Anthropic', url: string
): Promise<ProviderStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const indicator: StatusIndicator = data?.status?.indicator || 'unknown'
    const description: string = data?.status?.description || 'Status unavailable'
    return { name, indicator, description, operational: indicator === 'none' }
  } catch (err) {
    console.warn(`[apiStatusService] ${name} status check failed:`, err)
    return { name, indicator: 'unknown', description: 'Could not reach status page', operational: true }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Checks both providers in parallel. Skips entirely (returns checked: false)
 * when the device has no connection — avoids a false "degraded" reading that
 * is really just the phone being offline (the offline banner already covers
 * that case).
 */
export async function checkApiStatuses(): Promise<ApiStatusResult | null> {
  const online = await probe()
  if (!online) return null

  const [openai, anthropic] = await Promise.all([
    fetchProviderStatus('OpenAI', OPENAI_STATUS_URL),
    fetchProviderStatus('Anthropic', ANTHROPIC_STATUS_URL),
  ])

  return {
    openai,
    anthropic,
    allOperational: openai.operational && anthropic.operational,
    checked: true,
  }
}
