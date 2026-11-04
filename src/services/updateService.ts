import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Platform, Alert } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const GITHUB_OWNER = 'LMInventories'
const GITHUB_REPO  = 'inspectpro-mobile'

export interface ReleaseInfo {
  buildNumber: number
  tagName: string
  downloadUrl: string | null
}

export function getCurrentBuildNumber(): number {
  const raw = process.env.EXPO_PUBLIC_BUILD_NUMBER
  return raw ? parseInt(raw, 10) : 0
}

const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
let releaseCache: { info: ReleaseInfo; checkedAt: number } | null = null

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const now = Date.now()
  if (releaseCache && now - releaseCache.checkedAt < RELEASE_CACHE_TTL_MS) {
    return releaseCache.info
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (res.status === 404) throw new Error('No releases found yet.')
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)

  const data = await res.json()
  const tagName: string = data.tag_name ?? ''
  const match = tagName.match(/build-(\d+)/)
  const buildNumber = match ? parseInt(match[1], 10) : 0
  const apkAsset = (data.assets ?? []).find((a: any) =>
    (a.name as string).endsWith('.apk')
  )
  const info: ReleaseInfo = {
    buildNumber,
    tagName,
    downloadUrl: apkAsset?.browser_download_url ?? null,
  }
  releaseCache = { info, checkedAt: now }
  return info
}

export async function downloadAndInstall(
  downloadUrl: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Only supported on Android.')

  const dest = `${FileSystem.cacheDirectory}inspectpro-update.apk`

  const existing = await FileSystem.getInfoAsync(dest)
  if (existing.exists) await FileSystem.deleteAsync(dest)

  const task = FileSystem.createDownloadResumable(
    downloadUrl,
    dest,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) {
        onProgress(totalBytesWritten / totalBytesExpectedToWrite)
      }
    }
  )

  const result = await task.downloadAsync()
  if (!result) throw new Error('Download failed.')

  const contentUri = await FileSystem.getContentUriAsync(dest)
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    })
  } finally {
    FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {})
  }
}

// ── Automatic update check (every 3 days) ─────────────────────────────────────
const AUTO_CHECK_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'last_update_check'
let autoCheckRunning = false

/**
 * Checks GitHub for a newer build if 3+ days have passed since the last
 * successful check, and offers "Update Now" / "Cancel". Silent on failure
 * (offline, rate limit) — the timestamp is only advanced after a successful
 * check, so it retries next time the app is opened/foregrounded.
 */
export async function checkForUpdateIfDue(): Promise<void> {
  if (Platform.OS !== 'android' || autoCheckRunning) return
  autoCheckRunning = true
  try {
    const last = parseInt((await SecureStore.getItemAsync(LAST_CHECK_KEY)) ?? '0', 10) || 0
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return

    const info = await fetchLatestRelease()
    await SecureStore.setItemAsync(LAST_CHECK_KEY, String(Date.now()))

    if (info.buildNumber > getCurrentBuildNumber() && info.downloadUrl) {
      const url = info.downloadUrl
      Alert.alert(
        'Update Available',
        'A new version of InspectPro is available.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Update Now',
            onPress: () => {
              downloadAndInstall(url, () => {}).catch(err =>
                Alert.alert('Update failed', err?.message || 'Download failed.')
              )
            },
          },
        ]
      )
    }
  } catch (err) {
    console.warn('[Update] Auto-check failed (non-fatal):', err)
  } finally {
    autoCheckRunning = false
  }
}
