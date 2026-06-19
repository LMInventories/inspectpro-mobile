import React, { useState, useRef, useEffect } from 'react'
import {
  View, Modal, TouchableOpacity, Text, StyleSheet,
  Image, useWindowDimensions, ActivityIndicator, Alert,
} from 'react-native'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path, Line as SvgLine, Rect as SvgRect, Circle as SvgCircle } from 'react-native-svg'
import { captureRef } from 'react-native-view-shot'
import * as FileSystem from 'expo-file-system/legacy'
import { colors, font, radius, spacing } from '../utils/theme'

type DrawTool = 'freehand' | 'line' | 'rect' | 'circle'

const PALETTE = ['#FF3B30', '#FF9F0A', '#FFD60A', '#FFFFFF', '#000000']
const STROKES = [3, 6, 12]

interface Point { x: number; y: number }

interface FreeShape { type: 'freehand'; d: string;                                        color: string; sw: number }
interface LineShape { type: 'line';     x1: number; y1: number; x2: number; y2: number;  color: string; sw: number }
interface RectShape { type: 'rect';     x: number;  y: number;  w: number;  h: number;   color: string; sw: number }
interface OvalShape { type: 'circle';   cx: number; cy: number; r: number;                color: string; sw: number }
type Shape = FreeShape | LineShape | RectShape | OvalShape

interface ActiveDraw { tool: DrawTool; start: Point; cur: Point; freeD: string }

interface Props {
  visible:      boolean
  photoUri:     string
  inspectionId: string
  onSave:       (newUri: string) => void
  onDismiss:    () => void
}

