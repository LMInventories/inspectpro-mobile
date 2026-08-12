package uk.co.lminventories.inspectpro.floorplanscanner

import com.google.ar.core.Session

/**
 * Bridges the ARCore Session (owned/lifecycle-managed by FloorPlanScannerModule,
 * created in startScan()) and FloorPlanRenderer (running on the GL thread inside
 * FloorPlanScanView, which needs the same Session instance to call update() each
 * frame). A singleton is a pragmatic choice here, not an accident: only one scan
 * can be active at a time, and only one FloorPlanScanView is ever mounted at once.
 *
 * The View and the Module mount/call in independent order — JS may call
 * startScan() before or after the view has attached and created its GL surface.
 * FloorPlanRenderer re-checks and re-binds the texture whenever the session
 * reference changes, rather than assuming a fixed startup order (see its
 * `lastConfiguredSession` handling) — do not "simplify" that away.
 */
object FloorPlanSessionHolder {
  @Volatile
  var session: Session? = null

  @Volatile
  var listener: FloorPlanFrameListener? = null
}

interface FloorPlanFrameListener {
  fun onTrackingStateChanged(state: String, reason: String?)
  fun onScanProgress(wallsDetected: Int)
  fun onScanWarning(code: String, message: String)
  fun onScanFailed(code: String, message: String)
}
