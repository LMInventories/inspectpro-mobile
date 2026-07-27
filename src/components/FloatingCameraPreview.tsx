/**
 * FloatingCameraPreview
 *
 * Live camera preview + shutter button, rendered as an absolute overlay in
 * landscape mode when the clerk chooses "Floating with Preview" camera option.
 *
 * Layout: preview on the left, shutter button vertically centred against the preview to
 * its right, with the flash toggle positioned directly below the shutter.
 * The whole widget is draggable — long-press-move or move-threshold drag repositions it.
 *
 * Zoom is selected via 0.6×/1×/2×/5× buttons on the right edge of the preview.
 */
import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import {
  View, TouchableOpacity, StyleSheet, Text, Animated,
  PanResponder, useWindowDimensions,
} from 'react-native'
import { Camera, useCameraPermission } from 'react-native-vision-camera'
import type { CameraDevice } from 'react-native-vision-camera'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import { useIsFocused } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DICTATION_SIDEBAR_W } from './RoomDictationRecorder'
import { useToastStore } from '../stores/toastStore'

// Preview dimensions — 50% larger than before
const PREVIEW_W = 462
const PREVIEW_H = 347

// Shutter button — same diameter as the Record button in the sidebar (62 px)
const SHUTTER_SIZE = 62

// Horizontal gap between preview right edge and shutter centre area
const SHUTTER_MARGIN = 14

// Total container size (row: preview + gap + shutter)
const CONTAINER_W = PREVIEW_W + SHUTTER_MARGIN + SHUTTER_SIZE
const CONTAINER_H = PREVIEW_H

interface ZoomPreset {
  zoom: number
  label: string
  useUltraWide: boolean
}

interface Props {
  inspectionId: number
  onCapture: (uri: string, fallback?: boolean) => void
}

