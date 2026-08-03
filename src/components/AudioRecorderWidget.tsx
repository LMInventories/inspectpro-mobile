import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated,
} from 'react-native'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { colors, font, radius, spacing } from '../utils/theme'

interface Props {
  recordings: { id?: number; uri: string; durationMs: number; transcription?: string }[]
  onRecordingComplete: (uri: string, durationMs: number) => Promise<void>
  onDeleteRecording: (uri: string, id?: number) => Promise<void>
  onTranscriptionChange?: (uri: string, text: string) => void
  /** URI of the recording currently being transcribed — drives the pulsing state */
  transcribingUri?: string | null
  compact?: boolean
}

export default function AudioRecorderWidget({
  recordings,
  onRecordingComplete,
  onDeleteRecording,
  transcribingUri,
  compact,
}: Props) {
  const {
    isRecording, isPaused, startRecording, pauseRecording, resumeRecording,
    stopRecording, playRecording, stopPlayback, formatDuration,
  } = useAudioRecorder()
  const [saving, setSaving]       = useState(false)
  const [playingUri, setPlayingUri] = useState<string | null>(null)
  // Collapsed by default — tapping the clips button (replaces the old
  // attach-existing-file button) reveals the list so a clerk can find and
  // delete a specific clip without it always taking up screen space.
  const [clipsExpanded, setClipsExpanded] = useState(false)

  // Pulse animation — runs while any recording is being transcribed
  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null)
  const isTranscribing = !!transcribingUri
  // A "take" spans however many record/pause/resume cycles the clerk does —
  // it's all one continuous file until Transcribe finalizes it.
  const hasActiveTake  = isRecording || isPaused

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

  // Toggles record/pause within the current take — does NOT finalize the
  // file, so the clerk can record more than one clip into it (pause, think,
  // resume) before ever transcribing. Only handleTranscribeNow finalizes.
  async function handleToggleRecord() {
    if (isRecording) {
      pauseRecording()
    } else if (isPaused) {
      resumeRecording()
    } else {
      await startRecording()
    }
  }

  // Finalizes the take (whatever's been recorded across any pause/resume
  // cycles) and hands the full audio off for saving + transcription.
  async function handleTranscribeNow() {
    if (!hasActiveTake) return
    setSaving(true)
    const result = await stopRecording()
    if (result) await onRecordingComplete(result.uri, result.durationMs)
    setSaving(false)
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
  //   paused       → amber — a take is open but not currently capturing
  //   transcribing → accent / pulsing
  //   saving       → spinner
  //   idle         → primary / normal
  const btnStyle = isRecording
    ? styles.recordBtnRecording
    : isPaused
    ? styles.recordBtnPaused
    : isTranscribing
    ? styles.recordBtnTranscribing
    : null

  return (
    <View style={styles.container}>
      {/* Record/Pause + Transcribe-now + Clips-list-toggle buttons */}
      <View style={styles.recordRow}>
        <Animated.View style={{ flex: 3, transform: [{ scale: isTranscribing ? pulseAnim : 1 }] }}>
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
                <View style={styles.pauseBars}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
                <Text style={styles.recordBtnText}>Pause</Text>
                <View style={styles.recordingDot} />
              </View>
            ) : isPaused ? (
              <View style={styles.recordBtnInner}>
                <View style={styles.micCircle}>
                  <Text style={styles.micEmoji}>🎙</Text>
                </View>
                <Text style={styles.recordBtnText}>Resume</Text>
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

        {/* Transcribe now — finalizes whatever's been recorded across any
            pause/resume cycles (the "full audio") and submits it immediately,
            instead of waiting for the clerk to stop. Roughly 1/4 the width
            of the record button. Same ✨ icon as the AI Transcribe button in
            AI By Room mode. */}
        <TouchableOpacity
          style={[styles.transcribeBtn, !hasActiveTake && styles.transcribeBtnDisabled]}
          onPress={handleTranscribeNow}
          disabled={!hasActiveTake || saving || isTranscribing}
          activeOpacity={0.8}
        >
          <Text style={styles.transcribeBtnText}>✨</Text>
        </TouchableOpacity>

        {/* Clips list toggle — replaces the old attach-existing-file button.
            Shows the recorded-clip count; tapping expands/collapses the list
            below so a clerk can find and delete a specific clip without it
            always taking up space on screen. */}
        <TouchableOpacity
          style={[styles.clipsBtn, recordings.length === 0 && styles.clipsBtnEmpty]}
          onPress={() => setClipsExpanded(v => !v)}
          disabled={recordings.length === 0}
          activeOpacity={0.8}
        >
          <Text style={styles.clipsBtnIcon}>🎵</Text>
          <Text style={[styles.clipsBtnCount, recordings.length === 0 && styles.clipsBtnCountEmpty]}>
            {recordings.length}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Recordings list — collapsed by default */}
      {clipsExpanded && recordings.length > 0 && (
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

  // Record/Pause button — shares the row with the Transcribe-now and Insert
  // buttons. No explicit width/height here — the wrapping Animated.View
  // provides flex:3 for width, and paddingVertical below gives it a
  // natural, bounded height. (height: '100%' previously resolved against
  // whatever the parent's computed height happened to be — with no
  // explicit height anywhere up the chain, that made the button balloon to
  // fill all available space.)
  recordBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Transcribe-now — roughly 1/4 the width of the record button (flex 1 vs
  // flex 3 on the row), finalizes + submits the current take immediately.
  transcribeBtn: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcribeBtnDisabled: {
    backgroundColor: colors.border,
  },
  transcribeBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  // Clips list toggle — shows recorded-clip count, expands/collapses the
  // list below. Dimmed and non-interactive when there are no clips yet.
  clipsBtn: {
    width: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  clipsBtnEmpty: { opacity: 0.4 },
  clipsBtnIcon: { fontSize: 15 },
  clipsBtnCount: { fontSize: font.xs, fontWeight: '700', color: colors.text },
  clipsBtnCountEmpty: { color: colors.textLight },
  recordBtnRecording: {
    backgroundColor: colors.danger,
  },
  recordBtnPaused: {
    backgroundColor: colors.warning,
  },
  recordBtnTranscribing: {
    backgroundColor: colors.accent,   // distinct colour for transcribing state
  },
  pauseBars: {
    flexDirection: 'row',
    gap: 3,
  },
  pauseBar: {
    width: 4, height: 16,
    borderRadius: 2,
    backgroundColor: '#fff',
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
