package uk.co.lminventories.inspectpro.floorplanscanner

import com.google.ar.core.ArCoreApk
import com.google.ar.core.exceptions.UnavailableException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * FloorPlanScannerModule — Milestone 1 scaffold.
 *
 * This increment implements ONLY runtime ARCore capability detection
 * (checkAvailability / requestInstall) — the low-risk, well-defined part of
 * Milestone 1 ("detect ARCore/device capabilities at runtime", non-negotiable
 * rule in docs/floor-plan/IMPLEMENTATION_PLAN.md). Real ARCore Session
 * creation, camera texture binding, and frame/pose/depth capture are
 * deliberately NOT implemented yet — that requires GL surface/camera-thread
 * plumbing that genuinely needs on-device iteration to get right, unlike
 * this piece which is a handful of well-documented static SDK calls.
 *
 * startScan() currently always rejects with NOT_IMPLEMENTED; pause/resume/
 * stop/cancel are no-ops. This lets the JS side and CI compile/link against
 * the real eventual API shape without pretending scanning already works.
 */
class ArCoreUnavailableException(cause: Throwable) :
  CodedException(message = "ARCore availability check failed: ${cause.message}", cause = cause)

class FloorPlanScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FloorPlanScanner")

    Events(
      "onScanProgress",
      "onTrackingStateChanged",
      "onScanWarning",
      "onScanComplete",
      "onScanFailed"
    )

    AsyncFunction("checkAvailability") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        ArCoreApk.getInstance().checkAvailability(context).name
      } catch (e: UnavailableException) {
        throw ArCoreUnavailableException(e)
      }
    }

    AsyncFunction("requestInstall") {
      val activity = appContext.throwingActivity
      try {
        ArCoreApk.getInstance().requestInstall(activity, /* userRequestedInstall = */ true).name
      } catch (e: UnavailableException) {
        throw ArCoreUnavailableException(e)
      }
    }

    // ── Scan lifecycle — not yet implemented, see class doc above ─────────
    AsyncFunction("startScan") {
      throw CodedException(
        message = "ARCore session capture not yet implemented — this build only supports checkAvailability()/requestInstall()"
      )
    }
    Function("pauseScan") { }
    Function("resumeScan") { }
    Function("stopScan") { }
    Function("cancelScan") { }
  }
}
