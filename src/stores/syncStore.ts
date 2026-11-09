import { Platform } from 'react-native'
import { create } from 'zustand'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { SyncProgress, SyncResult, syncSingleInspection } from '../services/syncService'
import { useInspectionStore } from './inspectionStore'
import { useToastStore } from './toastStore'
import { showSyncProgress, showSyncComplete } from '../services/notificationService'
import { runInForegroundService, setForegroundServiceText } from '../services/foregroundService'

interface SyncStore {
  syncing:    boolean
  progress:   SyncProgress | null
  syncIndex:  number
  syncTotal:  number
  results:    SyncResult[] | null
  startSync:  (inspections: any[], user: any) => Promise<void>
  clearResults: () => void
}

// Android: the sync runs inside a foreground service (see foregroundService.ts), so
// it continues with the screen off or the phone in a pocket, and its persistent
// notification doubles as the progress display.
// iOS can't do that, so there we keep the screen on instead — once it locks the OS
// suspends the app's JS and network within seconds.
const KEEP_AWAKE_TAG = 'inspection-sync'
const IS_ANDROID = Platform.OS === 'android'

function reportProgress(current: number, total: number, phase?: string) {
  if (IS_ANDROID) {
    const detail = phase === 'photos' ? ' — photos' : phase === 'audio' ? ' — audio'
      : phase === 'uploading' ? ' — uploading' : phase === 'retrying' ? ' — retrying' : ''
    setForegroundServiceText(`Inspection ${current} of ${total}${detail}`)
  } else {
    showSyncProgress(current, total, phase)
  }
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  syncing:   false,
  progress:  null,
  syncIndex: 0,
  syncTotal: 0,
  results:   null,

  startSync: async (inspections, user) => {
    if (get().syncing) return          // a sync (and its foreground service) is already running
    const total = inspections.length
    set({ syncing: true, results: null, syncTotal: total, syncIndex: 0, progress: null })
    const res: SyncResult[] = []

    if (!IS_ANDROID) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    try {
    await runInForegroundService(async () => {
    for (let i = 0; i < inspections.length; i++) {
      const current = i + 1
      set({ syncIndex: current, progress: null })

      reportProgress(current, total)

      const insp   = inspections[i]
      const result = await syncSingleInspection(insp.id, insp, user, (p) => {
        set({ progress: p })
        // Update notification with phase detail (photo/audio progress)
        if (p.phase !== 'retrying') {
          reportProgress(current, total, p.phase)
        }
      })
      res.push(result)
    }

    useInspectionStore.getState().loadInspections()

    const succeeded = res.filter(r => r.success).length
    const photosFailedTotal = res.reduce((sum, r) => sum + (r.photosFailed || 0), 0)

    // OS-level notification: dismiss progress, show completion
    showSyncComplete(succeeded, total)

    // In-app toast (visible immediately if app is foregrounded)
    const showToast = useToastStore.getState().showToast
    if (res.length > 0) {
      if (succeeded === res.length) {
        if (photosFailedTotal > 0) {
          // Local files for these photos are deliberately kept (not deleted) —
          // syncing again will retry them.
          showToast(
            `Synced, but ${photosFailedTotal} photo${photosFailedTotal !== 1 ? 's' : ''} `
            + `didn't upload — sync again to retry`, 'info'
          )
        } else {
          showToast(`✓ ${succeeded} inspection${succeeded !== 1 ? 's' : ''} synced`, 'success')
        }
      } else {
        showToast(`${succeeded}/${res.length} synced — ${res.length - succeeded} failed`, 'error')
      }
    }

    set({ syncing: false, progress: null, results: res })
    })   // end runInForegroundService — finishing inside it keeps the service alive until results/notifications are done
    } catch (err) {
      set({ syncing: false, progress: null, results: res })
      throw err
    } finally {
      if (!IS_ANDROID) deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {})
    }
  },

  clearResults: () => set({ results: null }),
}))
