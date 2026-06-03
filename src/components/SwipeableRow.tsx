import React, { useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { colors, font, radius, spacing } from '../utils/theme'

interface Action {
  icon: string
  label: string
  bg: string
  onPress: () => void
  wide?: boolean  // grid mode only — spans full row width (use for destructive actions)
}

interface Props {
  children: React.ReactNode
  actions: Action[]
  disabled?: boolean
  layout?: 'grid' | 'row'  // grid = 2-col wrap (default), row = horizontal single line
}

export default function SwipeableRow({ children, actions, disabled, layout = 'grid' }: Props) {
  const swipeRef = useRef<Swipeable>(null)

  function close() {
    swipeRef.current?.close()
  }

  function renderActions(
    _progress: Animated.AnimatedInterpolation<number>,
    _side: 'left' | 'right'
  ) {
    if (!actions.length) return null

    if (layout === 'row') {
      return (
        <View style={styles.rowContainer}>
          {actions.map((action, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.rowBtn, { backgroundColor: action.bg }]}
              onPress={() => { close(); action.onPress() }}
            >
              <Text style={styles.btnIcon}>{action.icon}</Text>
              <Text style={styles.btnLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )
    }

    // Default: 2-column wrapping grid
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
  // ── Grid layout (2-column wrap) ──────────────────────────────────────────
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
    width: BTN_W * 2 + GAP,
  },

  // ── Row layout (horizontal single line) ──────────────────────────────────
  rowContainer: {
    flexDirection: 'row',
    alignItems:    'stretch',
    gap:           2,
    padding:       2,
  },
  rowBtn: {
    width:          62,
    minHeight:      44,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   radius.md,
    gap:            3,
  },

  // ── Shared ────────────────────────────────────────────────────────────────
  btnIcon:  { fontSize: 18 },
  btnLabel: { fontSize: 9, fontWeight: '700', color: colors.text, letterSpacing: 0.2 },
})
