import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import type { RouteProp } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCameraPermission } from 'react-native-vision-camera'
import type { RootStackParamList } from '../../App'
import Header from '../components/Header'
import FloorPlanScanner, { FloorPlanScanNativeView } from '../../modules/floor-plan-scanner'
import type { ArCoreAvailability, TrackingState } from '../../modules/floor-plan-scanner'
import { colors, font, spacing, radius } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'FloorPlan'>
type Route = RouteProp<RootStackParamList, 'FloorPlan'>

/**
 * Milestone 1 — ARCore capability check (Phase 2, verified working: CI
 * build eb6c578) plus the real scan lifecycle (Session/GL renderer, added
 * after that — NOT yet verified on a device, see FloorPlanScannerModule.kt's
 * class doc for exactly what "compiles" does and doesn't prove here).
 *
 * There is no floor-plan output yet — geometry reconstruction (Milestone 2)
 * and beyond aren't built. This screen currently only proves the capture
 * pipeline runs: tracking state and a live wall count from ARCore's plane
 * detection, while a scan is active.
 */
export default function FloorPlanScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const insets = useSafeAreaInsets()
  void route.params.inspectionId // not yet used — will key the saved FloorPlan record (Milestone 9)

  const { hasPermission, requestPermission } = useCameraPermission()

  const [checking, setChecking] = useState(true)
  const [availability, setAvailability] = useState<ArCoreAvailability | null>(null)
  const [installing, setInstalling] = useState(false)
  const [checkError, setCheckError] = useState('')

  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [trackingState, setTrackingState] = useState<TrackingState | null>(null)
  const [trackingReason, setTrackingReason] = useState<string | undefined>(undefined)
  const [wallsDetected, setWallsDetected] = useState(0)
  const [scanError, setScanError] = useState('')

  useEffect(() => {
    runCheck()
  }, [])

  // Subscribe once; scanning state itself doesn't change which listeners are
  // attached, only whether the native session emitting them is alive.
  useEffect(() => {
    const subs = [
      FloorPlanScanner.addListener('onTrackingStateChanged', (e) => {
        setTrackingState(e.state)
        setTrackingReason(e.reason)
      }),
      FloorPlanScanner.addListener('onScanProgress', (e) => {
        setWallsDetected(e.wallsDetected)
      }),
      FloorPlanScanner.addListener('onScanFailed', (e) => {
        setScanError(e.message)
        setScanning(false)
      }),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      // Safety net: if this screen unmounts mid-scan (e.g. back button),
      // make sure the native Session doesn't keep the camera held open.
      FloorPlanScanner.stopScan()
    }
  }, [])

  async function runCheck() {
    setChecking(true)
    setCheckError('')
    try {
      const result = await FloorPlanScanner.checkAvailability()
      setAvailability(result)
    } catch (err: any) {
      setCheckError(err.message || 'Could not check ARCore availability')
    } finally {
      setChecking(false)
    }
  }

  async function handleInstall() {
    setInstalling(true)
    try {
      await FloorPlanScanner.requestInstall()
      // The Play Store install/update flow takes over the foreground — by the
      // time control returns here the app has been backgrounded and resumed,
      // so re-check rather than assuming success.
      await runCheck()
    } catch (err: any) {
      Alert.alert('Install failed', err.message || 'Could not open Google Play Services for AR install')
    } finally {
      setInstalling(false)
    }
  }

  async function handleStartScan() {
    if (!hasPermission) {
      const granted = await requestPermission()
      if (!granted) {
        Alert.alert('Camera permission needed', 'Floor plan scanning needs camera access to work.')
        return
      }
    }

    setStarting(true)
    setScanError('')
    setTrackingState(null)
    setWallsDetected(0)
    setScanning(true) // mounts the native GL view before startScan() so its
                       // surface exists by the time the session needs a texture
    try {
      await FloorPlanScanner.startScan()
    } catch (err: any) {
      setScanning(false)
      Alert.alert('Couldn\'t start scan', err.message || 'Unknown error')
    } finally {
      setStarting(false)
    }
  }

  async function handleStopScan() {
    FloorPlanScanner.stopScan()
    setScanning(false)
    setTrackingState(null)
  }

  const supported    = availability === 'SUPPORTED_INSTALLED'
  const needsInstall  = availability === 'SUPPORTED_NOT_INSTALLED' || availability === 'SUPPORTED_APK_TOO_OLD'
  const unsupported   = availability === 'UNSUPPORTED_DEVICE_NOT_CAPABLE'

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Floor Plan" onBack={() => navigation.goBack()} />

      {scanning ? (
        <View style={styles.scanArea}>
          <FloorPlanScanNativeView style={styles.scanView} />
          <View style={styles.scanOverlay}>
            <Text style={styles.scanOverlayText}>
              {trackingState === 'TRACKING'
                ? '✓ Tracking'
                : trackingState === 'LIMITED'
                  ? `⚠ Limited tracking${trackingReason ? ` — ${trackingReason}` : ''}`
                  : 'Starting…'}
            </Text>
            <Text style={styles.scanOverlayText}>Walls detected: {wallsDetected}</Text>
            {scanError ? <Text style={styles.scanOverlayError}>{scanError}</Text> : null}
          </View>
          <TouchableOpacity style={[styles.btnSecondary, styles.stopBtn]} onPress={handleStopScan}>
            <Text style={styles.btnSecondaryText}>Stop Scan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          {checking ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.statusText}>Checking device support…</Text>
            </View>
          ) : checkError ? (
            <View style={styles.center}>
              <Text style={styles.statusIcon}>⚠️</Text>
              <Text style={styles.statusTitle}>Couldn't check device support</Text>
              <Text style={styles.statusText}>{checkError}</Text>
              <TouchableOpacity style={styles.btnSecondary} onPress={runCheck}>
                <Text style={styles.btnSecondaryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : unsupported ? (
            <View style={styles.center}>
              <Text style={styles.statusIcon}>📵</Text>
              <Text style={styles.statusTitle}>Not supported on this device</Text>
              <Text style={styles.statusText}>
                Floor plan scanning needs ARCore, which this device doesn't support. You can still
                complete the rest of the inspection as normal.
              </Text>
            </View>
          ) : needsInstall ? (
            <View style={styles.center}>
              <Text style={styles.statusIcon}>⬇️</Text>
              <Text style={styles.statusTitle}>Google Play Services for AR required</Text>
              <Text style={styles.statusText}>
                This device supports floor plan scanning, but needs Google Play Services for AR
                installed or updated first.
              </Text>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleInstall} disabled={installing}>
                {installing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnPrimaryText}>Install / Update</Text>}
              </TouchableOpacity>
            </View>
          ) : supported ? (
            <View style={styles.center}>
              <Text style={styles.statusIcon}>✓</Text>
              <Text style={styles.statusTitle}>This device supports floor plan scanning</Text>
              <Text style={styles.statusText}>
                There's no floor-plan output yet — this confirms the capture pipeline runs
                (tracking + wall detection) ahead of geometry reconstruction being built.
              </Text>
              {scanError ? <Text style={styles.statusTextError}>{scanError}</Text> : null}
              <TouchableOpacity style={styles.btnSecondary} onPress={handleStartScan} disabled={starting}>
                {starting
                  ? <ActivityIndicator color={colors.primary} />
                  : <Text style={styles.btnSecondaryText}>Start Scan</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.statusText}>Unexpected result: {String(availability)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  center:  { alignItems: 'center', gap: spacing.md },
  statusIcon:  { fontSize: 40 },
  statusTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  statusText:  { fontSize: font.sm, color: colors.textMid, textAlign: 'center', lineHeight: 20 },
  statusTextError: { fontSize: font.sm, color: colors.danger, textAlign: 'center' },
  btnPrimary: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    minWidth: 200,
    marginTop: spacing.sm,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    minWidth: 200,
    marginTop: spacing.sm,
  },
  btnSecondaryText: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  scanArea: { flex: 1 },
  scanView: { flex: 1, backgroundColor: '#000' },
  scanOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  scanOverlayText: { color: '#fff', fontSize: font.md, fontWeight: '600' },
  scanOverlayError: { color: '#fca5a5', fontSize: font.sm, marginTop: spacing.xs },
  stopBtn: {
    position: 'absolute',
    bottom: spacing.lg,
    alignSelf: 'center',
    backgroundColor: colors.surface,
  },
})
