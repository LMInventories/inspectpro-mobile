/**
 * Mirrors com.google.ar.core.ArCoreApk.Availability — see
 * https://developers.google.com/ar/reference/java/com/google/ar/core/ArCoreApk.Availability
 */
export type ArCoreAvailability =
  | 'UNKNOWN_ERROR'
  | 'UNKNOWN_CHECKING'
  | 'UNKNOWN_TIMED_OUT'
  | 'UNSUPPORTED_DEVICE_NOT_CAPABLE'
  | 'SUPPORTED_NOT_INSTALLED'
  | 'SUPPORTED_APK_TOO_OLD'
  | 'SUPPORTED_INSTALLED'

/**
 * Mirrors com.google.ar.core.ArCoreApk.InstallStatus.
 */
export type ArCoreInstallStatus = 'INSTALLED' | 'INSTALL_REQUESTED'

/**
 * Result of stopScan() — the local scan package that was written to the
 * device's internal storage (nothing uploaded yet, see FloorPlanScannerModule.kt).
 * scanId/path are null if no scan was actually in progress when called.
 */
export interface StopScanResult {
  scanId: string | null
  path: string | null
  frameCount: number
}

/**
 * Event payload shapes.
 */
export interface ScanProgressEvent {
  roomsScanned: number
  wallsDetected: number
}

export type TrackingState = 'NOT_TRACKING' | 'LIMITED' | 'TRACKING'

export interface TrackingStateEvent {
  state: TrackingState
  reason?: string // populated when state === 'LIMITED', e.g. "EXCESSIVE_MOTION", "INSUFFICIENT_LIGHT"
}

export interface ScanWarningEvent {
  code: string
  message: string
}

export interface ScanCompleteEvent {
  scanId: string
}

export interface ScanFailedEvent {
  code: string
  message: string
}
