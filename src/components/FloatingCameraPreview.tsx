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
 * Tap the preview to cycle zoom: 0.6× (ultra-wide) → 1× → 2× → …
 * Device selection mirrors CameraScreen: Camera.getAvailableCameraDevices() is used
 * rather than useCameraDevice('back') so that separate ultra-wide physical cameras
 * are discoverable and switchable.
 */
import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import {
  View, TouchableOpacity, StyleSheet, Text, Animated,
} from 'react-native'
import { Camera, useCameraPermission } from 'react-native-vision-camera'
import type { CameraDevice } from 'react-native-vision-camera'
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

interface ZoomPreset {
  zoom: number
  label: string
  // true = this preset requires switching to the ultraWideDevice
  useUltraWide: boolean
}

interface Props {
  inspectionId: number
  onCapture: (uri: string) => void
}

export default function FloatingCameraPreview({ inspectionId, onCapture }: Props) {
  const isFocused = useIsFocused()
  const insets    = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const cameraRef    = useRef<Camera>(null)
  const capturingRef = useRef(false)
  // Bump to force Camera remount when switching between physical devices
  const [cameraKey, setCameraKey] = useState(0)

  // ── Device discovery — same approach as CameraScreen ──────────────────────
  // useCameraDevice('back') returns one "best" logical device and may omit the
  // ultra-wide entirely. Camera.getAvailableCameraDevices() returns ALL physical
  // devices so we can find and switch to a separate ultra-wide camera.
  const [allDevices, setAllDevices] = useState<CameraDevice[]>(() => {
    try { return Camera.getAvailableCameraDevices() } catch { return [] }
  })

  useEffect(() => {
    try { setAllDevices(Camera.getAvailableCameraDevices()) } catch {}
  }, [hasPermission])

  const backDevices: CameraDevice[] = allDevices.filter(d => d.position === 'back')

  // Main back camera: prefers the device whose physicalDevices includes
  // 'wide-angle-camera' but is not exclusively ultra-wide.
  const mainDevice: CameraDevice | undefined =
    backDevices.find(d =>
      d.physicalDevices?.includes('wide-angle-camera') &&
      !(d.physicalDevices ?? []).every(p => p === 'ultra-wide-angle-camera')
    ) ?? backDevices[0]

  // Ultra-wide device: a back-facing device that explicitly includes
  // 'ultra-wide-angle-camera'. Do NOT match 'wide-angle-camera' alone.
  const ultraWideDevice: CameraDevice | undefined = backDevices.find(d =>
    (d.physicalDevices ?? []).some(
      p => p === 'ultra-wide-angle-camera' || p.toLowerCase().includes('ultra')
    )
  )

  // Is ultra-wide a separate device, or reachable via zoom on the main device?
  const hasSeparateUltraWide =
    !!ultraWideDevice && !!mainDevice && ultraWideDevice.id !== mainDevice.id
  const hasZoomUltraWide =
    !!mainDevice && mainDevice.minZoom < mainDevice.neutralZoom * 0.85

  // ── Zoom presets ───────────────────────────────────────────────────────────
  const zoomPresets = useMemo((): ZoomPreset[] => {
    if (!mainDevice) return [{ zoom: 1, label: '1×', useUltraWide: false }]
    const presets: ZoomPreset[] = []

    if (hasSeparateUltraWide || hasZoomUltraWide) {
      presets.push({
        // For a separate device, zoom to its neutral (= 1× on that camera).
        // For zoom-based, use mainDevice.minZoom directly.
        zoom:         hasSeparateUltraWide
                        ? (ultraWideDevice?.neutralZoom ?? 1)
                        : mainDevice.minZoom,
        label:        '0.6×',
        useUltraWide: true,
      })
    }

    presets.push({ zoom: mainDevice.neutralZoom, label: '1×', useUltraWide: false })

    if (mainDevice.neutralZoom * 2 <= mainDevice.maxZoom) {
      presets.push({ zoom: mainDevice.neutralZoom * 2, label: '2×', useUltraWide: false })
    }

    return presets
  }, [mainDevice?.id, ultraWideDevice?.id, hasSeparateUltraWide, hasZoomUltraWide])

  const [zoomIdx, setZoomIdx] = useState(0)

  // Reset to 1× whenever the main device changes (covers initial mount too)
  useEffect(() => {
    const idx = zoomPresets.findIndex(p => p.label === '1×')
    setZoomIdx(idx >= 0 ? idx : 0)
  }, [mainDevice?.id])

  const currentPreset = zoomPresets[Math.min(zoomIdx, zoomPresets.length - 1)]

  // Which physical device to render
  const activeDevice: CameraDevice | undefined =
    currentPreset.useUltraWide && hasSeparateUltraWide ? ultraWideDevice : mainDevice

  // Zoom value to pass — for a separate UW device we always pass its neutral zoom
  const activeZoom =
    currentPreset.useUltraWide && hasSeparateUltraWide
      ? (ultraWideDevice?.neutralZoom ?? 1)
      : currentPreset.zoom

  function cycleZoom() {
    const nextIdx    = (zoomIdx + 1) % zoomPresets.length
    const nextPreset = zoomPresets[nextIdx]
    // Switching between separate physical devices requires a Camera remount
    const switchingDevice =
      (nextPreset.useUltraWide && hasSeparateUltraWide) !==
      (currentPreset.useUltraWide && hasSeparateUltraWide)
    if (switchingDevice) setCameraKey(k => k + 1)
    setZoomIdx(nextIdx)
  }

  // ── Visual feedback ────────────────────────────────────────────────────────
  const captureFlash = useRef(new Animated.Value(0)).current
  function triggerFlash() {
    captureFlash.stopAnimation()
    captureFlash.setValue(0)
    Animated.sequence([
      Animated.timing(captureFlash, { toValue: 0.6, duration: 20,  useNativeDriver: true }),
      Animated.timing(captureFlash, { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start()
  }

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
    if (!cameraRef.current || capturingRef.current || !activeDevice || !photoDirRef.current) return
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
  }, [activeDevice, onCapture])

  // Request permission if missing
  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission])

  const rightOffset = DICTATION_SIDEBAR_W + Math.max(insets.right, 0)

  if (!hasPermission || !activeDevice) {
    return (
      <View style={[styles.noPermWrap, { right: rightOffset }]}>
        <Text style={styles.noPermText}>
          {!hasPermission ? '📷 No camera permission' : '📷 Camera unavailable'}
        </Text>
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
          key={cameraKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={activeDevice}
          isActive={isFocused}
          photo
          outputOrientation="device"
          zoom={activeZoom}
        />
        {/* Capture flash overlay */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: captureFlash }]}
        />
        {/* Zoom level badge — bottom-left corner */}
        <View style={styles.zoomBadge}>
          <Text style={styles.zoomBadgeText}>{currentPreset.label}</Text>
        </View>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    width: PREVIEW_W,
    alignItems: 'center',
    height: SHUTTER_SIZE + SHUTTER_GAP + PREVIEW_H,
  },

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
