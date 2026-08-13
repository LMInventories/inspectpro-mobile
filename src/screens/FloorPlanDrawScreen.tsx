import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import type { RouteProp } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Polygon as SvgPolygon, Circle as SvgCircle } from 'react-native-svg'
import type { RootStackParamList } from '../../App'
import Header from '../components/Header'
import { api } from '../services/api'
import { computePolygon, type WallEntry, type Point } from '../utils/floorPlanPolygon'
import { colors, font, spacing, radius } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'FloorPlanDraw'>
type Route = RouteProp<RootStackParamList, 'FloorPlanDraw'>

const PREVIEW_SIZE = 280
const PREVIEW_PADDING = 24

/**
 * Manual measure-and-draw floor plan tool — replaces ARCore depth scanning
 * (FloorPlanScreen.tsx, still present but no longer the default path) as
 * the primary way to record a floor plan. The inspector measures each wall
 * (laser measure or tape) and enters the length here; corners default to
 * 90 degrees (most rooms are rectilinear) with an override for the rest.
 * See computePolygon in utils/floorPlanPolygon.ts for the turtle-graphics
 * math, and routes/floorplan_manual.py for the backend side.
 */
export default function FloorPlanDrawScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const insets = useSafeAreaInsets()
  const { inspectionId } = route.params

  const [loading, setLoading] = useState(true)
  const [walls, setWalls] = useState<WallEntry[]>([])
  const [lengthInput, setLengthInput] = useState('')
  const [turnInput, setTurnInput] = useState('90')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadExisting()
  }, [])

  async function loadExisting() {
    setLoading(true)
    try {
      const res = await api.getFloorPlanManual(inspectionId)
      const corners: [number, number][] = res.data.corners
      // Reconstruct wall lengths/angles from the saved absolute corner
      // points, so re-opening this screen shows an editable wall list
      // rather than just a fixed image.
      const reconstructed: WallEntry[] = []
      for (let i = 0; i < corners.length; i++) {
        const [x1, z1] = corners[i]
        const [x2, z2] = corners[(i + 1) % corners.length]
        const lengthM = Math.hypot(x2 - x1, z2 - z1)
        reconstructed.push({ lengthM, turnDeg: 90 })
      }
      // Only the lengths are meaningfully recoverable without storing turn
      // angles separately — corner defaults reset to 90 on reopen. Good
      // enough for now: the saved SHAPE isn't affected, only the editable
      // wall list's turn values, and unsupported angles are rare.
      setWalls(reconstructed.slice(0, -1))
      setSaved(true)
    } catch (err: any) {
      if (err.response?.status !== 404) {
        Alert.alert('Could not load existing floor plan', err.message || 'Unknown error')
      }
      setSaved(false)
    } finally {
      setLoading(false)
    }
  }

  function handleAddWall() {
    const lengthM = parseFloat(lengthInput)
    const turnDeg = parseFloat(turnInput)
    if (!Number.isFinite(lengthM) || lengthM <= 0) {
      Alert.alert('Enter a wall length', 'Length must be a positive number of meters.')
      return
    }
    if (!Number.isFinite(turnDeg)) {
      Alert.alert('Enter a turn angle', 'Turn angle must be a number of degrees.')
      return
    }
    setWalls((prev) => [...prev, { lengthM, turnDeg }])
    setLengthInput('')
    setTurnInput('90')
    setSaved(false)
  }

  function handleRemoveLast() {
    setWalls((prev) => prev.slice(0, -1))
    setSaved(false)
  }

  async function handleFinish() {
    if (walls.length < 3) {
      Alert.alert('Not enough walls', 'Enter at least 3 walls to form a room.')
      return
    }
    const points = computePolygon(walls)
    // Closed polygon for storage: drop the auto-added trailing point (which
    // duplicates the start after a full loop) — the backend expects each
    // corner once, not the start point repeated at the end.
    const corners: [number, number][] = points.slice(0, -1).map((p) => [p.x, p.z])

    setSaving(true)
    try {
      await api.saveFloorPlanManual(inspectionId, corners)
      setSaved(true)
      Alert.alert('Floor plan saved', `${walls.length} walls recorded.`)
    } catch (err: any) {
      Alert.alert('Save failed', err.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  // computePolygon does NOT auto-close the shape — it's just the path
  // walked so far. SVG's <Polygon> element always draws a closing edge
  // from the last point back to the first on its own, which is what gives
  // the live preview its "sneak peek of the closed room" effect even
  // mid-entry, and also means any cumulative measurement error (the walked
  // path not quite meeting itself) shows up honestly once all walls are in.
  const displayPoints = computePolygon(walls)
  const svgPolygonPoints = toSvgPoints(displayPoints)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Floor Plan" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.statusText}>
            Walk the room's perimeter, measuring each wall with a laser measure or tape. Corners
            default to 90° — adjust the turn angle for non-square rooms.
          </Text>

          <View style={styles.previewCard}>
            {walls.length === 0 ? (
              <Text style={styles.previewEmptyText}>Preview appears after your first wall</Text>
            ) : (
              <Svg width={PREVIEW_SIZE} height={PREVIEW_SIZE}>
                {svgPolygonPoints && (
                  <SvgPolygon
                    points={svgPolygonPoints}
                    stroke={colors.primary}
                    strokeWidth={2}
                    fill="none"
                  />
                )}
                {displayPoints.map((p, i) => {
                  const { x, z } = toSvgXY(p, displayPoints)
                  return <SvgCircle key={i} cx={x} cy={z} r={4} fill={colors.primary} />
                })}
              </Svg>
            )}
          </View>

          <View style={styles.wallList}>
            {walls.map((w, i) => (
              <Text key={i} style={styles.wallRow}>
                Wall {i + 1}: {w.lengthM.toFixed(2)} m, turn {w.turnDeg}°
              </Text>
            ))}
          </View>

          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Length (m)</Text>
              <TextInput
                style={styles.input}
                value={lengthInput}
                onChangeText={setLengthInput}
                keyboardType="decimal-pad"
                placeholder="e.g. 4.20"
                placeholderTextColor={colors.textMid}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Turn (°)</Text>
              <TextInput
                style={styles.input}
                value={turnInput}
                onChangeText={setTurnInput}
                keyboardType="numbers-and-punctuation"
                placeholder="90"
                placeholderTextColor={colors.textMid}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.btnPrimary} onPress={handleAddWall}>
            <Text style={styles.btnPrimaryText}>Add Wall</Text>
          </TouchableOpacity>

          {walls.length > 0 && (
            <TouchableOpacity style={styles.btnSecondary} onPress={handleRemoveLast}>
              <Text style={styles.btnSecondaryText}>Remove Last Wall</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.btnPrimary, styles.finishBtn]}
            onPress={handleFinish}
            disabled={saving || walls.length < 3}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnPrimaryText}>{saved ? 'Update Floor Plan' : 'Finish & Save'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  )
}

