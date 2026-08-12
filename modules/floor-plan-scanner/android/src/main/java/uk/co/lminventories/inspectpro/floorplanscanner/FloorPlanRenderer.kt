package uk.co.lminventories.inspectpro.floorplanscanner

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
 * ARCore render loop — draws the camera passthrough via BackgroundRenderer,
 * calls session.update() every frame, and surfaces tracking state + detected-
 * wall count as throttled events via FloorPlanSessionHolder.listener. Also
 * hands a throttled pose+depth sample to FloorPlanSessionHolder.recorder (if
 * a scan is active), which persists it as the local scan package.
 */
class FloorPlanRenderer : GLSurfaceView.Renderer {
  private val backgroundRenderer = BackgroundRenderer()
  private var viewportWidth = 0
  private var viewportHeight = 0
  private var lastConfiguredSession: Session? = null
  private var lastTrackingState: TrackingState? = null
  private var lastProgressAt = 0L
  private var lastCaptureAt = 0L

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    backgroundRenderer.createOnGlThread()
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
    if (backgroundRenderer.textureId == -1 || viewportWidth == 0 || viewportHeight == 0) return

    if (session !== lastConfiguredSession) {
      session.setCameraTextureName(backgroundRenderer.textureId)
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

    backgroundRenderer.draw(frame)

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
}
