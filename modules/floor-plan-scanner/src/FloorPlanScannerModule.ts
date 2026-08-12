import { requireNativeModule, NativeModule } from 'expo-modules-core'
import type {
  ArCoreAvailability,
  ArCoreInstallStatus,
  ScanProgressEvent,
  TrackingStateEvent,
  ScanWarningEvent,
  ScanCompleteEvent,
  ScanFailedEvent,
  StopScanResult,
} from './FloorPlanScanner.types'

type FloorPlanScannerEvents = {
  onScanProgress: (event: ScanProgressEvent) => void
  onTrackingStateChanged: (event: TrackingStateEvent) => void
  onScanWarning: (event: ScanWarningEvent) => void
  onScanComplete: (event: ScanCompleteEvent) => void
  onScanFailed: (event: ScanFailedEvent) => void
}

declare class FloorPlanScannerModuleType extends NativeModule<FloorPlanScannerEvents> {
  /**
   * Runtime capability check — required before offering the scan entry point.
   * Do not assume identical ARCore/depth support across target devices
   * (Galaxy S21 Ultra, Honor Magic V3, OnePlus 13).
   */
  checkAvailability(): Promise<ArCoreAvailability>

  /**
   * Triggers Google Play Store's "install/update Google Play Services for AR"
   * flow when checkAvailability() returns SUPPORTED_NOT_INSTALLED or
   * SUPPORTED_APK_TOO_OLD. Must be called while the app is in the foreground
   * with an active Activity — this app is sideloaded (not Play-Store
   * distributed), so this is the only install path available.
   */
  requestInstall(): Promise<ArCoreInstallStatus>

  // ── Scan lifecycle ──────────────────────────────────────────────────────
  // Real ARCore Session creation, camera texture binding, frame/pose/depth
  // capture, and local scan package persistence are implemented natively
  // (FloorPlanScannerModule.kt + FloorPlanRenderer.kt + FloorPlanScanRecorder.kt)
  // but NOT YET VERIFIED ON A DEVICE — only confirmed to compile against the
  // real ARCore SDK in CI. Caller must ensure camera permission is granted
  // before calling startScan(); it rejects with a clear error if not (see
  // useCameraPermission from react-native-vision-camera, already used
  // elsewhere in this app for the same permission).
  startScan(): Promise<void>
  pauseScan(): void
  resumeScan(): void
  /**
   * Ends the scan and finalises the local package (manifest.json + any
   * captured depth frames) under the app's internal storage. Nothing is
   * uploaded anywhere — there is no backend pipeline for this yet (Phase 5).
   * frameCount === 0 means nothing usable was captured (e.g. tracking never
   * succeeded), not necessarily an error — check before assuming success.
   */
  stopScan(): Promise<StopScanResult>
  /** Ends the scan and deletes everything captured so far. */
  cancelScan(): Promise<void>
}

export default requireNativeModule<FloorPlanScannerModuleType>('FloorPlanScanner')
