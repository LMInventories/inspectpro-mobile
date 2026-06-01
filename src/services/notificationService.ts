/**
 * notificationService.ts
 *
 * OS-level notification helpers for sync progress.
 * Uses a fixed identifier ('sync-progress') so the progress notification
 * updates in place rather than spawning a new one for each inspection.
 *
 * On Android: notification is sticky (not swipe-dismissible) while syncing.
 * On iOS:     notification appears as a banner; each update replaces the last.
 *
 * Requires expo-notifications — install with: npx expo install expo-notifications
 */
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const PROGRESS_ID = 'inspectpro-sync-progress'
const CHANNEL_ID  = 'sync'

// Configures how notifications are displayed while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
})

// ── Permission + channel setup ────────────────────────────────────────────────
// Call once from App.tsx after DB init.
export async function setupNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name:                 'Sync',
        importance:           Notifications.AndroidImportance.DEFAULT,
        showBadge:            false,
        enableVibrate:        false,
        enableLights:         false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      })
    }

    const { status: current } = await Notifications.getPermissionsAsync()
    if (current === 'granted') return true

    const { status } = await Notifications.requestPermissionsAsync()
    return status === 'granted'
  } catch (err) {
    console.warn('[Notifications] setup failed (non-fatal):', err)
    return false
  }
}

// ── Sync progress notification ────────────────────────────────────────────────
// Replace-in-place via fixed identifier.
// phase: 'photos' | 'audio' | 'uploading' | 'retrying' | undefined
export async function showSyncProgress(
  current: number,
  total:   number,
  phase?:  string
): Promise<void> {
  try {
    let detail = ''
    if (phase === 'photos')    detail = ' — photos'
    if (phase === 'audio')     detail = ' — audio'
    if (phase === 'uploading') detail = ' — uploading'
    if (phase === 'retrying')  detail = ' — retrying'

    await Notifications.scheduleNotificationAsync({
      identifier: PROGRESS_ID,
      content: {
        title: `Syncing ${current}/${total}…`,
        body:  `Inspection ${current} of ${total}${detail}`,
        sticky: true,   // Android: stays until dismissed programmatically
        data:  {},
        ...(Platform.OS === 'android' && {
          android: { channelId: CHANNEL_ID },
        }),
      },
      trigger: null,
    })
  } catch (err) {
    console.warn('[Notifications] showSyncProgress error:', err)
  }
}

// ── Sync complete notification ────────────────────────────────────────────────
export async function showSyncComplete(
  succeeded: number,
  total:     number
): Promise<void> {
  try {
    // Remove the in-progress notification first.
    await Notifications.dismissNotificationAsync(PROGRESS_ID).catch(() => {})

    const allOk = succeeded === total
    await Notifications.scheduleNotificationAsync({
      content: {
        title: allOk
          ? '✓ Sync complete'
          : `Sync done — ${total - succeeded} failed`,
        body: allOk
          ? `${succeeded} inspection${succeeded !== 1 ? 's' : ''} synced successfully.`
          : `${succeeded}/${total} synced. Open InspectPro to retry the rest.`,
        data: {},
        ...(Platform.OS === 'android' && {
          android: { channelId: CHANNEL_ID },
        }),
      },
      trigger: null,
    })
  } catch (err) {
    console.warn('[Notifications] showSyncComplete error:', err)
  }
}

// ── Dismiss sync notification ─────────────────────────────────────────────────
// Call on sync cancel or app foregrounded without completing.
export async function dismissSyncNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(PROGRESS_ID)
  } catch {}
}
