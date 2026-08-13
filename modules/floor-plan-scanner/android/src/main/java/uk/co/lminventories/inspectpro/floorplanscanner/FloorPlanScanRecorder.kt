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
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

private const val TAG = "FloorPlanScanRecorder"

/**
 * Writes a scan's captured frames to local storage as it happens — the
 * "local scan package" from Phase 4 of docs/floor-plan/IMPLEMENTATION_PLAN.md.
 * Nothing is uploaded from here — that's the caller's job (FloorPlanScreen.tsx
 * calling the Phase 5 backend endpoints in lmsoftware/backend/routes/floorplans.py)
 * once finalizeScan() hands back a ready-to-upload zipFile.
 *
 * Package layout while a scan is in progress, under
 * context.filesDir/floorplan-scans/{scanId}/ (internal app storage, not
 * cache — must survive until upload consumes it):
 *   manifest.json   — scan metadata + per-frame pose/depth-file references
 *   depth/{n}.raw   — raw 16-bit depth buffer bytes for frames that had depth
 * finalizeScan() zips this directory to {scanId}.zip and deletes the raw
 * copy — from that point on the zip is what exists on disk.
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

  /** Set by finalizeScan() once the package has been zipped. Null until then (or if zipping failed). */
  var zipFile: File? = null
    private set

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
      // textureIntrinsics (GPU texture), NOT imageIntrinsics (CPU image) —
      // confirmed against Google's own official raw-depth sample
      // (PointCloudHelper.convertRawDepthImagesTo3dPointBuffer in the
      // arcore-android-sdk repo), which backprojects depth pixels using
      // textureIntrinsics scaled per-axis to the depth image's own
      // resolution. Using imageIntrinsics here would silently produce a
      // wrong-but-plausible-looking point cloud.
      val intrinsics = frame.camera.textureIntrinsics
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
   * Writes manifest.json, zips the whole package, and shuts down the
   * background executor, waiting for any outstanding depth-file writes to
   * finish first. Call exactly once, when the scan ends normally (not for
   * cancellation — see discard()).
   *
   * Returns the frame count actually written — callers should treat 0 as
   * "nothing usable was captured" (e.g. tracking never succeeded) rather
   * than a hard error. Check zipFile afterward for the upload-ready package;
   * it stays null if zipping itself failed (frameCount can still be > 0 in
   * that case — the raw directory just wasn't cleaned up, so it's not lost).
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

    zipFile = try {
      zipScanDir()
    } catch (e: Exception) {
      Log.e(TAG, "Failed zipping scan package", e)
      null
    }

    return frameCount
  }

  /**
   * Compresses scanDir into {scanId}.zip alongside it (Phase 4's "compress
   * it" requirement), then deletes the raw directory — the zip is the only
   * copy kept from this point on, so upload doesn't duplicate on-device
   * storage while it's pending.
   */
  private fun zipScanDir(): File {
    val zip = File(scanDir.parentFile, "$scanId.zip")
    ZipOutputStream(zip.outputStream().buffered()).use { zos ->
      scanDir.walkTopDown().filter { it.isFile }.forEach { file ->
        val entryName = file.relativeTo(scanDir).path
        zos.putNextEntry(ZipEntry(entryName))
        file.inputStream().use { it.copyTo(zos) }
        zos.closeEntry()
      }
    }
    scanDir.deleteRecursively()
    return zip
  }

  /** Discards everything captured so far — used by cancelScan(). */
  fun discard() {
    executor.shutdownNow()
    scanDir.deleteRecursively()
    zipFile?.delete()
  }
}
