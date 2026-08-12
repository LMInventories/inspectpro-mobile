package uk.co.lminventories.inspectpro.floorplanscanner

import android.opengl.GLES11Ext
import android.opengl.GLES20
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

private const val VERTEX_SHADER = """
  attribute vec4 a_Position;
  attribute vec2 a_TexCoord;
  varying vec2 v_TexCoord;
  void main() {
    gl_Position = a_Position;
    v_TexCoord = a_TexCoord;
  }
"""

private const val FRAGMENT_SHADER = """
  #extension GL_OES_EGL_image_external : require
  precision mediump float;
  varying vec2 v_TexCoord;
  uniform samplerExternalOES sTexture;
  void main() {
    gl_FragColor = texture2D(sTexture, v_TexCoord);
  }
"""

// Full-screen quad in OpenGL normalized device coordinates, as a triangle
// strip: bottom-left, bottom-right, top-left, top-right.
private val QUAD_COORDS = floatArrayOf(
  -1f, -1f,
   1f, -1f,
  -1f,  1f,
   1f,  1f,
)

/**
 * Draws the ARCore camera feed to the screen each frame — without this, the
 * scan screen just shows whatever glClearColor() was set to (black), which is
 * what the previous increment shipped (data capture only, no camera passthrough
 * — this was a deliberate scope cut, not an oversight, but not appropriate to
 * ship as the final scanning UX either).
 *
 * Standard ARCore sample pattern: a full-screen quad textured with the
 * external OES camera texture, with texture coordinates re-derived from
 * frame.transformCoordinates2d() whenever the display geometry changes
 * (rotation, aspect ratio) rather than assumed fixed.
 */
class BackgroundRenderer {
  var textureId = -1
    private set

  private var program = 0
  private var positionAttrib = 0
  private var texCoordAttrib = 0
  private var textureUniform = 0

  private val quadCoords: FloatBuffer = ByteBuffer.allocateDirect(QUAD_COORDS.size * 4)
    .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(QUAD_COORDS); position(0) }

  // Initial values are a placeholder identity mapping — overwritten every
  // frame in draw() via transformCoordinates2d() once display geometry is known.
  private val quadTexCoords: FloatBuffer = ByteBuffer.allocateDirect(QUAD_COORDS.size * 4)
    .order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
      put(floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)); position(0)
    }

  /** Must be called on the GL thread, once, when the surface is created. */
  fun createOnGlThread() {
    textureId = createExternalTexture()

    val vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
    val fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)

    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program, vertexShader)
    GLES20.glAttachShader(program, fragmentShader)
    GLES20.glLinkProgram(program)

    val linkStatus = IntArray(1)
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0)
    if (linkStatus[0] != GLES20.GL_TRUE) {
      val log = GLES20.glGetProgramInfoLog(program)
      GLES20.glDeleteProgram(program)
      throw IllegalStateException("BackgroundRenderer program link failed: $log")
    }

    positionAttrib = GLES20.glGetAttribLocation(program, "a_Position")
    texCoordAttrib = GLES20.glGetAttribLocation(program, "a_TexCoord")
    textureUniform = GLES20.glGetUniformLocation(program, "sTexture")
  }

  /** Must be called on the GL thread, once per frame, after session.update(). */
  fun draw(frame: Frame) {
    if (program == 0 || textureId == -1) return

    if (frame.hasDisplayGeometryChanged()) {
      frame.transformCoordinates2d(
        Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quadCoords,
        Coordinates2d.TEXTURE_NORMALIZED, quadTexCoords
      )
    }

    GLES20.glDisable(GLES20.GL_DEPTH_TEST)
    GLES20.glDepthMask(false)

    GLES20.glUseProgram(program)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glUniform1i(textureUniform, 0)

    quadCoords.position(0)
    GLES20.glVertexAttribPointer(positionAttrib, 2, GLES20.GL_FLOAT, false, 0, quadCoords)
    GLES20.glEnableVertexAttribArray(positionAttrib)

    quadTexCoords.position(0)
    GLES20.glVertexAttribPointer(texCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords)
    GLES20.glEnableVertexAttribArray(texCoordAttrib)

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

    GLES20.glDisableVertexAttribArray(positionAttrib)
    GLES20.glDisableVertexAttribArray(texCoordAttrib)
    GLES20.glDepthMask(true)
    GLES20.glEnable(GLES20.GL_DEPTH_TEST)
  }

  private fun compileShader(type: Int, source: String): Int {
    val shader = GLES20.glCreateShader(type)
    GLES20.glShaderSource(shader, source)
    GLES20.glCompileShader(shader)
    val compiled = IntArray(1)
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
    if (compiled[0] == 0) {
      val log = GLES20.glGetShaderInfoLog(shader)
      GLES20.glDeleteShader(shader)
      throw IllegalStateException("Shader compile failed (type=$type): $log")
    }
    return shader
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
