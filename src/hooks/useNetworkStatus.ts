/**
 * useNetworkStatus — lightweight offline detection without extra packages.
 *
 * Strategy: poll a HEAD request to the server health endpoint every 15 seconds,
 * and re-check whenever the app returns to the foreground (AppState change).
 * This avoids @react-native-community/netinfo and expo-network dependencies.
 *
 * Returns:
 *   isOnline — true = server reachable, false = offline or server down
 *   lastChecked — Date of the last check (or null before first check)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { api } from '../services/api'

const POLL_INTERVAL_MS = 15_000   // 15 s
const CHECK_TIMEOUT_MS  = 5_000   // 5 s per individual probe

async function probe(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    await api.http.get('/api/health', {
      signal: controller.signal as any,
      timeout: CHECK_TIMEOUT_MS,
      // Don't trigger the 401 interceptor on this call
      _noRetry: true,
    } as any)
    clearTimeout(timer)
    return true
  } catch {
    return false
  }
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline]       = useState(true)   // optimistic default
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const check = useCallback(async () => {
    const online = await probe()
    if (!mountedRef.current) return
    setIsOnline(online)
    setLastChecked(new Date())
  }, [])

  useEffect(() => {
    mountedRef.current = true

    // Initial check
    check()

    // Periodic poll
    timerRef.current = setInterval(check, POLL_INTERVAL_MS)

    // Re-check on foreground
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
