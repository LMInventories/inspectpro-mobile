import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, Image, Modal, ActivityIndicator,
  Keyboard, Platform, Animated, Dimensions, useWindowDimensions,
  FlatList,
} from 'react-native'
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
  NativeViewGestureHandler,
} from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native'
import type { StackNavigationProp, RouteProp } from '@react-navigation/stack'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'

import type { RootStackParamList } from '../../App'
import { useInspectionStore } from '../stores/inspectionStore'
import { useAuthStore } from '../stores/authStore'
import { saveAudioRecording, getAudioRecordingsForItem, getLocalInspection, updateTranscription } from '../services/database'
import { setCameraTarget, processPendingPhotos, clearCameraTarget } from '../services/cameraStore'
import AudioRecorderWidget from '../components/AudioRecorderWidget'
import RoomDictationRecorder, { RoomDictationItem } from '../components/RoomDictationRecorder'
import FloatingCameraPreview from '../components/FloatingCameraPreview'
import Header from '../components/Header'
import { colors, useColors, font, radius, spacing } from '../utils/theme'
import { api } from '../services/api'
import SwipeableRow from '../components/SwipeableRow'
import { useToastStore } from '../stores/toastStore'
import { mimeTypeForUri } from '../utils/audioMime'
import { pickAndImportAudioClip } from '../services/importAudioClip'

type Nav   = StackNavigationProp<RootStackParamList, 'RoomInspection'>
type Route = RouteProp<RootStackParamList, 'RoomInspection'>

const ANSWER_OPTIONS      = ['Yes', 'No', 'N/A']
const CLEANLINESS_OPTIONS = [
  'Professionally Cleaned',
  'Professionally Cleaned — Receipt Seen',
  'Professionally Cleaned with Omissions',
  'Domestically Cleaned',
  'Domestically Cleaned with Omissions',
  'Not Clean',
]

