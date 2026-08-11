import React, { useState, useEffect, useRef } from 'react'
import { TextInput, TextInputProps } from 'react-native'

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string
  onChangeText: (v: string) => void
}

/**
 * Drop-in replacement for TextInput on report item fields (description,
 * condition, notes, etc.), where `value` is recomputed on every keystroke
 * from a freshly re-parsed report_data blob (see getField()/setField() in
 * RoomInspectionScreen.tsx). That round trip is cheap per character, but the
 * re-parse + re-render of every other field on screen is not — on Android,
 * a controlled multiline TextInput that receives a new `value` prop while
 * mid-composition can lose track of the cursor, most visibly landing back
 * at the end of the previous line right after pressing Enter.
 *
 * This wraps TextInput with its own locally-owned display state so typing
 * is never blocked on that round trip. onChangeText still fires on every
 * keystroke to persist to the store as before — only the *displayed* value
 * is decoupled. The external `value` is re-synced whenever the field isn't
 * focused (switching items, an AI fill landing, etc.), never while typing.
 */
export default function ReportTextInput({ value, onChangeText, onFocus, onBlur, ...rest }: Props) {
  const [local, setLocal] = useState(value)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setLocal(value)
  }, [value])

  return (
    <TextInput
      {...rest}
      value={local}
      onFocus={(e) => { focused.current = true; onFocus?.(e) }}
      onBlur={(e) => { focused.current = false; onBlur?.(e) }}
      onChangeText={(v) => { setLocal(v); onChangeText(v) }}
    />
  )
}
