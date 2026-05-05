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
          setStrokes(prev => [...prev, { points: currentStroke.current }])
          currentStroke.current = []
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

  // Render preview lines as thin Views between consecutive points
  const renderStrokeLines = (points: Point[], key: string | number) => {
    const lines: React.ReactNode[] = []
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1]
      const p2 = points[i]
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const length = Math.sqrt(dx * dx + dy * dy)
      if (length < 0.5) continue
      const angle = Math.atan2(dy, dx) * (180 / Math.PI)
      lines.push(
        <View
          key={`${key}-${i}`}
          style={[
            previewStyles.line,
            {
              width: length,
              height: strokeWidth,
              left: p1.x,
              top: p1.y - strokeWidth / 2,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: '0 50%',
              backgroundColor: strokeColor,
            } as any,
          ]}
        />
      )
    }
    return lines
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