function OptionPicker({ options, value, onSelect }: { options: string[]; value: string; onSelect: (v: string) => void }) {
  return (
    <View style={optStyles.row}>
      {options.map(opt => (
        <TouchableOpacity key={opt} style={[optStyles.btn, value === opt && optStyles.btnActive]} onPress={() => onSelect(opt === value ? '' : opt)}>
          <Text style={[optStyles.text, value === opt && optStyles.textActive]}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function RoomInspectionScreen() {
  const navigation = useNavigation<Nav>()
  const route      = useRoute<Route>()
  const insets     = useSafeAreaInsets()
  const { inspectionId, sectionKey, sectionName, sectionType, templateSectionId, fixedSectionData, sectionIndex, focusItemKey, focusSubId } = route.params
  const { activeInspection, loadInspection, setReportData } = useInspectionStore()
  const { user } = useAuthStore()

  const [items, setItems]               = useState<any[]>([])
  const [sectionType_, setSectionType_] = useState<string>('room')
  const [recordings, setRecordings]     = useState<Record<string, any[]>>({})
  const [addItemModal, setAddItemModal] = useState(false)
  const [newItemName, setNewItemName]   = useState('')
  const [loading, setLoading]           = useState(true)
  const [renameItemModal, setRenameItemModal] = useState(false)
  const [renameItemId, setRenameItemId]       = useState('')
  const [renameItemName, setRenameItemName]   = useState('')

  // Sub-item quantity modal — opened when clerk taps the ⊕ swipe action
  const [subQtyModal, setSubQtyModal] = useState<{ itemId: string; label: string; count: number } | null>(null)

  // Copy item to room modal
  const [copyItemModal, setCopyItemModal] = useState<{ itemId: string; item: any } | null>(null)
  const [copyTargetKey, setCopyTargetKey] = useState('')
  const [copyDescs,     setCopyDescs]     = useState(true)
  const [copyConds,     setCopyConds]     = useState(true)
  const [copyPhotos,    setCopyPhotos]    = useState(true)
  const [copyRoomsList, setCopyRoomsList] = useState<{ key: string; name: string }[]>([])
  const [copyRoomsLoading, setCopyRoomsLoading] = useState(false)
  const [copyingItem, setCopyingItem] = useState(false)

  // Move item to room modal (shares copyRoomsList/copyRoomsLoading — can't both be open)
  const [moveItemModal, setMoveItemModal] = useState<{ itemId: string; item: any } | null>(null)
  const [moveTargetKey, setMoveTargetKey] = useState('')
  const [moveDescs,     setMoveDescs]     = useState(true)
  const [moveConds,     setMoveConds]     = useState(true)
  const [movePhotos,    setMovePhotos]    = useState(true)
  const [movingItem,    setMovingItem]    = useState(false)

  // Move MULTIPLE room items to a different room at once — shares
  // moveTargetKey/moveDescs/moveConds/movePhotos/copyRoomsList with the
  // single-item Move To modal above (mutually exclusive, never both open).
  const [moveMultipleModal, setMoveMultipleModal]     = useState(false)
  const [moveMultipleStep,  setMoveMultipleStep]       = useState<'select' | 'target'>('select')
  const [moveMultipleSelected, setMoveMultipleSelected] = useState<Set<string>>(new Set())
  const [movingMultiple,    setMovingMultiple]         = useState(false)

  // Sub-item move (single via "Move To", or multiple siblings under the same
  // parent via "Move Multiple") — target room resolved by matching the
  // PARENT item's name in the destination room (creating it there if no
  // item with that name exists yet), so a moved sub always lands as a
  // sub-item again, never a standalone item.
  const [subMoveModal, setSubMoveModal]         = useState<{ itemId: string; parentLabel: string; initialSid: string; multiSelect: boolean } | null>(null)
  const [subMoveStep,  setSubMoveStep]           = useState<'select' | 'target'>('select')
  const [subMoveSelected, setSubMoveSelected]     = useState<Set<string>>(new Set())
  const [subMoveTargetKey, setSubMoveTargetKey]   = useState('')
  const [subMoveDescs, setSubMoveDescs]           = useState(true)
  const [subMoveConds, setSubMoveConds]           = useState(true)
  const [movingSub, setMovingSub]                 = useState(false)

  // Sub-item rearrange — lightweight up/down reorder (subs lists are short;
  // a full drag-gesture modal like the room-item Rearrange below is overkill).
  const [subRearrangeModal, setSubRearrangeModal] = useState<{ itemId: string; parentLabel: string; subs: any[] } | null>(null)

  // Rearrange modal
  const [rearrangeModal, setRearrangeModal]   = useState(false)
  const [rearrangeItems, setRearrangeItems]   = useState<any[]>([])
  const rearrangeDragFromRef  = useRef<number | null>(null)
  const rearrangeDragToRef    = useRef<number | null>(null)
  const [rearrangeDragFrom, setRearrangeDragFrom] = useState<number | null>(null)
  const [rearrangeDragTo,   setRearrangeDragTo]   = useState<number | null>(null)
  const rearrangeDragYAnim = useRef(new Animated.Value(0)).current
  const REORDER_ROW_H = 56

  // ── Check-out / Damage Report mode ───────────────────────────────────────
  const [isCheckOut_, setIsCheckOut_]         = useState(false)
  const [isDamageReport_, setIsDamageReport_] = useState(false)
  const [actionCatalogue, setActionCatalogue] = useState<any[]>([])
  const [actionResponsibilities, setActionResponsibilities] = useState<string[]>([])
  const [actionsModal, setActionsModal] = useState<{
    itemId: string
    itemLabel: string
    workingActions: any[]
    conditionLines: string[]
  } | null>(null)

  // Landscape detection — header scrolls with content in landscape to maximise
  // the vertical space available when the keyboard is showing.
  const { width: winWidth, height: winHeight } = useWindowDimensions()

  // Keyboard height — tracked via listeners so we can manually add paddingBottom
  // to the ScrollView, ensuring the focused field is always scrollable above the
  // keyboard regardless of device keyboard settings or KeyboardAvoidingView quirks.
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => { showSub.remove(); hideSub.remove() }
  }, [])
  const isLandscape = winWidth > winHeight

  // Camera option for this inspection — 'perItem' (default) | 'floating'
  const cameraOption = (activeInspection as any)?.camera_option ?? 'perItem'
  const showFloatingCamera = cameraOption === 'floating' && isLandscape

  // Defaults visible; hides when clerk taps toggle — resets naturally on room remount
  const [cameraPreviewVisible, setCameraPreviewVisible] = useState(true)

  // Y-position + height cache for each item card, populated via onLayout.
  const itemLayoutsRef = useRef<Map<string, number>>(new Map())
  const itemHeightsRef = useRef<Map<string, number>>(new Map())
  // Y of each item's subsContainer within its item card (keyed by item.id).
  const subContainerLayoutsRef = useRef<Map<string, number>>(new Map())
  // Y of each sub-item within its subsContainer (keyed by sub._sid).
  const subItemLayoutsRef = useRef<Map<string, number>>(new Map())

  // Deep-link target from the pre-finalise Review Report overlay — briefly
  // highlighted once scrolled into view (see the focusItemKey effect below).
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null)
  const [highlightSubId,  setHighlightSubId]  = useState<string | null>(null)

  // Overview section layout — so the floating camera can assign to Room Overview
  // when it is the majority-visible section (not just a fallback when no items show).
  const overviewLayoutRef = useRef<{ y: number; h: number } | null>(null)

  // ── Item drag-to-reorder ───────────────────────────────────────────────────
  // Approximate row height used to compute target drop index during drag.
  // Items vary in height but this gives a reasonable gap-preview.
  const ITEM_ROW_H  = 180
  const ITEM_SCR_H  = Dimensions.get('window').height
  const ITEM_SCROLL_EDGE = 120  // px from top/bottom to trigger auto-scroll
  const ITEM_SCROLL_STEP = 6    // px per ~16ms scroll frame

  const itemDragFromRef = useRef<number | null>(null)
  const itemDragToRef   = useRef<number | null>(null)
  const [itemDragFrom, setItemDragFrom] = useState<number | null>(null)
  const [itemDragTo,   setItemDragTo]   = useState<number | null>(null)
  const itemDragYAnim = useRef(new Animated.Value(0)).current

  // Auto-scroll refs for item drag
  const itemScrollRef             = useRef<ScrollView>(null)
  const scrollViewHeightRef       = useRef(0)   // measured via onLayout — actual visible height
  const itemScrollOffsetRef       = useRef(0)
  const itemDragStartScrollRef    = useRef(0)
  const itemLastTranslationYRef   = useRef(0)
  const itemLastAbsYRef           = useRef(0)
  const itemAutoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sub-items stored in report_data[sectionKey][itemId]._subs matching web app format

  // AI typist state
  // typistMode_: resolved mode for THIS inspection — drives which UI is shown
  //   'ai_instant' → per-item mic + immediate AI fill (no room recorder)
  //   'ai_room'    → room recorder + AI Transcribe button (no per-item mic)
  //   'human'      → room recorder WITHOUT AI button (clips synced for typist)
  //   null         → no typist mode set
  const [typistMode_, setTypistMode_]           = useState<'ai_instant' | 'ai_room' | 'human' | null>(null)
  const [hasAiTypist, setHasAiTypist]           = useState(false)   // true only for ai_instant
  const [aiProcessingItem, setAiProcessingItem] = useState<string | null>(null)
  // URI of the recording currently being transcribed per item — drives widget pulse + row highlight
  const [transcribingUris, setTranscribingUris] = useState<Record<string, string | null>>({})
  const [aiError, setAiError]                   = useState('')

  // Serialised transcription queue — prevents concurrent API calls when the user
  // presses multiple item buttons in quick succession.
  const transcriptionQueueRef = useRef<Array<() => Promise<void>>>([])
  const transcriptionRunningRef = useRef(false)

  // AI Condition Summary
  const [aiCondSumLoading, setAiCondSumLoading] = useState(false)

  // Cleanliness dropdown state
  const [cleanlinessOpen, setCleanlinessOpen]   = useState(false)
  const [cleanlinessItemId, setCleanlinessItemId] = useState('')

  // Room dictation state — always visible for all modes
  const [roomTranscribing, setRoomTranscribing] = useState(false)

  // Source check-in report_data — read from local DB (pre-downloaded at fetch time)
  const [sourceReportData, setSourceReportData] = useState<Record<string, any> | null>(null)
  // Tracks which items have the CI photos accordion open
  const [ciPhotosExpanded, setCiPhotosExpanded] = useState<Record<string, boolean>>({})
  // Tracks expanded state for the room overview CI photos dropdown
  const [ciOverviewExpanded, setCiOverviewExpanded] = useState(false)

  // ── Check-In photo lightbox (read-only) ────────────────────────────────────
  const [ciLightbox, setCiLightbox]               = useState<{ photos: string[]; index: number } | null>(null)
  const [ciScrollEnabled, setCiScrollEnabled]     = useState(true)
  const ciScale     = useRef(new Animated.Value(1)).current
  const ciLastScale = useRef(1)

  const ciZoomGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onUpdate(e => {
        ciScale.setValue(Math.max(1, Math.min(4, ciLastScale.current * e.scale)))
      })
      .onEnd(e => {
        const final = Math.max(1, Math.min(4, ciLastScale.current * e.scale))
        ciLastScale.current = final <= 1.05 ? 1 : final
        if (ciLastScale.current === 1) {
          Animated.spring(ciScale, { toValue: 1, useNativeDriver: true }).start()
          setCiScrollEnabled(true)
        } else {
          setCiScrollEnabled(false)
        }
      })
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd(() => {
        const next = ciLastScale.current > 1 ? 1 : 2.5
        ciLastScale.current = next
        Animated.spring(ciScale, { toValue: next, useNativeDriver: true }).start()
        setCiScrollEnabled(next === 1)
      })
    return Gesture.Simultaneous(pinch, doubleTap)
  }, [])

  function closeCiLightbox() {
    setCiLightbox(null)
    ciLastScale.current = 1
    ciScale.setValue(1)
    setCiScrollEnabled(true)
  }

  // Track which photo target is pending (for camera handoff)
  const cameraTargetRef = useRef<{ type: 'item'; itemId: string } | { type: 'overview' } | null>(null)

  // Clear the camera handler when this screen unmounts so stale closures don't
  // accumulate. On focus-loss (navigating TO the camera) the handler must stay
  // alive — clearCameraTarget must only run on full unmount, not on blur.
  useEffect(() => {
    return () => { clearCameraTarget() }
  }, [])

  useFocusEffect(useCallback(() => { loadInspection(inspectionId) }, [inspectionId]))

  // Pick up any photo parked in cameraStore (fallback if handler was GC'd)
  useFocusEffect(useCallback(() => {
    const pending = processPendingPhotos()
    if (pending && cameraTargetRef.current) {
      const target = cameraTargetRef.current
      cameraTargetRef.current = null
      if (target.type === 'item') addPhotoUri(target.itemId, pending)
      else addOverviewPhotoUri(pending)
    }
  }, []))

  useEffect(() => { buildItems() }, [sectionKey])

  // ── Dynamic theme colours ────────────────────────────────────────────────────
  const c  = useColors()
  const dm = {
    bg:        { backgroundColor: c.background },
    surface:   { backgroundColor: c.surface },
    border:    { borderColor: c.border },
    text:      { color: c.text },
    textMid:   { color: c.textMid },
    textLight: { color: c.textLight },
    muted:     { backgroundColor: c.muted },
    input:     { backgroundColor: c.surface, borderColor: c.border, color: c.text } as const,
  }

  // Load source CI report_data from local DB whenever the active inspection changes.
  // Pre-downloaded at fetch time — no network call needed here.
  useEffect(() => { loadSourcePhotos() }, [activeInspection?.id])

  function loadSourcePhotos() {
    const raw = activeInspection?.source_report_data
    if (!raw) { setSourceReportData(null); return }
    try {
      setSourceReportData(typeof raw === 'string' ? JSON.parse(raw) : raw)
    } catch {
      setSourceReportData(null)
    }
  }

  function handleTextFocus(itemId: string, sid?: string) {
    const itemY = itemLayoutsRef.current.get(itemId)
    if (itemY === undefined) return
    // For sub-items: scroll to the sub-item's position in scroll space.
    // subContainerLayoutsRef gives the subsContainer's Y within the item card,
    // subItemLayoutsRef gives the sub-item's Y within the subsContainer.
    const subOffset = sid
      ? (subContainerLayoutsRef.current.get(itemId) ?? 0) + (subItemLayoutsRef.current.get(sid) ?? 0)
      : 0
    const y = itemY + subOffset
    // Pull the target to the very top of the visible area (8 px breathing room).
    const doScroll = () => itemScrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true })

    if (Platform.OS === 'android') {
      if (keyboardHeight > 0) {
        // Keyboard already visible (switching between inputs) — scroll straight away.
        doScroll()
      } else {
        // Keyboard not yet visible. Wait for it to finish appearing, then give React
        // one frame to apply the paddingBottom re-render before scrolling, otherwise
        // scrollTo runs against the old (shorter) content height and stops short.
        const sub = Keyboard.addListener('keyboardDidShow', () => {
          sub.remove()
          setTimeout(doScroll, 50)
        })
      }
    } else {
      // iOS: keyboard animation is ~250 ms; scroll after it finishes.
      setTimeout(doScroll, 260)
    }
  }

  // Deep-link from the pre-finalise Review Report overlay: scroll to the
  // requested item (or sub-item) once its layout has been measured, then
  // briefly highlight it so it's obvious which one to edit. Item layouts are
  // populated asynchronously via onLayout after the item list renders, so
  // this polls briefly rather than assuming they're ready on the first frame.
  useEffect(() => {
    if (!focusItemKey) return
    let cancelled = false
    let attempts = 0

    function tryScroll() {
      if (cancelled) return
      const itemY = itemLayoutsRef.current.get(focusItemKey!)
      if (itemY === undefined) {
        if (attempts++ < 30) setTimeout(tryScroll, 100)
        return
      }
      const subOffset = focusSubId
        ? (subContainerLayoutsRef.current.get(focusItemKey!) ?? 0) + (subItemLayoutsRef.current.get(focusSubId) ?? 0)
        : 0
      itemScrollRef.current?.scrollTo({ y: Math.max(0, itemY + subOffset - 8), animated: true })
      setHighlightItemId(focusItemKey!)
      setHighlightSubId(focusSubId ?? null)
      setTimeout(() => {
        if (cancelled) return
        setHighlightItemId(null)
        setHighlightSubId(null)
      }, 2500)
    }
    tryScroll()
    return () => { cancelled = true }
  }, [focusItemKey, focusSubId, items])

  async function buildItems() {
    subItemLayoutsRef.current.clear()
    subContainerLayoutsRef.current.clear()
    setLoading(true)
    try {
      // Read fresh from DB — avoids store race condition
      const fresh = await getLocalInspection(inspectionId)

      // Determine typist mode
      if (fresh) {
        // Priority order for resolving which recording/transcription UI to show:
        //   1. local_typist_override — clerk explicitly changed it on the Property Overview
        //      screen for THIS inspection. Always wins (most specific).
        //   2. Clerk's own typist_mode from their user profile — their global preference.
        //   3. The inspection's assigned typist's typist_mode (server-assigned default).
        //   4. Legacy: inspection's typist_is_ai boolean → treat as ai_instant.

        const localOverride = (fresh as any).local_typist_override  // set on overview screen
        const clerkMode     = user?.typist_mode                     // clerk's profile preference
        const typistMode    = (fresh as any).typist_mode            // server-assigned / merged
        const typistName    = (fresh.typist_name || (fresh as any).typist?.name || '').toLowerCase()
        const typistIsAi    = (fresh as any).typist_is_ai === true ||
                              (fresh as any).typist?.is_ai === true ||
                              typistName === 'ai typist' ||
                              typistName.startsWith('ai ')

        console.log('[TypistMode] localOverride:', localOverride, 'clerkMode:', clerkMode,
                    'typistMode:', typistMode, 'typistIsAi:', typistIsAi)

        // Per-inspection override wins; then clerk profile; then server-assigned mode
        let resolved: 'ai_instant' | 'ai_room' | 'human' | null = null
        const effectiveMode = localOverride || clerkMode || typistMode

        if      (effectiveMode === 'ai_instant' || typistIsAi) resolved = 'ai_instant'
        else if (effectiveMode === 'ai_room')                  resolved = 'ai_room'
        else if (effectiveMode === 'human')                    resolved = 'human'

        console.log('[TypistMode] resolved:', resolved)

        setTypistMode_(resolved)
        setHasAiTypist(resolved === 'ai_instant')  // per-item mic only in ai_instant

        // Detect check-out / damage report mode and load action catalogue (once per screen)
        const checkOut     = fresh?.inspection_type === 'check_out'
        const damageReport = fresh?.inspection_type === 'damage_report'
        setIsCheckOut_(checkOut)
        setIsDamageReport_(damageReport)
        if (checkOut && actionCatalogue.length === 0) {
          try {
            const actRes = await api.getActions()
            setActionCatalogue(actRes.data.actions || [])
            setActionResponsibilities(actRes.data.responsibilities || [])
          } catch { /* fail silently — actions just won't show options */ }
        }
      }

      if (sectionType === 'fixed' && fixedSectionData) {
        const section = JSON.parse(fixedSectionData)
        const type = section.type || 'condition_summary'
        setSectionType_(type)
        const templateItems = (section.items || []).map((item: any, i: number) => adaptItem(item, type, i, section.secIdx))

        // Restore any extra items added / copied during a previous visit.
        // Fixed sections write _extra entries the same way room sections do,
        // but the original load never read them back — so they vanished on
        // navigate-away. We now merge them in here with the correct field
        // shape for the section type.
        const savedRd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
        const extras: any[] = (savedRd[sectionKey]?._extra || []).map((e: any) =>
          adaptExtraItem(e._eid, e.name || '', type)
        )
        const allFixedItems = [...templateItems, ...extras]
        // Apply name overrides for renamed template items (stored in _names)
        const savedNames: Record<string, string> = savedRd[sectionKey]?._names || {}
        if (Object.keys(savedNames).length > 0) {
          allFixedItems.forEach((it: any) => {
            const override = savedNames[String(it.id)]
            if (override) { it.label = override; it.name = override }
          })
        }
        // Apply saved item order if present
        const fixedOrder: string[] = (savedRd[sectionKey]?._itemOrder || [])
        if (fixedOrder.length > 0) {
          const fixedOrderMap = new Map(fixedOrder.map((k: string, i: number) => [k, i]))
          allFixedItems.sort((a: any, b: any) => {
            const ai = fixedOrderMap.has(a.id) ? fixedOrderMap.get(a.id)! : Infinity
            const bi = fixedOrderMap.has(b.id) ? fixedOrderMap.get(b.id)! : Infinity
            return ai - bi
          })
        }
        // Filter out rows the user deleted — these are stored in _hidden
        // (matching the web frontend's isHidden() convention)
        const hiddenIds: string[] = savedRd[sectionKey]?._hidden || []
        const visibleFixedItems = hiddenIds.length > 0
          ? allFixedItems.filter((item: any) => !hiddenIds.includes(String(item.id)))
          : allFixedItems
        setItems(visibleFixedItems)
      } else if (sectionType === 'room') {
        setSectionType_('room')
        let templateItems: any[] = []

        if (templateSectionId && fresh?.template_id) {
          // Use the template embedded at download time (offline-safe).
          // Must check for sections[], not just template presence — the inspection
          // detail API may have returned a partial template object without sections.
          const cachedOk = Array.isArray(fresh?.template?.sections) &&
                           fresh.template.sections.length > 0
          let templateData: any = cachedOk ? fresh.template : null
          if (!templateData) {
            try {
              const tmplRes = await api.getTemplate(fresh.template_id)
              templateData = tmplRes.data
            } catch (e) {
              console.warn('[buildItems] template fetch failed (offline?) — using cached extras only:', e)
            }
          }

          if (templateData) {
            const tmplSection = (templateData.sections ?? []).find((s: any) => s.id === templateSectionId)
            if (tmplSection) {
              templateItems = tmplSection.items.map((item: any) => {
                let answerOptions: string[] = []
                try {
                  const ao = item.answer_options || ''
                  if (ao) answerOptions = JSON.parse(ao)
                } catch {}
                return {
                  id: String(item.id),
                  label: item.name || item.label || '',
                  hasDescription: true,
                  hasCondition: item.requires_condition !== false,
                  hasPhotos: item.requires_photo !== false,
                  answerOptions,
                }
              })
            }
          }
        }

        // Also load any extra items saved in report_data._extra
        const savedRd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
        // Filter out template items that were explicitly deleted by the clerk
        const deletedIds: string[] = savedRd[sectionKey]?._deleted || []
        const filteredTemplateItems = templateItems.filter((i: any) => !deletedIds.includes(i.id))
        const extras: any[] = (savedRd[sectionKey]?._extra || []).map((e: any) => ({
          id: e._eid,
          label: e.name || '',
          hasDescription: true,
          hasCondition: true,
          hasPhotos: true,
          custom: true,
        }))

        const allRoomItems = [...filteredTemplateItems, ...extras]
        // Apply saved item order if present
        const roomOrder: string[] = savedRd[sectionKey]?._itemOrder || []
        if (roomOrder.length > 0) {
          const orderMap = new Map(roomOrder.map((k: string, i: number) => [k, i]))
          allRoomItems.sort((a: any, b: any) => {
            const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity
            const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity
            return ai - bi
          })
        }
        setItems(allRoomItems)
        setLoading(false)
        return
      }
    } catch (err) {
      console.error('buildItems error', err)
      Alert.alert('Error', 'Could not load section items. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  // Matches _adaptItem in InspectionReportView.vue
  function adaptItem(item: any, type: string, idx: number, secIdx: number) {
    const id = `fs_${secIdx}_${idx}`
    switch (type) {
      case 'meter_readings':
        return { id, name: item.name || '', type, hasReading: true, hasLocationSerial: true, hasPhotos: true }
      case 'cleaning_summary':
        return { id, name: item.name || '', type, hasCleanliness: true, hasCleanlinessNotes: true, hasPhotos: true }
      case 'fire_door_safety':
        return { id, name: item.name || '', question: item.question || '', type, hasAnswer: true, hasNotes: true, hasPhotos: true }
      case 'smoke_alarms':
      case 'health_safety':
        return { id, question: item.name || item.question || '', name: item.name || '', type, hasAnswer: true, hasNotes: true, hasPhotos: true }
      case 'keys':
        return { id, name: item.name || '', type, hasDescription: true, hasPhotos: true }
      case 'condition_summary':
      default:
        return { id, name: item.name || '', type, hasConditionText: true, hasPhotos: true }
    }
  }

  // Produces the correct item shape for a user-added extra item in a fixed
  // section. Mirrors adaptItem() but uses a caller-supplied id and name.
  function adaptExtraItem(id: string, name: string, type: string) {
    switch (type) {
      case 'meter_readings':
        return { id, name, type, hasReading: true, hasLocationSerial: true, hasPhotos: true, custom: true }
      case 'cleaning_summary':
        return { id, name, type, hasCleanliness: true, hasCleanlinessNotes: true, hasPhotos: true, custom: true }
      case 'fire_door_safety':
        return { id, name, question: name, type, hasAnswer: true, hasNotes: true, hasPhotos: true, custom: true }
      case 'smoke_alarms':
      case 'health_safety':
        return { id, name, question: name, type, hasAnswer: true, hasNotes: true, hasPhotos: true, custom: true }
      case 'keys':
        return { id, name, type, hasDescription: true, hasPhotos: true, custom: true }
      case 'condition_summary':
      default:
        return { id, name, type, hasConditionText: true, hasPhotos: true, custom: true }
    }
  }

  const parsedReportData = useMemo(() => {
    if (!activeInspection?.report_data) return {}
    try { return JSON.parse(activeInspection.report_data) } catch { return {} }
  }, [activeInspection?.report_data])

  function getReportData() { return parsedReportData }

  function getField(itemId: string, field: string) {
    const rd = getReportData()
    return rd[sectionKey]?.[String(itemId)]?.[field] ?? ''
  }

  function setField(itemId: string, field: string, value: any) {
    // Read from Zustand store state directly — always the latest committed value,
    // fully synchronous, no async DB round-trip.  Using getState() instead of the
    // closure `activeInspection` avoids the classic race where rapid keystrokes
    // (each triggering an async read) all read the same base state and the last
    // writer wins, silently dropping intermediate characters.
    const current = useInspectionStore.getState().activeInspection
    const rd = (current?.id === inspectionId && current?.report_data)
      ? JSON.parse(current.report_data)
      : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    rd[sectionKey][String(itemId)][field] = value

    // When checkOutCondition is edited: drop saved action condition-links that no
    // longer appear as lines in the new text, so the actions modal stays consistent
    // and never shows ghost conditions from a previous AI fill.
    if (field === 'checkOutCondition') {
      const newLines = new Set(
        String(value).split('\n').map((l: string) => l.trim()).filter(Boolean)
      )
      const actKey = `_actions_${itemId}`
      if (rd[sectionKey][actKey]?.length) {
        rd[sectionKey][actKey] = rd[sectionKey][actKey].map((a: any) => ({
          ...a,
          conditions: (a.conditions || []).filter((c: string) => newLines.has(c)),
        }))
      }
    }

    setReportData(inspectionId, rd)
  }

  function getMajorityItemId(): string | null {
    const scrollY      = itemScrollOffsetRef.current
    const visibleTop   = scrollY
    // Use the ScrollView's measured height so the visible window is accurate.
    // winHeight (full screen) is too large in portrait — the fixed header and
    // recording bar sit outside the scroll area, causing off-screen items to
    // accumulate false overlap and win over genuinely visible items.
    const visibleHeight = scrollViewHeightRef.current > 0 ? scrollViewHeightRef.current : winHeight
    const visibleBot   = scrollY + visibleHeight
    let bestId: string | null = null
    let bestOverlap = 0

    // Only consider items still in the active items list — layout refs may lag deletions
    const activeIds = new Set(items.map((it: any) => String(it.id)))

    for (const [id, y] of itemLayoutsRef.current) {
      if (!activeIds.has(String(id))) continue  // skip deleted/moved items
      const h       = itemHeightsRef.current.get(id) ?? 150
      const overlap = Math.max(0, Math.min(visibleBot, y + h) - Math.max(visibleTop, y))
      if (overlap > bestOverlap) { bestOverlap = overlap; bestId = id }
    }

    // Overview check — two conditions, either triggers a route to Room Overview:
    // 1. ≥50% of the overview block's own height is visible (clerk is in overview territory
    //    even when the first item's header peeks in below — overview block is typically short)
    // 2. Overview has more absolute pixels on screen than the best item (fallback for cases
    //    where the overview is large and partially scrolled)
    if (overviewLayoutRef.current) {
      const { y: ovy, h: ovh } = overviewLayoutRef.current
      const ovOverlap = Math.max(0, Math.min(visibleBot, ovy + ovh) - Math.max(visibleTop, ovy))
      const ovRatio   = ovh > 0 ? ovOverlap / ovh : 0
      if (ovRatio >= 0.5 || ovOverlap > bestOverlap) return null
    }

    return bestId
  }

  const handleFloatingCapture = useCallback(async (fileUri: string, fallback?: boolean) => {
    const candidateId = fallback ? null : getMajorityItemId()
    // Safety net: reject any ID that is no longer in the active items list
    // (layout refs can briefly lag a deletion before the React re-render fires onLayout)
    const activeItem = candidateId
      ? items.find((it: any) => String(it.id) === String(candidateId))
      : null
    const itemId   = activeItem ? candidateId : null
    const itemName = activeItem?.label || activeItem?.name || null
    if (itemId) {
      await addPhotoUri(itemId, fileUri)
      useToastStore.getState().showToast(`Photo assigned to ${itemName}`, 'success')
    } else {
      await addOverviewPhotoUri(fileUri)
      useToastStore.getState().showToast(
        fallback ? 'Photo saved to Room Overview — reassign if needed' : 'Photo assigned to Room Overview',
        fallback ? 'info' : 'success',
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  async function addPhotoUri(itemId: string, fileUri: string) {
    // MUST await — getLocalInspection is async; without await fresh is a Promise,
    // fresh?.report_data is undefined, and every capture overwrites the array with
    // a single item instead of accumulating.
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    const existing: string[] = rd[sectionKey][String(itemId)]._photos || []
    rd[sectionKey][String(itemId)]._photos = [...existing, fileUri]
    await setReportData(inspectionId, rd)
  }

  async function removePhoto(itemId: string, idx: number) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const photos: string[] = rd[sectionKey]?.[String(itemId)]?._photos || []
    photos.splice(idx, 1)
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    rd[sectionKey][String(itemId)]._photos = [...photos]
    await setReportData(inspectionId, rd)
  }

  // ── Room overview photos ──────────────────────────────────────────────────
  // Stored as rd[sectionKey]['_overview']._photos so that ItemGalleryScreen can
  // open them with itemKey='_overview' — giving clerks full reassign/rotate/delete.
  function getOverviewPhotos(): string[] {
    try {
      const rd = JSON.parse(activeInspection?.report_data || '{}')
      return rd[sectionKey]?.['_overview']?._photos || []
    } catch { return [] }
  }

  async function addOverviewPhotoUri(fileUri: string) {
    // MUST await — same missing-await bug as addPhotoUri (fresh is a Promise otherwise)
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_overview']) rd[sectionKey]['_overview'] = {}
    rd[sectionKey]['_overview']._photos = [
      ...(rd[sectionKey]['_overview']._photos || []),
      fileUri,
    ]
    await setReportData(inspectionId, rd)
  }

  async function removeOverviewPhoto(idx: number) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_overview']) rd[sectionKey]['_overview'] = {}
    const photos: string[] = rd[sectionKey]['_overview']._photos || []
    photos.splice(idx, 1)
    rd[sectionKey]['_overview']._photos = [...photos]
    await setReportData(inspectionId, rd)
  }

  function handleTakeOverviewPhoto() {
    cameraTargetRef.current = { type: 'overview' }
    setCameraTarget((uri) => {
      cameraTargetRef.current = null
      addOverviewPhotoUri(uri)
    })
    navigation.navigate('Camera', {
      inspectionId,
      sectionKey, sectionName,
      itemKey: '_overview', itemName: 'Room Overview',
    })
  }

  async function handlePickOverviewPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Photo library permission is needed.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
    })
    if (result.canceled || !result.assets?.length) return

    const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })

    // Copy all selected files, then append in one write
    const newPaths: string[] = []
    for (const asset of result.assets) {
      const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
      await FileSystem.copyAsync({ from: asset.uri, to: dest })
      newPaths.push(dest)
    }
    if (!newPaths.length) return

    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_overview']) rd[sectionKey]['_overview'] = {}
    rd[sectionKey]['_overview']._photos = [
      ...(rd[sectionKey]['_overview']._photos || []),
      ...newPaths,
    ]
    await setReportData(inspectionId, rd)
  }

  function handleTakePhoto(itemId: string, itemName: string) {
    cameraTargetRef.current = { type: 'item', itemId }
    setCameraTarget((uri) => {
      cameraTargetRef.current = null
      addPhotoUri(itemId, uri)
    })
    navigation.navigate('Camera', {
      inspectionId,
      sectionKey, sectionName,
      itemKey: itemId, itemName,
    })
  }

  async function handlePickPhoto(itemId: string) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Photo library access is needed.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.75,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
    })
    if (result.canceled || !result.assets?.length) return

    const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })

    // Copy all selected files, then append in one write
    const newPaths: string[] = []
    for (const asset of result.assets) {
      const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
      await FileSystem.copyAsync({ from: asset.uri, to: dest })
      newPaths.push(dest)
    }
    if (!newPaths.length) return

    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    const existing: string[] = rd[sectionKey][String(itemId)]._photos || []
    rd[sectionKey][String(itemId)]._photos = [...existing, ...newPaths]
    await setReportData(inspectionId, rd)
  }

  // ── Transcription queue helpers ───────────────────────────────────────────
  // Jobs pushed here run one-at-a-time so rapid button presses don't fire
  // concurrent API calls that can race on setReportData or trigger rate limits.
  function enqueueTranscription(job: () => Promise<void>) {
    transcriptionQueueRef.current.push(job)
    drainTranscriptionQueue()
  }

  async function drainTranscriptionQueue() {
    if (transcriptionRunningRef.current) return
    transcriptionRunningRef.current = true
    while (transcriptionQueueRef.current.length > 0) {
      const job = transcriptionQueueRef.current.shift()!
      try { await job() } catch {}
    }
    transcriptionRunningRef.current = false
  }

  // ── AI Transcription ──────────────────────────────────────────────────────
  // ── Duplicate-content guards ──────────────────────────────────────────────
  // The same fill can reach us twice (double-tap, offline retry replay, or the
  // AI re-emitting an already-filled item), and the AI can occasionally repeat
  // a line. Never append text that is already present in the field.
  const normLine = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  function appendUnique(existing: string, incoming: string): string {
    if (!existing) return incoming
    if (!incoming) return existing
    const have  = new Set(existing.split('\n').map(normLine).filter(Boolean))
    const fresh = incoming.split('\n').filter(l => normLine(l) && !have.has(normLine(l)))
    return fresh.length ? existing + '\n' + fresh.join('\n') : existing
  }
  function isDuplicateSub(subs: any[], sub: any): boolean {
    return (subs || []).some((s: any) =>
      normLine(s.description || '') === normLine(sub.description || '') &&
      normLine(s.condition   || '') === normLine(sub.condition   || ''))
  }

  async function transcribeItem(
    itemId: string,
    itemLabel: string,
    uri: string,
    durationMs: number,
    forceNormalMode = false
  ) {
    // Additional Items (Check Out) always want a real description + condition
    // fill, never the room's actual checkOutCondition/damage-only behavior.
    const effectiveCheckOut     = forceNormalMode ? false : isCheckOut_
    const effectiveDamageReport = forceNormalMode ? false : isDamageReport_

    setAiProcessingItem(itemId)
    setTranscribingUris(prev => ({ ...prev, [itemId]: uri }))
    setAiError('')
    try {
      // Read file as base64 — use the statically imported FileSystem (expo-file-system/legacy)
      const audioB64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })

      const response = await api.transcribeItem({
        audio:          audioB64,
        mimeType:       mimeTypeForUri(uri),
        itemLabel,
        roomName:       sectionName,
        sectionId:      sectionKey,
        rowId:          itemId,
        sectionType:    sectionType_,
        isCheckOut:     effectiveCheckOut,
        isDamageReport: effectiveDamageReport,
        inspectionId,
      })

      const result = response.data

      // Persist the raw Whisper transcript to the SQLite recording row so it
      // syncs to the server and becomes available for the web app's Export Transcription.
      if (result.transcript) {
        const recs = await getAudioRecordingsForItem(inspectionId, sectionKey, itemId)
        const match = recs.find((r: any) => r.file_uri === uri)
        if (match?.id) updateTranscription(match.id, result.transcript)
      }

      // Read fresh from DB *after* the API call so any edits the user made while
      // waiting for the AI response are preserved — not overwritten by a stale read
      // taken before the network request started.
      const freshAfterApi = await getLocalInspection(inspectionId)
      const rd = freshAfterApi?.report_data ? JSON.parse(freshAfterApi.report_data) : {}
      if (!rd[sectionKey]) rd[sectionKey] = {}
      if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
      const row = rd[sectionKey][String(itemId)]

      const editMode  = result.editMode  || 'normal'   // 'normal' | 'overwrite' | 'append' | 'delete' | 'add_sub'
      const editField = result.editField || null        // 'description' | 'condition' | null

      // ── "Not Applicable" — delete item ────────────────────────────────────
      if (editMode === 'delete') {
        await deleteItemImmediate(itemId)
        // Log after deletion — re-read so we don't overwrite the now-deleted item
        if (result.transcript) {
          const freshAfterDelete = await getLocalInspection(inspectionId)
          const rdAfterDelete = freshAfterDelete?.report_data ? JSON.parse(freshAfterDelete.report_data) : {}
          if (!rdAfterDelete._transcriptionLog) rdAfterDelete._transcriptionLog = []
          rdAfterDelete._transcriptionLog.push({
            mode:      'instant',
            timestamp: new Date().toISOString(),
            room:      sectionName,
            item:      itemLabel,
            transcript: result.transcript,
            command:   'delete',
            filled:    null,
          })
          await setReportData(inspectionId, rdAfterDelete)
        }
        return
      }

      // ── "Add sub item" — append sub-item from _subs in result ─────────────
      if (editMode === 'add_sub') {
        const incomingSubs: any[] = result._subs || []
        if (incomingSubs.length > 0) {
          const fresh2 = await getLocalInspection(inspectionId)
          const rd2 = fresh2?.report_data ? JSON.parse(fresh2.report_data) : {}
          if (!rd2[sectionKey]) rd2[sectionKey] = {}
          if (!rd2[sectionKey][String(itemId)]) rd2[sectionKey][String(itemId)] = {}
          if (!rd2[sectionKey][String(itemId)]._subs) rd2[sectionKey][String(itemId)]._subs = []
          for (const sub of incomingSubs) {
            if (isDuplicateSub(rd2[sectionKey][String(itemId)]._subs, sub)) continue
            const sid = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            rd2[sectionKey][String(itemId)]._subs.push({
              _sid: sid,
              description: sub.description || '',
              condition:   sub.condition   || '',
            })
          }
          if (result.transcript) {
            if (!rd2._transcriptionLog) rd2._transcriptionLog = []
            rd2._transcriptionLog.push({
              mode:      'instant',
              timestamp: new Date().toISOString(),
              room:      sectionName,
              item:      itemLabel,
              transcript: result.transcript,
              command:   'add_sub',
              filled:    { _subs: incomingSubs },
            })
          }
          await setReportData(inspectionId, rd2)
        }
        return
      }

      // Helper: should we write this field given the edit mode?
      const shouldWrite = (fieldName: string, newVal: string, existing: string): boolean => {
        if (!newVal) return false
        if (editMode === 'overwrite') return editField === null || editField === fieldName
        if (editMode === 'append')    return editField === null || editField === fieldName
        return !existing  // 'normal' → only fill if empty
      }

      // Helper: compute the value to store (append skips lines already present)
      const computeValue = (fieldName: string, newVal: string, existing: string): string => {
        if (editMode === 'append' && existing) return appendUnique(existing, newVal)
        return newVal
      }

      let changed = false
      if (sectionType_ === 'room') {
        if (effectiveDamageReport) {
          // Damage report: AI returns condition only — write directly, no prefix
          if (shouldWrite('condition', result.condition, row.condition)) {
            row.condition = computeValue('condition', result.condition, row.condition); changed = true
          }
        } else if (effectiveCheckOut) {
          // Check-out: AI result goes into checkOutCondition.
          // "As Inventory+" is always the first line (placeholder = no damage / matches inventory).
          // Any AI-dictated condition is appended below it.
          const aiCondition = result.condition || result.description
          if (aiCondition) {
            const existing = row.checkOutCondition || ''
            const isBlankOrPlaceholder = !existing.trim() || existing.trim() === 'As Inventory+'
            row.checkOutCondition = isBlankOrPlaceholder
              ? `As Inventory+\n${aiCondition}`
              : appendUnique(existing, aiCondition)
            changed = true
          }
        } else {
          if (shouldWrite('description', result.description, row.description)) {
            row.description = computeValue('description', result.description, row.description); changed = true
          }
          if (shouldWrite('condition', result.condition, row.condition)) {
            row.condition = computeValue('condition', result.condition, row.condition); changed = true
          }
        }
        // Mark as transcribed so later room passes skip this item unless the
        // clerk explicitly amends it (mirrors handleRoomTranscribed).
        if (changed && !row._transcribed) row._transcribed = true
      } else if (sectionType_ === 'meter_readings') {
        if (result.locationSerial && !row.locationSerial) { row.locationSerial = result.locationSerial; changed = true }
        if (result.reading        && !row.reading)        { row.reading        = result.reading;        changed = true }
      } else if (sectionType_ === 'keys') {
        if (shouldWrite('description', result.description, row.description)) {
          row.description = computeValue('description', result.description, row.description); changed = true
        }
      } else if (sectionType_ === 'condition_summary') {
        if (shouldWrite('condition', result.condition, row.condition)) {
          row.condition = computeValue('condition', result.condition, row.condition); changed = true
        }
      } else if (sectionType_ === 'cleaning_summary') {
        const cn = result.cleanlinessNotes || result.notes
        if (shouldWrite('cleanlinessNotes', cn, row.cleanlinessNotes)) {
          row.cleanlinessNotes = computeValue('cleanlinessNotes', cn, row.cleanlinessNotes); changed = true
        }
      } else {
        if (shouldWrite('notes', result.notes, row.notes)) {
          row.notes = computeValue('notes', result.notes, row.notes); changed = true
        }
      }

      // Append to transcription log so admins can review Whisper + Haiku output
      if (result.transcript) {
        if (!rd._transcriptionLog) rd._transcriptionLog = []
        const logFilled: Record<string, any> = {}
        if (result.description)      logFilled.description      = result.description
        if (result.condition)        logFilled.condition        = result.condition
        if (result.notes)            logFilled.notes            = result.notes
        if (result.cleanlinessNotes) logFilled.cleanlinessNotes = result.cleanlinessNotes
        if (result.locationSerial)   logFilled.locationSerial   = result.locationSerial
        if (result.reading)          logFilled.reading          = result.reading
        if (Array.isArray(result._subs) && result._subs.length) logFilled._subs = result._subs
        rd._transcriptionLog.push({
          mode:       'instant',
          timestamp:  new Date().toISOString(),
          room:       sectionName,
          item:       itemLabel,
          transcript: result.transcript,
          ...(editMode !== 'normal' ? { command: editMode, commandField: editField || undefined } : {}),
          filled:     logFilled,
        })
        changed = true
      }

      if (changed) {
        await setReportData(inspectionId, rd)
      }
    } catch (err: any) {
      console.error('transcribeItem error', err)
      const msg = err.response?.data?.error || err.message || 'Transcription failed'
      setAiError(msg)
      Alert.alert('AI Error', msg)
    } finally {
      setAiProcessingItem(null)
      setTranscribingUris(prev => ({ ...prev, [itemId]: null }))
    }
  }

  // ── Room dictation callback ────────────────────────────────────────────────
  // Called by RoomDictationRecorder when AI returns filled fields.
  // filled = { itemId: { description?, condition?, _subs?: [{description, condition}] } }
  // _subs is created when the AI detects multiple distinct elements within one item chapter.
  // Phrases that mean the item is not present — triggers auto-deletion.
  // Only matches when the phrase IS essentially the entire content (exact match),
  // so embedded uses like "serial number not seen" are left as dictation.
  const NONE_SEEN_PHRASES = [
    'delete item', 'none seen', 'not applicable', 'not present', 'none present',
    'not found', 'n/a', 'none', 'not seen',
  ]
  function isNoneSeen(fields: Record<string, any>): boolean {
    const text = [fields.description, fields.condition].filter(Boolean).join(' ').toLowerCase().trim()
    return NONE_SEEN_PHRASES.some(p => text === p)
  }

  async function handleRoomTranscribed(filled: Record<string, Record<string, any>>, transcript?: string) {
    // Read fresh from DB — room dictation is async (recording + upload + AI round-trip
    // can take 10+ seconds), so the store closure captured at component render time
    // may be stale.  A fresh read ensures no user keystrokes are silently dropped.
    const freshData = await getLocalInspection(inspectionId)
    const rd = freshData?.report_data ? JSON.parse(freshData.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    let changed = false
    let subItemsCreated = 0
    const deletedItems: string[] = []

    for (const [itemId, fields] of Object.entries(filled)) {
      // Explicit delete — clerk said "[item] Not Applicable" (AI sets _delete: true)
      // Also catches auto-detection via isNoneSeen for legacy compatibility.
      // Handle inline within rd so the single setReportData at the end captures
      // deletions alongside any other fills — avoids a second write overwriting _deleted.
      if ((fields as any)._delete === true || isNoneSeen(fields)) {
        setItems(prev => prev.filter(i => i.id !== itemId))
        itemLayoutsRef.current.delete(itemId)
        itemHeightsRef.current.delete(itemId)
        if (rd[sectionKey][String(itemId)]) delete rd[sectionKey][String(itemId)]
        if (rd[sectionKey]['_extra']) {
          rd[sectionKey]['_extra'] = rd[sectionKey]['_extra'].filter((e: any) => e._eid !== itemId)
        }
        if (!rd[sectionKey]['_deleted']) rd[sectionKey]['_deleted'] = []
        if (!rd[sectionKey]['_deleted'].includes(itemId)) rd[sectionKey]['_deleted'].push(itemId)
        deletedItems.push(itemId)
        changed = true
        continue
      }

      if (!rd[sectionKey][itemId]) rd[sectionKey][itemId] = {}
      const row = rd[sectionKey][itemId]

      // Mark item as transcribed so subsequent passes skip it unless explicitly amended
      if (!row._transcribed) { row._transcribed = true; changed = true }

      // Fill main item fields — respect amendment action flags from the AI
      const descAction = fields._descAction || 'fill'  // 'fill' | 'overwrite' | 'append'
      const condAction = fields._condAction || 'fill'

      if (isCheckOut_) {
        // Check-out: _claude_fill_room_checkout returns checkOutCondition; fall back to
        // condition/description for any legacy or fixed-section paths.
        const aiCondition = fields.checkOutCondition || fields.condition || fields.description
        if (aiCondition) {
          const existing = row.checkOutCondition || ''
          const isBlankOrPlaceholder = !existing.trim() || existing.trim() === 'As Inventory+'
          const mergedCO = isBlankOrPlaceholder
            ? `As Inventory+\n${aiCondition}`
            : appendUnique(existing, aiCondition)
          if (mergedCO !== existing) { row.checkOutCondition = mergedCO; changed = true }
        }
      } else {
        if (fields.description) {
          if (descAction === 'overwrite' || (descAction === 'fill' && !row.description)) {
            row.description = fields.description; changed = true
          } else if (descAction === 'append' && row.description) {
            const merged = appendUnique(row.description, fields.description)
            if (merged !== row.description) { row.description = merged; changed = true }
          } else if (descAction === 'append' && !row.description) {
            row.description = fields.description; changed = true
          }
        }
        if (fields.condition) {
          if (condAction === 'overwrite' || (condAction === 'fill' && !row.condition)) {
            row.condition = fields.condition; changed = true
          } else if (condAction === 'append' && row.condition) {
            const merged = appendUnique(row.condition, fields.condition)
            if (merged !== row.condition) { row.condition = merged; changed = true }
          } else if (condAction === 'append' && !row.condition) {
            row.condition = fields.condition; changed = true
          }
        }
      }

      // Create AI-suggested sub-items (check-in) or write CO conditions to existing subs (check-out)
      if (Array.isArray(fields._subs) && fields._subs.length > 0) {
        if (!row._subs) row._subs = []
        for (const sub of fields._subs) {
          if (isCheckOut_ && sub._sid) {
            // Check-out: match by _sid, write checkOutCondition with "As Inventory+" prefix
            const existing = row._subs.find((s: any) => s._sid === sub._sid)
            if (existing && sub.checkOutCondition) {
              const existingCO = existing.checkOutCondition || ''
              const isBlankOrPlaceholder = !existingCO.trim() || existingCO.trim() === 'As Inventory+'
              const mergedSubCO = isBlankOrPlaceholder
                ? `As Inventory+\n${sub.checkOutCondition}`
                : appendUnique(existingCO, sub.checkOutCondition)
              if (mergedSubCO !== existingCO) { existing.checkOutCondition = mergedSubCO; changed = true }
            }
          } else if (!isCheckOut_) {
            // Check-in: create new sub-items from AI-detected elements —
            // skip exact duplicates (produced by a double-apply of the same fill)
            if (isDuplicateSub(row._subs, sub)) continue
            const sid = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            row._subs.push({
              _sid:        sid,
              description: sub.description || '',
              condition:   sub.condition   || '',
            })
            changed = true
            subItemsCreated++
          }
        }
      }
    }

    const parts: string[] = []
    const filledCount = Object.keys(filled).length - deletedItems.length
    if (filledCount > 0) parts.push(`${filledCount} item${filledCount !== 1 ? 's' : ''} filled`)
    if (subItemsCreated > 0) parts.push(`${subItemsCreated} sub-item${subItemsCreated !== 1 ? 's' : ''} created`)
    if (deletedItems.length > 0) parts.push(`${deletedItems.length} removed (none seen)`)

    // Append room-mode log entry so admins can review full Whisper transcript + Haiku fill
    if (transcript) {
      if (!rd._transcriptionLog) rd._transcriptionLog = []
      const logFilled: Record<string, any> = {}
      for (const [itemId, fields] of Object.entries(filled)) {
        const item = items.find((i: any) => String(i.id) === String(itemId))
        logFilled[itemId] = { name: item?.label || item?.name || itemId, ...fields }
      }
      rd._transcriptionLog.push({
        mode:      'room',
        timestamp: new Date().toISOString(),
        room:      sectionName,
        transcript,
        filled:    logFilled,
      })
      changed = true
    }

    if (changed) {
      setReportData(inspectionId, rd)
      useToastStore.getState().showToast(`✨ ${parts.join(' · ')} in ${sectionName}.`)
    } else {
      useToastStore.getState().showToast('Already filled — existing content preserved.', 'info')
    }
  }

  // ── AI Condition Summary ─────────────────────────────────────────────────
  // Reads all filled room data from the inspection, sends it to the backend,
  // and fills each condition_summary item with concise line-by-line observations.
  async function handleAiConditionSummary() {
    if (aiCondSumLoading) return

    const fresh    = await getLocalInspection(inspectionId)
    const rd       = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const template = fresh?.template

    if (!template?.sections?.length) {
      Alert.alert('No room data', 'Complete some rooms before generating a condition summary.')
      return
    }

    const roomNames: Record<string, string>              = rd._roomNames   || {}
    const customRooms: Array<{ key: string; name: string }> = rd._customRooms || []

    // Build sections array from template structure + filled report_data.
    // Check-out items store their value in checkOutCondition, not condition
    // (condition holds the read-only check-in text carried over) — read the
    // right field so the AI condition summary actually sees what was
    // recorded at check-out instead of silently falling back to check-in data.
    const condOf = (d: any) => (isCheckOut_ ? (d.checkOutCondition || '') : (d.condition || ''))
    const sections: Array<{ name: string; items: any[] }> = []

    for (const sec of template.sections) {
      const secKey   = String(sec.id)
      const secData  = rd[secKey] || {}
      const secName  = roomNames[secKey] || sec.name || `Room ${secKey}`
      const secItems: any[] = []

      for (const item of (sec.items || [])) {
        const itemData = secData[String(item.id)] || {}
        if (!itemData.description && !condOf(itemData)) continue
        secItems.push({
          name:        item.name || '',
          description: itemData.description || '',
          condition:   condOf(itemData),
          subs: (itemData._subs || []).map((s: any) => ({
            description: s.description || '',
            condition:   condOf(s),
          })),
        })
      }

      // Extra (user-added) items stored in _extra
      for (const extra of (secData._extra || [])) {
        const eData = secData[extra._eid] || {}
        if (!eData.description && !condOf(eData)) continue
        secItems.push({
          name:        extra.name || '',
          description: eData.description || '',
          condition:   condOf(eData),
          subs: (eData._subs || []).map((s: any) => ({
            description: s.description || '',
            condition:   condOf(s),
          })),
        })
      }

      if (secItems.length > 0) sections.push({ name: secName, items: secItems })
    }

    // Custom rooms
    for (const cr of customRooms) {
      const crData  = rd[cr.key] || {}
      const crName  = roomNames[cr.key] || cr.name
      const crItems: any[] = []
      // Preset-added rooms store item names in _extra, not in the data object.
      // Build a lookup so items get their actual name instead of their internal ID.
      const extraNameLookup: Record<string, string> = {}
      for (const ex of (crData._extra || [])) {
        if (ex._eid) extraNameLookup[ex._eid] = ex.name || ''
      }
      for (const [itemId, rawData] of Object.entries(crData)) {
        if (itemId.startsWith('_')) continue
        const d = rawData as any
        if (!d.description && !condOf(d)) continue
        crItems.push({
          name:        d._name || extraNameLookup[itemId] || itemId,
          description: d.description || '',
          condition:   condOf(d),
          subs: (d._subs || []).map((s: any) => ({
            description: s.description || '',
            condition:   condOf(s),
          })),
        })
      }
      if (crItems.length > 0) sections.push({ name: crName, items: crItems })
    }

    if (sections.length === 0) {
      Alert.alert('No room data', 'Complete some rooms before generating a condition summary.')
      return
    }

    // For Check Out: build CI baseline sections from source_report_data.
    // CO data wins where present; CI fills in items with no CO note recorded.
    let checkInSections: Array<{ name: string; items: any[] }> | undefined
    if (isCheckOut_) {
      const ciRd = fresh?.source_report_data ? JSON.parse(fresh.source_report_data) : null
      if (ciRd && template?.sections?.length) {
        checkInSections = []
        for (const sec of template.sections) {
          const secKey  = String(sec.id)
          const secData = ciRd[secKey] || {}
          const secName = sec.name || `Room ${secKey}`
          const ciItems: any[] = []
          for (const item of (sec.items || [])) {
            const itemData = secData[String(item.id)] || {}
            if (!itemData.description && !itemData.condition) continue
            ciItems.push({ name: item.name || '', description: itemData.description || '', condition: itemData.condition || '' })
          }
          for (const extra of (secData._extra || [])) {
            const eData = secData[extra._eid] || {}
            if (!eData.description && !eData.condition) continue
            ciItems.push({ name: extra.name || '', description: eData.description || '', condition: eData.condition || '' })
          }
          if (ciItems.length > 0) checkInSections.push({ name: secName, items: ciItems })
        }
        const ciCustomRooms: Array<{ key: string; name: string }> = ciRd._customRooms || []
        for (const cr of ciCustomRooms) {
          const crData = ciRd[cr.key] || {}
          const crName = (ciRd._roomNames || {})[cr.key] || cr.name
          const ciItems: any[] = []
          const extraLookup: Record<string, string> = {}
          for (const ex of (crData._extra || [])) {
            if (ex._eid) extraLookup[ex._eid] = ex.name || ''
          }
          for (const [itemId, rawData] of Object.entries(crData)) {
            if (itemId.startsWith('_')) continue
            const d = rawData as any
            if (!d.description && !d.condition) continue
            ciItems.push({ name: d._name || extraLookup[itemId] || itemId, description: d.description || '', condition: d.condition || '' })
          }
          if (ciItems.length > 0) checkInSections.push({ name: crName, items: ciItems })
        }
      }
    }

    setAiCondSumLoading(true)
    try {
      const summaryItems = items.map(it => ({ id: String(it.id), name: it.name || '' }))
      const prop = fresh?.property || {}

      // Derive missing property details from the template name (e.g. "2 Bedroom Flat",
      // "3 Bed 2 Bath House") so the backend doesn't fall back to "residential".
      const tmplName      = (fresh?.template?.name ?? '') as string
      const bedroomMatch  = tmplName.match(/(\d+)\s*bed(?:room)?s?/i)
      const bathroomMatch = tmplName.match(/(\d+)\s*bath(?:room)?s?/i)
      // House group: detached variants, terraced, bungalow, house
      // Flat group: purpose-built/converted flat, penthouse, flat
      const HOUSE_TMPL = /\b(detached|semi[- ]detached|terraced|bungalow|house)\b/i
      const FLAT_TMPL  = /\b(purpose[\s-]built[\s-]flat|converted[\s-]flat|penthouse|flat)\b/i
      const OTHER_TMPL = /\b(studio|maisonette|cottage)\b/i
      const derivedType = HOUSE_TMPL.test(tmplName) ? 'House'
        : FLAT_TMPL.test(tmplName)  ? 'Flat'
        : (() => { const m = tmplName.match(OTHER_TMPL); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null })()

      const DET_MAP: Record<string, string> = {
        'Terraced': 'house', 'Semi-Detached': 'house', 'Detached': 'house',
        'Purpose Built Flat': 'flat', 'Converted Flat': 'flat', 'Penthouse': 'flat',
        'Bungalow': 'bungalow',
      }
      const typeFromDetachment = prop.detachment_type ? (DET_MAP[prop.detachment_type as string] ?? null) : null
      const effectiveType = typeFromDetachment
        ?? (prop.property_type && prop.property_type !== 'residential' ? prop.property_type : null)
        ?? derivedType

      const propertyDetails = {
        property_type: effectiveType,
        bedrooms:      prop.bedrooms      ?? (bedroomMatch  ? parseInt(bedroomMatch[1],  10) : null),
        bathrooms:     prop.bathrooms     ?? (bathroomMatch ? parseInt(bathroomMatch[1], 10) : null),
        furnished:     prop.furnished     ?? null,
        address:       fresh?.property_address ?? null,
      }
      const res = await api.generateConditionSummary({
        inspectionId, sections, summaryItems, propertyDetails,
        ...(isCheckOut_ && checkInSections ? { isCheckOut: true, checkInSections } : {}),
      })
      const filled: Record<string, { condition: string }> = res.data.filled || {}

      const allEntries   = Object.entries(filled)
      const withContent  = allEntries.filter(([, v]) => v.condition?.trim())

      // Write ALL items (including empty strings) so that any previously AI-filled
      // "In good order" text is cleared — empty fields show "No issues" placeholder.
      const freshNow = await getLocalInspection(inspectionId)
      const rdNow    = freshNow?.report_data ? JSON.parse(freshNow.report_data) : {}
      if (!rdNow[sectionKey]) rdNow[sectionKey] = {}

      for (const [itemId, fields] of allEntries) {
        if (!rdNow[sectionKey][itemId]) rdNow[sectionKey][itemId] = {}
        rdNow[sectionKey][itemId].condition = fields.condition
      }

      setReportData(inspectionId, rdNow)

      if (withContent.length === 0) {
        useToastStore.getState().showToast('No notable issues found — property looks good!', 'info')
      } else {
        useToastStore.getState().showToast(`✨ Condition summary filled for ${withContent.length} item${withContent.length !== 1 ? 's' : ''}.`)
      }
    } catch (err: any) {
      Alert.alert('AI Error', err.response?.data?.error || err.message || 'Failed to generate summary')
    } finally {
      setAiCondSumLoading(false)
    }
  }

  // Fixed section dictation callback — field names vary by section type
  async function handleFixedRoomTranscribed(filled: Record<string, Record<string, any>>) {
    // Same fresh-read pattern as handleRoomTranscribed — dictation is async.
    const freshFixed = await getLocalInspection(inspectionId)
    const rd = freshFixed?.report_data ? JSON.parse(freshFixed.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    let changed = false

    for (const [itemId, fields] of Object.entries(filled)) {
      if (!rd[sectionKey][itemId]) rd[sectionKey][itemId] = {}
      const row = rd[sectionKey][itemId]
      for (const [fieldKey, value] of Object.entries(fields)) {
        if (value && !row[fieldKey]) {
          row[fieldKey] = value
          changed = true
        }
      }
    }

    if (changed) {
      setReportData(inspectionId, rd)
      const count = Object.keys(filled).length
      useToastStore.getState().showToast(`✨ ${count} item${count !== 1 ? 's' : ''} filled in ${sectionName}.`)
    } else {
      useToastStore.getState().showToast('Already filled — existing content preserved.', 'info')
    }
  }

  // forceNormalMode: used by Additional Items (Check Out) — those items always
  // want a real description + condition fill (like a check-in item), never the
  // room's actual checkOutCondition/damage-only behavior, even though the
  // overall inspection is check-out.
  async function handleRecordingComplete(item: any, uri: string, durationMs: number, forceNormalMode = false) {
    saveAudioRecording(inspectionId, sectionKey, sectionName, item.id, item.label || item.name || '', item.label || item.name || '', uri, durationMs)
    const recs = await getAudioRecordingsForItem(inspectionId, sectionKey, item.id)
    setRecordings(prev => ({ ...prev, [item.id]: recs }))

    // Trigger AI transcription if AI typist assigned — enqueue so rapid presses
    // don't fire concurrent API calls.
    if (hasAiTypist) {
      const label = item.label || item.name || ''
      enqueueTranscription(() => transcribeItem(item.id, label, uri, durationMs, forceNormalMode))
    }
  }

  async function transcribeSubItem(
    parentItemId: string,
    sid: string,
    subLabel: string,
    uri: string,
  ) {
    setAiProcessingItem(sid)
    setTranscribingUris(prev => ({ ...prev, [sid]: uri }))
    setAiError('')
    try {
      const audioB64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
      const response = await api.transcribeItem({
        audio:          audioB64,
        mimeType:       'audio/m4a',
        itemLabel:      subLabel,
        roomName:       sectionName,
        sectionId:      sectionKey,
        rowId:          sid,
        sectionType:    'room',
        isCheckOut:     isCheckOut_,
        isDamageReport: isDamageReport_,
        inspectionId,
      })
      const result = response.data

      // Persist the raw Whisper transcript to the SQLite recording row.
      if (result.transcript) {
        const recs = await getAudioRecordingsForItem(inspectionId, sectionKey, sid)
        const match = recs.find((r: any) => r.file_uri === uri)
        if (match?.id) updateTranscription(match.id, result.transcript)
      }

      const fresh = await getLocalInspection(inspectionId)
      const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
      const subs: any[] = rd[sectionKey]?.[String(parentItemId)]?._subs || []
      const sub = subs.find((s: any) => s._sid === sid)
      if (sub) {
        let changed = false
        if (isDamageReport_) {
          if (result.condition && !sub.condition) { sub.condition = result.condition; changed = true }
        } else if (isCheckOut_) {
          const aiCondition = result.condition || result.description
          if (aiCondition) {
            const existingCO = sub.checkOutCondition || ''
            const isBlankOrPlaceholder = !existingCO.trim() || existingCO.trim() === 'As Inventory+'
            sub.checkOutCondition = isBlankOrPlaceholder
              ? `As Inventory+\n${aiCondition}`
              : `${existingCO}\n${aiCondition}`
            changed = true
          }
        } else {
          if (result.description && !sub.description) { sub.description = result.description; changed = true }
          if (result.condition   && !sub.condition)   { sub.condition   = result.condition;   changed = true }
        }
        if (changed) {
          await setReportData(inspectionId, rd)
        }
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Transcription failed'
      setAiError(msg)
    } finally {
      setAiProcessingItem(null)
      setTranscribingUris(prev => ({ ...prev, [sid]: null }))
    }
  }

  async function handleSubItemRecordingComplete(
    parentItemId: string,
    sid: string,
    subLabel: string,
    uri: string,
    durationMs: number
  ) {
    saveAudioRecording(inspectionId, sectionKey, sectionName, sid, subLabel, subLabel, uri, durationMs)
    const recs = await getAudioRecordingsForItem(inspectionId, sectionKey, sid)
    setRecordings(prev => ({ ...prev, [sid]: recs }))

    if (!hasAiTypist) return

    enqueueTranscription(() => transcribeSubItem(parentItemId, sid, subLabel, uri))
  }

  async function handleAddItem() {
    if (!newItemName.trim()) return
    const key = `extra_${Date.now()}`
    const newItem = sectionType_ === 'room'
      ? { id: key, label: newItemName.trim(), hasDescription: true, hasCondition: true, hasPhotos: true, custom: true }
      : adaptExtraItem(key, newItemName.trim(), sectionType_)
    // Read fresh to avoid overwriting concurrent writes
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_extra']) rd[sectionKey]['_extra'] = []
    rd[sectionKey]['_extra'].push({ _eid: key, name: newItemName.trim() })
    await setReportData(inspectionId, rd)
    // Add to items state AFTER writing so it's consistent
    setItems(prev => [...prev, newItem])
    setNewItemName('')
    setAddItemModal(false)
    // Scroll to the new item once React has laid it out (≈200 ms is enough)
    setTimeout(() => itemScrollRef.current?.scrollToEnd({ animated: true }), 200)
  }

  async function deleteItemImmediate(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId))
    itemLayoutsRef.current.delete(itemId)
    itemHeightsRef.current.delete(itemId)
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    // Remove item data if it exists
    if (rd[sectionKey][String(itemId)]) delete rd[sectionKey][String(itemId)]
    // Remove from _extra if it was a custom item
    if (rd[sectionKey]['_extra']) rd[sectionKey]['_extra'] = rd[sectionKey]['_extra'].filter((e: any) => e._eid !== itemId)

    if (sectionType_ === 'room') {
      // Room items: web frontend filters by _deleted in the rooms computed
      if (!rd[sectionKey]['_deleted']) rd[sectionKey]['_deleted'] = []
      if (!rd[sectionKey]['_deleted'].includes(itemId)) rd[sectionKey]['_deleted'].push(itemId)
    } else {
      // Fixed section rows (meters, keys, smoke alarms, etc.):
      // Web frontend's isHidden() reads _hidden — must match here
      if (!rd[sectionKey]['_hidden']) rd[sectionKey]['_hidden'] = []
      const rid = String(itemId)
      if (!rd[sectionKey]['_hidden'].includes(rid)) rd[sectionKey]['_hidden'].push(rid)
    }
    await setReportData(inspectionId, rd)
  }

  async function deleteItemConfirmed(itemId: string, itemName: string) {
    Alert.alert(`Delete "${itemName}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteItemImmediate(itemId) },
    ])
  }

  // ── Shared field-transfer helpers (move/copy item or sub across rooms) ────
  // Mode-aware: check-out items store their value under inventoryCondition
  // (read-only check-in reference) + checkOutCondition (the clerk's new
  // value) — condition doesn't exist on a check-out item at all. Used by
  // commitMoveItemToRoom, commitCopyItemToRoom, commitMoveMultipleToRoom,
  // and the sub-item move/copy functions, so the check-out field mapping
  // only needs to be right in one place.
  function buildTransferFields(src: any, includeDescs: boolean, includeConds: boolean): any {
    const out: any = {}
    if (includeDescs && src.description) out.description = src.description
    if (includeConds) {
      if (isCheckOut_) {
        if (src.inventoryCondition) out.inventoryCondition = src.inventoryCondition
        if (src.checkOutCondition)  out.checkOutCondition  = src.checkOutCondition
      } else if (src.condition) {
        out.condition = src.condition
      }
    }
    return out
  }

  function buildTransferSubs(srcSubs: any[], includeDescs: boolean, includeConds: boolean): any[] | undefined {
    if (!Array.isArray(srcSubs) || srcSubs.length === 0) return undefined
    return srcSubs.map((sub: any) => {
      const newSub: any = { _sid: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
      if (includeDescs && sub.description) newSub.description = sub.description
      if (includeConds) {
        if (isCheckOut_) {
          // Mirrors the read-side fallback (sub.inventoryCondition || sub.condition) —
          // copy whichever the sub actually has, plus the real checkOutCondition value.
          if (sub.inventoryCondition) newSub.inventoryCondition = sub.inventoryCondition
          else if (sub.condition)     newSub.condition          = sub.condition
          if (sub.checkOutCondition)  newSub.checkOutCondition  = sub.checkOutCondition
        } else if (sub.condition) {
          newSub.condition = sub.condition
        }
      }
      return newSub
    })
  }

  // Copies an item's _photos to a new set of files on disk, returning the new
  // URIs — used whenever an item's photos need to survive a move/copy across
  // rooms (each destination item needs its own physical copies, not shared
  // references, so deleting one item's photos later can't affect the other).
  async function copyItemPhotos(srcPhotos: string[] | undefined): Promise<string[]> {
    if (!Array.isArray(srcPhotos) || srcPhotos.length === 0) return []
    const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
    const newPhotos: string[] = []
    for (const uri of srcPhotos) {
      try {
        const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
        await FileSystem.copyAsync({ from: uri, to: dest })
        newPhotos.push(dest)
      } catch {}
    }
    return newPhotos
  }

  // Shared "which other rooms can I move/copy to" list builder — used by
  // openMoveItemModal, openCopyItemModal, and openMoveMultipleModal alike.
  async function fetchMovableRoomsList(fresh: any, rd: any): Promise<{ key: string; name: string }[]> {
    const hidden: string[]                   = rd['_hiddenRooms'] || []
    const roomNames: Record<string, string>  = rd['_roomNames']   || {}
    const rooms: { key: string; name: string }[] = []

    if (fresh?.template_id) {
      try {
        let templateData = fresh?.template || null
        if (!templateData) {
          const tmplRes = await api.getTemplate(fresh.template_id)
          templateData = tmplRes.data
        }
        for (const s of (templateData?.sections || [])) {
          const key = String(s.id)
          if (!hidden.includes(key) && key !== sectionKey)
            rooms.push({ key, name: roomNames[key] || s.name })
        }
      } catch {}
    }

    for (const cr of (rd['_customRooms'] || [])) {
      if (!hidden.includes(cr.key) && cr.key !== sectionKey)
        rooms.push({ key: cr.key, name: cr.name })
    }

    const order: string[] = rd['_roomOrder'] || []
    if (order.length) {
      const orderMap = new Map(order.map((k: string, i: number) => [k, i]))
      rooms.sort((a, b) => {
        const ai = orderMap.has(a.key) ? orderMap.get(a.key)! : Infinity
        const bi = orderMap.has(b.key) ? orderMap.get(b.key)! : Infinity
        return ai - bi
      })
    }

    return rooms
  }

  async function duplicateItem(itemId: string, item: any) {
    const newId = `extra_${Date.now()}`
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const existing = rd[sectionKey]?.[String(itemId)] || {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    rd[sectionKey][newId] = JSON.parse(JSON.stringify(existing))
    if (!rd[sectionKey]['_extra']) rd[sectionKey]['_extra'] = []
    const label = item.label || item.name || ''
    const copyName = `${label} (Copy)`
    rd[sectionKey]['_extra'].push({ _eid: newId, name: copyName })
    await setReportData(inspectionId, rd)
    // Build the new item with correct field shape for the section type
    const newItem = sectionType_ === 'room'
      ? { ...item, id: newId, label: copyName, custom: true }
      : adaptExtraItem(newId, copyName, sectionType_)
    setItems(prev => [...prev, newItem])
  }

  async function openCopyItemModal(item: any) {
    setCopyTargetKey('')
    setCopyDescs(true)
    setCopyConds(true)
    setCopyPhotos(true)
    setCopyRoomsList([])
    setCopyRoomsLoading(true)
    setCopyItemModal({ itemId: item.id, item })

    const fresh = await getLocalInspection(inspectionId)
    const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    setCopyRoomsList(await fetchMovableRoomsList(fresh, rd))
    setCopyRoomsLoading(false)
  }

  async function commitCopyItemToRoom() {
    if (!copyItemModal || !copyTargetKey) return
    const { itemId, item } = copyItemModal
    setCopyingItem(true)
    try {
      const newId = `extra_${Date.now()}`
      const fresh = await getLocalInspection(inspectionId)
      const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
      const src   = rd[sectionKey]?.[String(itemId)] || {}
      const newData: any = buildTransferFields(src, copyDescs, copyConds)

      if (copyPhotos) {
        const newPhotos = await copyItemPhotos(src._photos)
        if (newPhotos.length) newData._photos = newPhotos
      }

      const newSubs = buildTransferSubs(src._subs, copyDescs, copyConds)
      if (newSubs) newData._subs = newSubs

      if (!rd[copyTargetKey]) rd[copyTargetKey] = {}
      rd[copyTargetKey][newId] = newData
      if (!rd[copyTargetKey]['_extra']) rd[copyTargetKey]['_extra'] = []
      const label = item.label || item.name || ''
      rd[copyTargetKey]['_extra'].push({ _eid: newId, name: label })

      await setReportData(inspectionId, rd)
      const targetName = copyRoomsList.find(r => r.key === copyTargetKey)?.name || 'room'
      useToastStore.getState().showToast(`"${label}" copied to ${targetName}`, 'success')
      setCopyItemModal(null)
    } catch (e: any) {
      Alert.alert('Copy failed', 'Could not copy item to room.')
    } finally {
      setCopyingItem(false)
    }
  }

  async function openMoveItemModal(item: any) {
    setMoveTargetKey('')
    setMoveDescs(true)
    setMoveConds(true)
    setMovePhotos(true)
    setCopyRoomsList([])
    setCopyRoomsLoading(true)
    setMoveItemModal({ itemId: item.id, item })

    const fresh = await getLocalInspection(inspectionId)
    const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    setCopyRoomsList(await fetchMovableRoomsList(fresh, rd))
    setCopyRoomsLoading(false)
  }

  async function commitMoveItemToRoom() {
    if (!moveItemModal || !moveTargetKey) return
    const { itemId, item } = moveItemModal
    setMovingItem(true)
    try {
      const newId  = `extra_${Date.now()}`
      const label  = item.label || item.name || ''
      // Read fresh once — all mutations below happen on this single snapshot
      const fresh  = await getLocalInspection(inspectionId)
      const rd     = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
      const src    = rd[sectionKey]?.[String(itemId)] || {}
      const newData: any = buildTransferFields(src, moveDescs, moveConds)

      if (movePhotos) {
        const newPhotos = await copyItemPhotos(src._photos)
        if (newPhotos.length) newData._photos = newPhotos
      }

      const newSubs = buildTransferSubs(src._subs, moveDescs, moveConds)
      if (newSubs) newData._subs = newSubs

      // ── Add to target room ───────────────────────────────────────────────
      if (!rd[moveTargetKey]) rd[moveTargetKey] = {}
      rd[moveTargetKey][newId] = newData
      if (!rd[moveTargetKey]['_extra']) rd[moveTargetKey]['_extra'] = []
      rd[moveTargetKey]['_extra'].push({ _eid: newId, name: label })

      // ── Remove from source room (atomic with the add above) ──────────────
      if (!rd[sectionKey]) rd[sectionKey] = {}
      delete rd[sectionKey][String(itemId)]
      if (rd[sectionKey]['_extra']) {
        rd[sectionKey]['_extra'] = rd[sectionKey]['_extra'].filter((e: any) => e._eid !== itemId)
      }
      if (!rd[sectionKey]['_deleted']) rd[sectionKey]['_deleted'] = []
      if (!rd[sectionKey]['_deleted'].includes(itemId)) rd[sectionKey]['_deleted'].push(itemId)

      // Single DB write — item can never exist in both rooms simultaneously
      setReportData(inspectionId, rd)
      setItems(prev => prev.filter(i => i.id !== itemId))
      itemLayoutsRef.current.delete(itemId)
      itemHeightsRef.current.delete(itemId)

      const targetName = copyRoomsList.find(r => r.key === moveTargetKey)?.name || 'room'
      setMoveItemModal(null)
      useToastStore.getState().showToast(`"${label}" moved to ${targetName}`, 'success')
    } catch {
      Alert.alert('Move failed', 'Could not move item to room.')
    } finally {
      setMovingItem(false)
    }
  }

  async function openMoveMultipleModal(initialItemId: string) {
    setMoveTargetKey('')
    setMoveDescs(true)
    setMoveConds(true)
    setMovePhotos(true)
    setMoveMultipleSelected(new Set([initialItemId]))
    setMoveMultipleStep('select')
    setCopyRoomsList([])
    setCopyRoomsLoading(true)
    setMoveMultipleModal(true)

    const fresh = await getLocalInspection(inspectionId)
    const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    setCopyRoomsList(await fetchMovableRoomsList(fresh, rd))
    setCopyRoomsLoading(false)
  }

  function toggleMoveMultipleSelected(itemId: string) {
    setMoveMultipleSelected(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  async function commitMoveMultipleToRoom() {
    if (!moveTargetKey || moveMultipleSelected.size === 0) return
    setMovingMultiple(true)
    try {
      // Preserve the order items currently appear in on screen — `items` is
      // already in display order, so filtering it keeps that order intact.
      const orderedSelected = items.filter(i => moveMultipleSelected.has(i.id))
      const fresh = await getLocalInspection(inspectionId)
      const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}

      if (!rd[moveTargetKey]) rd[moveTargetKey] = {}
      if (!rd[moveTargetKey]['_extra']) rd[moveTargetKey]['_extra'] = []
      if (!rd[sectionKey]) rd[sectionKey] = {}
      if (!rd[sectionKey]['_deleted']) rd[sectionKey]['_deleted'] = []

      let seq = 0
      for (const item of orderedSelected) {
        const itemId = item.id
        const src    = rd[sectionKey]?.[String(itemId)] || {}
        const newId  = `extra_${Date.now()}_${seq++}`
        const label  = item.label || item.name || ''

        const newData: any = buildTransferFields(src, moveDescs, moveConds)
        if (movePhotos) {
          const newPhotos = await copyItemPhotos(src._photos)
          if (newPhotos.length) newData._photos = newPhotos
        }
        const newSubs = buildTransferSubs(src._subs, moveDescs, moveConds)
        if (newSubs) newData._subs = newSubs

        // ── Add to target room, in source order, appended to the bottom ────
        rd[moveTargetKey][newId] = newData
        rd[moveTargetKey]['_extra'].push({ _eid: newId, name: label })

        // ── Remove from source room ─────────────────────────────────────────
        delete rd[sectionKey][String(itemId)]
        if (rd[sectionKey]['_extra']) {
          rd[sectionKey]['_extra'] = rd[sectionKey]['_extra'].filter((e: any) => e._eid !== itemId)
        }
        if (!rd[sectionKey]['_deleted'].includes(itemId)) rd[sectionKey]['_deleted'].push(itemId)
      }

      // Single DB write for the whole batch — atomic, matches the single-item move
      setReportData(inspectionId, rd)
      const movedIds = new Set(orderedSelected.map(i => i.id))
      setItems(prev => prev.filter(i => !movedIds.has(i.id)))
      for (const id of movedIds) {
        itemLayoutsRef.current.delete(id)
        itemHeightsRef.current.delete(id)
      }

      const targetName = copyRoomsList.find(r => r.key === moveTargetKey)?.name || 'room'
      const count = orderedSelected.length
      setMoveMultipleModal(false)
      useToastStore.getState().showToast(`${count} item${count !== 1 ? 's' : ''} moved to ${targetName}`, 'success')
    } catch {
      Alert.alert('Move failed', 'Could not move items to room.')
    } finally {
      setMovingMultiple(false)
    }
  }

  async function handleRenameItem() {
    if (!renameItemName.trim()) return
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_extra']) rd[sectionKey]['_extra'] = []
    const extraIdx = rd[sectionKey]['_extra'].findIndex((e: any) => e._eid === renameItemId)
    if (extraIdx >= 0) {
      // Custom item — update _extra
      rd[sectionKey]['_extra'][extraIdx].name = renameItemName.trim()
    } else {
      // Template item — store name override in _names so it survives sync
      if (!rd[sectionKey]['_names']) rd[sectionKey]['_names'] = {}
      rd[sectionKey]['_names'][renameItemId] = renameItemName.trim()
    }
    await setReportData(inspectionId, rd)
    setItems(prev => prev.map(i => i.id === renameItemId
      ? { ...i, label: renameItemName.trim(), name: renameItemName.trim() }
      : i
    ))
    setRenameItemModal(false)
  }

  // ── Item drag-to-reorder helpers ──────────────────────────────────────────
  // ── Rearrange modal ────────────────────────────────────────────────────────
  function openRearrangeModal() {
    setRearrangeItems([...items])
    rearrangeDragYAnim.setValue(0)
    setRearrangeDragFrom(null)
    setRearrangeDragTo(null)
    setRearrangeModal(true)
  }

  function getRearrangeShift(idx: number, from: number, to: number): number {
    if (from < to)  { if (idx > from && idx <= to) return -REORDER_ROW_H }
    else if (from > to) { if (idx >= to && idx < from) return REORDER_ROW_H }
    return 0
  }

  function makeRearrangeGesture(idx: number) {
    return Gesture.Pan()
      .runOnJS(true)
      .activateAfterLongPress(350)
      .onStart(() => {
        rearrangeDragFromRef.current = idx
        rearrangeDragToRef.current   = idx
        rearrangeDragYAnim.setValue(0)
        setRearrangeDragFrom(idx)
        setRearrangeDragTo(idx)
      })
      .onUpdate(e => {
        rearrangeDragYAnim.setValue(e.translationY)
        const newTo = Math.max(0, Math.min(
          rearrangeItems.length - 1,
          Math.round(idx + e.translationY / REORDER_ROW_H)
        ))
        if (newTo !== rearrangeDragToRef.current) {
          rearrangeDragToRef.current = newTo
          setRearrangeDragTo(newTo)
        }
      })
      .onEnd(() => {
        const from = rearrangeDragFromRef.current
        const to   = rearrangeDragToRef.current
        rearrangeDragYAnim.setValue(0)
        rearrangeDragFromRef.current = null
        rearrangeDragToRef.current   = null
        setRearrangeDragFrom(null)
        setRearrangeDragTo(null)
        if (from !== null && to !== null && from !== to) {
          setRearrangeItems(prev => {
            const next = [...prev]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
        }
      })
      .onFinalize(() => {
        rearrangeDragYAnim.setValue(0)
        rearrangeDragFromRef.current = null
        rearrangeDragToRef.current   = null
        setRearrangeDragFrom(null)
        setRearrangeDragTo(null)
      })
  }

  async function saveRearrange() {
    setItems(rearrangeItems)
    const keys = rearrangeItems.map((i: any) => String(i.id))
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    rd[sectionKey]['_itemOrder'] = keys
    await setReportData(inspectionId, rd)
    setRearrangeModal(false)
  }

  async function commitItemReorderByIndex(from: number, to: number) {
    // Reorder local state immediately for a responsive UI
    const reordered = [...items]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setItems(reordered)
    // Persist the new order as an array of item IDs
    const keys = reordered.map((i: any) => i.id)
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    rd[sectionKey]['_itemOrder'] = keys
    await setReportData(inspectionId, rd)
  }

  function stopItemAutoScroll() {
    if (itemAutoScrollIntervalRef.current) {
      clearInterval(itemAutoScrollIntervalRef.current)
      itemAutoScrollIntervalRef.current = null
    }
  }

  function startItemAutoScroll() {
    if (itemAutoScrollIntervalRef.current) return
    itemAutoScrollIntervalRef.current = setInterval(() => {
      if (itemDragFromRef.current === null) { stopItemAutoScroll(); return }
      const absY = itemLastAbsYRef.current
      let delta = 0
      if (absY < ITEM_SCROLL_EDGE)                  delta = -((ITEM_SCROLL_EDGE - absY) / ITEM_SCROLL_EDGE) * ITEM_SCROLL_STEP * 2
      else if (absY > ITEM_SCR_H - ITEM_SCROLL_EDGE) delta =  ((absY - (ITEM_SCR_H - ITEM_SCROLL_EDGE)) / ITEM_SCROLL_EDGE) * ITEM_SCROLL_STEP * 2
      if (delta === 0) return

      const newOffset = Math.max(0, itemScrollOffsetRef.current + delta)
      itemScrollRef.current?.scrollTo({ y: newOffset, animated: false })
      itemScrollOffsetRef.current = newOffset

      // Keep dragged item following the finger as list scrolls
      const scrollDelta = itemScrollOffsetRef.current - itemDragStartScrollRef.current
      itemDragYAnim.setValue(itemLastTranslationYRef.current + scrollDelta)

      // Update drop target with new effective position
      const from = itemDragFromRef.current!
      const effectiveY = itemLastTranslationYRef.current + scrollDelta
      const newTo = Math.max(0, Math.min(items.length - 1, Math.round(from + effectiveY / ITEM_ROW_H)))
      if (newTo !== itemDragToRef.current) {
        itemDragToRef.current = newTo
        setItemDragTo(newTo)
      }
    }, 16)
  }

  function makeItemDragGesture(idx: number) {
    return Gesture.Pan()
      .runOnJS(true)
      .minDistance(6)
      .onStart(() => {
        itemDragStartScrollRef.current = itemScrollOffsetRef.current
        itemLastTranslationYRef.current = 0
        itemLastAbsYRef.current = 0
        itemDragYAnim.setValue(0)
        itemDragFromRef.current = idx
        itemDragToRef.current   = idx
        setItemDragFrom(idx)
        setItemDragTo(idx)
      })
      .onUpdate((e) => {
        itemLastAbsYRef.current = e.absoluteY
        itemLastTranslationYRef.current = e.translationY

        // Trigger auto-scroll when near screen edges
        if (e.absoluteY < ITEM_SCROLL_EDGE || e.absoluteY > ITEM_SCR_H - ITEM_SCROLL_EDGE) {
          startItemAutoScroll()
        } else {
          stopItemAutoScroll()
        }

        const scrollDelta = itemScrollOffsetRef.current - itemDragStartScrollRef.current
        itemDragYAnim.setValue(e.translationY + scrollDelta)

        const effectiveY = e.translationY + scrollDelta
        const newTo = Math.max(0, Math.min(items.length - 1, Math.round(idx + effectiveY / ITEM_ROW_H)))
        if (newTo !== itemDragToRef.current) {
          itemDragToRef.current = newTo
          setItemDragTo(newTo)
        }
      })
      .onEnd(() => {
        stopItemAutoScroll()
        const from = itemDragFromRef.current
        const to   = itemDragToRef.current
        itemDragYAnim.setValue(0)
        itemDragFromRef.current = null
        itemDragToRef.current   = null
        setItemDragFrom(null)
        setItemDragTo(null)
        if (from !== null && to !== null && from !== to) {
          commitItemReorderByIndex(from, to)
        }
      })
      .onFinalize(() => {
        stopItemAutoScroll()
        itemDragYAnim.setValue(0)
        itemDragFromRef.current = null
        itemDragToRef.current   = null
        setItemDragFrom(null)
        setItemDragTo(null)
      })
  }

  // Returns how far a non-dragged item should shift (px) to visualise the gap
  function getItemShift(idx: number, from: number, to: number): number {
    if (from < to) {
      if (idx > from && idx <= to) return -ITEM_ROW_H
    } else if (from > to) {
      if (idx >= to && idx < from) return ITEM_ROW_H
    }
    return 0
  }

  // ── Sub-items — stored as report_data[sectionKey][itemId]._subs
  // Matches web app: { _sid, description, condition }
  function getSubs(itemId: string): any[] {
    return getReportData()[sectionKey]?.[String(itemId)]?._subs ?? []
  }

  async function addSubItem(itemId: string) {
    await addSubItems(itemId, 1)
  }

  async function addSubItems(itemId: string, count: number) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    if (!rd[sectionKey][String(itemId)]._subs) rd[sectionKey][String(itemId)]._subs = []
    for (let i = 0; i < count; i++) {
      const sid = `sub_${Date.now()}_${i}`
      rd[sectionKey][String(itemId)]._subs.push({ _sid: sid, description: '', condition: '' })
    }
    await setReportData(inspectionId, rd)
  }

  async function removeSubItem(itemId: string, sid: string) {
    Alert.alert('Remove sub-item?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const fresh = await getLocalInspection(inspectionId)
        const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
        if (rd[sectionKey]?.[String(itemId)]?._subs) {
          rd[sectionKey][String(itemId)]._subs = rd[sectionKey][String(itemId)]._subs.filter((s: any) => s._sid !== sid)
          await setReportData(inspectionId, rd)
        }
      }},
    ])
  }

  async function setSubField(itemId: string, sid: string, field: string, value: string) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    if (!rd[sectionKey][String(itemId)]._subs) rd[sectionKey][String(itemId)]._subs = []
    const sub = rd[sectionKey][String(itemId)]._subs.find((s: any) => s._sid === sid)
    if (sub) sub[field] = value
    await setReportData(inspectionId, rd)
  }

  // ── Sub-item slide-menu actions ────────────────────────────────────────────

  async function duplicateSubItem(itemId: string, sid: string) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const subs = rd[sectionKey]?.[String(itemId)]?._subs || []
    const src = subs.find((s: any) => s._sid === sid)
    if (!src) return
    const newSub = { ...JSON.parse(JSON.stringify(src)), _sid: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
    subs.push(newSub)
    rd[sectionKey][String(itemId)]._subs = subs
    await setReportData(inspectionId, rd)
    useToastStore.getState().showToast('Sub-item copied', 'success')
  }

  // Resolves the item to attach a moved sub-item to in the target room, by
  // matching the source PARENT item's name (case-insensitive) — a moved sub
  // always lands as a sub-item again, e.g. Contents > Contents, never a
  // standalone item. Creates a new standalone item with that name in the
  // target room if nothing there matches, so the sub always has somewhere
  // to attach. Mutates `rd` in place when it has to create that fallback.
  async function findOrCreateMatchingParentInRoom(rd: any, fresh: any, targetRoomKey: string, parentName: string): Promise<string> {
    const normalizedName = parentName.trim().toLowerCase()
    const targetSecData = rd[targetRoomKey] || {}
    // Template items don't disappear from the template when deleted in a
    // specific room — deletion is tracked separately via _deleted. A name
    // match against a deleted item must NOT be used: writing into it would
    // silently attach the sub to an item that never renders (that was the
    // "nothing happens" bug — the sub landed on a still-deleted item).
    const deletedIds: string[] = targetSecData['_deleted'] || []

    for (const extra of (targetSecData._extra || [])) {
      if ((extra.name || '').trim().toLowerCase() === normalizedName && !deletedIds.includes(extra._eid)) {
        return extra._eid
      }
    }

    try {
      let templateData = fresh?.template || null
      if (!templateData && fresh?.template_id) {
        const tmplRes = await api.getTemplate(fresh.template_id)
        templateData = tmplRes.data
      }
      const targetSection = (templateData?.sections || []).find((s: any) => String(s.id) === targetRoomKey)
      const match = (targetSection?.items || []).find((it: any) => (it.name || '').trim().toLowerCase() === normalizedName)
      if (match && !deletedIds.includes(String(match.id))) return String(match.id)
    } catch {}

    // Not found, or the only name match in this room was deleted — fall back
    // to creating a fresh standalone item. It starts with zero subs, so the
    // moved sub(s) pushed by the caller naturally become the first sub(s).
    const newId = `extra_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    if (!rd[targetRoomKey]) rd[targetRoomKey] = {}
    if (!rd[targetRoomKey][newId]) rd[targetRoomKey][newId] = {}
    if (!rd[targetRoomKey]['_extra']) rd[targetRoomKey]['_extra'] = []
    rd[targetRoomKey]['_extra'].push({ _eid: newId, name: parentName })
    return newId
  }

  // multiSelect=false ("Move To"): moves just the one sub, skips the sibling
  // picker. multiSelect=true ("Move Multiple"): starts on the sibling-select
  // step so more subs from the SAME parent item can be brought along together.
  async function openSubMoveModal(itemId: string, parentLabel: string, sid: string, multiSelect: boolean) {
    setSubMoveTargetKey('')
    setSubMoveDescs(true)
    setSubMoveConds(true)
    setSubMoveSelected(new Set([sid]))
    setSubMoveStep(multiSelect ? 'select' : 'target')
    setSubMoveModal({ itemId, parentLabel, initialSid: sid, multiSelect })
    setCopyRoomsList([])
    setCopyRoomsLoading(true)

    const fresh = await getLocalInspection(inspectionId)
    const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    setCopyRoomsList(await fetchMovableRoomsList(fresh, rd))
    setCopyRoomsLoading(false)
  }

  function toggleSubMoveSelected(sid: string) {
    setSubMoveSelected(prev => {
      const next = new Set(prev)
      if (next.has(sid)) next.delete(sid)
      else next.add(sid)
      return next
    })
  }

  async function commitSubMove() {
    if (!subMoveModal || !subMoveTargetKey || subMoveSelected.size === 0) return
    const { itemId, parentLabel } = subMoveModal
    setMovingSub(true)
    try {
      const fresh = await getLocalInspection(inspectionId)
      const rd    = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
      const allSubs: any[] = rd[sectionKey]?.[String(itemId)]?._subs || []

      // Preserve on-screen order — allSubs is already in display order.
      const orderedSelected = allSubs.filter((s: any) => subMoveSelected.has(s._sid))
      if (orderedSelected.length === 0) return

      const targetItemId = await findOrCreateMatchingParentInRoom(rd, fresh, subMoveTargetKey, parentLabel)
      if (!rd[subMoveTargetKey][targetItemId]) rd[subMoveTargetKey][targetItemId] = {}
      if (!Array.isArray(rd[subMoveTargetKey][targetItemId]._subs)) rd[subMoveTargetKey][targetItemId]._subs = []

      for (const sub of orderedSelected) {
        const fields = buildTransferFields(sub, subMoveDescs, subMoveConds)
        rd[subMoveTargetKey][targetItemId]._subs.push({
          _sid: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...fields,
        })
      }

      // Remove moved subs from the source item
      const movedIds = new Set(orderedSelected.map((s: any) => s._sid))
      if (rd[sectionKey]?.[String(itemId)]?._subs) {
        rd[sectionKey][String(itemId)]._subs = rd[sectionKey][String(itemId)]._subs.filter((s: any) => !movedIds.has(s._sid))
      }

      setReportData(inspectionId, rd)
      const targetName = copyRoomsList.find(r => r.key === subMoveTargetKey)?.name || 'room'
      const count = orderedSelected.length
      setSubMoveModal(null)
      useToastStore.getState().showToast(
        `${count} sub-item${count !== 1 ? 's' : ''} moved to ${parentLabel} in ${targetName}`,
        'success'
      )
    } catch {
      Alert.alert('Move failed', 'Could not move sub-item(s) to room.')
    } finally {
      setMovingSub(false)
    }
  }

  // Lightweight up/down reorder — sub-item lists are short enough that a full
  // drag-gesture modal (like the room-item Rearrange above) is overkill.
  function openSubRearrangeModal(itemId: string, parentLabel: string) {
    const rd = getReportData()
    const subs = rd[sectionKey]?.[String(itemId)]?._subs || []
    setSubRearrangeModal({ itemId, parentLabel, subs: [...subs] })
  }

  function moveSubRearrangeItem(fromIdx: number, direction: -1 | 1) {
    setSubRearrangeModal(prev => {
      if (!prev) return prev
      const toIdx = fromIdx + direction
      if (toIdx < 0 || toIdx >= prev.subs.length) return prev
      const next = [...prev.subs]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { ...prev, subs: next }
    })
  }

  async function commitSubRearrange() {
    if (!subRearrangeModal) return
    const { itemId, subs } = subRearrangeModal
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey][String(itemId)]) rd[sectionKey][String(itemId)] = {}
    rd[sectionKey][String(itemId)]._subs = subs
    await setReportData(inspectionId, rd)
    setSubRearrangeModal(null)
  }

  function getSubActions(item: any, sub: any): any[] {
    const parentLabel = item.label || item.name || 'Item'
    return [
      { icon: '⊕', label: 'Add Sub Item', bg: '#f0fdf4', onPress: () => setSubQtyModal({ itemId: item.id, label: parentLabel, count: 1 }) },
      { icon: '⧉', label: 'Copy',         bg: '#e0f2fe', onPress: () => duplicateSubItem(item.id, sub._sid) },
      { icon: '↗', label: 'Move To',       bg: '#fdf4ff', onPress: () => openSubMoveModal(item.id, parentLabel, sub._sid, false) },
      { icon: '☑', label: 'Move Multiple', bg: '#fdf4ff', onPress: () => openSubMoveModal(item.id, parentLabel, sub._sid, true) },
      { icon: '⇅', label: 'Rearrange',     bg: '#f5f3ff', onPress: () => openSubRearrangeModal(item.id, parentLabel) },
      { icon: '🗑', label: 'Delete',        bg: colors.dangerLight, onPress: () => removeSubItem(item.id, sub._sid) },
    ]
  }

  // ── Additional Items (Check Out only) — items added to the property during
  // tenancy, not part of the original check-in. Stored as
  // reportData[sectionKey]._customItems = [{ _cid, name, description, checkOutCondition }].
  // Sub-items, photos, and actions reuse the standard per-id helpers (cid as
  // itemId) — mirrors the webapp's existing implementation exactly, so a
  // report reads the same whichever app you view it in.
  function getCustomItems(): any[] {
    return getReportData()[sectionKey]?.['_customItems'] || []
  }

  async function addCustomItemEntry() {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    if (!rd[sectionKey]['_customItems']) rd[sectionKey]['_customItems'] = []
    const cid = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    rd[sectionKey]['_customItems'].push({ _cid: cid, name: '', description: '', checkOutCondition: '' })
    await setReportData(inspectionId, rd)
  }

  async function setCustomItemField(cid: string, field: string, value: string) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    const item = (rd[sectionKey]?.['_customItems'] || []).find((i: any) => i._cid === cid)
    if (item) {
      item[field] = value
      await setReportData(inspectionId, rd)
    }
  }

  async function removeCustomItemEntry(cid: string, name: string) {
    Alert.alert(`Remove "${name || 'item'}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const fresh = await getLocalInspection(inspectionId)
        const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
        if (!rd[sectionKey]?.['_customItems']) return
        rd[sectionKey]['_customItems'] = rd[sectionKey]['_customItems'].filter((i: any) => i._cid !== cid)
        if (rd[sectionKey][cid]) delete rd[sectionKey][cid]
        const actKey = `_actions_${cid}`
        if (rd[sectionKey][actKey]) delete rd[sectionKey][actKey]
        await setReportData(inspectionId, rd)
      }},
    ])
  }

  // ── Check-out: Actions ────────────────────────────────────────────────────
  function getItemActions(itemId: string): any[] {
    return getReportData()[sectionKey]?.[`_actions_${itemId}`] || []
  }

  async function saveItemActions(itemId: string, actions: any[]) {
    const fresh = await getLocalInspection(inspectionId)
    const rd = fresh?.report_data ? JSON.parse(fresh.report_data) : {}
    if (!rd[sectionKey]) rd[sectionKey] = {}
    rd[sectionKey][`_actions_${itemId}`] = actions
    await setReportData(inspectionId, rd)
  }

  // itemId can be a template item id OR a sub-item _sid — both stored as _actions_${itemId}
  // Ensure every action entry has a stable _id so the same actionId can appear
  // multiple times (e.g. Maintenance Required — Tenant AND Landlord/Agent).
  function genActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  }

  function normaliseAction(a: any): any {
    return {
      _id:          a._id || genActionId(),
      actionId:     a.actionId,
      responsibility: a.responsibility ?? '',
      conditions:   a.conditions ?? (a.condition ? [a.condition] : []),
    }
  }

  function openActionsModal(itemId: string, label: string, coCondition: string) {
    const existing = getItemActions(itemId)
    const lines = coCondition
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
    const normed = existing.map(normaliseAction)
    setActionsModal({
      itemId,
      itemLabel:      label,
      workingActions: JSON.parse(JSON.stringify(normed)),
      conditionLines: lines,
    })
  }

  function modalInstanceCount(actionId: any): number {
    return (actionsModal?.workingActions || []).filter((a: any) => a.actionId === actionId).length
  }

  // Always ADD a new instance — tap the same catalogue button to add another entry
  function modalAddAction(actionId: any) {
    setActionsModal(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workingActions: [
          ...prev.workingActions,
          normaliseAction({ actionId, responsibility: actionResponsibilities[0] || '', conditions: [] }),
        ],
      }
    })
  }

  function modalRemoveAction(_id: string) {
    setActionsModal(prev => {
      if (!prev) return prev
      return { ...prev, workingActions: prev.workingActions.filter((a: any) => a._id !== _id) }
    })
  }

  function modalSetResponsibility(_id: string, value: string) {
    setActionsModal(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workingActions: prev.workingActions.map((a: any) =>
          a._id === _id ? { ...a, responsibility: value } : a
        ),
      }
    })
  }

  function modalToggleCondition(_id: string, line: string) {
    setActionsModal(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workingActions: prev.workingActions.map((a: any) => {
          if (a._id !== _id) return a
          const has = a.conditions.includes(line)
          return { ...a, conditions: has ? a.conditions.filter((c: string) => c !== line) : [...a.conditions, line] }
        }),
      }
    })
  }

  function isItemDone(item: any) {
    const id = item.id
    return !!(
      getField(id, 'condition') || getField(id, 'answer') || getField(id, 'cleanliness') ||
      getField(id, 'reading') || getField(id, 'description') || getField(id, 'notes')
    )
  }

  function getSourcePhotos(itemId: string): string[] {
    if (!sourceReportData) return []
    const sec = sourceReportData[sectionKey] || {}
    // Photos keyed by item id in the source report_data
    const direct = sec[itemId]?._photos || []
    if (direct.length) return direct
    // Also check _importedSource (PDF-imported check-in)
    const imported = sourceReportData._importedSource?.[sectionKey]?.[itemId]?._photos || []
    return imported
  }

  function renderPhotos(item: any) {
    const photos: string[] = getReportData()[sectionKey]?.[String(item.id)]?._photos || []
    const count = photos.length
    // Build "1.3"-style position label — sectionIndex comes from nav params (1-based),
    // itemIndex is 1-based position of this item within the current section's items list.
    const itemIndexInList = items.findIndex((it: any) => String(it.id) === String(item.id))
    const itemIndex = itemIndexInList >= 0 ? itemIndexInList + 1 : undefined
    const itemPosition = sectionIndex && itemIndex ? `${sectionIndex}.${itemIndex}` : undefined

    const srcPhotos = getSourcePhotos(String(item.id))

    return (
      <View style={styles.photoBlock}>
        {/* Top row: label + icon buttons */}
        <View style={styles.photosHeader}>
          <Text style={[styles.fieldLabel, dm.textLight]}>
            Photos{count > 0 ? ` (${count})` : ''}
          </Text>
          <View style={styles.photoIconBtns}>
            <TouchableOpacity style={styles.photoIconBtn} onPress={() => handleTakePhoto(item.id, item.label || item.name || '')}>
              <Text style={styles.photoIconEmoji}>📷</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoIconBtn} onPress={() => handlePickPhoto(item.id)}>
              <Text style={styles.photoIconEmoji}>🖼</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Thumbnail strip */}
        {count > 0 && (
          <NativeViewGestureHandler disallowInterruption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
              {photos.map((uri: string, idx: number) => (
                <TouchableOpacity key={idx}
                  onPress={() => navigation.navigate('ItemGallery', {
                    inspectionId, sectionKey, sectionName, itemKey: String(item.id),
                    itemName: item.label || item.name, itemPosition,
                  })}
                  onLongPress={() => Alert.alert('Remove photo?', '', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => removePhoto(item.id, idx) },
                  ])}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </NativeViewGestureHandler>
        )}
      </View>
    )
  }

  function renderVoiceNotes(item: any) {
    // Only show per-item recorder in AI instant mode
    // All other modes use the room dictation recorder at the bottom
    if (!hasAiTypist) return null

    // AI instant mode: per-item recorder widget
    // AudioRecorderWidget handles all transcribing state visually via transcribingUri prop
    return (
      <View style={styles.voiceBlock}>
        <AudioRecorderWidget
          recordings={recordings[item.id] || []}
          onRecordingComplete={async (uri, dur) => handleRecordingComplete(item, uri, dur)}
          onDeleteRecording={async (uri) => {
            setRecordings(prev => ({ ...prev, [item.id]: (prev[item.id] || []).filter((r: any) => r.file_uri !== uri) }))
          }}
          transcribingUri={transcribingUris[item.id] ?? null}
          importPrefix={`item_${inspectionId}_${item.id}`}
          compact
        />
      </View>
    )
  }

  function renderCheckInPhotos(item: any) {
    if (!isCheckOut_) return null
    const photos: string[] = sourceReportData?.[sectionKey]?.[String(item.id)]?._photos || []
    if (photos.length === 0) return null

    const expanded = ciPhotosExpanded[item.id] ?? false

    return (
      <View style={styles.ciPhotosBlock}>
        <TouchableOpacity
          style={styles.ciPhotosHeader}
          onPress={() => setCiPhotosExpanded(prev => ({ ...prev, [item.id]: !expanded }))}
          activeOpacity={0.7}
        >
          <Text style={styles.ciPhotosHeaderText}>
            📷  Check-In Photos ({photos.length})
          </Text>
          <Text style={styles.ciPhotosChevron}>{expanded ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {expanded && (
          <NativeViewGestureHandler disallowInterruption>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.ciPhotosScroll}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              {photos.map((uri, idx) => (
                <TouchableOpacity key={idx} onPress={() => setCiLightbox({ photos, index: idx })} activeOpacity={0.8}>
                  <Image source={{ uri }} style={styles.ciPhotoThumb} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </NativeViewGestureHandler>
        )}
      </View>
    )
  }

  function renderCustomItems() {
    const customItems = getCustomItems()

    return (
      <View style={styles.additionalItemsSection}>
        <View style={styles.additionalItemsHeader}>
          <Text style={styles.additionalItemsTitle}>🆕 Additional Items</Text>
          <Text style={styles.additionalItemsSubtitle}>Items added to the property during tenancy</Text>
        </View>

        {customItems.map((ci: any) => {
          const syntheticItem = { id: ci._cid, label: ci.name || 'Additional item' }
          const subs = getSubs(ci._cid)
          const actions = getItemActions(ci._cid)

          return (
            <View key={ci._cid} style={[styles.itemCard, dm.surface, { borderColor: c.border }]}>
              <View style={styles.itemHeader}>
                <TextInput
                  style={[styles.itemName, dm.text, { flex: 1 }]}
                  value={ci.name}
                  onChangeText={v => setCustomItemField(ci._cid, 'name', v)}
                  placeholder="Item name — e.g. Black plastic chair"
                  placeholderTextColor={c.textLight}
                />
                <TouchableOpacity onPress={() => removeCustomItemEntry(ci._cid, ci.name)}>
                  <Text style={styles.subItemDelete}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                <TextInput
                  style={[styles.notesInput, dm.input]}
                  value={ci.description || ''}
                  onFocus={() => handleTextFocus(ci._cid)}
                  onChangeText={v => setCustomItemField(ci._cid, 'description', v)}
                  placeholder="Describe the item…"
                  placeholderTextColor={c.textLight}
                  multiline textAlignVertical="top"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Condition at Check Out</Text>
                <TextInput
                  style={[styles.notesInput, dm.input]}
                  value={ci.checkOutCondition || ''}
                  onFocus={() => handleTextFocus(ci._cid)}
                  onChangeText={v => setCustomItemField(ci._cid, 'checkOutCondition', v)}
                  placeholder="e.g. In good order"
                  placeholderTextColor={c.textLight}
                  multiline textAlignVertical="top"
                />
              </View>

              {/* Actions / tag */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Actions</Text>
                <TouchableOpacity
                  style={[styles.actionsBtn, actions.length > 0 && styles.actionsBtnActive]}
                  onPress={() => openActionsModal(ci._cid, ci.name || 'Additional item', ci.checkOutCondition || '')}
                >
                  <Text style={[styles.actionsBtnText, actions.length === 0 && styles.actionsBtnEmpty]}>
                    {actions.length > 0
                      ? `${actions.length} action${actions.length !== 1 ? 's' : ''} — tap to edit`
                      : '+ Add action'}
                  </Text>
                </TouchableOpacity>
                {actions.length > 0 && (
                  <View style={styles.actionPillsRow}>
                    {actions.map((a: any, ai: number) => {
                      const cat = actionCatalogue.find((cc: any) => cc.id === a.actionId)
                      const col = cat?.color || '#64748b'
                      const key = a._id || `${a.actionId}_${ai}`
                      return (
                        <View key={key} style={[styles.actionPill, { backgroundColor: col + '20', borderColor: col + '60' }]}>
                          <View style={[styles.actionPillDot, { backgroundColor: col }]} />
                          <Text style={[styles.actionPillText, { color: col }]}>{cat?.name || String(a.actionId)}</Text>
                          {a.responsibility ? <Text style={[styles.actionPillResp, { color: col }]}>· {a.responsibility}</Text> : null}
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>

              {renderPhotos(syntheticItem)}

              {/* Voice note — forceNormalMode so the AI always fills description
                  + condition here, regardless of the room's check-out mode. */}
              {hasAiTypist && (
                <View style={styles.voiceBlock}>
                  {aiProcessingItem === ci._cid && (
                    <View style={styles.aiProcessingBadge}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={styles.aiProcessingText}>AI transcribing…</Text>
                    </View>
                  )}
                  <AudioRecorderWidget
                    recordings={recordings[ci._cid] || []}
                    onRecordingComplete={async (uri, dur) => handleRecordingComplete(syntheticItem, uri, dur, true)}
                    onDeleteRecording={async (uri) => {
                      setRecordings(prev => ({ ...prev, [ci._cid]: (prev[ci._cid] || []).filter((r: any) => r.file_uri !== uri) }))
                    }}
                    transcribingUri={transcribingUris[ci._cid] ?? null}
                    importPrefix={`item_${inspectionId}_${ci._cid}`}
                    compact
                  />
                </View>
              )}

              {/* Sub-items — same slide menu as regular items' subs */}
              {subs.length > 0 && (
                <View style={styles.subsContainer}>
                  <View style={styles.subsDivider} />
                  {subs.map((sub: any) => (
                    <SwipeableRow key={sub._sid} actions={getSubActions(syntheticItem, sub)}>
                      <View style={styles.subItem}>
                        <View style={styles.subItemHeader}>
                          <Text style={styles.subItemTitle}>—</Text>
                          <TouchableOpacity onPress={() => removeSubItem(ci._cid, sub._sid)}>
                            <Text style={styles.subItemDelete}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.fieldGroup}>
                          <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                          <TextInput
                            style={[styles.notesInput, dm.input]}
                            value={sub.description}
                            onChangeText={v => setSubField(ci._cid, sub._sid, 'description', v)}
                            placeholder="Describe sub-item…"
                            placeholderTextColor={c.textLight}
                            multiline textAlignVertical="top"
                          />
                        </View>
                        <View style={styles.fieldGroup}>
                          <Text style={[styles.fieldLabel, dm.textLight]}>Condition</Text>
                          <TextInput
                            style={[styles.notesInput, dm.input]}
                            value={sub.condition}
                            onChangeText={v => setSubField(ci._cid, sub._sid, 'condition', v)}
                            placeholder="e.g. Good, Fair, Worn…"
                            placeholderTextColor={c.textLight}
                            multiline textAlignVertical="top"
                          />
                        </View>
                      </View>
                    </SwipeableRow>
                  ))}
                </View>
              )}

              <TouchableOpacity style={styles.addSubItemBtn} onPress={() => addSubItem(ci._cid)}>
                <Text style={styles.addSubItemText}>+ Add Sub Item</Text>
              </TouchableOpacity>
            </View>
          )
        })}

        <TouchableOpacity style={styles.addItemBtn} onPress={addCustomItemEntry}>
          <Text style={styles.addItemText}>+ Add Additional Item</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderItem(item: any, idx: number) {
    const label = item.label || item.name || ''

    const itemLabel = item.label || item.name || 'Item'
    const isRoomItem = item.hasDescription && sectionType_ === 'room'
    // 2-column grid layout (room items): Sub-item/Rename, Copy/Copy To, Rearrange, Delete(wide)
    const itemActions = [
      ...(isRoomItem ? [{ icon: '⊕', label: 'Sub-item', bg: '#f0fdf4', onPress: () => setSubQtyModal({ itemId: item.id, label: itemLabel, count: 1 }) }] : []),
      { icon: '✏️', label: 'Rename',    bg: colors.primaryLight, onPress: () => { setRenameItemId(item.id); setRenameItemName(label); setRenameItemModal(true) } },
      { icon: '⧉',  label: 'Copy',      bg: '#e0f2fe',           onPress: () => duplicateItem(item.id, item) },
      ...(isRoomItem ? [{ icon: '⤢', label: 'Copy To', bg: '#f0f9ff', onPress: () => openCopyItemModal(item) }] : []),
      ...(isRoomItem ? [{ icon: '↗', label: 'Move To', bg: '#fdf4ff', onPress: () => openMoveItemModal(item) }] : []),
      ...(isRoomItem ? [{ icon: '☑', label: 'Move Multiple', bg: '#fdf4ff', onPress: () => openMoveMultipleModal(item.id) }] : []),
      { icon: '⇅',  label: 'Rearrange', bg: '#f5f3ff',           onPress: () => openRearrangeModal() },
      { icon: '🗑',  label: 'Delete',    bg: colors.dangerLight,  onPress: () => deleteItemConfirmed(item.id, label) },
    ]

    const isDragging  = itemDragFrom === idx
    const shift       = (itemDragFrom !== null && itemDragTo !== null && !isDragging)
      ? getItemShift(idx, itemDragFrom, itemDragTo)
      : 0
    const photoCount  = (getReportData()[sectionKey]?.[String(item.id)]?._photos as string[] | undefined)?.length ?? 0

    return (
      <Animated.View
        key={item.id}
        onLayout={(e) => {
          itemLayoutsRef.current.set(item.id, e.nativeEvent.layout.y)
          itemHeightsRef.current.set(item.id, e.nativeEvent.layout.height)
        }}
        style={
          isDragging
            ? { transform: [{ translateY: itemDragYAnim }], zIndex: 20, elevation: 8 }
            : shift !== 0
              ? { transform: [{ translateY: shift }] }
              : {}
        }
      >
      <SwipeableRow
        actions={itemActions}
        disabled={itemDragFrom !== null}
      >
      <View style={[styles.itemCard, dm.surface, { borderColor: c.border }, isDragging && styles.itemCardDragging, highlightItemId === item.id && styles.itemCardHighlighted]}>
        {/* Header */}
        <View style={styles.itemHeader}>
          <View style={styles.itemHeaderLeft}>
            <Text style={[styles.itemName, dm.text]}>{label}</Text>
            {photoCount > 0 && (
              <View style={styles.photoCountBadge}>
                <Text style={styles.photoCountText}>📷 {photoCount}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Question label for smoke/health/fire */}
        {item.question ? <Text style={[styles.questionText, dm.textMid]}>{item.question}</Text> : null}

        {/* ── ROOM ITEMS ── */}
        {sectionType_ === 'room' && (
          isCheckOut_ ? (
            /* ── CHECK OUT layout ── */
            <>
              {/* Description — read-only from check-in */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                <View style={[styles.coReadOnly, dm.muted, { borderColor: c.border }]}>
                  <Text style={[styles.coReadOnlyText, dm.textMid]}>{getField(item.id, 'description') || '—'}</Text>
                </View>
              </View>
              {/* Condition at Check In — read-only */}
              <View style={styles.fieldGroup}>
                <View style={styles.coLabelRow}>
                  <Text style={[styles.fieldLabel, dm.textLight]}>Condition at Check In</Text>
                  <View style={styles.coInvBadge}><Text style={styles.coInvBadgeText}>Inventory</Text></View>
                </View>
                <View style={[styles.coReadOnly, dm.muted, { borderColor: c.border }]}>
                  <Text style={[styles.coReadOnlyText, dm.textMid]}>{getField(item.id, 'inventoryCondition') || '—'}</Text>
                </View>
              </View>
              {/* Check-In reference photos — collapsible, for visual comparison */}
              {renderCheckInPhotos(item)}

              {/* Condition at Check Out — editable, one line per condition.
                   "As Inventory+" is auto-set on first focus (means item matches check-in,
                   any extra conditions are appended below it on new lines). */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Condition at Check Out</Text>
                <TextInput
                  style={[styles.notesInput, dm.input]}
                  value={getField(item.id, 'checkOutCondition')}
                  onFocus={() => {
                    handleTextFocus(item.id)
                    if (!getField(item.id, 'checkOutCondition')) {
                      setField(item.id, 'checkOutCondition', 'As Inventory+')
                    }
                  }}
                  onChangeText={v => setField(item.id, 'checkOutCondition', v)}
                  placeholder="As Inventory+"
                  placeholderTextColor={c.textLight}
                  multiline textAlignVertical="top"
                />
              </View>
              {/* Actions */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, dm.textLight]}>Actions</Text>
                <TouchableOpacity
                  style={[styles.actionsBtn, getItemActions(item.id).length > 0 && styles.actionsBtnActive]}
                  onPress={() => openActionsModal(item.id, item.label || item.name || '', getField(item.id, 'checkOutCondition'))}
                >
                  <Text style={[styles.actionsBtnText, getItemActions(item.id).length === 0 && styles.actionsBtnEmpty]}>
                    {getItemActions(item.id).length > 0
                      ? `${getItemActions(item.id).length} action${getItemActions(item.id).length !== 1 ? 's' : ''} — tap to edit`
                      : '+ Add action'}
                  </Text>
                </TouchableOpacity>
                {getItemActions(item.id).length > 0 && (
                  <View style={styles.actionPillsRow}>
                    {getItemActions(item.id).map((a: any, ai: number) => {
                      const cat = actionCatalogue.find((c: any) => c.id === a.actionId)
                      const col = cat?.color || '#64748b'
                      const key = a._id || `${a.actionId}_${ai}`
                      return (
                        <View key={key} style={[styles.actionPill, { backgroundColor: col + '20', borderColor: col + '60' }]}>
                          <View style={[styles.actionPillDot, { backgroundColor: col }]} />
                          <Text style={[styles.actionPillText, { color: col }]}>{cat?.name || String(a.actionId)}</Text>
                          {a.responsibility ? <Text style={[styles.actionPillResp, { color: col }]}>· {a.responsibility}</Text> : null}
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>
            </>
          ) : (
            /* ── CHECK IN layout ── */
            <>
              {!isDamageReport_ && (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                  <TextInput
                    style={[styles.notesInput, dm.input]}
                    value={getField(item.id, 'description')}
                    onFocus={() => handleTextFocus(item.id)}
                    onChangeText={v => setField(item.id, 'description', v)}
                    placeholder="Describe item appearance, state, notes…"
                    placeholderTextColor={c.textLight}
                    multiline textAlignVertical="top"
                  />
                </View>
              )}
              {item.hasCondition !== false && (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, dm.textLight]}>
                    {item.answerOptions?.length ? item.label : 'Condition'}
                  </Text>
                  {item.answerOptions?.length ? (
                    /* Question-type item: tap-to-select pill buttons */
                    <View style={styles.answerOptionRow}>
                      {item.answerOptions.map((opt: string) => {
                        const selected = getField(item.id, 'condition') === opt
                        return (
                          <TouchableOpacity
                            key={opt}
                            style={[styles.answerOptBtn, selected && styles.answerOptBtnSelected]}
                            onPress={() => setField(item.id, 'condition', selected ? '' : opt)}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.answerOptText, selected && styles.answerOptTextSelected]}>
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ) : (
                    <TextInput
                      style={[styles.notesInput, dm.input]}
                      value={getField(item.id, 'condition')}
                      onFocus={() => handleTextFocus(item.id)}
                      onChangeText={v => setField(item.id, 'condition', v)}
                      placeholder="e.g. Good, Fair, Worn, Damaged…"
                      placeholderTextColor={c.textLight}
                      multiline textAlignVertical="top"
                    />
                  )}
                </View>
              )}
            </>
          )
        )}

        {/* ── FIXED: condition_summary — condition text box ── */}
        {item.hasConditionText && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Condition</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'condition')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'condition', v)}
              placeholder="Describe condition…"
              placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Answer — smoke alarms, health & safety, fire door */}
        {item.hasAnswer && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Answer</Text>
            <OptionPicker options={ANSWER_OPTIONS} value={getField(item.id, 'answer')} onSelect={v => setField(item.id, 'answer', v)} />
          </View>
        )}

        {/* Notes — smoke/health/fire door */}
        {item.hasNotes && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Notes</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'notes')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'notes', v)}
              placeholder="Notes…" placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Cleanliness — cleaning summary — dropdown */}
        {item.hasCleanliness && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Cleanliness</Text>
            <TouchableOpacity
              style={styles.dropdownBtn}
              onPress={() => { setCleanlinessItemId(item.id); setCleanlinessOpen(true) }}
            >
              <Text style={[styles.dropdownBtnText, !getField(item.id, 'cleanliness') && styles.dropdownBtnPlaceholder]}>
                {getField(item.id, 'cleanliness') || 'Select cleanliness…'}
              </Text>
              <Text style={styles.dropdownChevron}>▾</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Cleanliness notes */}
        {item.hasCleanlinessNotes && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Additional Notes</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'cleanlinessNotes')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'cleanlinessNotes', v)}
              placeholder="Additional notes…" placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Keys — description */}
        {item.hasDescription && sectionType_ !== 'room' && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'description')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'description', v)}
              placeholder="e.g. 2 × Yale keys…"
              placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Location / serial */}
        {item.hasLocationSerial && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Location / Serial</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'locationSerial')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'locationSerial', v)}
              placeholder={'Located to [location]\nSerial Number: [number]'}
              placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Meter reading */}
        {item.hasReading && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, dm.textLight]}>Reading</Text>
            <TextInput
              style={[styles.notesInput, dm.input]}
              value={getField(item.id, 'reading')}
              onFocus={() => handleTextFocus(item.id)}
              onChangeText={v => setField(item.id, 'reading', v)}
              placeholder="e.g. 12345.6" placeholderTextColor={c.textLight}
              multiline textAlignVertical="top"
            />
          </View>
        )}

        {/* Check-In reference photos — fixed sections only; room items handled above */}
        {sectionType_ !== 'room' && renderCheckInPhotos(item)}

        {/* Photos */}
        {renderPhotos(item)}

        {/* Voice notes for main item — always above sub-items */}
        {renderVoiceNotes(item)}

        {/* Sub-items — only for room items */}
        {sectionType_ === 'room' && getSubs(item.id).length > 0 && (
          <View
            style={styles.subsContainer}
            onLayout={(e) => subContainerLayoutsRef.current.set(item.id, e.nativeEvent.layout.y)}
          >
            <View style={styles.subsDivider} />
            {getSubs(item.id).map((sub: any, idx: number) => (
              isCheckOut_ ? (
                /* ── CHECK OUT sub-item: read-only CI fields + editable CO condition ── */
                <SwipeableRow key={sub._sid} actions={getSubActions(item, sub)}>
                <View
                  style={[styles.subItem, highlightSubId === sub._sid && styles.subItemHighlighted]}
                  onLayout={(e) => subItemLayoutsRef.current.set(sub._sid, e.nativeEvent.layout.y)}
                >
                  <View style={styles.subItemHeader}>
                    <Text style={styles.subItemTitle} numberOfLines={1}>
                      {sub.description ? sub.description.split('\n')[0] : `Sub-item ${idx + 1}`}
                    </Text>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                    <View style={[styles.coReadOnly, dm.muted, { borderColor: c.border }]}>
                      <Text style={[styles.coReadOnlyText, dm.textMid]}>{sub.description || '—'}</Text>
                    </View>
                  </View>
                  <View style={styles.fieldGroup}>
                    <View style={styles.coLabelRow}>
                      <Text style={[styles.fieldLabel, dm.textLight]}>Condition at Check In</Text>
                      <View style={styles.coInvBadge}><Text style={styles.coInvBadgeText}>Inventory</Text></View>
                    </View>
                    <View style={[styles.coReadOnly, dm.muted, { borderColor: c.border }]}>
                      <Text style={[styles.coReadOnlyText, dm.textMid]}>{sub.inventoryCondition || sub.condition || '—'}</Text>
                    </View>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, dm.textLight]}>Condition at Check Out</Text>
                    <TextInput
                      style={[styles.notesInput, dm.input]}
                      value={sub.checkOutCondition || ''}
                      onFocus={() => {
                        handleTextFocus(item.id, sub._sid)
                        if (!sub.checkOutCondition) {
                          setSubField(item.id, sub._sid, 'checkOutCondition', 'As Inventory+')
                        }
                      }}
                      onChangeText={v => setSubField(item.id, sub._sid, 'checkOutCondition', v)}
                      placeholder="As Inventory+"
                      placeholderTextColor={c.textLight}
                      multiline textAlignVertical="top"
                    />
                  </View>
                  {/* Sub-item Actions — same modal as main items, keyed by _sid */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, dm.textLight]}>Actions</Text>
                    <TouchableOpacity
                      style={[styles.actionsBtn, getItemActions(sub._sid).length > 0 && styles.actionsBtnActive]}
                      onPress={() => openActionsModal(
                        sub._sid,
                        `${item.label || item.name || 'Item'} — ${sub.description || 'Sub-item'}`,
                        sub.checkOutCondition || ''
                      )}
                    >
                      <Text style={[styles.actionsBtnText, getItemActions(sub._sid).length === 0 && styles.actionsBtnEmpty]}>
                        {getItemActions(sub._sid).length > 0
                          ? `${getItemActions(sub._sid).length} action${getItemActions(sub._sid).length !== 1 ? 's' : ''} — tap to edit`
                          : '+ Add action'}
                      </Text>
                    </TouchableOpacity>
                    {getItemActions(sub._sid).length > 0 && (
                      <View style={styles.actionPillsRow}>
                        {getItemActions(sub._sid).map((a: any, ai: number) => {
                          const cat = actionCatalogue.find((c: any) => c.id === a.actionId)
                          const col = cat?.color || '#64748b'
                          const key = a._id || `${a.actionId}_${ai}`
                          return (
                            <View key={key} style={[styles.actionPill, { backgroundColor: col + '20', borderColor: col + '60' }]}>
                              <View style={[styles.actionPillDot, { backgroundColor: col }]} />
                              <Text style={[styles.actionPillText, { color: col }]}>{cat?.name || String(a.actionId)}</Text>
                              {a.responsibility ? <Text style={[styles.actionPillResp, { color: col }]}>· {a.responsibility}</Text> : null}
                            </View>
                          )
                        })}
                      </View>
                    )}
                  </View>
                  {/* Per-sub-item recorder — AI instant mode */}
                  {hasAiTypist && (
                    <View style={[styles.voiceBlock, { marginTop: 8 }]}>
                      {aiProcessingItem === sub._sid && (
                        <View style={styles.aiProcessingBadge}>
                          <ActivityIndicator size="small" color={colors.accent} />
                          <Text style={styles.aiProcessingText}>AI transcribing…</Text>
                        </View>
                      )}
                      <AudioRecorderWidget
                        recordings={recordings[sub._sid] || []}
                        onRecordingComplete={async (uri, dur) =>
                          handleSubItemRecordingComplete(
                            item.id, sub._sid,
                            sub.description || 'Sub-item',
                            uri, dur
                          )
                        }
                        onDeleteRecording={async (uri) => {
                          setRecordings(prev => ({ ...prev, [sub._sid]: (prev[sub._sid] || []).filter((r: any) => r.file_uri !== uri) }))
                        }}
                        transcribingUri={transcribingUris[sub._sid] ?? null}
                        compact
                      />
                    </View>
                  )}
                </View>
                </SwipeableRow>
              ) : (
                /* ── CHECK IN sub-item: editable description + condition ── */
                <SwipeableRow key={sub._sid} actions={getSubActions(item, sub)}>
                <View
                  style={[styles.subItem, highlightSubId === sub._sid && styles.subItemHighlighted]}
                  onLayout={(e) => subItemLayoutsRef.current.set(sub._sid, e.nativeEvent.layout.y)}
                >
                  <View style={styles.subItemHeader}>
                    <Text style={styles.subItemTitle}>—</Text>
                    <TouchableOpacity onPress={() => removeSubItem(item.id, sub._sid)}>
                      <Text style={styles.subItemDelete}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, dm.textLight]}>Description</Text>
                    <TextInput
                      style={[styles.notesInput, dm.input]}
                      value={sub.description}
                      onFocus={() => handleTextFocus(item.id, sub._sid)}
                      onChangeText={v => setSubField(item.id, sub._sid, 'description', v)}
                      placeholder="Describe sub-item…"
                      placeholderTextColor={c.textLight}
                      multiline textAlignVertical="top"
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, dm.textLight]}>Condition</Text>
                    <TextInput
                      style={[styles.notesInput, dm.input]}
                      value={sub.condition}
                      onFocus={() => handleTextFocus(item.id, sub._sid)}
                      onChangeText={v => setSubField(item.id, sub._sid, 'condition', v)}
                      placeholder="e.g. Good, Fair, Worn…"
                      placeholderTextColor={c.textLight}
                      multiline textAlignVertical="top"
                    />
                  </View>
                  {/* Per-sub-item recorder — AI typist only */}
                  {hasAiTypist && (
                    <View style={[styles.voiceBlock, { marginTop: 8 }]}>
                      {aiProcessingItem === sub._sid && (
                        <View style={styles.aiProcessingBadge}>
                          <ActivityIndicator size="small" color={colors.accent} />
                          <Text style={styles.aiProcessingText}>AI transcribing…</Text>
                        </View>
                      )}
                      <AudioRecorderWidget
                        recordings={recordings[sub._sid] || []}
                        onRecordingComplete={async (uri, dur) =>
                          handleSubItemRecordingComplete(
                            item.id, sub._sid,
                            `${item.label || item.name} — Sub-item ${idx + 1}`,
                            uri, dur
                          )
                        }
                        onDeleteRecording={async (uri) => {
                          setRecordings(prev => ({ ...prev, [sub._sid]: (prev[sub._sid] || []).filter((r: any) => r.file_uri !== uri) }))
                        }}
                        compact
                      />
                    </View>
                  )}
                </View>
                </SwipeableRow>
              )
            ))}
          </View>
        )}

      </View>
      </SwipeableRow>
      </Animated.View>
    )
  }

  // In landscape the header scrolls with the content so the keyboard doesn't
  // push it off screen and steal vertical space from the form fields.
  const headerBlock = (
    <>
      <Header title={sectionName} subtitle={activeInspection?.property_address} onBack={() => navigation.goBack()} />
      {typistMode_ === 'ai_instant' && (
        <View style={styles.aiBanner}>
          <Text style={styles.aiBannerIcon}>✨</Text>
          <Text style={styles.aiBannerText}>AI Instant — tap 🎙 next to each item to fill fields automatically</Text>
        </View>
      )}
      {typistMode_ === 'ai_room' && (
        <View style={styles.aiBanner}>
          <Text style={styles.aiBannerIcon}>✨</Text>
          <Text style={styles.aiBannerText}>AI by Room — record the whole room, then tap Transcribe to fill fields</Text>
        </View>
      )}
      {typistMode_ === 'human' && (
        <View style={[styles.aiBanner, styles.aiBannerHuman]}>
          <Text style={styles.aiBannerIcon}>🎙</Text>
          <Text style={styles.aiBannerText}>Human Typist assigned — record audio below, it will sync to the typist</Text>
        </View>
      )}
      {aiError ? (
        <View style={styles.aiErrorBanner}>
          <Text style={styles.aiErrorText}>⚠️ {aiError}</Text>
          <TouchableOpacity onPress={() => setAiError('')}><Text style={styles.aiErrorDismiss}>✕</Text></TouchableOpacity>
        </View>
      ) : null}
    </>
  )

  const hasDictationRecorder = (typistMode_ === 'ai_room' || typistMode_ === 'human')

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={{ flex: 1 }}>
      {/* Outer: row in landscape so sidebar sits beside content; column in portrait */}
      <View style={[styles.screen, dm.bg, { paddingTop: insets.top, flexDirection: isLandscape ? 'row' : 'column' }]}>

        {/* Main content area — flex:1 so it doesn't squeeze when sidebar is present */}
        <View style={{ flex: 1 }}>
        {/* Portrait: header fixed above scroll. Landscape: header scrolls with content
            so the keyboard doesn't eat the fixed header space on small screens. */}
        {!isLandscape && headerBlock}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : (
          <ScrollView
            ref={itemScrollRef}
            onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height }}
            onScroll={(e) => { itemScrollOffsetRef.current = e.nativeEvent.contentOffset.y }}
            scrollEventThrottle={16}
            contentContainerStyle={[
              styles.scroll,
              {
                // Base padding for the dictation bar in portrait; always grow
                // by keyboardHeight so the focused field can reach the top of
                // the visible area on any device, regardless of keyboard mode.
                paddingBottom: Math.max(
                  sectionType_ === 'room' && hasDictationRecorder && !isLandscape ? 140 : 20,
                  keyboardHeight + 32,
                ),
              },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {isLandscape && headerBlock}
            {/* ── Room Overview Photos ──────────────────────────────────── */}
            {sectionType_ === 'room' && (() => {
              const ovPhotos = getOverviewPhotos()
              return (
                <View
                  style={styles.overviewBlock}
                  onLayout={(e) => {
                    overviewLayoutRef.current = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }
                  }}
                >
                  <View style={styles.overviewHeader}>
                    <View>
                      <Text style={styles.overviewTitle}>Room Overview</Text>
                      <Text style={styles.overviewSub}>
                        {ovPhotos.length > 0
                          ? `${ovPhotos.length} photo${ovPhotos.length !== 1 ? 's' : ''}`
                          : 'Photos from each corner of the room'}
                      </Text>
                    </View>
                    <View style={styles.overviewBtns}>
                      <TouchableOpacity style={styles.overviewIconBtn} onPress={handleTakeOverviewPhoto}>
                        <Text style={styles.overviewIconEmoji}>📷</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.overviewIconBtn} onPress={handlePickOverviewPhoto}>
                        <Text style={styles.overviewIconEmoji}>🖼</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {ovPhotos.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.overviewStrip}>
                      {ovPhotos.map((uri: string, idx: number) => (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => navigation.navigate('ItemGallery', {
                            inspectionId,
                            sectionKey,
                            sectionName,
                            itemKey: '_overview',
                            itemName: 'Room Overview',
                          })}
                          onLongPress={() => Alert.alert('Remove overview photo?', '', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => removeOverviewPhoto(idx) },
                          ])}
                        >
                          <Image source={{ uri }} style={styles.overviewThumb} />
                          <View style={styles.overviewThumbNum}>
                            <Text style={styles.overviewThumbNumText}>{idx + 1}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {isCheckOut_ && (() => {
                    const ciOvPhotos = getSourcePhotos('_overview')
                    if (ciOvPhotos.length === 0) return null
                    return (
                      <View style={styles.ciPhotosBlock}>
                        <TouchableOpacity
                          style={styles.ciPhotosHeader}
                          onPress={() => setCiOverviewExpanded(v => !v)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.ciPhotosHeaderText}>
                            📷  Check-In Photos ({ciOvPhotos.length})
                          </Text>
                          <Text style={styles.ciPhotosChevron}>{ciOverviewExpanded ? '▴' : '▾'}</Text>
                        </TouchableOpacity>
                        {ciOverviewExpanded && (
                          <NativeViewGestureHandler disallowInterruption>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.ciPhotosScroll}
                              contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                            >
                              {ciOvPhotos.map((uri, idx) => (
                                <TouchableOpacity key={idx} onPress={() => setCiLightbox({ photos: ciOvPhotos, index: idx })} activeOpacity={0.8}>
                                  <Image source={{ uri }} style={styles.ciPhotoThumb} resizeMode="cover" />
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </NativeViewGestureHandler>
                        )}
                      </View>
                    )
                  })()}
                </View>
              )
            })()}

            {/* ── AI Condition Summary button — condition_summary sections only ── */}
            {sectionType_ === 'condition_summary' && (
              <TouchableOpacity
                style={[styles.aiCondSumBtn, aiCondSumLoading && styles.aiCondSumBtnBusy]}
                onPress={handleAiConditionSummary}
                disabled={aiCondSumLoading}
                activeOpacity={0.75}
              >
                {aiCondSumLoading ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.aiCondSumBtnText}>Generating summary…</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.aiCondSumBtnIcon}>✨</Text>
                    <Text style={styles.aiCondSumBtnText}>AI Condition Summary</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

                        {items.length > 0 && (
              <Text style={styles.swipeHint}>← Swipe left or right for options →</Text>
            )}
            {items.length === 0 && (
              <View style={styles.emptyNote}>
                <Text style={styles.emptyNoteText}>No items yet. Tap "+ Add Item" to add one.</Text>
              </View>
            )}
            {items.map((item, idx) => renderItem(item, idx))}
            <TouchableOpacity style={styles.addItemBtn} onPress={() => setAddItemModal(true)}>
              <Text style={styles.addItemText}>+ Add Item</Text>
            </TouchableOpacity>
            {isCheckOut_ && sectionType_ === 'room' && renderCustomItems()}
            <View style={{ height: 20 }} />
          </ScrollView>
        )}

        </View>{/* end main content area */}

        {/* Room dictation recorder — fixed at bottom (portrait) or right sidebar (landscape) */}
        {sectionType_ === 'room' && (typistMode_ === 'ai_room' || typistMode_ === 'human') && (
          <RoomDictationRecorder
            inspectionId={inspectionId}
            sectionKey={sectionKey}
            sectionName={sectionName}
            sectionType="room"
            isDamageReport={isDamageReport_}
            items={items.map((it: any): RoomDictationItem => ({
              id:             it.id,
              name:           it.label || it.name || '',
              hasCondition:   it.hasCondition !== false,
              hasDescription: it.hasDescription !== false,
              isTranscribed:  !!getField(it.id, '_transcribed'),
              subs: isCheckOut_
                ? getSubs(it.id).map((s: any) => ({ _sid: s._sid, description: s.description || '' }))
                : undefined,
            }))}
            onTranscribed={handleRoomTranscribed}
            showAiButton={typistMode_ === 'ai_room'}
            isLandscape={isLandscape}
            showCameraToggle={showFloatingCamera}
            cameraVisible={cameraPreviewVisible}
            onCameraToggle={() => setCameraPreviewVisible(v => !v)}
          />
        )}

        {/* Room dictation recorder — fixed sections (all types) */}
        {sectionType_ !== 'room' && (typistMode_ === 'ai_room' || typistMode_ === 'human') && (
          <RoomDictationRecorder
            inspectionId={inspectionId}
            sectionKey={sectionKey}
            sectionName={sectionName}
            sectionType={sectionType_}
            items={items.map((it: any): RoomDictationItem => ({
              id:   it.id,
              name: it.name || it.label || it.question || '',
            }))}
            onTranscribed={handleFixedRoomTranscribed}
            showAiButton={typistMode_ === 'ai_room'}
            isLandscape={isLandscape}
          />
        )}

        {/* Floating camera preview — landscape + floating option only */}
        {showFloatingCamera && cameraPreviewVisible && (
          <FloatingCameraPreview
            inspectionId={inspectionId}
            onCapture={handleFloatingCapture}
          />
        )}

        {/* ── Check-In photo lightbox — read-only ───────────────────────────── */}
        <Modal
          visible={!!ciLightbox}
          animationType="fade"
          statusBarTranslucent
          onRequestClose={closeCiLightbox}
        >
          <View style={ciLbStyles.screen}>
            {ciLightbox && (
              <>
                <FlatList
                  data={ciLightbox.photos}
                  keyExtractor={(_, i) => String(i)}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={ciScrollEnabled}
                  style={StyleSheet.absoluteFill}
                  initialScrollIndex={ciLightbox.index}
                  getItemLayout={(_, index) => ({ length: winWidth, offset: winWidth * index, index })}
                  renderItem={({ item: uri }) => (
                    <View style={{ width: winWidth, height: winHeight, justifyContent: 'center', alignItems: 'center' }}>
                      <GestureDetector gesture={ciZoomGesture}>
                        <Animated.Image
                          source={{ uri }}
                          style={{ width: winWidth, height: winHeight, transform: [{ scale: ciScale }] }}
                          resizeMode="contain"
                        />
                      </GestureDetector>
                    </View>
                  )}
                  onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / winWidth)
                    setCiLightbox(prev => prev ? { ...prev, index: i } : prev)
                    ciLastScale.current = 1
                    ciScale.setValue(1)
                    setCiScrollEnabled(true)
                  }}
                />
                <TouchableOpacity
                  style={[ciLbStyles.closeBtn, { top: insets.top + 12 }]}
                  onPress={closeCiLightbox}
                >
                  <Text style={ciLbStyles.closeBtnText}>✕</Text>
                </TouchableOpacity>
                <View style={[ciLbStyles.counter, { top: insets.top + 16 }]}>
                  <Text style={ciLbStyles.counterText}>
                    {ciLightbox.index + 1} / {ciLightbox.photos.length}{'  ·  '}pinch or double-tap to zoom
                  </Text>
                </View>
                <View style={[ciLbStyles.badge, { bottom: insets.bottom + 24 }]}>
                  <Text style={ciLbStyles.badgeText}>📋 Check-In Reference — Read Only</Text>
                </View>
              </>
            )}
          </View>
        </Modal>

        {/* Cleanliness dropdown modal */}
        <Modal visible={cleanlinessOpen} transparent animationType="fade">
          <View style={mStyles.overlay}>
            <View style={mStyles.box}>
              <Text style={mStyles.title}>Cleanliness</Text>
              <View style={styles.dropdownList}>
                <TouchableOpacity
                  style={styles.dropdownListItem}
                  onPress={() => { setField(cleanlinessItemId, 'cleanliness', ''); setCleanlinessOpen(false) }}
                >
                  <Text style={[styles.dropdownListItemText, styles.dropdownListItemPlaceholder]}>Clear selection</Text>
                </TouchableOpacity>
                {CLEANLINESS_OPTIONS.map(opt => {
                  const isSelected = getField(cleanlinessItemId, 'cleanliness') === opt
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.dropdownListItem, isSelected && styles.dropdownListItemActive]}
                      onPress={() => { setField(cleanlinessItemId, 'cleanliness', opt); setCleanlinessOpen(false) }}
                    >
                      <Text style={[styles.dropdownListItemText, isSelected && styles.dropdownListItemTextActive]}>
                        {opt}
                      </Text>
                      {isSelected && <Text style={styles.dropdownCheck}>✓</Text>}
                    </TouchableOpacity>
                  )
                })}
              </View>
              <TouchableOpacity style={[mStyles.cancel, { marginTop: spacing.sm }]} onPress={() => setCleanlinessOpen(false)}>
                <Text style={mStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Sub-item quantity modal */}
        <Modal visible={!!subQtyModal} transparent animationType="fade">
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '75%' }]}>
              <Text style={mStyles.title}>Add Sub-items</Text>
              <Text style={{ fontSize: 13, color: colors.textMid, marginBottom: 16 }}>
                {subQtyModal?.label}
              </Text>
              {/* +/- stepper */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => subQtyModal && subQtyModal.count > 1 && setSubQtyModal({ ...subQtyModal, count: subQtyModal.count - 1 })}
                  style={subQtyStyles.stepBtn}
                >
                  <Text style={subQtyStyles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={subQtyStyles.countText}>{subQtyModal?.count ?? 1}</Text>
                <TouchableOpacity
                  onPress={() => subQtyModal && subQtyModal.count < 10 && setSubQtyModal({ ...subQtyModal, count: subQtyModal.count + 1 })}
                  style={subQtyStyles.stepBtn}
                >
                  <Text style={subQtyStyles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <View style={mStyles.actions}>
                <TouchableOpacity style={mStyles.cancel} onPress={() => setSubQtyModal(null)}>
                  <Text style={mStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={mStyles.confirm}
                  onPress={async () => {
                    if (subQtyModal) {
                      await addSubItems(subQtyModal.itemId, subQtyModal.count)
                      setSubQtyModal(null)
                    }
                  }}
                >
                  <Text style={mStyles.confirmText}>
                    Add {subQtyModal?.count === 1 ? '1 Sub-item' : `${subQtyModal?.count} Sub-items`}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Copy item to room modal ───────────────────────────────────── */}
        <Modal visible={!!copyItemModal} transparent animationType="fade" onRequestClose={() => setCopyItemModal(null)}>
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '88%', maxHeight: '80%', padding: 0, overflow: 'hidden' }]}>
              {/* Header */}
              <View style={ciStyles.header}>
                <Text style={ciStyles.title}>Copy to Room</Text>
                <Text style={ciStyles.sub} numberOfLines={1}>
                  {copyItemModal?.item?.label || copyItemModal?.item?.name || 'Item'}
                </Text>
              </View>

              <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                {/* What to include */}
                <View style={ciStyles.section}>
                  <Text style={ciStyles.sectionLabel}>Include</Text>
                  {[
                    { label: 'Descriptions', value: copyDescs, set: setCopyDescs },
                    { label: 'Conditions',   value: copyConds, set: setCopyConds },
                    { label: 'Photos',       value: copyPhotos, set: setCopyPhotos },
                  ].map(({ label, value, set }) => (
                    <TouchableOpacity key={label} style={ciStyles.checkRow} onPress={() => set(!value)} activeOpacity={0.7}>
                      <View style={[ciStyles.checkbox, value && ciStyles.checkboxOn]}>
                        {value && <Text style={ciStyles.checkmark}>✓</Text>}
                      </View>
                      <Text style={ciStyles.checkLabel}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Room picker */}
                <View style={ciStyles.section}>
                  <Text style={ciStyles.sectionLabel}>Destination Room</Text>
                  {copyRoomsLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                  ) : copyRoomsList.length === 0 ? (
                    <Text style={ciStyles.emptyRooms}>No other rooms available.</Text>
                  ) : (
                    copyRoomsList.map(room => (
                      <TouchableOpacity
                        key={room.key}
                        style={[ciStyles.roomRow, copyTargetKey === room.key && ciStyles.roomRowSelected]}
                        onPress={() => setCopyTargetKey(room.key)}
                        activeOpacity={0.7}
                      >
                        <View style={[ciStyles.radio, copyTargetKey === room.key && ciStyles.radioSelected]}>
                          {copyTargetKey === room.key && <View style={ciStyles.radioDot} />}
                        </View>
                        <Text style={[ciStyles.roomName, copyTargetKey === room.key && ciStyles.roomNameSelected]}>
                          {room.name}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </ScrollView>

              {/* Actions */}
              <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <TouchableOpacity style={mStyles.cancel} onPress={() => setCopyItemModal(null)}>
                  <Text style={mStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[mStyles.confirm, (!copyTargetKey || copyingItem) && { backgroundColor: colors.borderDark }]}
                  onPress={commitCopyItemToRoom}
                  disabled={!copyTargetKey || copyingItem}
                >
                  {copyingItem
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={mStyles.confirmText}>Copy Item</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Move item to room modal ───────────────────────────────────── */}
        <Modal visible={!!moveItemModal} transparent animationType="fade" onRequestClose={() => setMoveItemModal(null)}>
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '88%', maxHeight: '80%', padding: 0, overflow: 'hidden' }]}>
              {/* Header */}
              <View style={ciStyles.header}>
                <Text style={ciStyles.title}>Move to Room</Text>
                <Text style={ciStyles.sub} numberOfLines={1}>
                  {moveItemModal?.item?.label || moveItemModal?.item?.name || 'Item'}
                </Text>
              </View>

              <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                {/* What to include */}
                <View style={ciStyles.section}>
                  <Text style={ciStyles.sectionLabel}>Include</Text>
                  {[
                    { label: 'Descriptions', value: moveDescs, set: setMoveDescs },
                    { label: 'Conditions',   value: moveConds, set: setMoveConds },
                    { label: 'Photos',       value: movePhotos, set: setMovePhotos },
                  ].map(({ label, value, set }) => (
                    <TouchableOpacity key={label} style={ciStyles.checkRow} onPress={() => set(!value)} activeOpacity={0.7}>
                      <View style={[ciStyles.checkbox, value && ciStyles.checkboxOn]}>
                        {value && <Text style={ciStyles.checkmark}>✓</Text>}
                      </View>
                      <Text style={ciStyles.checkLabel}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Room picker */}
                <View style={ciStyles.section}>
                  <Text style={ciStyles.sectionLabel}>Destination Room</Text>
                  {copyRoomsLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                  ) : copyRoomsList.length === 0 ? (
                    <Text style={ciStyles.emptyRooms}>No other rooms available.</Text>
                  ) : (
                    copyRoomsList.map(room => (
                      <TouchableOpacity
                        key={room.key}
                        style={[ciStyles.roomRow, moveTargetKey === room.key && ciStyles.roomRowSelected]}
                        onPress={() => setMoveTargetKey(room.key)}
                        activeOpacity={0.7}
                      >
                        <View style={[ciStyles.radio, moveTargetKey === room.key && ciStyles.radioSelected]}>
                          {moveTargetKey === room.key && <View style={ciStyles.radioDot} />}
                        </View>
                        <Text style={[ciStyles.roomName, moveTargetKey === room.key && ciStyles.roomNameSelected]}>
                          {room.name}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </ScrollView>

              {/* Actions */}
              <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <TouchableOpacity style={mStyles.cancel} onPress={() => setMoveItemModal(null)}>
                  <Text style={mStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[mStyles.confirm, (!moveTargetKey || movingItem) && { backgroundColor: colors.borderDark }]}
                  onPress={commitMoveItemToRoom}
                  disabled={!moveTargetKey || movingItem}
                >
                  {movingItem
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={mStyles.confirmText}>Move Item</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Move MULTIPLE items to room modal ─────────────────────────── */}
        <Modal visible={moveMultipleModal} transparent animationType="fade" onRequestClose={() => setMoveMultipleModal(false)}>
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '88%', maxHeight: '80%', padding: 0, overflow: 'hidden' }]}>
              <View style={ciStyles.header}>
                <Text style={ciStyles.title}>Move Multiple Items</Text>
                <Text style={ciStyles.sub}>
                  {moveMultipleSelected.size} item{moveMultipleSelected.size !== 1 ? 's' : ''} selected
                </Text>
              </View>

              {moveMultipleStep === 'select' ? (
                <>
                  <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Select items to move</Text>
                      {items.filter(it => it.hasDescription).map(it => {
                        const checked = moveMultipleSelected.has(it.id)
                        return (
                          <TouchableOpacity
                            key={it.id}
                            style={ciStyles.checkRow}
                            onPress={() => toggleMoveMultipleSelected(it.id)}
                            activeOpacity={0.7}
                          >
                            <View style={[ciStyles.checkbox, checked && ciStyles.checkboxOn]}>
                              {checked && <Text style={ciStyles.checkmark}>✓</Text>}
                            </View>
                            <Text style={ciStyles.checkLabel}>{it.label || it.name}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </ScrollView>
                  <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <TouchableOpacity style={mStyles.cancel} onPress={() => setMoveMultipleModal(false)}>
                      <Text style={mStyles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[mStyles.confirm, moveMultipleSelected.size === 0 && { backgroundColor: colors.borderDark }]}
                      onPress={() => setMoveMultipleStep('target')}
                      disabled={moveMultipleSelected.size === 0}
                    >
                      <Text style={mStyles.confirmText}>Next</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Include</Text>
                      {[
                        { label: 'Descriptions', value: moveDescs, set: setMoveDescs },
                        { label: 'Conditions',   value: moveConds, set: setMoveConds },
                        { label: 'Photos',       value: movePhotos, set: setMovePhotos },
                      ].map(({ label, value, set }) => (
                        <TouchableOpacity key={label} style={ciStyles.checkRow} onPress={() => set(!value)} activeOpacity={0.7}>
                          <View style={[ciStyles.checkbox, value && ciStyles.checkboxOn]}>
                            {value && <Text style={ciStyles.checkmark}>✓</Text>}
                          </View>
                          <Text style={ciStyles.checkLabel}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Destination Room</Text>
                      {copyRoomsLoading ? (
                        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                      ) : copyRoomsList.length === 0 ? (
                        <Text style={ciStyles.emptyRooms}>No other rooms available.</Text>
                      ) : (
                        copyRoomsList.map(room => (
                          <TouchableOpacity
                            key={room.key}
                            style={[ciStyles.roomRow, moveTargetKey === room.key && ciStyles.roomRowSelected]}
                            onPress={() => setMoveTargetKey(room.key)}
                            activeOpacity={0.7}
                          >
                            <View style={[ciStyles.radio, moveTargetKey === room.key && ciStyles.radioSelected]}>
                              {moveTargetKey === room.key && <View style={ciStyles.radioDot} />}
                            </View>
                            <Text style={[ciStyles.roomName, moveTargetKey === room.key && ciStyles.roomNameSelected]}>
                              {room.name}
                            </Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  </ScrollView>
                  <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <TouchableOpacity style={mStyles.cancel} onPress={() => setMoveMultipleStep('select')}>
                      <Text style={mStyles.cancelText}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[mStyles.confirm, (!moveTargetKey || movingMultiple) && { backgroundColor: colors.borderDark }]}
                      onPress={commitMoveMultipleToRoom}
                      disabled={!moveTargetKey || movingMultiple}
                    >
                      {movingMultiple
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={mStyles.confirmText}>Move {moveMultipleSelected.size} Item{moveMultipleSelected.size !== 1 ? 's' : ''}</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ── Move sub-item(s) to room modal ────────────────────────────── */}
        <Modal visible={!!subMoveModal} transparent animationType="fade" onRequestClose={() => setSubMoveModal(null)}>
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '88%', maxHeight: '80%', padding: 0, overflow: 'hidden' }]}>
              <View style={ciStyles.header}>
                <Text style={ciStyles.title}>{subMoveModal?.multiSelect ? 'Move Multiple Sub-items' : 'Move Sub-item'}</Text>
                <Text style={ciStyles.sub} numberOfLines={1}>{subMoveModal?.parentLabel || 'Item'}</Text>
              </View>

              {subMoveModal?.multiSelect && subMoveStep === 'select' ? (
                <>
                  <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Select sub-items to move</Text>
                      {getSubs(subMoveModal.itemId).map((sub: any, idx: number) => {
                        const checked = subMoveSelected.has(sub._sid)
                        return (
                          <TouchableOpacity
                            key={sub._sid}
                            style={ciStyles.checkRow}
                            onPress={() => toggleSubMoveSelected(sub._sid)}
                            activeOpacity={0.7}
                          >
                            <View style={[ciStyles.checkbox, checked && ciStyles.checkboxOn]}>
                              {checked && <Text style={ciStyles.checkmark}>✓</Text>}
                            </View>
                            <Text style={ciStyles.checkLabel} numberOfLines={1}>
                              {sub.description ? sub.description.split('\n')[0] : `Sub-item ${idx + 1}`}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </ScrollView>
                  <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <TouchableOpacity style={mStyles.cancel} onPress={() => setSubMoveModal(null)}>
                      <Text style={mStyles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[mStyles.confirm, subMoveSelected.size === 0 && { backgroundColor: colors.borderDark }]}
                      onPress={() => setSubMoveStep('target')}
                      disabled={subMoveSelected.size === 0}
                    >
                      <Text style={mStyles.confirmText}>Next</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Include</Text>
                      {[
                        { label: 'Descriptions', value: subMoveDescs, set: setSubMoveDescs },
                        { label: 'Conditions',   value: subMoveConds, set: setSubMoveConds },
                      ].map(({ label, value, set }) => (
                        <TouchableOpacity key={label} style={ciStyles.checkRow} onPress={() => set(!value)} activeOpacity={0.7}>
                          <View style={[ciStyles.checkbox, value && ciStyles.checkboxOn]}>
                            {value && <Text style={ciStyles.checkmark}>✓</Text>}
                          </View>
                          <Text style={ciStyles.checkLabel}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={ciStyles.section}>
                      <Text style={ciStyles.sectionLabel}>Destination Room</Text>
                      <Text style={[ciStyles.emptyRooms, { marginBottom: 8 }]}>
                        Attaches to "{subMoveModal?.parentLabel}" in the room you choose — created there if it doesn't already exist.
                      </Text>
                      {copyRoomsLoading ? (
                        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                      ) : copyRoomsList.length === 0 ? (
                        <Text style={ciStyles.emptyRooms}>No other rooms available.</Text>
                      ) : (
                        copyRoomsList.map(room => (
                          <TouchableOpacity
                            key={room.key}
                            style={[ciStyles.roomRow, subMoveTargetKey === room.key && ciStyles.roomRowSelected]}
                            onPress={() => setSubMoveTargetKey(room.key)}
                            activeOpacity={0.7}
                          >
                            <View style={[ciStyles.radio, subMoveTargetKey === room.key && ciStyles.radioSelected]}>
                              {subMoveTargetKey === room.key && <View style={ciStyles.radioDot} />}
                            </View>
                            <Text style={[ciStyles.roomName, subMoveTargetKey === room.key && ciStyles.roomNameSelected]}>
                              {room.name}
                            </Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  </ScrollView>
                  <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <TouchableOpacity
                      style={mStyles.cancel}
                      onPress={() => (subMoveModal?.multiSelect ? setSubMoveStep('select') : setSubMoveModal(null))}
                    >
                      <Text style={mStyles.cancelText}>{subMoveModal?.multiSelect ? 'Back' : 'Cancel'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[mStyles.confirm, (!subMoveTargetKey || movingSub) && { backgroundColor: colors.borderDark }]}
                      onPress={commitSubMove}
                      disabled={!subMoveTargetKey || movingSub}
                    >
                      {movingSub
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={mStyles.confirmText}>Move</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ── Sub-item rearrange modal ──────────────────────────────────── */}
        <Modal visible={!!subRearrangeModal} transparent animationType="fade" onRequestClose={() => setSubRearrangeModal(null)}>
          <View style={mStyles.overlay}>
            <View style={[mStyles.box, { width: '88%', maxHeight: '80%', padding: 0, overflow: 'hidden' }]}>
              <View style={ciStyles.header}>
                <Text style={ciStyles.title}>Rearrange Sub-items</Text>
                <Text style={ciStyles.sub} numberOfLines={1}>{subRearrangeModal?.parentLabel || 'Item'}</Text>
              </View>
              <ScrollView style={{ maxHeight: 400 }}>
                <View style={ciStyles.section}>
                  {(subRearrangeModal?.subs || []).map((sub: any, idx: number) => (
                    <View key={sub._sid} style={[ciStyles.roomRow, { justifyContent: 'space-between' }]}>
                      <Text style={ciStyles.roomName} numberOfLines={1}>
                        {sub.description ? sub.description.split('\n')[0] : `Sub-item ${idx + 1}`}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => moveSubRearrangeItem(idx, -1)}
                          disabled={idx === 0}
                          style={{ opacity: idx === 0 ? 0.3 : 1, padding: 6 }}
                        >
                          <Text style={{ fontSize: 18 }}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => moveSubRearrangeItem(idx, 1)}
                          disabled={idx === (subRearrangeModal?.subs.length ?? 0) - 1}
                          style={{ opacity: idx === (subRearrangeModal?.subs.length ?? 0) - 1 ? 0.3 : 1, padding: 6 }}
                        >
                          <Text style={{ fontSize: 18 }}>▼</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
              <View style={[mStyles.actions, { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <TouchableOpacity style={mStyles.cancel} onPress={() => setSubRearrangeModal(null)}>
                  <Text style={mStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={mStyles.confirm} onPress={commitSubRearrange}>
                  <Text style={mStyles.confirmText}>Save Order</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Actions picker modal — check-out only ─────────────────────── */}
        <Modal visible={!!actionsModal} transparent animationType="slide">
          <View style={actStyles.overlay}>
            <View style={actStyles.sheet}>
              {/* Header */}
              <View style={actStyles.header}>
                <Text style={actStyles.headerTitle}>Actions</Text>
                {actionsModal && <Text style={actStyles.headerSub}>{actionsModal.itemLabel}</Text>}
              </View>

              <ScrollView style={actStyles.scrollArea} keyboardShouldPersistTaps="handled">
                {/* Catalogue — tap to add an instance (same action can be added multiple times) */}
                <Text style={actStyles.sectionLbl}>Add action</Text>
                <Text style={actStyles.sectionHint}>Tap to add. Same action can be added more than once for different responsibilities.</Text>
                {actionCatalogue.length === 0 ? (
                  <Text style={actStyles.emptyText}>No actions configured — add them in Settings → Actions.</Text>
                ) : (
                  actionCatalogue.map((cat: any) => {
                    const count = modalInstanceCount(cat.id)
                    const isActive = count > 0
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[actStyles.catBtn, isActive && { borderColor: cat.color + '80', backgroundColor: cat.color + '18' }]}
                        onPress={() => modalAddAction(cat.id)}
                      >
                        <View style={[actStyles.catDot, { backgroundColor: cat.color }]} />
                        <Text style={[actStyles.catName, isActive && { color: cat.color, fontWeight: '700' }]}>{cat.name}</Text>
                        {isActive && (
                          <View style={[actStyles.countBadge, { backgroundColor: cat.color }]}>
                            <Text style={actStyles.countBadgeText}>{count}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )
                  })
                )}

                {/* Detail rows — one per action instance, keyed by _id */}
                {(actionsModal?.workingActions || []).length > 0 && (
                  <>
                    <View style={actStyles.divider} />
                    <Text style={actStyles.sectionLbl}>Details</Text>
                    {(actionsModal?.workingActions || []).map((action: any) => {
                      const cat = actionCatalogue.find((c: any) => c.id === action.actionId)
                      const col = cat?.color || '#64748b'
                      const condLines = actionsModal?.conditionLines || []
                      const actionConditions: string[] = action.conditions || []
                      return (
                        <View key={action._id} style={actStyles.detailRow}>
                          {/* Action name + remove button */}
                          <View style={actStyles.detailLabel}>
                            <View style={[actStyles.catDot, { backgroundColor: col }]} />
                            <Text style={[actStyles.detailName, { color: col, flex: 1 }]}>{cat?.name || String(action.actionId)}</Text>
                            <TouchableOpacity onPress={() => modalRemoveAction(action._id)} style={actStyles.detailRemoveBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Text style={actStyles.detailRemoveText}>✕</Text>
                            </TouchableOpacity>
                          </View>

                          {/* Responsibility */}
                          {actionResponsibilities.length > 0 && (
                            <View style={actStyles.detailField}>
                              <Text style={actStyles.fieldLbl}>Responsibility</Text>
                              <View style={actStyles.respBtns}>
                                {actionResponsibilities.map((r: string) => (
                                  <TouchableOpacity
                                    key={r}
                                    style={[actStyles.respBtn, action.responsibility === r && actStyles.respBtnActive]}
                                    onPress={() => modalSetResponsibility(action._id, r)}
                                  >
                                    <Text style={[actStyles.respBtnText, action.responsibility === r && actStyles.respBtnTextActive]}>{r}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                          )}

                          {/* Condition selector — multi-select */}
                          <View style={actStyles.detailField}>
                            <Text style={actStyles.fieldLbl}>Condition <Text style={actStyles.fieldLblOpt}>(select all that apply)</Text></Text>
                            {condLines.length > 0 ? (
                              <>
                                {condLines.map((line: string) => {
                                  const checked = actionConditions.includes(line)
                                  return (
                                    <TouchableOpacity
                                      key={line}
                                      style={[actStyles.condLine, checked && actStyles.condLineActive]}
                                      onPress={() => modalToggleCondition(action._id, line)}
                                    >
                                      <View style={[actStyles.condCheckbox, checked && actStyles.condCheckboxActive]}>
                                        {checked && <Text style={actStyles.condCheckmark}>✓</Text>}
                                      </View>
                                      <Text style={[actStyles.condLineText, checked && actStyles.condLineTextActive]} numberOfLines={3}>{line}</Text>
                                    </TouchableOpacity>
                                  )
                                })}
                              </>
                            ) : (
                              <TextInput
                                style={[styles.notesInput, { minHeight: 40 }]}
                                value={actionConditions.join('\n')}
                                onChangeText={v => {
                                  const lines = v.split('\n').map((l: string) => l.trim()).filter(Boolean)
                                  setActionsModal(prev => {
                                    if (!prev) return prev
                                    return {
                                      ...prev,
                                      workingActions: prev.workingActions.map((a: any) =>
                                        a._id === action._id ? { ...a, conditions: lines } : a
                                      ),
                                    }
                                  })
                                }}
                                placeholder="e.g. Heavy marks to low level door…"
                                placeholderTextColor={c.textLight}
                                multiline
                              />
                            )}
                          </View>
                        </View>
                      )
                    })}
                  </>
                )}
                <View style={{ height: 24 }} />
              </ScrollView>

              {/* Footer — Save and Cancel */}
              <View style={[actStyles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
                <TouchableOpacity style={[mStyles.cancel, { flex: 1 }]} onPress={() => setActionsModal(null)}>
                  <Text style={mStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[mStyles.confirm, { flex: 2 }]}
                  onPress={async () => {
                    if (actionsModal) {
                      await saveItemActions(actionsModal.itemId, actionsModal.workingActions)
                      setActionsModal(null)
                    }
                  }}
                >
                  <Text style={mStyles.confirmText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Rename item modal */}
        <Modal visible={renameItemModal} transparent animationType="fade">
          <View style={mStyles.overlay}><View style={mStyles.box}>
            <Text style={mStyles.title}>Rename Item</Text>
            <TextInput style={mStyles.input} value={renameItemName} onChangeText={setRenameItemName} autoFocus />
            <View style={mStyles.actions}>
              <TouchableOpacity style={mStyles.cancel} onPress={() => setRenameItemModal(false)}>
                <Text style={mStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={mStyles.confirm} onPress={handleRenameItem}>
                <Text style={mStyles.confirmText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View></View>
        </Modal>

        <Modal visible={addItemModal} transparent animationType="fade">
          <View style={mStyles.overlay}><View style={mStyles.box}>
            <Text style={mStyles.title}>Add Item</Text>
            <TextInput style={mStyles.input} value={newItemName} onChangeText={setNewItemName}
              placeholder="Item name…" placeholderTextColor={c.textLight} autoFocus />
            <View style={mStyles.actions}>
              <TouchableOpacity style={mStyles.cancel} onPress={() => { setAddItemModal(false); setNewItemName('') }}>
                <Text style={mStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={mStyles.confirm} onPress={handleAddItem}>
                <Text style={mStyles.confirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View></View>
        </Modal>

        {/* ── Rearrange items modal ─────────────────────────────────────────── */}
        <Modal visible={rearrangeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRearrangeModal(false)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={[rrStyles.screen, dm.bg, { paddingTop: insets.top }]}>
            <View style={[rrStyles.header, dm.surface, { borderBottomColor: c.border }]}>
              <TouchableOpacity onPress={() => setRearrangeModal(false)}>
                <Text style={[rrStyles.cancel, dm.textMid]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[rrStyles.title, dm.text]}>Rearrange Items</Text>
              <TouchableOpacity onPress={saveRearrange}>
                <Text style={rrStyles.save}>Save</Text>
              </TouchableOpacity>
            </View>
            <Text style={rrStyles.hint}>Hold any item and drag to reorder</Text>
            <ScrollView
              scrollEnabled={rearrangeDragFrom === null}
              contentContainerStyle={rrStyles.list}
            >
              {rearrangeItems.map((item, idx) => {
                const isDragging = rearrangeDragFrom === idx
                const shift = (!isDragging && rearrangeDragFrom !== null && rearrangeDragTo !== null)
                  ? getRearrangeShift(idx, rearrangeDragFrom, rearrangeDragTo)
                  : 0
                return (
                  <Animated.View
                    key={item.id}
                    style={isDragging
                      ? { transform: [{ translateY: rearrangeDragYAnim }], zIndex: 10, elevation: 6 }
                      : shift !== 0 ? { transform: [{ translateY: shift }] } : {}
                    }
                  >
                    <GestureDetector gesture={makeRearrangeGesture(idx)}>
                      <View style={[rrStyles.row, dm.surface, { borderColor: c.border }, isDragging && rrStyles.rowDragging]}>
                        <Text style={[rrStyles.rowLabel, dm.text]} numberOfLines={1}>
                          {item.label || item.name || ''}
                        </Text>
                        <Text style={rrStyles.handle}>≡</Text>
                      </View>
                    </GestureDetector>
                  </Animated.View>
                )
              })}
            </ScrollView>
            <View style={[rrStyles.footer, dm.surface, { borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}>
              <TouchableOpacity style={rrStyles.saveBtn} onPress={saveRearrange}>
                <Text style={rrStyles.saveBtnText}>Save Order</Text>
              </TouchableOpacity>
            </View>
          </View>
          </GestureHandlerRootView>
        </Modal>
      </View>
    </View>
    </GestureHandlerRootView>
  )
}

const optStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: colors.muted, borderWidth: 1.5, borderColor: colors.border },
  btnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  text: { fontSize: font.sm, color: colors.textMid, fontWeight: '500' },
  textActive: { color: colors.primary, fontWeight: '700' },
})
const subQtyStyles = StyleSheet.create({
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary },
  stepBtnText: { fontSize: 24, fontWeight: '700', color: colors.primary, lineHeight: 28 },
  countText: { fontSize: 32, fontWeight: '800', color: colors.text, minWidth: 40, textAlign: 'center' },
})
const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, width: '80%' },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  input: { borderWidth: 2, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, fontSize: font.md, color: colors.text, marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  cancel: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.muted, alignItems: 'center' },
  cancelText: { color: colors.textMid, fontWeight: '600' },
  confirm: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700' },
})
const ciStyles = StyleSheet.create({
  header:         { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  title:          { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sub:            { fontSize: font.sm, color: colors.textMid, marginTop: 2 },
  section:        { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4 },
  sectionLabel:   { fontSize: font.xs, fontWeight: '700', color: colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  checkRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkbox:       { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:     { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark:      { color: '#fff', fontSize: 13, fontWeight: '800' },
  checkLabel:     { fontSize: font.md, color: colors.text, fontWeight: '500' },
  emptyRooms:     { fontSize: font.sm, color: colors.textLight, textAlign: 'center', paddingVertical: spacing.md },
  roomRow:        { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  roomRowSelected:{ backgroundColor: colors.primaryLight, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  radio:          { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected:  { borderColor: colors.primary },
  radioDot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  roomName:       { fontSize: font.sm, color: colors.text, flex: 1, fontWeight: '500' },
  roomNameSelected: { color: colors.primary, fontWeight: '700' },
})
const rrStyles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  cancel: { fontSize: font.md, fontWeight: '500' },
  title:  { fontSize: font.md, fontWeight: '700' },
  save:   { fontSize: font.md, fontWeight: '700', color: colors.primary },
  hint: {
    fontSize: font.xs, color: colors.textLight, textAlign: 'center',
    paddingVertical: spacing.sm, fontStyle: 'italic',
  },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    height: 56, borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
  },
  rowDragging: {
    borderColor: colors.primary,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 8, elevation: 8,
  },
  rowLabel: { flex: 1, fontSize: font.sm, fontWeight: '600' },
  handle: { fontSize: 20, color: colors.textLight, letterSpacing: 1 },
  footer: {
    padding: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: 15, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: font.lg, fontWeight: '700' },
})
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  aiBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#eef2ff', borderBottomWidth: 1, borderBottomColor: '#c7d2fe', paddingHorizontal: spacing.md, paddingVertical: 10 },
  aiBannerHuman: { backgroundColor: '#f0fdf4', borderBottomColor: '#bbf7d0' },   // green tint for human mode
  aiBannerIcon: { fontSize: 16 },
  aiBannerText: { fontSize: font.sm, color: '#3730a3', fontWeight: '600', flex: 1 },
  aiErrorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.dangerLight, paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#fca5a5' },
  aiErrorText: { fontSize: font.sm, color: colors.danger, flex: 1 },
  aiErrorDismiss: { fontSize: font.md, color: colors.danger, fontWeight: '700', paddingLeft: spacing.sm },
  scroll: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  itemCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  itemCardDragging: { backgroundColor: '#f0f7ff', borderColor: colors.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  // Deep-link target from the pre-finalise Review Report overlay
  itemCardHighlighted: { backgroundColor: colors.warningLight, borderColor: colors.warning, borderWidth: 2 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  itemHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  itemName: { fontSize: font.sm, fontWeight: '700', color: colors.text, flex: 1 },
  deleteBtn: { fontSize: font.md, color: colors.danger, padding: 4 },
  itemDragHandle: { paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  itemDragHandleIcon: { fontSize: 18, color: colors.textLight, letterSpacing: 1 },
  photoCountBadge: { backgroundColor: colors.primaryLight, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, flexShrink: 0 },
  photoCountText:  { fontSize: 11, color: colors.primary, fontWeight: '700' },
  questionText: { fontSize: font.sm, color: colors.textMid, fontStyle: 'italic', marginBottom: spacing.xs },
  fieldGroup: { marginTop: 8 },
  fieldLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textLight, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  notesInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, fontSize: font.sm, color: colors.text, backgroundColor: colors.surface, minHeight: 60 },
  answerOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  answerOptBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  answerOptBtnSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  answerOptText: { fontSize: font.sm, fontWeight: '600', color: colors.textMid },
  answerOptTextSelected: { color: '#ffffff' },
  inlineInput: { minHeight: 0, height: 42 },
  overviewBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  overviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  overviewTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  overviewSub:   { fontSize: font.xs, color: colors.textLight, marginTop: 2 },
  overviewBtns:  { flexDirection: 'row', gap: spacing.xs },
  overviewIconBtn: {
    width: 36, height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  overviewIconEmoji: { fontSize: 17 },
  overviewStrip: { marginTop: 6 },
  overviewThumb: { width: 90, height: 90, borderRadius: radius.md, marginRight: spacing.sm },
  overviewThumbNum: {
    position: 'absolute', bottom: 4, right: spacing.sm + 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
  overviewThumbNumText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  photoBlock: { marginTop: 8 },
  photosHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  photoIconBtns: { flexDirection: 'row', gap: spacing.xs },
  photoIconBtn: {
    width: 44, height: 44,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  photoIconEmoji: { fontSize: 22 },
  photoStrip: { marginTop: 4 },
  photoThumb: { width: 80, height: 80, borderRadius: radius.md, marginRight: 6 },
  sourcePhotoBlock: {
    backgroundColor: '#f0f4ff',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#e0e7ff',
    padding: 8,
    marginBottom: 8,
  },
  sourcePhotoLabel: {
    fontSize: font.xs,
    fontWeight: '700' as const,
    color: '#6366f1',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  sourcePhotoThumb: { opacity: 0.85 },
  voiceBlock: { marginTop: 8, gap: 4 },
  aiProcessingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#eef2ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, alignSelf: 'flex-start' },
  aiProcessingText: { fontSize: font.xs, color: '#3730a3', fontWeight: '600' },
  addItemBtn: { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  addItemText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  addSubItemBtn: { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md, padding: spacing.xs, alignItems: 'center', marginTop: spacing.xs },
  addSubItemText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  // ── Additional Items (Check Out) ──────────────────────────────────────────
  additionalItemsSection: { marginTop: spacing.md, marginBottom: spacing.xs, padding: spacing.sm, backgroundColor: '#eff6ff', borderWidth: 1.5, borderColor: '#93c5fd', borderStyle: 'dashed', borderRadius: radius.md },
  additionalItemsHeader: { marginBottom: spacing.sm },
  additionalItemsTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  additionalItemsSubtitle: { fontSize: font.xs, color: colors.textMid, marginTop: 2 },
  aiCondSumBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  aiCondSumBtnBusy: { backgroundColor: colors.borderDark },
  aiCondSumBtnIcon: { fontSize: 16 },
  aiCondSumBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  emptyNote: { backgroundColor: colors.muted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  subsContainer: { marginTop: spacing.sm },
  subsDivider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm, borderStyle: 'dashed' },
  subItem: { backgroundColor: '#fafafa', borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border },
  // Deep-link target from the pre-finalise Review Report overlay
  subItemHighlighted: { borderLeftColor: colors.warning, borderColor: colors.warning, backgroundColor: colors.warningLight },
  subItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  subItemTitle: { fontSize: font.md, fontWeight: '400', color: colors.textLight },
  subItemDelete: { fontSize: font.sm, color: colors.danger, padding: 4 },
  dropdownList: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', marginBottom: 4 },
  dropdownListItem: { paddingVertical: 13, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownListItemActive: { backgroundColor: colors.primaryLight },
  dropdownListItemText: { fontSize: font.sm, color: colors.text, flex: 1 },
  dropdownListItemPlaceholder: { color: colors.textLight, fontStyle: 'italic' },
  dropdownListItemTextActive: { color: colors.primary, fontWeight: '700' },
  dropdownCheck: { fontSize: font.sm, color: colors.primary, fontWeight: '700' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 10, backgroundColor: colors.surface },
  dropdownBtnText: { fontSize: font.sm, color: colors.text, flex: 1 },
  dropdownBtnPlaceholder: { color: colors.textLight },
  dropdownChevron: { fontSize: font.sm, color: colors.textLight, marginLeft: spacing.xs },
  swipeHint: { fontSize: 10, color: colors.textLight, textAlign: 'center', marginBottom: spacing.xs, fontStyle: 'italic' },
  emptyNoteText: { fontSize: font.sm, color: colors.textLight, textAlign: 'center' },
  // Check-out read-only fields
  coReadOnly: { backgroundColor: '#f8fafc', borderRadius: radius.sm, padding: 8, borderWidth: 1, borderColor: colors.border, minHeight: 40, justifyContent: 'center' },
  coReadOnlyText: { fontSize: font.sm, color: colors.textMid },
  coLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  coInvBadge: { backgroundColor: '#ede9fe', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  coInvBadgeText: { fontSize: 9, fontWeight: '700', color: '#7c3aed' },
  // Actions button and pills
  actionsBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, backgroundColor: colors.muted },
  actionsBtnActive: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  actionsBtnText: { fontSize: font.sm, color: colors.primary, fontWeight: '600' },
  actionsBtnEmpty: { color: colors.textMid, fontWeight: '500' },
  actionPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  actionPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  actionPillDot: { width: 7, height: 7, borderRadius: 4 },
  actionPillText: { fontSize: 12, fontWeight: '600' },
  actionPillResp: { fontSize: 11, fontWeight: '500', opacity: 0.75 },
  // Check-In photos accordion (shown during check-out inspections)
  ciPhotosBlock: {
    marginTop: 6, marginBottom: 4,
    borderWidth: 1, borderColor: '#c7d2fe',
    borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: '#eef2ff',
  },
  ciPhotosHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  ciPhotosHeaderText: { fontSize: font.sm, fontWeight: '600', color: '#4338ca' },
  ciPhotosChevron:    { fontSize: 11, color: '#6366f1' },
  ciPhotosScroll:     { backgroundColor: '#fff' },
  ciPhotoThumb:       { width: 96, height: 72, borderRadius: radius.sm },
})

const actStyles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' },
  header:       { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:  { fontSize: font.lg, fontWeight: '800', color: colors.text },
  headerSub:    { fontSize: font.sm, color: colors.textMid, marginTop: 2 },
  scrollArea:   { padding: spacing.md },
  sectionLbl:       { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textLight, marginBottom: 4, marginTop: 4 },
  sectionHint:      { fontSize: 11, color: colors.textLight, fontStyle: 'italic', marginBottom: 8 },
  emptyText:        { fontSize: font.sm, color: colors.textLight, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  catBtn:           { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: 6 },
  catDot:           { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  catName:          { flex: 1, fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  countBadge:       { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  countBadgeText:   { fontSize: 11, fontWeight: '700', color: '#fff' },
  divider:      { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  detailRow:    { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  detailLabel:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  detailName:   { fontSize: font.sm, fontWeight: '700', flex: 1 },
  detailField:  { marginBottom: 10 },
  fieldLbl:     { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: colors.textLight, marginBottom: 6 },
  fieldLblOpt:  { fontSize: 10, fontWeight: '400', textTransform: 'none', letterSpacing: 0, color: colors.textLight, fontStyle: 'italic' },
  respBtns:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  respBtn:      { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.muted, borderWidth: 1.5, borderColor: colors.border },
  respBtnActive:{ backgroundColor: colors.primaryLight, borderColor: colors.primary },
  respBtnText:      { fontSize: font.sm, color: colors.textMid, fontWeight: '500' },
  respBtnTextActive:{ color: colors.primary, fontWeight: '700' },
  condLine:         { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, marginBottom: 4 },
  condLineActive:   { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  condLineText:     { fontSize: font.sm, color: colors.textMid, flex: 1 },
  condLineTextActive: { color: colors.primary, fontWeight: '600' },
  condCheckbox:     { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  condCheckboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  condCheckmark:    { fontSize: 11, color: 'white', fontWeight: '800', lineHeight: 14 },
  footer:       { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  detailRemoveBtn:  { marginLeft: 'auto', padding: 4 },
  detailRemoveText: { fontSize: 14, color: colors.danger, fontWeight: '700' },
})

const ciLbStyles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#000' },
  image:        { width: '100%', height: '65%' },
  closeBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  counter: {
    position: 'absolute', alignSelf: 'center', zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
  },
  counterText:  { color: '#fff', fontSize: 12 },
  badge: {
    position: 'absolute', alignSelf: 'center', zIndex: 10,
    backgroundColor: 'rgba(99,102,241,0.85)',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
  },
  badgeText:    { color: '#fff', fontSize: 12, fontWeight: '600' },
})
