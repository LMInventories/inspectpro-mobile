/**
 * SignaturePad.tsx
 *
 * Signature capture using PanResponder only — no react-native-svg dependency.
 * Paths are recorded and rendered via an inline SVG string injected into a
 * WebView-free data URL (the output is a data:image/svg+xml;base64 string).
 * The live preview is drawn using View-based line segments approximation.
 *
 * Works with bare Expo / React Native without any native module beyond core.
 */

import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, PanResponder, StyleSheet,
  LayoutChangeEvent,
} from 'react-native'
import { colors, font, radius, spacing } from '../utils/theme'

interface Point { x: number; y: number }
interface Stroke { points: Point[] }

interface Props {
  height?: number
  strokeColor?: string
  strokeWidth?: number
  onSave: (svgDataUrl: string) => void
  onClear?: () => void
}

export default function SignaturePad({
  height = 180,
  strokeColor = '#1e293b',
  strokeWidth = 2.5,
  onSave,
  onClear,
}: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [, forceUpdate] = useState(0)
  const currentStroke = useRef<Point[]>([])
  const canvasWidth = useRef(320)

  const isEmpty = strokes.length === 0 && currentStroke.current.length === 0

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent
        currentStroke.current = [{ x: locationX, y: locationY }]
        forceUpdate(n => n + 1)
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent
        currentStroke.current = [...currentStroke.current, { x: locationX, y: locationY }]
        forceUpdate(n => n + 1)
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 0) {
          // Snapshot before clearing — functional updates run async, so the ref
          // must not be cleared until after the snapshot is captured.
          const completed = currentStroke.current.slice()
          currentStroke.current = []
          setStrokes(prev => [...prev, { points: completed }])
        }
      },
    })
  ).current

  const handleLayout = (e: LayoutChangeEvent) => {
    canvasWidth.current = e.nativeEvent.layout.width
  }

  const handleClear = useCallback(() => {
    setStrokes([])
    currentStroke.current = []
    forceUpdate(n => n + 1)
    onClear?.()
  }, [onClear])

  const buildPathD = (points: Point[]): string => {
    if (points.length === 0) return ''
    if (points.length === 1) {
      const { x, y } = points[0]
      return `M ${x} ${y} L ${x + 0.1} ${y}`
    }
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const mx = ((prev.x + curr.x) / 2).toFixed(1)
      const my = ((prev.y + curr.y) / 2).toFixed(1)
      d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${mx} ${my}`
    }
    return d
  }

  const handleSave = useCallback(() => {
    const allStrokes = currentStroke.current.length > 0
      ? [...strokes, { points: currentStroke.current }]
      : strokes

    if (allStrokes.length === 0) return

    const w = canvasWidth.current
    const h = height

    const pathEls = allStrokes
      .map(s => `<path d="${buildPathD(s.points)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('\n  ')

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  ${pathEls}\n</svg>`

    // btoa with UTF-8 safety
    const b64 = btoa(unescape(encodeURIComponent(svg)))
    onSave(`data:image/svg+xml;base64,${b64}`)
  }, [strokes, strokeColor, strokeWidth, height, onSave])

  // Render preview using the same quadratic bezier midpoint algorithm as the SVG export,
  // approximated by short straight segments (N subdivisions per curve) so the preview
  // matches the saved output accurately. Dots at each sampled point fill corner gaps.
  const renderStrokeLines = (points: Point[], key: string | number) => {
    if (points.length === 0) return []
    const elements: React.ReactNode[] = []
    const N = 5 // sub-divisions per bezier curve

    const drawSeg = (x1: number, y1: number, x2: number, y2: number, k: string) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.3) return
      const angle = Math.atan2(dy, dx) * (180 / Math.PI)
      elements.push(
        <View key={k} style={[previewStyles.line, {
          width: len, height: strokeWidth,
          left: (x1 + x2) / 2 - len / 2,
          top:  (y1 + y2) / 2 - strokeWidth / 2,
          transform: [{ rotate: `${angle}deg` }],
          backgroundColor: strokeColor,
        }]} />
      )
    }

    // Single-point stroke — render a dot
    if (points.length === 1) {
      const { x, y } = points[0]
      elements.push(
        <View key={`${key}-dot`} style={[previewStyles.dot, {
          width: strokeWidth * 1.5, height: strokeWidth * 1.5,
          borderRadius: strokeWidth,
          left: x - strokeWidth * 0.75, top: y - strokeWidth * 0.75,
          backgroundColor: strokeColor,
        }]} />
      )
      return elements
    }

    // Multi-point: quadratic bezier through midpoints (same algorithm as buildPathD)
    for (let i = 1; i < points.length; i++) {
      const p0 = i === 1 ? points[0] : { x: (points[i - 2].x + points[i - 1].x) / 2, y: (points[i - 2].y + points[i - 1].y) / 2 }
      const p1 = points[i - 1]   // control point
      const p2 = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 } // end point

      for (let t = 0; t < N; t++) {
        const t1 = t / N
        const t2 = (t + 1) / N
        const bx = (t: number) => (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x
        const by = (t: number) => (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
        drawSeg(bx(t1), by(t1), bx(t2), by(t2), `${key}-${i}-${t}`)
      }
    }
    // Final point to actual last point
    const last = points[points.length - 1]
    const secondLast = { x: (points[points.length - 2].x + last.x) / 2, y: (points[points.length - 2].y + last.y) / 2 }
    drawSeg(secondLast.x, secondLast.y, last.x, last.y, `${key}-tail`)

    return elements
  }

  return (
    <View style={padStyles.wrap}>
      {/* Canvas */}
      <View
        style={[padStyles.canvas, { height }]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        {/* Committed strokes */}
        {strokes.map((s, si) => renderStrokeLines(s.points, si))}
        {/* Live stroke */}
        {renderStrokeLines(currentStroke.current, 'live')}

        {isEmpty && (
          <View style={padStyles.hint} pointerEvents="none">
            <Text style={padStyles.hintText}>Sign here</Text>
          </View>
        )}
      </View>

      {/* Toolbar */}
      <View style={padStyles.toolbar}>
        <TouchableOpacity style={padStyles.clearBtn} onPress={handleClear}>
          <Text style={padStyles.clearText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[padStyles.saveBtn, isEmpty && padStyles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={isEmpty}
        >
          <Text style={padStyles.saveText}>Confirm Signature ✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const previewStyles = StyleSheet.create({
  line: {
    position: 'absolute',
    borderRadius: 99,
  },
  dot: {
    position: 'absolute',
  },
})

const padStyles = StyleSheet.create({
  wrap:  { alignSelf: 'stretch' },
  canvas: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  hint: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: { fontSize: font.sm, color: colors.textLight, fontStyle: 'italic' },
  toolbar:  { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  clearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  clearText:        { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  saveBtn:          { flex: 1, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  saveBtnDisabled:  { backgroundColor: colors.muted },
  saveText:         { fontSize: font.sm, color: '#fff', fontWeight: '700' },
})
