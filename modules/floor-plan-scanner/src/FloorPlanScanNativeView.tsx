import { requireNativeViewManager } from 'expo-modules-core'
import * as React from 'react'
import type { ViewProps } from 'react-native'

// Only one view is registered on this module (FloorPlanScanView.kt, via
// View(FloorPlanScanView::class) with no explicit Name()), so this resolves
// to that module's single default view — no second `viewName` argument needed.
const NativeView: React.ComponentType<ViewProps> = requireNativeViewManager('FloorPlanScanner')

/**
 * The camera-surface GL view backing an active scan. Mounting this alone
 * does nothing — pair with FloorPlanScanner.startScan()/stopScan() to
 * actually start/stop the ARCore session it renders (see FloorPlanScreen.tsx).
 */
export default function FloorPlanScanNativeView(props: ViewProps) {
  return <NativeView {...props} />
}
