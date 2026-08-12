package uk.co.lminventories.inspectpro.floorplanscanner

import android.content.Context
import android.opengl.GLSurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Native camera-surface view backing the floor-plan scan screen. Mounting
 * this view does NOT start a scan by itself — JS calls
 * FloorPlanScanner.startScan() separately, which creates the ARCore Session
 * FloorPlanRenderer reads from via FloorPlanSessionHolder. Session creation
 * can fail for reasons (ARCore not installed, permission not granted) that
 * should surface as a rejected promise to JS, not a silently broken view, so
 * the view itself stays dumb — it just renders whatever session is current.
 */
class FloorPlanScanView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val glSurfaceView: GLSurfaceView = GLSurfaceView(context).apply {
    setEGLContextClientVersion(2)
    setRenderer(FloorPlanRenderer())
    renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
  }

  init {
    addView(glSurfaceView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    glSurfaceView.onResume()
  }

  override fun onDetachedFromWindow() {
    glSurfaceView.onPause()
    super.onDetachedFromWindow()
  }
}
