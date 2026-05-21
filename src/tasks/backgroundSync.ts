/**
 * backgroundSync.ts
 * Background fetch task — syncs unsynced, finalised inspections while the app
 * is in the background (every ~15 minutes, iOS/Android permitting).
 *
 * ⚠️  Requires native modules:
 *     expo install expo-background-fetch expo-task-manager
 *     npx expo prebuild  (or EAS Build)
 *
 * Registration:
 *   Import { registerBackgroundSyncTask } from this file and call it once
 *   from App.tsx after the DB has been initialised.
 *
 * Constraints:
 *   • iOS: executes for max ~30 s; may be throttailed by the OS
 *   • Android: executes for max ~1 min; respects WorkManager constraints
 *   • Both: only runs when there is network connectivity
 *   • We skip inspections that don't have is_finalised=1 to avoid pushing
 *     incomplete work automatically.
 */
import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import NetInfo from '@react-native-community/netinfo'   // shimmed below if absent
import { getLocalInspections } from '../services/database'
import { syncSingleInspection } from '../services/syncService'
import { useAuthStore } from '../stores/authStore'

export const BACKGROUND_SYNC_TASK = 'INSPECTPRO_BACKGROUND_SYNC'

// ── Task definition ───────────────────────────────────────────────────────────
// TaskManager.defineTask must be called at the TOP LEVEL of a module that is
// imported early (before BackgroundFetch.registerTaskAsync).
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    console.log('[BGSync] task fired')

    // Check connectivity — skip if no network (saves battery)
    let isConnected = true
    try {
      // Use a lightweight fetch probe since @react-native-community/netinfo may
      // not be installed. Probe with a 5 s timeout.
      const ctrl   = new AbortController()
      const timer  = setTimeout(() => ctrl.abort(), 5000)
      await fetch('https://www.google.com', { method: 'HEAD', signal: ctrl.signal as any })
      clearTimeout(timer)
    } catch {
      isConnected = false
    }

    if (!isConnected) {
      console.log('[BGSync] no connectivity — skipping')
      return BackgroundFetch.BackgroundFetchResult.NoData
    }

    // Get user from auth store (Zustand's getState works outside React)
    const user = useAuthStore.getState().user
    if (!user) {
      console.log('[BGSync] no authenticated user — skipping')
      return BackgroundFetch.BackgroundFetchResult.NoData
    }

    // Find finalised, unsynced inspections
    const all        = getLocalInspections()
    const toSync     = all.filter(i => !i.synced && i.is_finalised)

    if (toSync.length === 0) {
      console.log('[BGSync] nothing to sync')
      return BackgroundFetch.BackgroundFetchResult.NoData
    }

    console.log(`[BGSync] syncing ${toSync.length} finalised inspection(s)`)

    let anySucceeded = false
    for (const inspection of toSync) {
      try {
        const result = await syncSingleInspection(inspection.id, inspection, user)
        if (result.success) {
          anySucceeded = true
          console.log(`[BGSync] inspection ${inspection.id} synced OK`)
        } else {
          console.warn(`[BGSync] inspection ${inspection.id} failed: ${result.error}`)
        }
      } catch (err) {
        console.warn(`[BGSync] inspection ${inspection.id} threw:`, err)
      }
    }

    return anySucceeded
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.Failed

  } catch (err) {
    console.error('[BGSync] unhandled error:', err)
    return BackgroundFetch.BackgroundFetchResult.Failed
  }
})

// ── Registration — call once from App.tsx after DB init ───────────────────────
export async function registerBackgroundSyncTask(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync()

    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.log('[BGSync] background fetch restricted/denied by OS — skipping registration')
      return
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60,   // 15 minutes (OS may enforce longer gaps)
      stopOnTerminate: false,      // Android: continue after app is killed
      startOnBoot:     true,       // Android: resume after device restart
    })

    console.log('[BGSync] task registered')
  } catch (err) {
    // Non-fatal — background sync is best-effort; foreground sync is always available
    console.warn('[BGSync] registration failed (non-fatal):', err)
  }
}

// ── Unregistration — for settings/logout cleanup ─────────────────────────────
export async function unregisterBackgroundSyncTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK)
      console.log('[BGSync] task unregistered')
    }
  } catch (err) {
    console.warn('[BGSync] unregistration failed (non-fatal):', err)
  }
}
