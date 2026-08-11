import { requireNativeModule } from 'expo-modules-core'
import type { ArCoreAvailability, ArCoreInstallStatus } from './FloorPlanScanner.types'

interface FloorPlanScannerModuleType {
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

  // ── Scan lifecycle — NOT YET IMPLEMENTED ──────────────────────────────
  // startScan currently always rejects; pause/resume/stop/cancel are no-ops.
  // Real ARCore Session creation, camera texture binding, and frame/pose/
  // depth capture are the next increment once this scaffold is confirmed to
  // compile, link, and pass checkAvailability() on a real device.
  startScan(): Promise<void>
  pauseScan(): void
  resumeScan(): void
  stopScan(): void
  cancelScan(): void
}

export default requireNativeModule<FloorPlanScannerModuleType>('FloorPlanScanner')
