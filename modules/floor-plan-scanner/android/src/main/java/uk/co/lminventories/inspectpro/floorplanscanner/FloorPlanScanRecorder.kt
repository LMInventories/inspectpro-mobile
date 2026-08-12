package uk.co.lminventories.inspectpro.floorplanscanner

import android.content.Context
import android.util.Log
import com.google.ar.core.Frame
import com.google.ar.core.Pose
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

private const val TAG = "FloorPlanScanRecorder"

/**
 * Writes a scan's captured frames to local storage as it happens — the
 * "local scan package" from Phase 4 of docs/floor-plan/IMPLEMENTATION_PLAN.md.
 * Nothing is uploaded from here (Phase 5, not yet built); this only produces
 * the on-device package a future upload step will read.
 *
 * Package layout, under context.filesDir/floorplan-scans/{scanId}/ (internal
 * app storage, not cache — must survive until an upload step consumes it,
 * which doesn't exist yet):
 *   manifest.json   — scan metadata + per-frame pose/depth-file references
 *   depth/{n}.raw   — raw 16-bit depth buffer bytes for frames that had depth
 *
 * recordFrame() is called from FloorPlanRenderer on the GL thread. Per-frame
 * work there is limited to a fast ByteBuffer→ByteArray copy (so the ARCore
 * Image can be closed immediately, as required) — the actual file write
 * happens on a single background executor thread so the GL/render loop is
 * never blocked on disk I/O.
 */
class FloorPlanScanRecorder(context: Context, val scanId: String = UUID.randomUUID().toString()) {
  val scanDir: File = File(File(context.filesDir, "floorplan-scans"), scanId)
  private val depthDir = File(scanDir, "depth")
  private val executor = Executors.newSingleThreadExecutor()

  private val frames = JSONArray()
  private var intrinsicsRecorded = false
  private var frameCount = 0

  init {
    scanDir.mkdirs()
    depthDir.mkdirs()
  }

  /**
   * Captures one frame's pose, and depth if [depthBytes] is non-null. Safe to
   * call from the GL thread — the only synchronous work is a JSON object
   * append and dispatching to the background executor.
   */
  fun recordFrame(
    frame: Frame,
    timestampMs: Long,
    depthBytes: ByteArray?,
    depthWidth: Int,
    depthHeight: Int,
    depthRowStride: Int,
  ) {
    val index = frameCount++
    val pose = frame.camera.pose

    if (!intrinsicsRecorded) {
      intrinsicsRecorded = true
      recordIntrinsicsAsync(frame)
    }

    val frameJson = JSONObject().apply {
      put("index", index)
      put("timestampMs", timestampMs)
      put("pose", poseToJson(pose))
      if (depthBytes != null) {
        put("depthFile", "depth/$index.raw")
        put("depthWidth", depthWidth)
        put("depthHeight", depthHeight)
        put("depthRowStride", depthRowStride)
      }
    }
    frames.put(frameJson)

    if (depthBytes != null) {
      executor.execute {
        try {
          File(depthDir, "$index.raw").writeBytes(depthBytes)
        } catch (e: Exception) {
          Log.w(TAG, "Failed writing depth frame $index", e)
        }
      }
    }
  }

  private fun recordIntrinsicsAsync(frame: Frame) {
    try {
      val intrinsics = frame.camera.imageIntrinsics
      val focal = intrinsics.focalLength
      val principal = intrinsics.principalPoint
      val dims = intrinsics.imageDimensions
      val json = JSONObject().apply {
        put("focalLengthX", focal[0])
        put("focalLengthY", focal[1])
        put("principalPointX", principal[0])
        put("principalPointY", principal[1])
        put("imageWidth", dims[0])
        put("imageHeight", dims[1])
      }
      executor.execute {
        try {
          File(scanDir, "intrinsics.json").writeText(json.toString())
        } catch (e: Exception) {
          Log.w(TAG, "Failed writing intrinsics", e)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Camera intrinsics unavailable", e)
    }
  }

  private fun poseToJson(pose: Pose): JSONObject {
    val t = pose.translation
    val q = pose.rotationQuaternion
    return JSONObject().apply {
      put("tx", t[0]); put("ty", t[1]); put("tz", t[2])
      put("qx", q[0]); put("qy", q[1]); put("qz", q[2]); put("qw", q[3])
    }
  }

  /**
   * Writes manifest.json and shuts down the background executor, waiting for
   * any outstanding depth-file writes to finish first. Call exactly once,
   * when the scan ends (whether stopped normally or cancelled).
   *
   * Returns the frame count actually written — callers should treat 0 as
   * "nothing usable was captured" (e.g. tracking never succeeded) rather
   * than a hard error.
   */
  fun finalizeScan(): Int {
    executor.shutdown()
    try {
      executor.awaitTermination(10, java.util.concurrent.TimeUnit.SECONDS)
    } catch (e: InterruptedException) {
      Log.w(TAG, "Timed out waiting for depth writes to finish", e)
    }

    val manifest = JSONObject().apply {
      put("scanId", scanId)
      put("frameCount", frameCount)
      put("frames", frames)
    }
    try {
      File(scanDir, "manifest.json").writeText(manifest.toString())
    } catch (e: Exception) {
      Log.e(TAG, "Failed writing manifest.json", e)
    }
    return frameCount
  }

  /** Discards everything captured so far — used by cancelScan(). */
  fun discard() {
    executor.shutdownNow()
    scanDir.deleteRecursively()
  }
}
