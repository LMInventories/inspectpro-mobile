import axios, { AxiosInstance } from 'axios'
import * as SecureStore from 'expo-secure-store'

// Set EXPO_PUBLIC_API_URL in your .env or EAS secrets to override.
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://lmsoftware-production.up.railway.app'

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

  changePassword: (data: { current_password: string; new_password: string }) =>
    http.post('/api/auth/change-password', data),

  getCurrentUser: () =>
    http.get('/api/auth/me'),

  // Inspections
  getInspections: () =>
    http.get('/api/inspections'),

  getInspection: (id: number) =>
    http.get(`/api/inspections/${id}`),

  getPreviousReportPdfs: (id: number) =>
    http.get(`/api/inspections/${id}/previous-report-pdfs`),

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
  getMidtermSections: () =>
    http.get('/api/midterm-sections'),

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
    isDamageReport?: boolean
    inspectionId?: number
    processedItemIds?: string[]
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

  // AI Condition Summary — synthesises notable issues from filled room data
  generateConditionSummary: (data: {
    inspectionId: number
    sections: Array<{
      name: string
      items: Array<{
        name: string
        description: string
        condition: string
        subs?: Array<{ description: string; condition: string }>
      }>
    }>
    summaryItems: Array<{ id: string; name: string }>
    propertyDetails?: {
      property_type?: string | null
      bedrooms?: number | null
      bathrooms?: number | null
      furnished?: string | null
      address?: string | null
    }
  }) =>
    httpAi.post('/api/transcribe/condition-summary', data),

  checkAiStatus: () =>
    http.get('/api/ai/status'),

  // ── Photo storage (S3 pre-signed upload URLs) ──────────────────────────────
  // Returns presigned PUT URLs so the mobile app can upload photos directly
  // to S3 without routing binary data through the Flask server.
  getPhotoPresignedUrls: (count: number, prefix: string) =>
    http.post('/api/photos/presign', { count, prefix }),

  deletePhoto: (key: string) =>
    http.post('/api/photos/delete', { key }),

  // ── Floor plan scan uploads (Milestone 1 / Phase 5) ─────────────────────────
  createFloorPlanScan: (inspectionId: number, scanUuid: string, frameCount: number) =>
    http.post(`/api/floorplans/${inspectionId}/scans`, { scanUuid, frameCount }),

  updateFloorPlanScan: (scanId: number, status: 'UPLOADED' | 'FAILED', errorMessage?: string) =>
    http.patch(`/api/floorplans/scans/${scanId}`, { status, errorMessage }),

  // Diagnostic SVG render of a scan's detected walls/corners — see
  // routes/floorplans.py's render_scan. responseType 'text' since this
  // returns image/svg+xml, not JSON.
  getFloorPlanScanRender: (scanId: number) =>
    http.get<string>(`/api/floorplans/scans/${scanId}/render`, { responseType: 'text' }),

  // ── Manual floor plan tool (measure-and-draw, replaces ARCore scanning as
  // the default path — see routes/floorplan_manual.py) ────────────────────────
  getFloorPlanManual: (inspectionId: number) =>
    http.get(`/api/floorplan-manual/${inspectionId}`),

  saveFloorPlanManual: (inspectionId: number, corners: [number, number][]) =>
    http.put(`/api/floorplan-manual/${inspectionId}`, { corners }),

  // Action catalogue (for check-out inspections)
  getActions: () =>
    http.get('/api/actions'),

  // ── Admin / Manager create flows ─────────────────────────────────────────
  createInspection: (data: any) =>
    http.post('/api/inspections', data),

  getProperties: () =>
    http.get('/api/properties'),

  getTemplates: () =>
    http.get('/api/templates'),

  getUsers: () =>
    http.get('/api/users'),

  getClients: () =>
    http.get('/api/clients'),

  getPropertyHistory: (propertyId: number) =>
    http.get(`/api/inspections/property/${propertyId}/history`),

  createProperty: (data: any) =>
    http.post('/api/properties', data),

  // ── Admin — Users CRUD ───────────────────────────────────────────────────
  createUser: (data: { name: string; email: string; password: string; role: string; color?: string; phone?: string; typist_mode?: string | null }) =>
    http.post('/api/users', data),

  updateUser: (id: number, data: { name?: string; email?: string; role?: string; color?: string; phone?: string; typist_mode?: string | null; password?: string }) =>
    http.put(`/api/users/${id}`, data),

  updateMyDefaults: (data: { typist_mode?: string | null; camera_option?: string | null }) =>
    http.patch('/api/auth/me', data),

  deleteUser: (id: number) =>
    http.delete(`/api/users/${id}`),

  // ── Admin — Properties update / delete ───────────────────────────────────
  updateProperty: (id: number, data: any) =>
    http.put(`/api/properties/${id}`, data),

  deleteProperty: (id: number) =>
    http.delete(`/api/properties/${id}`),

  // ── Admin — Clients CRUD ─────────────────────────────────────────────────
  createClient: (data: { name: string; email?: string; phone?: string; company?: string; address?: string; primary_color?: string; report_disclaimer?: string }) =>
    http.post('/api/clients', data),

  updateClient: (id: number, data: { name?: string; email?: string; phone?: string; company?: string; address?: string; primary_color?: string; report_disclaimer?: string }) =>
    http.put(`/api/clients/${id}`, data),

  deleteClient: (id: number) =>
    http.delete(`/api/clients/${id}`),

  // ── Admin — all inspections + delete ────────────────────────────────────
  getAllInspections: () =>
    http.get('/api/inspections'),

  deleteInspection: (id: number) =>
    http.delete(`/api/inspections/${id}`),

  // ── Dashboard ────────────────────────────────────────────────────────────
  getDashboardStats: () =>
    http.get('/api/dashboard/stats'),

  // ── Templates CRUD + copy ────────────────────────────────────────────────
  createTemplate: (data: { name: string; inspection_type: string; is_default?: boolean }) =>
    http.post('/api/templates', data),

  updateTemplate: (id: number, data: { name?: string; inspection_type?: string; is_default?: boolean }) =>
    http.put(`/api/templates/${id}`, data),

  deleteTemplate: (id: number) =>
    http.delete(`/api/templates/${id}`),

  copyTemplate: (id: number) =>
    http.post(`/api/templates/${id}/copy`),

  // ── Actions (check-out action catalogue) ─────────────────────────────────
  updateActions: (data: { actions: Array<{ id: string; name: string; color: string }>; responsibilities: string[] }) =>
    http.put('/api/actions', data),

  // ── System Settings ───────────────────────────────────────────────────────
  getSystemSettings: () =>
    http.get('/api/system-settings'),

  updateSystemSettings: (data: Record<string, string>) =>
    http.put('/api/system-settings', data),
}

export default api
