import React, { useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { colors, font, radius, spacing } from '../utils/theme'

interface Action {
  icon: string
  label: string
  bg: string
  onPress: () => void
  wide?: boolean  // spans full grid width — use for destructive/bottom actions
}

interface Props {
  children: React.ReactNode
  actions: Action[]
  disabled?: boolean
}

export default function SwipeableRow({ children, actions, disabled }: Props) {
  const swipeRef = useRef<Swipeable>(null)

  function close() {
    swipeRef.current?.close()
  }

  function renderActions(
    _progress: Animated.AnimatedInterpolation<number>,
    _side: 'left' | 'right'
  ) {
    if (!actions.length) return null
    return (
      <View style={styles.grid}>
        {actions.map((action, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.btn, { backgroundColor: action.bg }, action.wide && styles.btnWide]}
            onPress={() => { close(); action.onPress() }}
          >
            <Text style={styles.btnIcon}>{action.icon}</Text>
            <Text style={styles.btnLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  if (disabled) return <>{children}</>

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
      renderLeftActions={(p) => renderActions(p, 'left')}
      renderRightActions={(p) => renderActions(p, 'right')}
    >
      {children}
    </Swipeable>
  )
}

const BTN_W = 64
const GAP   = 2
const PAD   = 2

const styles = StyleSheet.create({
  // 2-column wrapping grid — centred vertically inside the swipe panel
  grid: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    alignContent:   'center',
    justifyContent: 'flex-start',
    width:          BTN_W * 2 + GAP + PAD * 2,
    padding:        PAD,
    gap:            GAP,
  },
  btn: {
    width:          BTN_W,
    minHeight:      54,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   radius.md,
    gap:            3,
  },
  btnWide: {
    width: BTN_W * 2 + GAP,  // spans both columns
  },
  btnIcon:  { fontSize: 18 },
  btnLabel: { fontSize: 9, fontWeight: '700', color: colors.text, letterSpacing: 0.2 },
})
