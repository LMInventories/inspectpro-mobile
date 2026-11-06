/**
 * useNetworkStatus — lightweight connectivity check.
 *
 * Uses raw fetch (not the axios instance) so the 401-refresh interceptor
 * and other axios middleware never interfere. fetch() only throws on a real
 * network failure; any HTTP response — even 401, 404, 500 — means we're
 * connected, so the server is reachable.
 *
 * Polls every 30 s and re-checks immediately when the app returns to
 * the foreground.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { BASE_URL } from '../services/api'

const POLL_INTERVAL_MS = 30_000
const CHECK_TIMEOUT_MS =  5_000

// TEMPORARY (6 Nov 2026): connectivity detection is switched OFF.
// The 5 s ping was producing false "offline" banners and queuing AI
// transcription ("waiting for connection…") on good signal. While this is
// false, probe() always reports online, so nothing is blocked or queued on a
// failed ping; a genuine network failure surfaces as a normal request error
// and the clips are kept. Set to true to restore the original behaviour.
export const OFFLINE_DETECTION_ENABLED = false

export async function probe(): Promise<boolean> {
  if (!OFFLINE_DETECTION_ENABLED) return true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    // HEAD request — minimal payload, no auth required.
    // fetch() throws only on network errors; any HTTP status = online.
    await fetch(`${BASE_URL}/api/health`, {
      method: 'HEAD',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline]       = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const check = useCallback(async () => {
    const online = await probe()
    if (!mountedRef.current) return
    setIsOnline(online)
    setLastChecked(new Date())
  }, [])

  useEffect(() => {
    if (!OFFLINE_DETECTION_ENABLED) return  // detection off — isOnline stays true
    mountedRef.current = true
    check()
    timerRef.current = setInterval(check, POLL_INTERVAL_MS)
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check()
    })
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      sub.remove()
    }
  }, [check])

  return { isOnline, lastChecked }
}
