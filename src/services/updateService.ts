import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Platform } from 'react-native'

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

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
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
  return {
    buildNumber,
    tagName,
    downloadUrl: apkAsset?.browser_download_url ?? null,
  }
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