export default function AnnotateModal({ visible, photoUri, inspectionId, onSave, onDismiss }: Props) {
  const { width: sw, height: sh } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const [tool,    setTool]    = useState<DrawTool>('freehand')
  const [color,   setColor]   = useState(PALETTE[0])
  const [stroke,  setStroke]  = useState(STROKES[1])
  const [shapes,  setShapes]  = useState<Shape[]>([])
  const [active,  setActive]  = useState<ActiveDraw | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [imgSize, setImgSize] = useState<Point | null>(null)

  const canvasRef  = useRef<View>(null)
  const startRef   = useRef<Point>({ x: 0, y: 0 })
  const curRef     = useRef<Point>({ x: 0, y: 0 })
  const freeDRef   = useRef('')
  // Refs mirror state so gesture callbacks (which capture via closure on first render) always read fresh values
  const toolRef    = useRef<DrawTool>('freehand')
  const colorRef   = useRef(PALETTE[0])
  const strokeRef  = useRef(STROKES[1])
  toolRef.current   = tool
  colorRef.current  = color
  strokeRef.current = stroke

  useEffect(() => {
    if (!visible) return
    setShapes([])
    setActive(null)
    setImgSize(null)
    Image.getSize(photoUri, (w, h) => setImgSize({ x: w, y: h }), () => {})
  }, [visible, photoUri])

  // Fit image inside available area (below header + above toolbar)
  const HEADER_H  = 50
  const TOOLBAR_H = 100
  const availW = sw
  const availH = sh - HEADER_H - TOOLBAR_H - insets.top - insets.bottom

  let canvasW = availW
  let canvasH = availH
  if (imgSize) {
    const ratio = imgSize.x / imgSize.y
    if (availW / availH > ratio) {
      canvasH = availH
      canvasW = availH * ratio
    } else {
      canvasW = availW
      canvasH = availW / ratio
    }
  }

  // ── Gesture ──────────────────────────────────────────────────────────────
  const drawGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(e => {
      const p = { x: e.x, y: e.y }
      startRef.current = p
      curRef.current   = p
      freeDRef.current = `M${p.x.toFixed(1)},${p.y.toFixed(1)}`
      setActive({ tool: toolRef.current, start: p, cur: p, freeD: freeDRef.current })
    })
    .onUpdate(e => {
      const p = { x: e.x, y: e.y }
      curRef.current = p
      if (toolRef.current === 'freehand') {
        freeDRef.current += ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`
      }
      setActive({ tool: toolRef.current, start: startRef.current, cur: p, freeD: freeDRef.current })
    })
    .onEnd(() => {
      const s = startRef.current
      const c = curRef.current
      const t = toolRef.current
      const col = colorRef.current
      const sw2 = strokeRef.current
      let shape: Shape | null = null

      if (t === 'freehand' && freeDRef.current) {
        shape = { type: 'freehand', d: freeDRef.current, color: col, sw: sw2 }
      } else if (t === 'line') {
        shape = { type: 'line', x1: s.x, y1: s.y, x2: c.x, y2: c.y, color: col, sw: sw2 }
      } else if (t === 'rect') {
        const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y)
        const w = Math.abs(c.x - s.x), h = Math.abs(c.y - s.y)
        if (w > 4 && h > 4) shape = { type: 'rect', x, y, w, h, color: col, sw: sw2 }
      } else if (t === 'circle') {
        const r = Math.hypot(c.x - s.x, c.y - s.y)
        if (r > 4) shape = { type: 'circle', cx: s.x, cy: s.y, r, color: col, sw: sw2 }
      }

      if (shape) setShapes(prev => [...prev, shape!])
      setActive(null)
    })

  // ── SVG helpers ───────────────────────────────────────────────────────────
  function shapeToSvg(s: Shape, key: number) {
    const base = { key, stroke: s.color, strokeWidth: s.sw, fill: 'none' as const }
    if (s.type === 'freehand')
      return <Path {...base} d={s.d} strokeLinecap="round" strokeLinejoin="round" />
    if (s.type === 'line')
      return <SvgLine {...base} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeLinecap="round" />
    if (s.type === 'rect')
      return <SvgRect {...base} x={s.x} y={s.y} width={s.w} height={s.h} />
    if (s.type === 'circle')
      return <SvgCircle {...base} cx={s.cx} cy={s.cy} r={s.r} />
    return null
  }

  function activeToSvg() {
    if (!active) return null
    const { tool: t, start: s, cur: c, freeD } = active
    const base = { stroke: color, strokeWidth: stroke, fill: 'none' as const }
    if (t === 'freehand')
      return <Path {...base} d={freeD} strokeLinecap="round" strokeLinejoin="round" />
    if (t === 'line')
      return <SvgLine {...base} x1={s.x} y1={s.y} x2={c.x} y2={c.y} strokeLinecap="round" />
    if (t === 'rect') {
      const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y)
      return <SvgRect {...base} x={x} y={y} width={Math.abs(c.x - s.x)} height={Math.abs(c.y - s.y)} />
    }
    if (t === 'circle') {
      const r = Math.hypot(c.x - s.x, c.y - s.y)
      return <SvgCircle {...base} cx={s.x} cy={s.y} r={r} />
    }
    return null
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!canvasRef.current) return
    setSaving(true)
    try {
      const tmpUri = await captureRef(canvasRef, { format: 'jpg', quality: 0.92 })
      const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
      const dest = `${dir}${Date.now()}_annotated.jpg`
      await FileSystem.copyAsync({ from: tmpUri, to: dest })
      onSave(dest)
    } catch {
      Alert.alert('Error', 'Could not save the annotated photo.')
    } finally {
      setSaving(false)
    }
  }

  // ── Tool labels ───────────────────────────────────────────────────────────
  const TOOL_META: { id: DrawTool; icon: string; label: string }[] = [
    { id: 'freehand', icon: '✏️', label: 'Draw'   },
    { id: 'line',     icon: '╱',  label: 'Line'   },
    { id: 'rect',     icon: '▭',  label: 'Rect'   },
    { id: 'circle',   icon: '○',  label: 'Circle' },
  ]

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[aS.screen, { paddingTop: insets.top }]}>

          {/* ── Header ── */}
          <View style={aS.header}>
            <TouchableOpacity onPress={onDismiss} hitSlop={12}>
              <Text style={aS.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={aS.title}>Annotate</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving || shapes.length === 0} hitSlop={12}>
              {saving
                ? <ActivityIndicator color={colors.primary} size="small" />
                : <Text style={[aS.save, shapes.length === 0 && aS.saveDisabled]}>Save</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Canvas ── */}
          <View style={aS.canvasOuter}>
            <GestureDetector gesture={drawGesture}>
              {/* collapsable={false} prevents Android from optimising away the View,
                  which would break captureRef */}
              <View ref={canvasRef} collapsable={false} style={{ width: canvasW, height: canvasH }}>
                <Image source={{ uri: photoUri }} style={{ width: canvasW, height: canvasH }} resizeMode="stretch" />
                <Svg width={canvasW} height={canvasH} style={StyleSheet.absoluteFill}>
                  {shapes.map((s, i) => shapeToSvg(s, i))}
                  {activeToSvg()}
                </Svg>
              </View>
            </GestureDetector>
          </View>

          {/* ── Toolbar ── */}
          <View style={[aS.toolbar, { paddingBottom: insets.bottom + 4 }]}>
            {/* Tool row */}
            <View style={aS.row}>
              {TOOL_META.map(({ id, icon, label }) => (
                <TouchableOpacity
                  key={id}
                  style={[aS.toolBtn, tool === id && aS.toolBtnOn]}
                  onPress={() => setTool(id)}
                >
                  <Text style={aS.toolIcon}>{icon}</Text>
                  <Text style={[aS.toolLabel, tool === id && aS.toolLabelOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
              <View style={aS.sep} />
              <TouchableOpacity
                style={[aS.toolBtn, !shapes.length && aS.toolBtnDim]}
                onPress={() => setShapes(s => s.slice(0, -1))}
                disabled={!shapes.length}
              >
                <Text style={aS.toolIcon}>↩</Text>
                <Text style={aS.toolLabel}>Undo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[aS.toolBtn, !shapes.length && aS.toolBtnDim]}
                onPress={() => setShapes([])}
                disabled={!shapes.length}
              >
                <Text style={aS.toolIcon}>🗑</Text>
                <Text style={aS.toolLabel}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* Palette + stroke row */}
            <View style={[aS.row, { paddingHorizontal: spacing.md, paddingVertical: 10, gap: 10 }]}>
              {PALETTE.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    aS.swatch,
                    { backgroundColor: c },
                    c === '#FFFFFF' && aS.swatchBorder,
                    color === c && aS.swatchOn,
                  ]}
                  onPress={() => setColor(c)}
                />
              ))}
              <View style={aS.sep} />
              {STROKES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[aS.strokeBtn, stroke === s && aS.strokeBtnOn]}
                  onPress={() => setStroke(s)}
                >
                  <View style={[aS.dot, { width: s * 2.4, height: s * 2.4, borderRadius: s * 1.2 }]} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const aS = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: '#111' },
  header:      {
    height: 50,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    backgroundColor: '#1c1c1e',
  },
  cancel:      { fontSize: font.md, color: '#aaa', fontWeight: '500' },
  title:       { fontSize: font.md, fontWeight: '700', color: '#fff' },
  save:        { fontSize: font.md, color: '#0ea5e9', fontWeight: '700' },
  saveDisabled:{ opacity: 0.35 },
  canvasOuter: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  toolbar:     { backgroundColor: '#1c1c1e', paddingTop: 4 },
  row:         { flexDirection: 'row', alignItems: 'center' },
  toolBtn:     { flex: 1, alignItems: 'center', paddingVertical: 8 },
  toolBtnOn:   { backgroundColor: 'rgba(14,165,233,0.18)', borderRadius: radius.sm },
  toolBtnDim:  { opacity: 0.3 },
  toolIcon:    { fontSize: 18, color: '#fff' },
  toolLabel:   { fontSize: font.xs, color: '#888', marginTop: 2 },
  toolLabelOn: { color: '#0ea5e9', fontWeight: '700' },
  sep:         { width: 1, height: 36, backgroundColor: '#333', marginHorizontal: 4 },
  swatch:      { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  swatchBorder:{ borderColor: '#555' },
  swatchOn:    { borderColor: '#fff', transform: [{ scale: 1.25 }] },
  strokeBtn:   { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  strokeBtnOn: { backgroundColor: '#333' },
  dot:         { backgroundColor: '#fff' },
})
