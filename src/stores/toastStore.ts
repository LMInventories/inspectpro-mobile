import { create } from 'zustand'

export type ToastType = 'success' | 'info' | 'error'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastStore {
  toast: Toast | null
  showToast: (message: string, type?: ToastType) => void
  hideToast: () => void
}

let _nextId = 0

export const useToastStore = create<ToastStore>((set) => ({
  toast: null,
  showToast: (message, type = 'success') => {
    set({ toast: { id: ++_nextId, message, type } })
  },
  hideToast: () => set({ toast: null }),
}))
