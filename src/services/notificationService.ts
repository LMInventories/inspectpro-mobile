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

// Two channels, not one: progress updates (per-inspection, per-photo, per-audio
// clip) must never buzz — only the final "sync complete" notification should.
// Android notification channels are effectively immutable after first creation
// (changing enableVibrate on an existing channel ID silently does nothing on
// most devices/OEM skins), so the old shared 'sync' channel kept vibrating on
// every update even after enableVibrate was set to false here — the channel
// had already been created (vibrating) by an earlier build. New channel IDs
// below force a fresh, correctly-configured channel on every device.
const PROGRESS_CHANNEL_ID = 'inspectpro-sync-progress-v2'
const COMPLETE_CHANNEL_ID = 'inspectpro-sync-complete-v2'

// Configures how notifications are displayed while the app is in the foreground.
// Sound/haptic (via content.sound) is only ever set on the "complete" notification
// itself (see showSyncComplete) — allowing it here just lets that per-notification
// setting take effect; progress notifications never request sound in the first place.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
})

// ── Permission + channel setup ────────────────────────────────────────────────
// Call once from App.tsx after DB init.
export async function setupNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(PROGRESS_CHANNEL_ID, {
        name:                 'Sync progress',
        importance:           Notifications.AndroidImportance.LOW,  // no sound, no vibrate, no heads-up
        showBadge:            false,
        enableVibrate:        false,
        enableLights:         false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      })
      await Notifications.setNotificationChannelAsync(COMPLETE_CHANNEL_ID, {
        name:                 'Sync complete',
        importance:           Notifications.AndroidImportance.DEFAULT,
        showBadge:            false,
        enableVibrate:        true,
        vibrationPattern:     [0, 200],
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
        sound: false,   // never buzz/chime per photo/audio clip — only showSyncComplete does
        data:  {},
        ...(Platform.OS === 'android' && {
          android: { channelId: PROGRESS_CHANNEL_ID },
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
        sound: true,   // the only point in a sync where a haptic/chime should fire
        data: {},
        ...(Platform.OS === 'android' && {
          android: { channelId: COMPLETE_CHANNEL_ID },
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
