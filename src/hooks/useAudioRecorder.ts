import { useState, useRef, useCallback } from 'react'
import {
  useAudioRecorder as useExpoAudioRecorder,
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system'
import { Alert } from 'react-native'

export interface Recording {
  uri: string
  durationMs: number
  transcription?: string
}

export function useAudioRecorder() {
  const recorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused]       = useState(false)
  const [isPlaying, setIsPlaying]     = useState(false)

  // Track elapsed time for duration ourselves (rather than trusting
  // recorder.currentTime, which may not be available post-stop on all
  // platforms) — accumulatedMsRef holds the total across however many
  // pause/resume cycles happened before the take was finalized; startTimeRef
  // marks when the CURRENT active recording segment began.
  const startTimeRef       = useRef<number>(0)
  const accumulatedMsRef   = useRef<number>(0)
  const playerRef          = useRef<ReturnType<typeof createAudioPlayer> | null>(null)

  // Starts a brand new take (first press after idle, or after a previous
  // take was finalized via stopRecording). Must call prepareToRecordAsync —
  // resuming from pause must NOT call this again, or the in-progress file
  // would be discarded and a new one started.
  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync()
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed for audio dictation.')
        return false
      }

      await AudioModule.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })

      // prepareToRecordAsync must be called before every NEW take's first
      // record() call — the hook creates the recorder but does not auto-prepare it.
      await recorder.prepareToRecordAsync()
      recorder.record()
      startTimeRef.current = Date.now()
      accumulatedMsRef.current = 0
      setIsRecording(true)
      setIsPaused(false)
      return true
    } catch (err) {
      console.error('startRecording error', err)
      Alert.alert('Recording error', 'Could not start recording. Please try again.')
      return false
    }
  }, [recorder])

  // Pauses the CURRENT take — the recorded file is kept open (not finalized),
  // so a later resumeRecording() call continues appending to the same file.
  const pauseRecording = useCallback(() => {
    if (!isRecording) return
    try {
      recorder.pause()
      accumulatedMsRef.current += Date.now() - startTimeRef.current
      setIsRecording(false)
      setIsPaused(true)
    } catch (err) {
      console.error('pauseRecording error', err)
    }
  }, [isRecording, recorder])

  // Resumes a paused take — no prepareToRecordAsync call, so this continues
  // the same underlying file rather than starting a new one.
  const resumeRecording = useCallback(() => {
    if (!isPaused) return
    try {
      recorder.record()
      startTimeRef.current = Date.now()
      setIsRecording(true)
      setIsPaused(false)
    } catch (err) {
      console.error('resumeRecording error', err)
    }
  }, [isPaused, recorder])

  // Finalizes the take (whether currently recording or paused) — this is
  // the ONLY point where the file is actually closed/committed, so it's the
  // right moment to hand the clip off for saving/transcription.
  const stopRecording = useCallback(async (): Promise<Recording | null> => {
    if (!isRecording && !isPaused) return null
    try {
      const durationMs = accumulatedMsRef.current + (isRecording ? Date.now() - startTimeRef.current : 0)

      // stop() is async — awaiting it ensures the native layer has finished
      // writing the file before we read recorder.uri.
      await recorder.stop()

      // URI should be available immediately after stop() resolves.
      // Short safety poll (10 × 50 ms = 500 ms) covers any edge-case native lag.
      let uri: string | null = recorder.uri ?? null
      for (let i = 0; i < 10 && !uri; i++) {
        await new Promise(r => setTimeout(r, 50))
        uri = recorder.uri ?? null
      }

      setIsRecording(false)
      setIsPaused(false)
      accumulatedMsRef.current = 0
      await AudioModule.setAudioModeAsync({ allowsRecording: false })

      if (!uri) {
        console.warn('[useAudioRecorder] URI not available after stop — recording lost')
        return null
      }
      return { uri, durationMs }
    } catch (err) {
      console.error('stopRecording error', err)
      setIsRecording(false)
      setIsPaused(false)
      return null
    }
  }, [isRecording, isPaused, recorder])

  const playRecording = useCallback(async (uri: string) => {
    try {
      if (playerRef.current) {
        playerRef.current.remove()
        playerRef.current = null
      }

      const player = createAudioPlayer({ uri })
      playerRef.current = player
      setIsPlaying(true)

      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) {
          setIsPlaying(false)
          player.remove()
          playerRef.current = null
        }
      })

      await player.play()
    } catch (err) {
      console.error('playRecording error', err)
      setIsPlaying(false)
    }
  }, [])

  const stopPlayback = useCallback(async () => {
    if (playerRef.current) {
      await playerRef.current.pause()
      playerRef.current.remove()
      playerRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const deleteRecording = useCallback(async (uri: string) => {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true })
    } catch {}
  }, [])

  function formatDuration(ms: number | undefined | null) {
    const safeMs = (typeof ms === 'number' && isFinite(ms)) ? ms : 0
    const s = Math.round(safeMs / 1000)
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return {
    isRecording,
    isPaused,
    isPlaying,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    playRecording,
    stopPlayback,
    deleteRecording,
    formatDuration,
  }
}
