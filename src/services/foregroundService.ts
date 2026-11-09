/**
 * foregroundService.ts
 *
 * Runs a long job (the inspection sync) inside an Android foreground service so
 * it keeps running — network included — with the screen off or the app in the
 * background. The service shows a persistent "Syncing…" notification, which is
 * what stops Android suspending the app.
 *
 * iOS has no equivalent for arbitrary long-running JS, so there (and if the
 * service can't start) the job simply runs inline as before.
 */
import { Platform } from 'react-native'
import BackgroundService from 'react-native-background-actions'

const OPTIONS = {
  taskName:  'InspectProSync',
  taskTitle: 'Syncing inspections',
  taskDesc:  'Starting…',
  taskIcon:  { name: 'ic_launcher', type: 'mipmap' },
  color:     '#1E3A8A',
  foregroundServiceType: ['dataSync'],
}

export async function runInForegroundService(work: () => Promise<void>): Promise<void> {
  if (Platform.OS !== 'android') { await work(); return }

  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  let failure: unknown
  let started = false

  try {
    // On Android start() resolves once the service is up, NOT when the task ends.
    await BackgroundService.start(async () => {
      started = true
      try { await work() } catch (e) { failure = e } finally { finish() }
    }, OPTIONS as any)
  } catch (err) {
    if (!started) {
      console.warn('[FGService] could not start foreground service — running inline:', err)
      await work()
      return
    }
    throw err
  }

  await finished
  if (failure) throw failure
}

/** Update the persistent notification text (Android only; no-op otherwise). */
export function setForegroundServiceText(text: string): void {
  if (Platform.OS !== 'android' || !BackgroundService.isRunning()) return
  BackgroundService.updateNotification({ taskDesc: text }).catch(() => {})
}
