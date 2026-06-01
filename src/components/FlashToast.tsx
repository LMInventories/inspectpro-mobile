import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useToastStore } from '../stores/toastStore'

const DISPLAY_MS = 2400
const FADE_MS    = 500

const BG: Record<string, string> = {
  success: '#166534',
  info:    '#1e3a5f',
  error:   '#7f1d1d',
}

export default function FlashToast() {
  const { toast, hideToast } = useToastStore()
  const opacity  = useRef(new Animated.Value(0)).current
  const seenId   = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insets   = useSafeAreaInsets()

  useEffect(() => {
    if (!toast || toast.id === seenId.current) return
    seenId.current = toast.id

    // Cancel any existing animation
    if (timerRef.current) clearTimeout(timerRef.current)
    opacity.stopAnimation()
    opacity.setValue(1)

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue:         0,
        duration:        FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) hideToast()
      })
    }, DISPLAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast?.id])

  if (!toast) return null

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8, opacity, backgroundColor: BG[toast.type] ?? BG.success },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position:     'absolute',
    left:         16,
    right:        16,
    zIndex:       9999,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical:   12,
    shadowColor:  '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius:  6,
    elevation:    12,
  },
  text: {
    color:      '#fff',
    fontSize:   14,
    fontWeight: '600',
    textAlign:  'center',
    lineHeight: 20,
  },
})
