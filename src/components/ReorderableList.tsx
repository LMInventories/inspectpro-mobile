/**
 * ReorderableList — drag-by-handle reordering that runs on the UI thread.
 *
 * Grab the ≡ handle and drag straight away (no long-press). Neighbours slide out
 * of the way, the dragged row settles into its slot on release, and the list
 * auto-scrolls near its top/bottom edge.
 *
 * Uncontrolled: it snapshots `data` on mount and reports every completed move
 * through `onReorder(newOrder)`. Mount it fresh each time a rearrange modal opens.
 */
import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps, useAnimatedReaction,
  useAnimatedScrollHandler, useAnimatedRef, useDerivedValue, useFrameCallback,
  scrollTo, withTiming, clamp, type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { colors, font, radius, spacing } from '../utils/theme'

export const REORDER_ROW_H = 56
const STRIDE = REORDER_ROW_H + spacing.xs     // row + gap between rows
const EDGE = 64                               // auto-scroll zone (px from viewport edge)
const SCROLL_STEP = 14                        // px per frame while auto-scrolling

interface Props<T> {
  data: T[]
  keyExtractor: (item: T) => string
  getLabel: (item: T) => string
  onReorder: (next: T[]) => void
  rowStyle?: StyleProp<ViewStyle>
  labelStyle?: StyleProp<TextStyle>
}

export default function ReorderableList<T>({
  data, keyExtractor, getLabel, onReorder, rowStyle, labelStyle,
}: Props<T>) {
  const [items] = useState(data)              // fixed render order (see header note)
  const n = items.length

  // positions[i] = the slot item i currently occupies
  const positions = useSharedValue<number[]>(items.map((_, i) => i))
  const active = useSharedValue(-1)           // index being dragged, or -1
  const startTop = useSharedValue(0)
  const startScroll = useSharedValue(0)
  const translationY = useSharedValue(0)
  const scrollY = useSharedValue(0)
  const viewportH = useSharedValue(0)
  const contentH = n * STRIDE + spacing.xs + 20

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const onScroll = useAnimatedScrollHandler(e => { scrollY.value = e.contentOffset.y })

  // Finger position in content coordinates (follows auto-scroll too).
  const dragTop = useDerivedValue(() =>
    clamp(startTop.value + translationY.value + (scrollY.value - startScroll.value), 0, (n - 1) * STRIDE))

  // Swap slots whenever the dragged row crosses into another slot.
  useAnimatedReaction(
    () => (active.value < 0 ? -1 : clamp(Math.round(dragTop.value / STRIDE), 0, n - 1)),
    (slot) => {
      const a = active.value
      if (a < 0 || slot < 0) return
      const cur = positions.value
      const from = cur[a]
      if (slot === from) return
      const next = cur.slice()
      for (let j = 0; j < next.length; j++) {
        if (j === a) continue
        if (from < slot && next[j] > from && next[j] <= slot) next[j] -= 1
        else if (from > slot && next[j] >= slot && next[j] < from) next[j] += 1
      }
      next[a] = slot
      positions.value = next
    },
  )

  // Auto-scroll while a row is held near the top/bottom edge.
  useFrameCallback(() => {
    if (active.value < 0 || viewportH.value <= 0) return
    const rowTopInView = dragTop.value - scrollY.value
    const maxScroll = Math.max(0, contentH - viewportH.value)
    let target = scrollY.value
    if (rowTopInView < EDGE) target = Math.max(0, scrollY.value - SCROLL_STEP)
    else if (rowTopInView + REORDER_ROW_H > viewportH.value - EDGE) target = Math.min(maxScroll, scrollY.value + SCROLL_STEP)
    if (target !== scrollY.value) scrollTo(scrollRef, 0, target, false)
  })

  function commit(order: number[]) {
    const next: T[] = new Array(n)
    order.forEach((slot, i) => { next[slot] = items[i] })
    onReorder(next)
  }

  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: active.value < 0 }))

  return (
    <Animated.ScrollView
      ref={scrollRef}
      animatedProps={scrollProps}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onLayout={e => { viewportH.value = e.nativeEvent.layout.height }}
      contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: 20 }}
    >
      <View style={{ height: n * STRIDE }}>
        {items.map((item, i) => (
          <Row
            key={keyExtractor(item)}
            index={i}
            count={n}
            label={getLabel(item)}
            positions={positions}
            active={active}
            dragTop={dragTop}
            startTop={startTop}
            startScroll={startScroll}
            translationY={translationY}
            scrollY={scrollY}
            onDrop={commit}
            rowStyle={rowStyle}
            labelStyle={labelStyle}
          />
        ))}
      </View>
    </Animated.ScrollView>
  )
}

interface RowProps {
  index: number
  count: number
  label: string
  positions: SharedValue<number[]>
  active: SharedValue<number>
  dragTop: SharedValue<number>
  startTop: SharedValue<number>
  startScroll: SharedValue<number>
  translationY: SharedValue<number>
  scrollY: SharedValue<number>
  onDrop: (order: number[]) => void
  rowStyle?: StyleProp<ViewStyle>
  labelStyle?: StyleProp<TextStyle>
}

function Row({
  index, label, positions, active, dragTop, startTop, startScroll,
  translationY, scrollY, onDrop, rowStyle, labelStyle,
}: RowProps) {
  const pan = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      startTop.value = positions.value[index] * STRIDE
      startScroll.value = scrollY.value
      translationY.value = 0
      active.value = index
    })
    .onUpdate(e => { translationY.value = e.translationY })
    .onFinalize(() => {
      if (active.value !== index) return
      // Releasing flips the row to the eased branch below, which animates from
      // wherever the finger left it into its slot.
      active.value = -1
      scheduleOnRN(onDrop, positions.value.slice())
    }),
  [index])

  const style = useAnimatedStyle(() => {
    const isActive = active.value === index
    const slotTop = positions.value[index] * STRIDE
    return {
      zIndex: isActive ? 10 : 0,
      elevation: isActive ? 8 : 0,
      shadowOpacity: isActive ? 0.18 : 0,
      transform: [{
        translateY: isActive
          ? dragTop.value
          : withTiming(slotTop, { duration: 160 }),
      }],
    }
  })

  return (
    <Animated.View style={[styles.rowWrap, style]}>
      <View style={[styles.row, rowStyle]}>
        <Text style={[styles.rowLabel, labelStyle]} numberOfLines={1}>{label}</Text>
        <GestureDetector gesture={pan}>
          <View style={styles.handleHit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.handle}>≡</Text>
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  rowWrap: {
    position: 'absolute', left: 0, right: 0, top: 0, height: REORDER_ROW_H,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 8,
  },
  row: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.md, paddingLeft: spacing.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowLabel: { flex: 1, fontSize: font.sm, fontWeight: '600', color: colors.text },
  handleHit: { width: 64, height: '100%', alignItems: 'center', justifyContent: 'center' },
  handle: { fontSize: 24, color: colors.textLight },
})
