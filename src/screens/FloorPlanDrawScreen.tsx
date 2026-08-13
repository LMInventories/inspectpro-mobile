import React, { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert,
  ScrollView, Modal, Pressable, GestureResponderEvent,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import type { RouteProp } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import Svg, { Polygon as SvgPolygon, Circle as SvgCircle, SvgXml } from 'react-native-svg'
import type { RootStackParamList } from '../../App'
import Header from '../components/Header'
import { api } from '../services/api'
import {
  computePolygon, angleFromDiagonal, interiorAngleToTurnDeg,
  type WallEntry, type Point, type FloorPlanSymbol,
} from '../utils/floorPlanPolygon'
import { colors, font, spacing, radius } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'FloorPlanDraw'>
type Route = RouteProp<RootStackParamList, 'FloorPlanDraw'>

type RoomData = { id: number; name: string; corners: [number, number][]; symbols: FloorPlanSymbol[] }
type LevelData = { id: number; name: string; rooms: RoomData[] }

const CANVAS_SIZE = 320
const CANVAS_PADDING = 24
const ANGLE_PRESETS = [90, 45, 135]
const SYMBOL_DEFAULTS: Record<'door' | 'window' | 'stairs', number> = { door: 0.9, window: 1.2, stairs: 1.0 }

/**
 * Manual measure-and-draw floor plan tool v2 — multiple floors, each with
 * multiple independent rooms the inspector arranges by dragging into
 * place, plus door/window/stairs symbols. Replaces v1 (single room, no
 * floors, raw-degree angle entry) — see backend/models.py's
 * FloorPlanLevel/FloorPlanRoom and routes/floorplan_manual.py.
 *
 * Corner angles: entering a raw degree value isn't realistic in the field
 * (nobody carries a protractor), so this defaults every corner to 90 and
 * offers preset buttons (90/45/135) for quick adjustment, PLUS an optional
 * diagonal-measurement field — a plain length, same as any laser-measure
 * reading — that computes the exact angle via the law of cosines (see
 * utils/floorPlanPolygon.angleFromDiagonal). This is entered when adding
 * the SECOND wall of a corner (not the first), since the diagonal spans
 * from the start of the previous wall to the end of the current one — you
 * can't know that measurement until both walls exist.
 *
 * The live editing canvas renders simple room outlines + drag handles +
 * plain symbol markers (fast, interactive). The real architectural
 * rendering (door swing arcs, window ticks, stairs tread lines) comes from
 * the backend's render_level_svg, viewable via the "Preview" button —
 * deliberately not reimplemented client-side, so there's exactly one
 * source of truth for what the final plan actually looks like.
 */
export default function FloorPlanDrawScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const insets = useSafeAreaInsets()
  const { inspectionId } = route.params

  const [loading, setLoading] = useState(true)
  const [levels, setLevels] = useState<LevelData[]>([])
  const [activeLevelId, setActiveLevelId] = useState<number | null>(null)

  const [addFloorModal, setAddFloorModal] = useState(false)
  const [newFloorName, setNewFloorName] = useState('')
  const [copyFromLevelId, setCopyFromLevelId] = useState<number | null>(null)
  const [savingFloor, setSavingFloor] = useState(false)

  const [addingRoom, setAddingRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [walls, setWalls] = useState<WallEntry[]>([])
  const [lengthInput, setLengthInput] = useState('')
  const [diagonalInput, setDiagonalInput] = useState('')
  const [cornerPreset, setCornerPreset] = useState(90)
  const [savingRoom, setSavingRoom] = useState(false)

  const [armedSymbol, setArmedSymbol] = useState<'door' | 'window' | 'stairs' | null>(null)

  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    loadLevels()
  }, [])

  async function loadLevels() {
    setLoading(true)
    try {
      const res = await api.getFloorPlanLevels(inspectionId)
      const data: LevelData[] = res.data
      setLevels(data)
      if (data.length > 0 && activeLevelId === null) setActiveLevelId(data[0].id)
    } catch (err: any) {
      Alert.alert('Could not load floor plan', err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const activeLevel = levels.find((l) => l.id === activeLevelId) || null

  // ── Floors ──────────────────────────────────────────────────────────────
  async function handleAddFirstFloor() {
    setSavingFloor(true)
    try {
      const res = await api.createFloorPlanLevel(inspectionId, 'Ground Floor')
      setLevels((prev) => [...prev, { ...res.data, rooms: [] }])
      setActiveLevelId(res.data.id)
    } catch (err: any) {
      Alert.alert('Could not add floor', err.message || 'Unknown error')
    } finally {
      setSavingFloor(false)
    }
  }

  async function handleConfirmAddFloor() {
    const name = newFloorName.trim()
    if (!name) {
      Alert.alert('Enter a name', 'Give this floor a name, e.g. "1st Floor".')
      return
    }
    setSavingFloor(true)
    try {
      const res = await api.createFloorPlanLevel(inspectionId, name, copyFromLevelId ?? undefined)
      await loadLevels()
      setActiveLevelId(res.data.id)
      setAddFloorModal(false)
      setNewFloorName('')
      setCopyFromLevelId(null)
    } catch (err: any) {
      Alert.alert('Could not add floor', err.message || 'Unknown error')
    } finally {
      setSavingFloor(false)
    }
  }

  // ── Room entry (wall-by-wall, with optional diagonal angle correction) ──
  function startAddingRoom() {
    setAddingRoom(true)
    setRoomName('')
    setWalls([])
    setLengthInput('')
    setDiagonalInput('')
    setCornerPreset(90)
  }

  function handleAddWall() {
    const lengthM = parseFloat(lengthInput)
    if (!Number.isFinite(lengthM) || lengthM <= 0) {
      Alert.alert('Enter a wall length', 'Length must be a positive number of meters.')
      return
    }

    setWalls((prev) => {
      const next = [...prev]
      // Fix up the PREVIOUS wall's turnDeg now that we know this wall's
      // length too — the corner between them needed both lengths (and
      // optionally the diagonal) to be determined, see the diagonal note
      // in this screen's top-level doc comment.
      if (next.length >= 1) {
        const prevWall = next[next.length - 1]
        const diagonalM = parseFloat(diagonalInput)
        let turnDeg = interiorAngleToTurnDeg(cornerPreset)
        if (Number.isFinite(diagonalM) && diagonalM > 0) {
          const interior = angleFromDiagonal(prevWall.lengthM, lengthM, diagonalM)
          turnDeg = interiorAngleToTurnDeg(interior)
        }
        next[next.length - 1] = { ...prevWall, turnDeg }
      }
      next.push({ lengthM, turnDeg: interiorAngleToTurnDeg(90) }) // placeholder until the NEXT wall fixes it up
      return next
    })
    setLengthInput('')
    setDiagonalInput('')
    setCornerPreset(90)
  }

  function handleRemoveLastWall() {
    setWalls((prev) => prev.slice(0, -1))
  }

  function defaultRoomOffset(): Point {
    if (!activeLevel || activeLevel.rooms.length === 0) return { x: 0, z: 0 }
    const maxX = Math.max(...activeLevel.rooms.flatMap((r) => r.corners.map((c) => c[0])))
    return { x: maxX + 1.5, z: 0 }
  }

  async function handleFinishRoom() {
    if (walls.length < 3) {
      Alert.alert('Not enough walls', 'Enter at least 3 walls to form a room.')
      return
    }
    if (!activeLevel) return

    const rawPoints = computePolygon(walls).slice(0, -1)
    const offset = defaultRoomOffset()
    const corners: [number, number][] = rawPoints.map((p) => [p.x + offset.x, p.z + offset.z])

    setSavingRoom(true)
    try {
      const res = await api.createFloorPlanRoom(activeLevel.id, roomName.trim() || 'Room', corners, [])
      setLevels((prev) =>
        prev.map((l) => (l.id === activeLevel.id ? { ...l, rooms: [...l.rooms, res.data] } : l))
      )
      setAddingRoom(false)
    } catch (err: any) {
      Alert.alert('Could not save room', err.message || 'Unknown error')
    } finally {
      setSavingRoom(false)
    }
  }

  // ── Room dragging ────────────────────────────────────────────────────────
  function handleRoomMoved(roomId: number, deltaX: number, deltaZ: number) {
    if (!activeLevel) return
    setLevels((prev) =>
      prev.map((l) =>
        l.id !== activeLevel.id
          ? l
          : {
              ...l,
              rooms: l.rooms.map((r) =>
                r.id !== roomId
                  ? r
                  : { ...r, corners: r.corners.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number]) }
              ),
            }
      )
    )
  }

  async function persistRoomCorners(roomId: number) {
    const room = activeLevel?.rooms.find((r) => r.id === roomId)
    if (!room) return
    try {
      await api.updateFloorPlanRoom(roomId, { corners: room.corners })
    } catch (err: any) {
      Alert.alert('Could not save room position', err.message || 'Unknown error')
    }
  }

  // ── Symbol placement ─────────────────────────────────────────────────────
  const fit = activeLevel ? computeLevelFit(activeLevel.rooms) : null

  async function handleCanvasTap(evt: GestureResponderEvent) {
    if (!armedSymbol || !activeLevel || !fit) return
    const { locationX, locationY } = evt.nativeEvent
    const worldX = (locationX - fit.offsetX) / fit.scale
    const worldZ = (locationY - fit.offsetZ) / fit.scale

    if (armedSymbol === 'stairs') {
      const room = activeLevel.rooms.find((r) => pointInPolygon(worldX, worldZ, r.corners))
      if (!room) {
        Alert.alert('Tap inside a room', 'Stairs need to be placed inside a room, not on a wall.')
        return
      }
      const symbol: FloorPlanSymbol = {
        type: 'stairs', x: worldX, z: worldZ, rotationDeg: 0,
        lengthM: SYMBOL_DEFAULTS.stairs * 2.5, widthM: SYMBOL_DEFAULTS.stairs, direction: 'up',
      }
      await addSymbolToRoom(room, symbol)
    } else {
      const nearest = findNearestWall(activeLevel.rooms, worldX, worldZ)
      if (!nearest || nearest.distance > 0.6) {
        Alert.alert('Tap closer to a wall', `Doors and windows attach to a wall edge — tap directly on one.`)
        return
      }
      const symbol: FloorPlanSymbol = {
        type: armedSymbol, wallIndex: nearest.wallIndex, positionFraction: nearest.fraction,
        widthM: SYMBOL_DEFAULTS[armedSymbol],
      }
      await addSymbolToRoom(nearest.room, symbol)
    }
    setArmedSymbol(null)
  }

  async function addSymbolToRoom(room: RoomData, symbol: FloorPlanSymbol) {
    const updatedSymbols = [...room.symbols, symbol]
    try {
      await api.updateFloorPlanRoom(room.id, { symbols: updatedSymbols })
      setLevels((prev) =>
        prev.map((l) => ({
          ...l,
          rooms: l.rooms.map((r) => (r.id === room.id ? { ...r, symbols: updatedSymbols } : r)),
        }))
      )
    } catch (err: any) {
      Alert.alert('Could not place symbol', err.message || 'Unknown error')
    }
  }

  // ── Preview (real backend render) ────────────────────────────────────────
  async function handlePreview() {
    if (!activeLevel) return
    setPreviewLoading(true)
    try {
      const res = await api.getFloorPlanLevelRender(activeLevel.id)
      setPreviewSvg(res.data)
    } catch (err: any) {
      Alert.alert('Could not render preview', err.response?.status === 422
        ? 'Not enough geometry on this floor yet — add at least one room.'
        : (err.message || 'Unknown error'))
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Floor Plan" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : levels.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.statusText}>No floors yet.</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={handleAddFirstFloor} disabled={savingFloor}>
            {savingFloor
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnPrimaryText}>Add Ground Floor</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Level switcher */}
          <ScrollView horizontal style={styles.levelTabs} contentContainerStyle={styles.levelTabsContent}>
            {levels.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={[styles.levelTab, l.id === activeLevelId && styles.levelTabActive]}
                onPress={() => setActiveLevelId(l.id)}
              >
                <Text style={[styles.levelTabText, l.id === activeLevelId && styles.levelTabTextActive]}>
                  {l.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.levelTab} onPress={() => setAddFloorModal(true)}>
              <Text style={styles.levelTabText}>+ Floor</Text>
            </TouchableOpacity>
          </ScrollView>

          <ScrollView contentContainerStyle={styles.content}>
            {activeLevel && (
              <GestureHandlerRootView>
                <Pressable style={styles.canvasWrap} onPress={handleCanvasTap}>
                  <View style={styles.canvas}>
                    {activeLevel.rooms.length === 0 ? (
                      <Text style={styles.previewEmptyText}>Add a room to see it here</Text>
                    ) : fit ? (
                      <Svg width={CANVAS_SIZE} height={CANVAS_SIZE}>
                        {activeLevel.rooms.map((room) => (
                          <RoomShape
                            key={room.id}
                            room={room}
                            fit={fit}
                            draggable={armedSymbol === null}
                            onMove={(dx, dz) => handleRoomMoved(room.id, dx, dz)}
                            onMoveEnd={() => persistRoomCorners(room.id)}
                          />
                        ))}
                      </Svg>
                    ) : null}
                  </View>
                </Pressable>
              </GestureHandlerRootView>
            )}

            {armedSymbol && (
              <Text style={styles.armedHint}>
                {armedSymbol === 'stairs' ? 'Tap inside a room to place stairs' : `Tap a wall to place a ${armedSymbol}`}
              </Text>
            )}

            <View style={styles.symbolRow}>
              {(['door', 'window', 'stairs'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.symbolBtn, armedSymbol === t && styles.symbolBtnActive]}
                  onPress={() => setArmedSymbol((prev) => (prev === t ? null : t))}
                >
                  <Text style={[styles.symbolBtnText, armedSymbol === t && styles.symbolBtnTextActive]}>
                    {t === 'door' ? '🚪 Door' : t === 'window' ? '🪟 Window' : '🪜 Stairs'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!addingRoom ? (
              <TouchableOpacity style={styles.btnSecondary} onPress={startAddingRoom}>
                <Text style={styles.btnSecondaryText}>+ Add Room</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.roomEntryCard}>
                <Text style={styles.inputLabel}>Room name</Text>
                <TextInput
                  style={styles.input}
                  value={roomName}
                  onChangeText={setRoomName}
                  placeholder="e.g. Living Room"
                  placeholderTextColor={colors.textMid}
                />

                {walls.map((w, i) => (
                  <Text key={i} style={styles.wallRow}>Wall {i + 1}: {w.lengthM.toFixed(2)} m</Text>
                ))}

                <View style={styles.inputRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Wall length (m)</Text>
                    <TextInput
                      style={styles.input}
                      value={lengthInput}
                      onChangeText={setLengthInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 4.20"
                      placeholderTextColor={colors.textMid}
                    />
                  </View>
                </View>

                {walls.length >= 1 && (
                  <>
                    <Text style={styles.inputLabel}>Corner angle (previous wall to this one)</Text>
                    <View style={styles.presetRow}>
                      {ANGLE_PRESETS.map((p) => (
                        <TouchableOpacity
                          key={p}
                          style={[styles.presetBtn, cornerPreset === p && styles.presetBtnActive]}
                          onPress={() => setCornerPreset(p)}
                        >
                          <Text style={[styles.presetBtnText, cornerPreset === p && styles.presetBtnTextActive]}>
                            {p}°
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.inputLabel}>
                      Diagonal (m) — optional, overrides the preset with the exact angle
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={diagonalInput}
                      onChangeText={setDiagonalInput}
                      keyboardType="decimal-pad"
                      placeholder="Measure corner-to-corner if not square"
                      placeholderTextColor={colors.textMid}
                    />
                  </>
                )}

                <TouchableOpacity style={styles.btnPrimary} onPress={handleAddWall}>
                  <Text style={styles.btnPrimaryText}>Add Wall</Text>
                </TouchableOpacity>

                {walls.length > 0 && (
                  <TouchableOpacity style={styles.btnSecondary} onPress={handleRemoveLastWall}>
                    <Text style={styles.btnSecondaryText}>Remove Last Wall</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.roomEntryActions}>
                  <TouchableOpacity style={styles.btnSecondary} onPress={() => setAddingRoom(false)}>
                    <Text style={styles.btnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnPrimary, styles.finishBtn]}
                    onPress={handleFinishRoom}
                    disabled={savingRoom || walls.length < 3}
                  >
                    {savingRoom
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.btnPrimaryText}>Finish Room</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.btnSecondary} onPress={handlePreview} disabled={previewLoading}>
              {previewLoading
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={styles.btnSecondaryText}>Preview This Floor</Text>}
            </TouchableOpacity>

            {previewSvg && (
              <View style={styles.previewCard}>
                <SvgXml xml={previewSvg} width="100%" height={280} />
              </View>
            )}
          </ScrollView>
        </>
      )}

      {/* Add floor modal */}
      <Modal visible={addFloorModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Add Floor</Text>
            <TextInput
              style={styles.input}
              value={newFloorName}
              onChangeText={setNewFloorName}
              placeholder="e.g. 1st Floor"
              placeholderTextColor={colors.textMid}
              autoFocus
            />
            {levels.length > 0 && (
              <>
                <Text style={styles.inputLabel}>Start from (optional)</Text>
                <View style={styles.presetRow}>
                  <TouchableOpacity
                    style={[styles.presetBtn, copyFromLevelId === null && styles.presetBtnActive]}
                    onPress={() => setCopyFromLevelId(null)}
                  >
                    <Text style={[styles.presetBtnText, copyFromLevelId === null && styles.presetBtnTextActive]}>
                      Blank
                    </Text>
                  </TouchableOpacity>
                  {levels.map((l) => (
                    <TouchableOpacity
                      key={l.id}
                      style={[styles.presetBtn, copyFromLevelId === l.id && styles.presetBtnActive]}
                      onPress={() => setCopyFromLevelId(l.id)}
                    >
                      <Text style={[styles.presetBtnText, copyFromLevelId === l.id && styles.presetBtnTextActive]}>
                        Copy {l.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <View style={styles.roomEntryActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setAddFloorModal(false)}>
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnPrimary, styles.finishBtn]} onPress={handleConfirmAddFloor} disabled={savingFloor}>
                {savingFloor
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnPrimaryText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

type Fit = { scale: number; offsetX: number; offsetZ: number }

function computeLevelFit(rooms: RoomData[]): Fit | null {
  const allPoints = rooms.flatMap((r) => r.corners)
  if (allPoints.length === 0) return null
  const xs = allPoints.map((p) => p[0])
  const zs = allPoints.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const width = Math.max(maxX - minX, 0.1)
  const height = Math.max(maxZ - minZ, 0.1)
  const usable = CANVAS_SIZE - CANVAS_PADDING * 2
  const scale = Math.min(usable / width, usable / height)
  const offsetX = CANVAS_PADDING - minX * scale + (usable - width * scale) / 2
  const offsetZ = CANVAS_PADDING - minZ * scale + (usable - height * scale) / 2
  return { scale, offsetX, offsetZ }
}

function pointInPolygon(x: number, z: number, corners: [number, number][]): boolean {
  // standard ray-casting test
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, zi] = corners[i]
    const [xj, zj] = corners[j]
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function findNearestWall(
  rooms: RoomData[], worldX: number, worldZ: number
): { room: RoomData; wallIndex: number; fraction: number; distance: number } | null {
  let best: { room: RoomData; wallIndex: number; fraction: number; distance: number } | null = null
  for (const room of rooms) {
    const n = room.corners.length
    for (let i = 0; i < n; i++) {
      const [x1, z1] = room.corners[i]
      const [x2, z2] = room.corners[(i + 1) % n]
      const dx = x2 - x1, dz = z2 - z1
      const lenSq = dx * dx + dz * dz || 1e-9
      let t = ((worldX - x1) * dx + (worldZ - z1) * dz) / lenSq
      t = Math.max(0, Math.min(1, t))
      const px = x1 + t * dx, pz = z1 + t * dz
      const distance = Math.hypot(worldX - px, worldZ - pz)
      if (!best || distance < best.distance) {
        best = { room, wallIndex: i, fraction: t, distance }
      }
    }
  }
  return best
}

// ── RoomShape: one room's polygon + optional drag gesture ───────────────────

function RoomShape({
  room, fit, draggable, onMove, onMoveEnd,
}: {
  room: RoomData
  fit: Fit
  draggable: boolean
  onMove: (deltaWorldX: number, deltaWorldZ: number) => void
  onMoveEnd: () => void
}) {
  const lastRef = React.useRef({ x: 0, y: 0 })

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(draggable)
    .onBegin((e) => {
      lastRef.current = { x: e.x, y: e.y }
    })
    .onUpdate((e) => {
      const deltaPxX = e.x - lastRef.current.x
      const deltaPxZ = e.y - lastRef.current.y
      lastRef.current = { x: e.x, y: e.y }
      onMove(deltaPxX / fit.scale, deltaPxZ / fit.scale)
    })
    .onEnd(() => {
      onMoveEnd()
    })

  const svgPoints = room.corners.map(([x, z]) => `${x * fit.scale + fit.offsetX},${z * fit.scale + fit.offsetZ}`).join(' ')

  const content = (
    <>
      <SvgPolygon points={svgPoints} stroke={colors.primary} strokeWidth={2} fill="rgba(30,58,138,0.08)" />
      {room.symbols.map((sym, i) => {
        if (sym.type === 'stairs') {
          const cx = sym.x * fit.scale + fit.offsetX
          const cz = sym.z * fit.scale + fit.offsetZ
          return <SvgCircle key={i} cx={cx} cy={cz} r={5} fill="#d97706" />
        }
        const n = room.corners.length
        const [x1, z1] = room.corners[sym.wallIndex]
        const [x2, z2] = room.corners[(sym.wallIndex + 1) % n]
        const px = x1 + (x2 - x1) * sym.positionFraction
        const pz = z1 + (z2 - z1) * sym.positionFraction
        return (
          <SvgCircle
            key={i}
            cx={px * fit.scale + fit.offsetX}
            cy={pz * fit.scale + fit.offsetZ}
            r={5}
            fill={sym.type === 'door' ? '#1f5f8b' : '#10b981'}
          />
        )
      })}
    </>
  )

  if (!draggable) return content
  return <GestureDetector gesture={pan}>{content}</GestureDetector>
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.background },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.md },
  statusText: { fontSize: font.sm, color: colors.textMid, textAlign: 'center', lineHeight: 20 },

  levelTabs: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  levelTabsContent: { paddingHorizontal: spacing.md, gap: spacing.sm, alignItems: 'center' },
  levelTab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  levelTabActive: { backgroundColor: colors.primaryLight },
  levelTabText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  levelTabTextActive: { color: colors.primary },

  canvasWrap: { alignSelf: 'center' },
  canvas: {
    width: CANVAS_SIZE, height: CANVAS_SIZE,
    backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  previewEmptyText: { fontSize: font.sm, color: colors.textMid, textAlign: 'center', padding: spacing.lg },
  armedHint: { fontSize: font.sm, color: colors.primary, textAlign: 'center', fontWeight: '600' },

  symbolRow: { flexDirection: 'row', gap: spacing.sm },
  symbolBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  symbolBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  symbolBtnText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  symbolBtnTextActive: { color: colors.primary },

  roomEntryCard: {
    backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: spacing.sm,
  },
  wallRow: { fontSize: font.sm, color: colors.text },
  inputRow: { flexDirection: 'row', gap: spacing.md },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: font.xs, color: colors.textMid, marginTop: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: font.md, color: colors.text, backgroundColor: '#fff',
  },
  presetRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  presetBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border,
  },
  presetBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  presetBtnText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  presetBtnTextActive: { color: colors.primary },

  roomEntryActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },

  btnPrimary: {
    backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radius.md,
    alignItems: 'center', flex: 1,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  btnSecondary: {
    borderWidth: 1.5, borderColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.md, alignItems: 'center', flex: 1,
  },
  btnSecondaryText: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  finishBtn: { marginTop: 0 },

  previewCard: {
    backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalBox: {
    width: '85%', backgroundColor: '#fff', borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm,
  },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
})
