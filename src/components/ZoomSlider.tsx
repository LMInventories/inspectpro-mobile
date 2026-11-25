/**
 * ZoomSlider - camera zoom as a sliding scale instead of 0.6x/1x/2x/5x buttons.
 *
 * - Snaps to 0.1x steps anywhere between `min` and `max`.
 * - Speed-sensitive: a slow drag moves the zoom gently (fine control), a fast drag covers the
 *   range quickly (see speedGain in utils/zoomScale.ts). Because of that the thumb is a jog
 *   control rather than glued to the finger - it follows the zoom value, not the touch point.
 * - Tap the value badge to jump back to 1.0x.
 * - Plain PanResponder that refuses to hand the drag to a parent, so it works inside the
 *   draggable floating camera widget (whose own PanResponder would otherwise steal the drag).
 */
import React, { useRef, useEffect } from 'react'
import { View, Text, TouchableOpacity, PanResponder, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { dragZoom, snapZoom, ZOOM_STEP } from '../utils/zoomScale'

interface Props {
  value: number
  min: number
  max: number
  onChange: (x: number) => void
  /** 'horizontal' = left-to-right zooms in. 'vertical' = bottom-to-top zooms in. */
  axis: 'horizontal' | 'vertical'
  /** Track length in px along the slider's axis. */
  length: number
  style?: StyleProp<ViewStyle>
  /** Applied to the value badge text wrapper, e.g. counter-rotation in the full-screen camera. */
  labelStyle?: StyleProp<any>
}

const THICK = 44   // touch target across the axis

export default function ZoomSlider({ value, min, max, onChange, axis, length, style, labelStyle }: Props) {
  const horizontal = axis === 'horizontal'
  const latest = useRef({ value, min, max, onChange, length, horizontal })
  latest.current = { value, min, max, onChange, length, horizontal }

  const raw = useRef(value)          // unsnapped zoom while dragging
  const lastPos = useRef(0)
  const lastEmitted = useRef(value)
  const dragging = useRef(false)
  const [, force] = React.useReducer((n: number) => n + 1, 0)

  useEffect(() => { if (!dragging.current) raw.current = value }, [value])

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,   // keep the drag even inside a draggable parent
    onPanResponderGrant: () => {
      dragging.current = true
      raw.current = latest.current.value
      lastEmitted.current = latest.current.value
      lastPos.current = 0
      force()
    },
    onPanResponderMove: (_, g) => {
      const { min, max, length, horizontal, onChange } = latest.current
      const pos = horizontal ? g.dx : -g.dy
      const v = horizontal ? g.vx : g.vy   // px per ms
      const delta = pos - lastPos.current
      lastPos.current = pos
      raw.current = dragZoom(raw.current, delta, v, length, min, max)
      const snapped = snapZoom(raw.current, min, max)
      if (snapped !== lastEmitted.current) {
        lastEmitted.current = snapped
        onChange(snapped)
      }
    },
    onPanResponderRelease: () => { dragging.current = false; force() },
    onPanResponderTerminate: () => { dragging.current = false; force() },
  })).current

  const frac = max > min ? (value - min) / (max - min) : 0
  const thumbPos = THICK / 2 + frac * length          // distance from the start of the axis to the thumb centre
  const oneFrac = max > min ? (1 - min) / (max - min) : 0
  const oneTick = THICK / 2 + oneFrac * length
  const showOneTick = min < 1 && max > 1

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      {/* value badge - tap to reset to 1.0x */}
      <TouchableOpacity
        style={s.badge}
        onPress={() => onChange(snapZoom(1, min, max))}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      >
        <View style={labelStyle}>
          <Text style={s.badgeText}>{value.toFixed(1)}×</Text>
        </View>
      </TouchableOpacity>

      {/* the whole bar is the touch target; the drawing inside ignores touches */}
      <View
        style={horizontal ? { width: length + THICK, height: THICK } : { width: THICK, height: length + THICK }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {horizontal ? (
            <>
              <View style={[s.trackH, { left: THICK / 2, width: length }]} />
              {showOneTick && <View style={[s.tickH, { left: oneTick - 1 }]} />}
              <View style={[s.thumb, dragging.current && s.thumbActive, { top: THICK / 2 - 11, left: thumbPos - 11 }]} />
            </>
          ) : (
            <>
              <View style={[s.trackV, { bottom: THICK / 2, height: length }]} />
              {showOneTick && <View style={[s.tickV, { bottom: oneTick - 1 }]} />}
              <View style={[s.thumb, dragging.current && s.thumbActive, { left: THICK / 2 - 11, bottom: thumbPos - 11 }]} />
            </>
          )}
        </View>
      </View>
    </View>
  )
}

export const ZOOM_SLIDER_THICKNESS = THICK
export { ZOOM_STEP }

const s = StyleSheet.create({
  trackH: { position: 'absolute', top: THICK / 2 - 2, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  trackV: { position: 'absolute', left: THICK / 2 - 2, width: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  tickH:  { position: 'absolute', top: THICK / 2 - 8, width: 2, height: 16, backgroundColor: '#fff' },
  tickV:  { position: 'absolute', left: THICK / 2 - 8, height: 2, width: 16, backgroundColor: '#fff' },
  thumb: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ffdc00', borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 4,
  },
  thumbActive: { transform: [{ scale: 1.25 }] },
  badge: { marginBottom: 2 },
  badgeText: {
    color: '#000', fontSize: 13, fontWeight: '800',
    backgroundColor: 'rgba(255,220,0,0.92)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden',
  },
})
