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
 * Event payload shapes. Scan lifecycle events (progress/tracking/warning/
 * complete/failed) are stubbed in this increment — see FloorPlanScannerModule.kt.
 * Shapes are defined now so the JS side (Milestone 2's entry point screen) can
 * be built against a stable contract ahead of the real Session/camera work.
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
