import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import type { RouteProp } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RootStackParamList } from '../../App'
import Header from '../components/Header'
import FloorPlanScanner from '../../modules/floor-plan-scanner'
import type { ArCoreAvailability } from '../../modules/floor-plan-scanner'
import { colors, font, spacing, radius } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'FloorPlan'>
type Route = RouteProp<RootStackParamList, 'FloorPlan'>

/**
 * Milestone 1 entry point — checks and surfaces ARCore device support
 * (Phase 2 of docs/floor-plan/IMPLEMENTATION_PLAN.md: "Check camera
 * permission, ARCore availability, depth capability and storage... Gracefully
 * handle unsupported devices"). Scanning itself is not implemented yet —
 * FloorPlanScanner.startScan() always rejects; "Start Scan" here is a
 * placeholder so the real screen shape exists ahead of that work.
 */
export default function FloorPlanScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const insets = useSafeAreaInsets()
  void route.params.inspectionId // not yet used — will key the saved FloorPlan record (Milestone 9)

  const [checking, setChecking] = useState(true)
  const [availability, setAvailability] = useState<ArCoreAvailability | null>(null)
  const [installing, setInstalling] = useState(false)
  const [checkError, setCheckError] = useState('')

  useEffect(() => {
    runCheck()
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

  function handleStartScan() {
    Alert.alert(
      'Coming soon',
      'Floor plan scanning is still in development — this screen currently only checks device support.'
    )
  }

  const supported    = availability === 'SUPPORTED_INSTALLED'
  const needsInstall  = availability === 'SUPPORTED_NOT_INSTALLED' || availability === 'SUPPORTED_APK_TOO_OLD'
  const unsupported   = availability === 'UNSUPPORTED_DEVICE_NOT_CAPABLE'

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Floor Plan" onBack={() => navigation.goBack()} />

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
              Scanning itself isn't built yet — this screen currently only confirms device
              support ahead of that work.
            </Text>
            <TouchableOpacity style={styles.btnSecondary} onPress={handleStartScan}>
              <Text style={styles.btnSecondaryText}>Start Scan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.statusText}>Unexpected result: {String(availability)}</Text>
          </View>
        )}
      </View>
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
})