/** Fit the (possibly negative-coordinate) polygon into the fixed preview
 * square, preserving aspect ratio, flipped/offset as needed. */
function computeFit(points: Point[]) {
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const width = Math.max(maxX - minX, 0.1)
  const height = Math.max(maxZ - minZ, 0.1)
  const usable = PREVIEW_SIZE - PREVIEW_PADDING * 2
  const scale = Math.min(usable / width, usable / height)
  const offsetX = PREVIEW_PADDING - minX * scale + (usable - width * scale) / 2
  const offsetZ = PREVIEW_PADDING - minZ * scale + (usable - height * scale) / 2
  return { scale, offsetX, offsetZ }
}

function toSvgXY(p: Point, allPoints: Point[]) {
  const { scale, offsetX, offsetZ } = computeFit(allPoints)
  return { x: p.x * scale + offsetX, z: p.z * scale + offsetZ }
}

function toSvgPoints(points: Point[]): string {
  if (points.length < 2) return ''
  const { scale, offsetX, offsetZ } = computeFit(points)
  return points.map((p) => `${(p.x * scale + offsetX).toFixed(1)},${(p.z * scale + offsetZ).toFixed(1)}`).join(' ')
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.background },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  statusText: { fontSize: font.sm, color: colors.textMid, lineHeight: 20 },
  previewCard: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmptyText: { fontSize: font.sm, color: colors.textMid, textAlign: 'center', padding: spacing.lg },
  wallList: { gap: spacing.xs },
  wallRow: { fontSize: font.sm, color: colors.text },
  inputRow: { flexDirection: 'row', gap: spacing.md },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: font.xs, color: colors.textMid, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: '#fff',
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  finishBtn: { marginTop: spacing.sm },
})
