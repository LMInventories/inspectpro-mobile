package uk.co.lminventories.inspectpro.floorplanscanner

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * FloorPlanScannerModule — Milestone 1.
 *
 * checkAvailability()/requestInstall(): runtime ARCore capability detection,
 * compile-and-run verified (CI build eb6c578).
 *
 * startScan()/pauseScan()/resumeScan()/stopScan()/cancelScan(): real ARCore
 * Session lifecycle, added in this increment. NOT yet verified on a device —
 * CI compiling this proves the Kotlin/ARCore API usage is at least
 * syntactically correct, but Session/GL/camera-thread behaviour (timing,
 * lifecycle ordering, resource leaks) can only be confirmed by actually
 * running this. See FloorPlanRenderer.kt for the render-loop half of this.
 *
 * Camera permission: this module checks (via ContextCompat) but does not
 * request it — requesting should reuse whatever permission flow the rest of
 * the app already uses (react-native-vision-camera) rather than duplicating
 * one here. FloorPlanScreen.tsx must ensure permission is granted before
 * calling startScan(); right now it does not do this yet, so startScan()
 * will reject with a clear PERMISSION error on a device where it hasn't
 * already been granted for some other reason.
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

    AsyncFunction("startScan") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

      if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
        != PackageManager.PERMISSION_GRANTED
      ) {
        throw CodedException(
          message = "Camera permission not granted — request it (e.g. via the app's existing " +
            "camera permission flow) before calling startScan()"
        )
      }

      if (FloorPlanSessionHolder.session != null) {
        throw CodedException(message = "A scan is already in progress — call stopScan() or cancelScan() first")
      }

      val session = try {
        Session(context)
      } catch (e: UnavailableException) {
        throw ArCoreUnavailableException(e)
      }

      val config = Config(session).apply {
        planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
        focusMode = Config.FocusMode.AUTO
        // Runtime capability check — do not assume identical depth support
        // across target devices (Galaxy S21 Ultra, Honor Magic V3, OnePlus 13).
        depthMode = if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
          Config.DepthMode.AUTOMATIC
        } else {
          Config.DepthMode.DISABLED
        }
      }
      session.configure(config)

      try {
        session.resume()
      } catch (e: CameraNotAvailableException) {
        session.close()
        throw CodedException(message = "Camera not available: ${e.message}", cause = e)
      }

      FloorPlanSessionHolder.listener = object : FloorPlanFrameListener {
        override fun onTrackingStateChanged(state: String, reason: String?) {
          sendEvent("onTrackingStateChanged", mapOf("state" to state, "reason" to reason))
        }
        override fun onScanProgress(wallsDetected: Int) {
          sendEvent("onScanProgress", mapOf("roomsScanned" to 0, "wallsDetected" to wallsDetected))
        }
        override fun onScanWarning(code: String, message: String) {
          sendEvent("onScanWarning", mapOf("code" to code, "message" to message))
        }
        override fun onScanFailed(code: String, message: String) {
          sendEvent("onScanFailed", mapOf("code" to code, "message" to message))
        }
      }

      FloorPlanSessionHolder.session = session
    }

    Function("pauseScan") {
      FloorPlanSessionHolder.session?.pause()
    }

    Function("resumeScan") {
      try {
        FloorPlanSessionHolder.session?.resume()
      } catch (e: CameraNotAvailableException) {
        FloorPlanSessionHolder.listener?.onScanFailed("CAMERA_UNAVAILABLE", e.message ?: "Camera not available")
      }
    }

    Function("stopScan") {
      FloorPlanSessionHolder.session?.close()
      FloorPlanSessionHolder.session = null
      FloorPlanSessionHolder.listener = null
    }

    Function("cancelScan") {
      FloorPlanSessionHolder.session?.close()
      FloorPlanSessionHolder.session = null
      FloorPlanSessionHolder.listener = null
    }

    View(FloorPlanScanView::class) { }
  }
}
