import { requireNativeModule, NativeModule } from 'expo-modules-core'
import type {
  ArCoreAvailability,
  ArCoreInstallStatus,
  ScanProgressEvent,
  TrackingStateEvent,
  ScanWarningEvent,
  ScanCompleteEvent,
  ScanFailedEvent,
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
  // Real ARCore Session creation, camera texture binding, and frame/pose/
  // depth capture are implemented natively (FloorPlanScannerModule.kt +
  // FloorPlanRenderer.kt) but NOT YET VERIFIED ON A DEVICE — only confirmed
  // to compile against the real ARCore SDK in CI. Caller must ensure camera
  // permission is granted before calling startScan(); it rejects with a
  // clear error if not (see useCameraPermission from react-native-vision-camera,
  // already used elsewhere in this app for the same permission).
  startScan(): Promise<void>
  pauseScan(): void
  resumeScan(): void
  stopScan(): void
  cancelScan(): void
}

export default requireNativeModule<FloorPlanScannerModuleType>('FloorPlanScanner')
