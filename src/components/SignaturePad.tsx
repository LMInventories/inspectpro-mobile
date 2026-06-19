import React, { useRef, useState, useCallback, useMemo } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  LayoutChangeEvent,
} from 'react-native'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import Svg, { Path } from 'react-native-svg'
import { colors, font, radius, spacing } from '../utils/theme'

interface Point { x: number; y: number }

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
  const [strokes, setStrokes]       = useState<Point[][]>([])
  const [livePoints, setLivePoints] = useState<Point[]>([])
  const canvasWidth = useRef(320)
  const liveRef     = useRef<Point[]>([])

  const isEmpty = strokes.length === 0 && livePoints.length === 0

  const handleLayout = (e: LayoutChangeEvent) => {
    canvasWidth.current = e.nativeEvent.layout.width
  }

  // Quadratic bezier through midpoints — same algorithm used for the SVG export,
  // so the live SVG preview exactly matches the saved output.
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

  // Gesture.Pan replaces PanResponder — PanResponder is unreliable on New
  // Architecture when a GestureHandlerRootView is present in the tree.
  const drawGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin(e => {
        const p = { x: e.x, y: e.y }
        liveRef.current = [p]
        setLivePoints([p])
      })
      .onUpdate(e => {
        const p = { x: e.x, y: e.y }
        liveRef.current.push(p)
        setLivePoints([...liveRef.current])
      })
      .onEnd(() => {
        if (liveRef.current.length > 0) {
          const completed = liveRef.current.slice()
          liveRef.current = []
          setLivePoints([])
          setStrokes(prev => [...prev, completed])
        }
      })
  , [])

  const handleClear = useCallback(() => {
    setStrokes([])
    setLivePoints([])
    liveRef.current = []
    onClear?.()
  }, [onClear])

  const handleSave = useCallback(() => {
    const allStrokes = livePoints.length > 0
      ? [...strokes, livePoints]
      : strokes
    if (allStrokes.length === 0) return

    const w = canvasWidth.current
    const h = height

    const pathEls = allStrokes
      .map(pts => `<path d="${buildPathD(pts)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('\n  ')

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  ${pathEls}\n</svg>`
    const b64 = btoa(unescape(encodeURIComponent(svg)))
    onSave(`data:image/svg+xml;base64,${b64}`)
  }, [strokes, livePoints, strokeColor, strokeWidth, height, onSave])

  return (
    <View style={padStyles.wrap}>
      <GestureDetector gesture={drawGesture}>
        {/* collapsable={false} prevents Android from collapsing the View,
            which would break touch coordinate calculation */}
        <View
          style={[padStyles.canvas, { height }]}
          onLayout={handleLayout}
          collapsable={false}
        >
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            {strokes.map((pts, i) => (
              <Path
                key={i}
                d={buildPathD(pts)}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {livePoints.length > 0 && (
              <Path
                d={buildPathD(livePoints)}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </Svg>
          {isEmpty && (
            <View style={padStyles.hint} pointerEvents="none">
              <Text style={padStyles.hintText}>Sign here</Text>
            </View>
          )}
        </View>
      </GestureDetector>

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

const padStyles = StyleSheet.create({
  wrap:  { alignSelf: 'stretch' },
  canvas: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  hint: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText:        { fontSize: font.sm, color: colors.textLight, fontStyle: 'italic' },
  toolbar:         { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  clearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  clearText:       { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  saveBtn:         { flex: 1, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.muted },
  saveText:        { fontSize: font.sm, color: '#fff', fontWeight: '700' },
})
