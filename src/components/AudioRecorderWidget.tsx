import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Alert,
} from 'react-native'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { colors, font, radius, spacing } from '../utils/theme'
import { pickAndImportAudioClip } from '../services/importAudioClip'
import { useToastStore } from '../stores/toastStore'

interface Props {
  recordings: { id?: number; uri: string; durationMs: number; transcription?: string }[]
  onRecordingComplete: (uri: string, durationMs: number) => Promise<void>
  onDeleteRecording: (uri: string, id?: number) => Promise<void>
  onTranscriptionChange?: (uri: string, text: string) => void
  /** URI of the recording currently being transcribed — drives the pulsing state */
  transcribingUri?: string | null
  compact?: boolean
  /** Used to namespace the imported file's on-device filename */
  importPrefix?: string
}

export default function AudioRecorderWidget({
  recordings,
  onRecordingComplete,
  onDeleteRecording,
  transcribingUri,
  compact,
  importPrefix = 'item',
}: Props) {
  const { isRecording, startRecording, stopRecording, playRecording, stopPlayback, formatDuration } = useAudioRecorder()
  const [saving, setSaving]       = useState(false)
  const [importing, setImporting] = useState(false)
  const [playingUri, setPlayingUri] = useState<string | null>(null)

  // Pulse animation — runs while any recording is being transcribed
  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null)
  const isTranscribing = !!transcribingUri

  useEffect(() => {
    if (isTranscribing) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.00, duration: 600, useNativeDriver: true }),
        ])
      )
      pulseLoop.current.start()
    } else {
      pulseLoop.current?.stop()
      pulseAnim.setValue(1)
    }
    return () => { pulseLoop.current?.stop() }
  }, [isTranscribing])

  async function handleToggleRecord() {
    if (isRecording) {
      setSaving(true)
      const result = await stopRecording()
      if (result) await onRecordingComplete(result.uri, result.durationMs)
      setSaving(false)
    } else {
      await startRecording()
    }
  }

  // Insert an existing audio file — stand-in for when the mic/API drops out.
  async function handleInsert() {
    if (isRecording || isTranscribing || importing) return
    setImporting(true)
    try {
      const imported = await pickAndImportAudioClip(importPrefix)
      if (!imported) return  // user cancelled
      await onRecordingComplete(imported.uri, imported.durationMs)
      useToastStore.getState().showToast(`Inserted "${imported.name}"`, 'info')
    } catch (err) {
      console.error('[AudioRecorderWidget] insert error:', err)
      Alert.alert('Insert failed', 'Could not add the selected audio file.')
    } finally {
      setImporting(false)
    }
  }

  async function handlePlay(uri: string) {
    if (playingUri === uri) {
      await stopPlayback()
      setPlayingUri(null)
    } else {
      setPlayingUri(uri)
      await playRecording(uri)
      setPlayingUri(null)
    }
  }

  // Derive button visual state:
  //   recording    → red / active
  //   transcribing → accent / pulsing
  //   saving       → spinner
  //   idle         → primary / normal
  const btnStyle = isRecording
    ? styles.recordBtnRecording
    : isTranscribing
    ? styles.recordBtnTranscribing
    : null

  return (
    <View style={styles.container}>
      {/* Record / Stop / Transcribing button + Insert-existing-file button */}
      <View style={styles.recordRow}>
        <Animated.View style={{ flex: 1, transform: [{ scale: isTranscribing ? pulseAnim : 1 }] }}>
          <TouchableOpacity
            style={[styles.recordBtn, btnStyle]}
            onPress={handleToggleRecord}
            disabled={saving || isTranscribing}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : isTranscribing ? (
              <View style={styles.recordBtnInner}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.recordBtnText}>Transcribing…</Text>
              </View>
            ) : isRecording ? (
              <View style={styles.recordBtnInner}>
                <View style={styles.stopSquare} />
                <Text style={styles.recordBtnText}>Stop</Text>
                <View style={styles.recordingDot} />
              </View>
            ) : (
              <View style={styles.recordBtnInner}>
                <View style={styles.micCircle}>
                  <Text style={styles.micEmoji}>🎙</Text>
                </View>
                <Text style={styles.recordBtnText}>Record</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity
          style={styles.insertBtn}
          onPress={handleInsert}
          disabled={isRecording || isTranscribing || saving || importing}
          activeOpacity={0.8}
        >
          {importing
            ? <ActivityIndicator color={colors.primary} size="small" />
            : <Text style={styles.insertBtnText}>📎</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Recordings list */}
      {recordings.length > 0 && (
        <View style={styles.list}>
          {recordings.map((rec, i) => (
            <View key={rec.uri} style={styles.recRow}>
              <TouchableOpacity
                style={[styles.playBtn, playingUri === rec.uri && styles.playBtnActive]}
                onPress={() => handlePlay(rec.uri)}
              >
                <Text style={styles.playBtnText}>{playingUri === rec.uri ? '⏸' : '▶'}</Text>
              </TouchableOpacity>

              <View style={styles.recInfo}>
                {rec.transcription ? (
                  <Text style={styles.transcription} numberOfLines={compact ? 2 : 4}>
                    {rec.transcription}
                  </Text>
                ) : transcribingUri === rec.uri ? (
                  <View style={styles.transcribingRow}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.transcribingText}>AI filling fields…</Text>
                  </View>
                ) : (
                  <Text style={styles.recLabel}>
                    Recording {i + 1} — {formatDuration(rec.durationMs)}
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => onDeleteRecording(rec.uri, rec.id)}
                disabled={transcribingUri === rec.uri}
              >
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },

  recordRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xs,
  },

  // Record button — shares the row with the Insert button
  recordBtn: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insertBtn: {
    width: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insertBtnText: { fontSize: 18 },
  recordBtnRecording: {
    backgroundColor: colors.danger,
  },
  recordBtnTranscribing: {
    backgroundColor: colors.accent,   // distinct colour for transcribing state
  },
  recordBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  micCircle: {
    width: 26, height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micEmoji: { fontSize: 14 },
  stopSquare: {
    width: 14, height: 14,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  recordingDot: {
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: '#ff6b6b',
  },
  recordBtnText: {
    color: '#fff',
    fontSize: font.md,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Recordings list
  list: { gap: spacing.xs, marginTop: spacing.xs },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnActive: { backgroundColor: colors.warningLight },
  playBtnText: { fontSize: 14, color: colors.primary },
  recInfo: { flex: 1 },
  recLabel: { fontSize: font.sm, color: colors.textMid },
  transcription: { fontSize: font.sm, color: colors.text, lineHeight: 18 },
  transcribingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  transcribingText: { fontSize: font.xs, color: colors.accent },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.dangerLight,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 12, color: colors.danger, fontWeight: '700' },
})
