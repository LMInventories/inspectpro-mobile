import axios, { AxiosInstance } from 'axios'
import * as SecureStore from 'expo-secure-store'

// Set EXPO_PUBLIC_API_URL in your .env or EAS secrets to override.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://lmsoftware-production.up.railway.app'

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

// Dedicated instance for sync uploads — large payloads (photos + audio) need a longer timeout.
const httpSync = axios.create({
  baseURL: BASE_URL,
  timeout: 300000,  // 5 minutes
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
})

// Separate instance with a longer timeout for AI audio endpoints
const httpAi = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,   // 2 min — Whisper + Claude can take a while for multi-clip rooms
})

// ── TOKEN REFRESH STATE ───────────────────────────────────────────────────────
// Shared across all three instances so only one refresh call fires at a time.
let _isRefreshing = false
let _failedQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = []

function _processQueue(error: any, token: string | null = null) {
  _failedQueue.forEach(({ resolve, reject }) => error ? reject(error) : resolve(token!))
  _failedQueue = []
}

async function _attemptRefresh(): Promise<string> {
  const currentToken = await SecureStore.getItemAsync('token')
  if (!currentToken) throw new Error('No token stored')
  const response = await axios.post(
    `${BASE_URL}/api/auth/refresh`,
    {},
    { headers: { Authorization: `Bearer ${currentToken}` } }
  )
  const newToken: string = response.data.token
  await SecureStore.setItemAsync('token', newToken)
  return newToken
}

function _attachRefreshInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response?.status
      const originalRequest = error.config

      if (status !== 401 || originalRequest._retry) {
        return Promise.reject(error)
      }

      // Never retry the refresh call itself.
      if (originalRequest.url?.includes('/api/auth/refresh')) {
        await SecureStore.deleteItemAsync('token')
        return Promise.reject(error)
      }

      // Queue while a refresh is already in flight.
      if (_isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          _failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest._retry = true
          originalRequest.headers.Authorization = `Bearer ${token}`
          return instance(originalRequest)
        }).catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      _isRefreshing = true

      try {
        const newToken = await _attemptRefresh()
        _processQueue(null, newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return instance(originalRequest)
      } catch (refreshError) {
        _processQueue(refreshError, null)
        await SecureStore.deleteItemAsync('token')
        return Promise.reject(refreshError)
      } finally {
        _isRefreshing = false
      }
    }
  )
}

httpAi.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

httpSync.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Attach refresh-then-retry to all three instances.
_attachRefreshInterceptor(http)
_attachRefreshInterceptor(httpSync)
_attachRefreshInterceptor(httpAi)

export const api = {
  // Auth
  login: (data: { email: string; password: string }) =>
    http.post('/api/auth/login', data),

  forgotPassword: (email: string) =>
    http.post('/api/auth/forgot-password', { email }),

  getCurrentUser: () =>
    http.get('/api/auth/me'),

  // Inspections
  getInspections: () =>
    http.get('/api/inspections'),

  getInspection: (id: number) =>
    http.get(`/api/inspections/${id}`),

  updateInspection: (id: number, data: any) =>
    http.put(`/api/inspections/${id}`, data),

  // Use the long-timeout sync instance for large payloads (photos + audio)
  syncInspection: (id: number, data: any) =>
    httpSync.put(`/api/inspections/${id}`, data),

  // Templates
  getTemplate: (id: number) =>
    http.get(`/api/templates/${id}`),

  // Fixed sections
  getFixedSections: () =>
    http.get('/api/fixed-sections'),

  // Section presets
  getSectionPresets: () =>
    http.get('/api/section-presets'),

  // AI transcription — per-item (AI instant mode)
  transcribeItem: (data: any) =>
    httpAi.post('/api/transcribe/item', data),

  // AI transcription — per-room or per-fixed-section dictation
  transcribeRoom: (data: {
    clips: Array<{ audio: string; mimeType: string }>
    sectionName: string
    sectionKey: string
    sectionType?: string   // 'room' (default) or fixed section type
    isCheckOut?: boolean   // check-out mode — verbatim CO conditions + sub-item routing
    items: Array<{
      id: string
      name: string
      hasCondition?: boolean
      hasDescription?: boolean
      subs?: Array<{ _sid: string; description: string }>  // for check-out sub-item routing
    }>
  }) =>
    httpAi.post('/api/transcribe/room', data),

  // AI photo classification (for reassign)
  classifyPhoto: (data: { imageBase64: string; mimeType: string; roomContext: string; inspectionId?: string | number }) =>
    httpAi.post('/api/transcribe/classify-photo', data),

  checkAiStatus: () =>
    http.get('/api/ai/status'),

  // Action catalogue (for check-out inspections)
  getActions: () =>
    http.get('/api/actions'),
}

export default api
