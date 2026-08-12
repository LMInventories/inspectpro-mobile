package uk.co.lminventories.inspectpro.floorplanscanner

import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.Log
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.DeadlineExceededException
import com.google.ar.core.exceptions.NotYetAvailableException
import com.google.ar.core.exceptions.ResourceExhaustedException
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

private const val TAG = "FloorPlanRenderer"
private const val PROGRESS_THROTTLE_MS = 500L
private const val CAPTURE_INTERVAL_MS = 500L

/**
 * Minimal ARCore render loop — creates the external camera texture ARCore
 * requires, calls session.update() every frame, and surfaces tracking state
 * + detected-wall count as throttled events via FloorPlanSessionHolder.listener.
 * Also hands a throttled pose+depth sample to FloorPlanSessionHolder.recorder
 * (if a scan is active), which persists it as the local scan package.
 *
 * Deliberately does NOT render the camera passthrough to screen (no shader /
 * BackgroundRenderer) — Milestone 1 targets pose/tracking/depth data capture,
 * not the scanning UI's visual polish, and shader-based texture rendering is
 * one more moving part that's better added once the data pipeline itself is
 * confirmed working on a device.
 */
class FloorPlanRenderer : GLSurfaceView.Renderer {
  private var textureId = -1
  private var viewportWidth = 0
  private var viewportHeight = 0
  private var lastConfiguredSession: Session? = null
  private var lastTrackingState: TrackingState? = null
  private var lastProgressAt = 0L
  private var lastCaptureAt = 0L

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    textureId = createExternalTexture()
    // Deliberately NOT calling session.setCameraTextureName() here — the
    // session may not exist yet if startScan() hasn't been called (the view
    // can mount before or after that JS call). onDrawFrame binds the texture
    // to whichever session is current the first time it sees it, instead.
    lastConfiguredSession = null
  }

  override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
    GLES20.glViewport(0, 0, width, height)
    viewportWidth = width
    viewportHeight = height
  }

  override fun onDrawFrame(gl: GL10?) {
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

    val session = FloorPlanSessionHolder.session ?: return
    if (textureId == -1 || viewportWidth == 0 || viewportHeight == 0) return

    if (session !== lastConfiguredSession) {
      session.setCameraTextureName(textureId)
      lastConfiguredSession = session
    }

    val frame = try {
      session.setDisplayGeometry(0, viewportWidth, viewportHeight)
      session.update()
    } catch (e: CameraNotAvailableException) {
      FloorPlanSessionHolder.listener?.onScanFailed("CAMERA_UNAVAILABLE", e.message ?: "Camera unavailable")
      return
    } catch (e: Exception) {
      Log.e(TAG, "session.update() failed", e)
      return
    }

    val trackingState = frame.camera.trackingState
    if (trackingState != lastTrackingState) {
      lastTrackingState = trackingState
      val stateName = when (trackingState) {
        TrackingState.TRACKING -> "TRACKING"
        TrackingState.PAUSED   -> "LIMITED"
        TrackingState.STOPPED  -> "NOT_TRACKING"
        else                    -> "NOT_TRACKING"
      }
      val reason = if (trackingState == TrackingState.PAUSED) frame.camera.trackingFailureReason.name else null
      FloorPlanSessionHolder.listener?.onTrackingStateChanged(stateName, reason)
    }

    val now = System.currentTimeMillis()
    if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
      lastProgressAt = now
      val wallCount = session.getAllTrackables(Plane::class.java)
        .count { it.type == Plane.Type.VERTICAL && it.trackingState == TrackingState.TRACKING }
      FloorPlanSessionHolder.listener?.onScanProgress(wallCount)
    }

    // Only meaningful to persist a sample while actually tracking — a pose
    // captured mid-relocalisation (LIMITED/NOT_TRACKING) is not usable data.
    val recorder = FloorPlanSessionHolder.recorder
    if (recorder != null && trackingState == TrackingState.TRACKING && now - lastCaptureAt >= CAPTURE_INTERVAL_MS) {
      lastCaptureAt = now

      var depthBytes: ByteArray? = null
      var depthWidth = 0
      var depthHeight = 0
      var depthRowStride = 0
      try {
        val depthImage = frame.acquireDepthImage16Bits()
        try {
          val plane = depthImage.planes[0]
          val buffer = plane.buffer
          depthBytes = ByteArray(buffer.remaining())
          buffer.get(depthBytes)
          depthWidth = depthImage.width
          depthHeight = depthImage.height
          depthRowStride = plane.rowStride
        } finally {
          // Must close promptly regardless of outcome above — ARCore limits
          // how many depth images can be outstanding at once and throws
          // ResourceExhaustedException on future acquires if these leak.
          depthImage.close()
        }
      } catch (e: NotYetAvailableException) {
        // Normal during the first second or so of tracking — not an error.
        // Fall through and record the pose alone (depthBytes stays null).
      } catch (e: DeadlineExceededException) {
        Log.w(TAG, "Depth image not ready in time", e)
      } catch (e: ResourceExhaustedException) {
        Log.w(TAG, "Too many outstanding depth images", e)
      } catch (e: Exception) {
        Log.w(TAG, "Depth image unavailable on this device", e)
      }

      recorder.recordFrame(frame, now, depthBytes, depthWidth, depthHeight, depthRowStride)
    }
  }

  private fun createExternalTexture(): Int {
    val textures = IntArray(1)
    GLES20.glGenTextures(1, textures, 0)
    val id = textures[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, id)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    return id
  }
}
