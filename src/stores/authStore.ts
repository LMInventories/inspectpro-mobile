import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { api } from '../services/api'

interface User {
  id: number
  name: string
  email: string
  role: string
  color: string
  typist_mode: 'ai_instant' | 'ai_room' | 'human' | null
  camera_option: string | null
  client_id: number | null
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  initAuth: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateDefaults: (typistMode: string | null, cameraOption: string | null) => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  initAuth: async () => {
    const token = await SecureStore.getItemAsync('token')
    const userJson = await SecureStore.getItemAsync('user')
    if (token && userJson) {
      set({ token, user: JSON.parse(userJson), isAuthenticated: true })
    }
  },

  login: async (email, password) => {
    const res = await api.login({ email, password })
    const { token, user } = res.data
    await SecureStore.setItemAsync('token', token)
    await SecureStore.setItemAsync('user', JSON.stringify(user))
    set({ token, user, isAuthenticated: true })
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('token')
    await SecureStore.deleteItemAsync('user')
    set({ user: null, token: null, isAuthenticated: false })
  },

  updateDefaults: async (typistMode, cameraOption) => {
    const res = await api.updateMyDefaults({ typist_mode: typistMode, camera_option: cameraOption })
    const updated = res.data
    const current = useAuthStore.getState().user
    const merged = { ...current, ...updated } as User
    await SecureStore.setItemAsync('user', JSON.stringify(merged))
    set({ user: merged })
  },
}))
