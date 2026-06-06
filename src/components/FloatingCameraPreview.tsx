/**
 * FloatingCameraPreview
 *
 * Live camera preview + shutter button, rendered as an absolute overlay in
 * landscape mode when the clerk chooses "Floating with Preview" camera option.
 *
 * Layout (relative to the right edge of the main content area):
 *   - Shutter button: vertically aligned with the Record button in the sidebar
 *   - Preview: below the shutter, at the bottom-right of the content area
 *
 * Tap the preview to cycle zoom: 0.5× (wide) → 1× → 2× → 0.5× …
 * Presets are filtered to device capabilities so only valid levels appear.
 */
import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import {
  View, TouchableOpacity, StyleSheet, Text, Animated,
} from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import * as FileSystem from 'expo-file-system/legacy'
import { useIsFocused } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DICTATION_SIDEBAR_W } from './RoomDictationRecorder'

// Preview dimensions — landscape proportion to match the room orientation
const PREVIEW_W = 176
const PREVIEW_H = 132

// Shutter button — same diameter as the Record button in the sidebar (62px)
const SHUTTER_SIZE = 62

// Vertical gap between preview top and shutter bottom
const SHUTTER_GAP = 8

// Desired zoom presets — filtered at runtime to what the device supports
const DESIRED_ZOOMS = [0.5, 1, 2]

function fmtZoom(z: number): string {
  return z < 1 ? `${z.toFixed(1)}×` : `${Math.round(z)}×`
}

interface Props {
  inspectionId: number
  onCapture: (uri: string) => void
}

export default function FloatingCameraPreview({ inspectionId, onCapture }: Props) {
  const isFocused = useIsFocused()
  const insets    = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)
  const capturingRef = useRef(false)

  // Zoom cycling — presets clamped to device min/max
  const zoomPresets = useMemo(() => {
    if (!device) return [1]
    return DESIRED_ZOOMS
      .filter(z => z >= device.minZoom && z <= device.maxZoom)
      // always include at least minZoom and 1 so there's something to show
      .concat(device.minZoom < 1 ? [] : [])
      .filter((z, i, arr) => arr.indexOf(z) === i)
      .sort((a, b) => a - b)
  }, [device?.id])

  const [zoomIdx, setZoomIdx] = useState(() => {
    // Default to 1× if available, else the first (widest) preset
    const idx = DESIRED_ZOOMS.indexOf(1)
    return idx >= 0 ? idx : 0
  })

  const safeIdx = Math.min(zoomIdx, zoomPresets.length - 1)
  const zoom    = zoomPresets[safeIdx]

  function cycleZoom() {
    setZoomIdx(i => (i + 1) % zoomPresets.length)
  }

  // White flash on capture — same approach as CameraScreen
  const captureFlash = useRef(new Animated.Value(0)).current
  function triggerFlash() {
    captureFlash.stopAnimation()
    captureFlash.setValue(0)
    Animated.sequence([
      Animated.timing(captureFlash, { toValue: 0.6, duration: 20,  useNativeDriver: true }),
      Animated.timing(captureFlash, { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start()
  }

  // Shutter opacity feedback
  const shutterOpacity = useRef(new Animated.Value(1)).current
  function dimShutter() {
    shutterOpacity.stopAnimation()
    shutterOpacity.setValue(0.35)
    Animated.timing(shutterOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start()
  }

  // Pre-create photo directory on mount
  const photoDirRef = useRef('')
  useEffect(() => {
    const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
    photoDirRef.current = dir
    FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  }, [inspectionId])

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturingRef.current || !device || !photoDirRef.current) return
    capturingRef.current = true
    triggerFlash()
    dimShutter()
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
        skipMetadata: true,
      } as any)

      const srcUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`
      capturingRef.current = false

      const dest = `${photoDirRef.current}${Date.now()}_float.jpg`
      FileSystem.copyAsync({ from: srcUri, to: dest })
        .then(() => onCapture(dest))
        .catch(() => onCapture(srcUri))
    } catch (err) {
      console.error('[FloatingCamera] capture error', err)
      capturingRef.current = false
    }
  }, [device, onCapture])

  // Request permission if missing
  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission])

  const rightOffset = DICTATION_SIDEBAR_W + Math.max(insets.right, 0)

  if (!hasPermission || !device) {
    return (
      <View style={[styles.noPermWrap, { right: rightOffset }]}>
        <Text style={styles.noPermText}>{!hasPermission ? '📷 No camera permission' : '📷 Camera unavailable'}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { right: rightOffset }]} pointerEvents="box-none">
      {/* Shutter button — aligns vertically with sidebar Record button */}
      <Animated.View style={[styles.shutterWrap, { opacity: shutterOpacity }]}>
        <TouchableOpacity style={styles.shutter} onPressIn={handleCapture} activeOpacity={1}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      </Animated.View>

      {/* Live preview — tap to cycle zoom */}
      <TouchableOpacity
        style={styles.preview}
        onPress={cycleZoom}
        activeOpacity={0.85}
      >
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused}
          photo
          outputOrientation="device"
          zoom={zoom}
        />
        {/* Capture flash overlay */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: captureFlash }]}
        />
        {/* Zoom level badge — bottom-left corner */}
        <View style={styles.zoomBadge}>
          <Text style={styles.zoomBadgeText}>{fmtZoom(zoom)}</Text>
        </View>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  // Outer container — right is applied inline to include insets.right
  container: {
    position: 'absolute',
    bottom: 0,
    width: PREVIEW_W,
    alignItems: 'center',
    height: SHUTTER_SIZE + SHUTTER_GAP + PREVIEW_H,
  },

  // Shutter button — same size as Record (62x62), centered over preview
  shutterWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SHUTTER_GAP,
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  shutterInner: {
    width: SHUTTER_SIZE - 12,
    height: SHUTTER_SIZE - 12,
    borderRadius: (SHUTTER_SIZE - 12) / 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ddd',
  },

  // Live preview box
  preview: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
  },

  // Zoom level badge — bottom-left of preview
  zoomBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  zoomBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  noPermWrap: {
    position: 'absolute',
    bottom: 0,
    width: PREVIEW_W,
    height: SHUTTER_SIZE + SHUTTER_GAP + PREVIEW_H,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
  },
  noPermText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
})
