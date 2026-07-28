import { create } from 'zustand'
import { SyncProgress, SyncResult, syncSingleInspection } from '../services/syncService'
import { useInspectionStore } from './inspectionStore'
import { useToastStore } from './toastStore'
import { showSyncProgress, showSyncComplete } from '../services/notificationService'

interface SyncStore {
  syncing:    boolean
  progress:   SyncProgress | null
  syncIndex:  number
  syncTotal:  number
  results:    SyncResult[] | null
  startSync:  (inspections: any[], user: any) => Promise<void>
  clearResults: () => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  syncing:   false,
  progress:  null,
  syncIndex: 0,
  syncTotal: 0,
  results:   null,

  startSync: async (inspections, user) => {
    const total = inspections.length
    set({ syncing: true, results: null, syncTotal: total, syncIndex: 0, progress: null })
    const res: SyncResult[] = []

    for (let i = 0; i < inspections.length; i++) {
      const current = i + 1
      set({ syncIndex: current, progress: null })

      // OS-level notification — updates in place (same identifier)
      showSyncProgress(current, total)

      const insp   = inspections[i]
      const result = await syncSingleInspection(insp.id, insp, user, (p) => {
        set({ progress: p })
        // Update notification with phase detail (photo/audio progress)
        if (p.phase !== 'retrying') {
          showSyncProgress(current, total, p.phase)
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
  },

  clearResults: () => set({ results: null }),
}))