function FloatingCameraPreview({ inspectionId, onCapture }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions()
  const isFocused    = useIsFocused()
  const insets       = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const cameraRef    = useRef<Camera>(null)
  const capturingRef = useRef(false)
  const [cameraKey, setCameraKey] = useState(0)

  // Pre-request MediaLibrary permission once at mount, mirroring CameraScreen —
  // floating-camera shots are saved to the device gallery too, not just the
  // app-private photo directory.
  const mlPermGranted = useRef(false)
  useEffect(() => {
    MediaLibrary.requestPermissionsAsync().then(p => {
      mlPermGranted.current = p.status === 'granted'
    })
  }, [])

  // Keep screen dims in refs so PanResponder closures always see current values
  const screenWRef = useRef(screenW)
  const screenHRef = useRef(screenH)
  useEffect(() => {
    screenWRef.current = screenW
    screenHRef.current = screenH
  }, [screenW, screenH])

  // ── Device discovery ───────────────────────────────────────────────────────
  const [allDevices, setAllDevices] = useState<CameraDevice[]>(() => {
    try { return Camera.getAvailableCameraDevices() } catch { return [] }
  })

  useEffect(() => {
    try { setAllDevices(Camera.getAvailableCameraDevices()) } catch {}
  }, [hasPermission])

  const backDevices: CameraDevice[] = allDevices.filter(d => d.position === 'back')

  const mainDevice: CameraDevice | undefined =
    backDevices.find(d =>
      d.physicalDevices?.includes('wide-angle-camera') &&
      !(d.physicalDevices ?? []).every(p => p === 'ultra-wide-angle-camera')
    ) ?? backDevices[0]

  const ultraWideDevice: CameraDevice | undefined = backDevices.find(d =>
    (d.physicalDevices ?? []).some(
      p => p === 'ultra-wide-angle-camera' || p.toLowerCase().includes('ultra')
    )
  )

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

    if (mainDevice.neutralZoom * 5 <= mainDevice.maxZoom) {
      presets.push({ zoom: mainDevice.neutralZoom * 5, label: '5×', useUltraWide: false })
    }

    return presets
  }, [mainDevice?.id, ultraWideDevice?.id, hasSeparateUltraWide, hasZoomUltraWide])

  const [zoomIdx, setZoomIdx] = useState(0)
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')

  function cycleFlash() {
    setFlashMode(m => m === 'off' ? 'on' : m === 'on' ? 'auto' : 'off')
  }

  useEffect(() => {
    const idx = zoomPresets.findIndex(p => p.label === '1×')
    setZoomIdx(idx >= 0 ? idx : 0)
  }, [mainDevice?.id])

  const currentPreset = zoomPresets[Math.min(zoomIdx, zoomPresets.length - 1)]

  const activeDevice: CameraDevice | undefined =
    currentPreset.useUltraWide && hasSeparateUltraWide ? ultraWideDevice : mainDevice

  const activeZoom =
    currentPreset.useUltraWide && hasSeparateUltraWide
      ? (ultraWideDevice?.neutralZoom ?? 1)
      : currentPreset.zoom

  function selectZoom(idx: number) {
    const nextPreset = zoomPresets[idx]
    const switchingDevice =
      (nextPreset.useUltraWide && hasSeparateUltraWide) !==
      (currentPreset.useUltraWide && hasSeparateUltraWide)
    if (switchingDevice) setCameraKey(k => k + 1)
    setZoomIdx(idx)
  }

  // ── Visual feedback ────────────────────────────────────────────────────────
  const captureFlash   = useRef(new Animated.Value(0)).current
  const shutterOpacity = useRef(new Animated.Value(1)).current

  function triggerFlash() {
    captureFlash.stopAnimation()
    captureFlash.setValue(0)
    Animated.sequence([
      Animated.timing(captureFlash, { toValue: 0.6, duration: 20,  useNativeDriver: true }),
      Animated.timing(captureFlash, { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start()
  }

  function dimShutter() {
    shutterOpacity.stopAnimation()
    shutterOpacity.setValue(0.35)
    Animated.timing(shutterOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start()
  }

  // ── Photo directory ────────────────────────────────────────────────────────
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
        flash: activeDevice?.hasFlash ? flashMode : 'off',
        enableShutterSound: false,
        skipMetadata: true,
      } as any)

      const rawPath = photo.path
      const srcUri = rawPath.startsWith('file://') || rawPath.startsWith('content://')
        ? rawPath
        : `file://${rawPath}`
      const dest = `${photoDirRef.current}${Date.now()}_float.jpg`

      // Save to the device gallery independently of the app-copy below, so the
      // photo isn't lost even if the app-private copy fails.
      if (mlPermGranted.current) {
        MediaLibrary.saveToLibraryAsync(srcUri).catch(e =>
          console.warn('[FloatingCamera] gallery save failed:', e)
        )
      }

      try {
        // Ensure directory exists — on some devices (e.g. Oppo/ColorOS) the async
        // makeDirectoryAsync in the useEffect may not have settled before the first capture.
        await FileSystem.makeDirectoryAsync(photoDirRef.current, { intermediates: true })
        await FileSystem.copyAsync({ from: srcUri, to: dest })
        onCapture(dest)
      } catch (copyErr) {
        // Copy failed (device-specific path/permission issue). Send to Room Overview so the
        // user still has the photo and can manually reassign — don't silently drop it.
        console.warn('[FloatingCamera] copy failed, routing to Room Overview', copyErr)
        onCapture(srcUri, true)
      }
    } catch (err) {
      console.error('[FloatingCamera] capture error', err)
      useToastStore.getState().showToast('Camera failed', 'error')
    } finally {
      capturingRef.current = false
    }
  }, [activeDevice, flashMode, onCapture])

  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission])

  // ── Drag / position ────────────────────────────────────────────────────────
  // Extra clearance beyond the sidebar's own width so the shutter button never
  // sits flush against (or overlaps) the dictation recorder's record button.
  const SIDEBAR_CLEARANCE = 40
  const rightOffset = DICTATION_SIDEBAR_W + Math.max(insets.right, 0) + SIDEBAR_CLEARANCE

  // Initialise at bottom-right, clear of the dictation sidebar
  const position = useRef(new Animated.ValueXY({
    x: screenW - CONTAINER_W - rightOffset,
    y: screenH - CONTAINER_H - Math.max(insets.bottom, 16),
  })).current

  const panResponder = useRef(
    PanResponder.create({
      // Don't steal taps — only activate on clear move
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderGrant: () => {
        position.setOffset({
          x: (position.x as any)._value,
          y: (position.y as any)._value,
        })
        position.setValue({ x: 0, y: 0 })
      },
      onPanResponderMove: Animated.event(
        [null, { dx: position.x, dy: position.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        position.flattenOffset()
        // Clamp so the widget stays fully on-screen
        const rawX = (position.x as any)._value
        const rawY = (position.y as any)._value
        const cX = Math.max(0, Math.min(rawX, screenWRef.current - CONTAINER_W))
        const cY = Math.max(0, Math.min(rawY, screenHRef.current - CONTAINER_H))
        if (cX !== rawX || cY !== rawY) {
          Animated.spring(position, {
            toValue: { x: cX, y: cY },
            useNativeDriver: false,
            bounciness: 4,
          }).start()
        }
      },
    })
  ).current

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!hasPermission || !activeDevice) {
    return (
      <Animated.View
        style={[styles.noPerm, { transform: position.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        <Text style={styles.noPermText}>
          {!hasPermission ? '📷 No camera permission' : '📷 Camera unavailable'}
        </Text>
      </Animated.View>
    )
  }

  return (
    <Animated.View
      style={[styles.container, { transform: position.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      {/* Live preview */}
      <View style={styles.preview}>
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
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: captureFlash }]}
        />

        {/* Zoom buttons — right edge of preview, highest zoom at top */}
        <View style={styles.zoomBtns}>
          {[...zoomPresets].reverse().map((preset) => {
            const idx = zoomPresets.indexOf(preset)
            return (
              <TouchableOpacity
                key={preset.label}
                style={[styles.zoomBtn, zoomIdx === idx && styles.zoomBtnActive]}
                onPress={() => selectZoom(idx)}
                activeOpacity={0.7}
              >
                <Text style={[styles.zoomBtnText, zoomIdx === idx && styles.zoomBtnTextActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {/* Shutter + flash toggle — right of preview. Shutter is centred against the
          preview's own height; the flash toggle sits directly below it, independent
          of the shutter's centring. */}
      <View style={styles.shutterArea}>
        <View style={styles.shutterCentered}>
          <Animated.View style={{ opacity: shutterOpacity }}>
            <TouchableOpacity style={styles.shutter} onPressIn={handleCapture} activeOpacity={1}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
          </Animated.View>
        </View>
        {activeDevice?.hasFlash && (
          <View style={styles.flashPositioned}>
            <TouchableOpacity
              style={[styles.flashBtn, flashMode !== 'off' && styles.flashBtnActive]}
              onPress={cycleFlash}
              activeOpacity={0.7}
            >
              <Text style={[styles.flashBtnText, flashMode !== 'off' && styles.flashBtnTextActive]}>
                {flashMode === 'off' ? '⚡ Off' : flashMode === 'on' ? '⚡ On' : '⚡ Auto'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CONTAINER_W,
    height: CONTAINER_H,
    flexDirection: 'row',
    alignItems: 'center',
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

  shutterArea: {
    width: SHUTTER_SIZE + SHUTTER_MARGIN,
    height: PREVIEW_H,
    position: 'relative',
  },
  // Centres the shutter against the preview's own height, independent of the
  // flash toggle below it.
  shutterCentered: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -(SHUTTER_SIZE / 2),
    alignItems: 'center',
  },
  // Anchored a fixed gap below the shutter's centre point — never affects,
  // or is affected by, the shutter's own centring.
  flashPositioned: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: SHUTTER_SIZE / 2 + 10,
    alignItems: 'center',
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

  flashBtn: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashBtnActive: {
    backgroundColor: 'rgba(255,220,0,0.85)',
  },
  flashBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  flashBtnTextActive: {
    color: '#111',
  },

  zoomBtns: {
    position: 'absolute',
    right: 7,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: 8,
  },
  zoomBtn: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
    minWidth: 42,
  },
  zoomBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  zoomBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  zoomBtnTextActive: {
    color: '#111',
  },

  noPerm: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CONTAINER_W,
    height: CONTAINER_H,
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

export default React.memo(FloatingCameraPreview)
