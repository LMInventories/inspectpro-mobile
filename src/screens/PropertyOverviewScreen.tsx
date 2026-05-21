import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, Alert, ActivityIndicator, Platform, Linking, Modal,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp, RouteProp } from '@react-navigation/stack'
import * as ImagePicker from 'expo-image-picker'

import type { RootStackParamList } from '../../App'
import { useInspectionStore } from '../stores/inspectionStore'
import { updateLocalStatus, updateInspectionServerStatus, markFinalised, unmarkFinalised, updateLocalTypistMode } from '../services/database'
import { api } from '../services/api'
import { syncSingleInspection, SyncProgress } from '../services/syncService'
import { useAuthStore } from '../stores/authStore'
import Header from '../components/Header'
import SignaturePad from '../components/SignaturePad'
import { colors, useColors, font, radius, spacing, TYPE_LABELS } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'PropertyOverview'>
type Route = RouteProp<RootStackParamList, 'PropertyOverview'>

type ReviewSub  = { label: string; cond: string }
type ReviewItem = { label: string; desc: string; cond: string; isEmpty: boolean; subs: ReviewSub[] }
type ReviewRoom  = { name: string; items: ReviewItem[] }

// ── Map launcher — fires device default, OS chooser if none set ───────────────
async function openMap(address: string) {
  const q = encodeURIComponent(address)
  // iOS: maps: scheme always opens Apple Maps (iOS has no user-configurable default maps app)
  // Android: geo: fires a system intent — opens the user's default maps app directly,
  //          or shows the Android app chooser if no default has been set
  const url = Platform.OS === 'ios' ? `maps:0,0?q=${q}` : `geo:0,0?q=${q}`
  try {
    await Linking.openURL(url)
  } catch {
    // Fallback: web Google Maps (handles edge cases where native scheme is unavailable)
    Linking.openURL(`https://maps.google.com/maps?q=${q}`)
  }
}

export default function PropertyOverviewScreen() {
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const insets = useSafeAreaInsets()
  const { inspectionId } = route.params
  const { activeInspection, loadInspection, updateItemInReport, setReportData } = useInspectionStore()
  const { user } = useAuthStore()
  const [starting, setStarting] = useState(false)
  const [finalising, setFinalising] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [reviewRooms, setReviewRooms] = useState<ReviewRoom[]>([])
  const [showSignature, setShowSignature] = useState(false)
  // sigStep: 'clerk' | 'tenant'
  const [sigStep, setSigStep] = useState<'clerk' | 'tenant'>('clerk')
  const [clerkSig, setClerkSig] = useState<string | null>(null)
  const [tenantSig, setTenantSig] = useState<string | null>(null)

  useEffect(() => { loadInspection(inspectionId) }, [inspectionId])

  const c  = useColors()
  const dm = {
    bg:        { backgroundColor: c.background },
    surface:   { backgroundColor: c.surface },
    border:    { borderColor: c.border },
    text:      { color: c.text },
    textMid:   { color: c.textMid },
    textLight: { color: c.textLight },
    input:     { backgroundColor: c.surface, borderColor: c.border, color: c.text },
  }

  const inspection = activeInspection?.id === inspectionId ? activeInspection : null
  if (!inspection) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Header title="Property Overview" onBack={() => navigation.goBack()} />
        <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    )
  }

  async function handleTakeOverviewPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Camera permission is needed to take photos.'); return }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      base64: false,
      allowsEditing: false,
    })
    if (result.canceled) return

    const uri = result.assets[0].uri
    await updateItemInReport(inspectionId, '_overview', 'photo', { uri })
    Alert.alert('Photo saved', 'Overview photo has been saved locally.')
  }

  async function handlePickOverviewFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Photo library permission is needed to select photos.'); return }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: false,
      allowsEditing: false,
    })
    if (result.canceled) return

    const uri = result.assets[0].uri
    await updateItemInReport(inspectionId, '_overview', 'photo', { uri })
    Alert.alert('Photo saved', 'Overview photo has been saved locally.')
  }

  async function handleStartInspection() {
    Alert.alert(
      'Start Inspection',
      'This will mark the inspection as Active on the server. Are you ready to begin?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Inspection',
          onPress: async () => {
            setStarting(true)
            try {
              await api.updateInspection(inspectionId, { status: 'active' })
              // Patch the data blob so inspection.status reads correctly everywhere
              // (blob is otherwise frozen at the value from download time)
              updateInspectionServerStatus(inspectionId, 'active')
              updateLocalStatus(inspectionId, 'active')
              await loadInspection(inspectionId)
              navigation.replace('RoomSelection', { inspectionId })
            } catch {
              // Offline — allow starting locally; server will be updated on next sync
              updateLocalStatus(inspectionId, 'active')
              await loadInspection(inspectionId)
              navigation.replace('RoomSelection', { inspectionId })
            } finally {
              setStarting(false)
            }
          },
        },
      ]
    )
  }

  function formatDate(str: string | null) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  }

  function formatTime(pref: string | null) {
    if (!pref) return '—'
    if (pref === 'anytime') return 'Anytime'
    if (pref.startsWith('specific:')) {
      const [h, m] = pref.replace('specific:', '').split('_')
      return `${h}:${m ?? '00'}`
    }
    return pref
  }

  const reportData = inspection.report_data ? JSON.parse(inspection.report_data) : {}
  // Prefer the locally-captured photo (updated by take/pick handlers) over
  // the server-side overview_photo so a new photo is immediately visible.
  const overviewPhoto = reportData._overview?.items?.photo?.uri || inspection.property?.overview_photo || null
  const isActive = inspection.local_status === 'active' || inspection.status === 'active'
  const isFinalised: boolean = !!(inspection as any).is_finalised
  const isAiMode = (inspection as any).typist_is_ai ||
                   (inspection as any).typist_mode === 'ai_instant' ||
                   (inspection as any).typist_mode === 'ai_room'

  function openReview() {
    const rd = inspection.report_data ? JSON.parse(inspection.report_data) : {}
    const isCheckOut = inspection.inspection_type === 'check_out'
    const template = (inspection as any).template

    const hiddenRooms: string[] = rd['_hiddenRooms'] || []
    const roomNames: Record<string, string> = rd['_roomNames'] || {}

    // Extract condition from a data blob, respecting check-out vs inventory
    const getCond = (data: any): string => data
      ? (isCheckOut ? (data.checkOutCondition || data.condition || '') : (data.condition || ''))
      : ''

    // Build sub-items from _subs array on an item's data blob
    const buildSubs = (itemData: any): ReviewSub[] => {
      return ((itemData?._subs) || []).map((sub: any) => ({
        label: sub.description || sub.label || '—',
        cond:  isCheckOut ? (sub.checkOutCondition || sub.condition || '') : (sub.condition || ''),
      })).filter((s: ReviewSub) => s.label || s.cond)
    }

    // Collect all rooms into a Map so we can apply _roomOrder afterwards,
    // mirroring the buildOrderedRooms() logic in RoomSelectionScreen.
    const roomMap = new Map<string, ReviewRoom>()

    // Template rooms
    const templateSections: any[] = (template?.sections || []).filter(
      (s: any) => s.section_type === 'room'
    )
    for (const section of templateSections) {
      const key = String(section.id)
      if (hiddenRooms.includes(key)) continue
      const displayName = roomNames[key] || section.name || ''
      const deleted = new Set<string>((rd[key]?._deleted || []).map(String))
      const items: ReviewItem[] = []

      for (const item of (section.items || [])) {
        if (deleted.has(String(item.id))) continue
        const iid      = String(item.id)
        const itemData = rd[key]?.[iid]
        const cond     = getCond(itemData)
        const desc     = !isCheckOut ? (itemData?.description || '') : ''
        const subs     = buildSubs(itemData)
        items.push({ label: item.name || item.label || '', desc, cond, isEmpty: !cond && !subs.length, subs })
      }
      for (const extra of (rd[key]?._extra || [])) {
        if (!extra._eid || deleted.has(String(extra._eid))) continue
        const merged   = { ...(rd[key]?.[extra._eid] || {}), ...extra }
        const cond     = getCond(merged)
        const desc     = !isCheckOut ? (merged.description || '') : ''
        const subs     = buildSubs(merged)
        items.push({ label: extra.name || extra.label || 'Added item', desc, cond, isEmpty: !cond && !subs.length, subs })
      }
      if (items.length > 0) roomMap.set(key, { name: displayName, items })
    }

    // Custom rooms
    const customRooms: { key: string; name: string }[] = rd['_customRooms'] || []
    for (const cr of customRooms) {
      if (hiddenRooms.includes(cr.key)) continue
      const deleted = new Set<string>((rd[cr.key]?._deleted || []).map(String))
      const items: ReviewItem[] = []
      for (const extra of (rd[cr.key]?._extra || [])) {
        if (!extra._eid || deleted.has(String(extra._eid))) continue
        const merged = { ...(rd[cr.key]?.[extra._eid] || {}), ...extra }
        const cond   = getCond(merged)
        const desc   = !isCheckOut ? (merged.description || '') : ''
        const subs   = buildSubs(merged)
        items.push({ label: extra.name || extra.label || 'Added item', desc, cond, isEmpty: !cond && !subs.length, subs })
      }
      if (items.length > 0) roomMap.set(cr.key, { name: roomNames[cr.key] ?? cr.name ?? 'Room', items })
    }

    // Apply user-defined room order (_roomOrder mirrors RoomSelectionScreen drag order).
    // Rooms not yet in _roomOrder fall through to end in their default order.
    const order: string[] = rd['_roomOrder'] || []
    const rooms: ReviewRoom[] = []
    const seen = new Set<string>()
    for (const key of order) {
      if (roomMap.has(key)) { rooms.push(roomMap.get(key)!); seen.add(key) }
    }
    for (const section of templateSections) {
      const key = String(section.id)
      if (!seen.has(key) && roomMap.has(key)) rooms.push(roomMap.get(key)!)
    }
    for (const cr of customRooms) {
      if (!seen.has(cr.key) && roomMap.has(cr.key)) rooms.push(roomMap.get(cr.key)!)
    }

    setReviewRooms(rooms)
    setShowReview(true)
  }

  function openSignatureFlow() {
    setClerkSig(null)
    setTenantSig(null)
    setSigStep('clerk')
    setShowSignature(true)
  }

  async function commitFinalise(clerkSignature: string | null, tenantSignature: string | null) {
    // Persist signatures into report_data._signatures so they sync to the server
    const rd = inspection.report_data ? JSON.parse(inspection.report_data) : {}
    const sigs: Record<string, any> = rd._signatures || {}
    const now = new Date().toISOString()
    if (clerkSignature) {
      sigs.clerk = { signature_data: clerkSignature, signer_name: user?.name || '', signed_at: now }
    }
    if (tenantSignature) {
      sigs.tenant = { signature_data: tenantSignature, signer_name: '', signed_at: now }
    }
    rd._signatures = sigs
    // Write updated report_data (with _signatures) back to the store
    setReportData(inspectionId, rd)
    setFinalising(true)
    try {
      markFinalised(inspectionId)
      await loadInspection(inspectionId)
      Alert.alert(
        'Finalised ✓',
        isAiMode
          ? 'Report finalised. When synced, it will be marked Complete and sent to all recipients automatically.'
          : 'Inspection marked as finalised. It will be queued for typist processing on your next sync.'
      )
    } finally {
      setFinalising(false)
    }
  }

  async function handleFinalise() {
    if (isFinalised) {
      Alert.alert(
        'Undo Finalise',
        'This inspection is marked as finalised. Do you want to undo this so it syncs back to Active?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Undo Finalise',
            style: 'destructive',
            onPress: async () => {
              setFinalising(true)
              try {
                unmarkFinalised(inspectionId)
                await loadInspection(inspectionId)
              } finally {
                setFinalising(false)
              }
            },
          },
        ]
      )
    } else {
      // Open signature collection first
      openSignatureFlow()
    }
  }

  async function handleSyncReport() {
    Alert.alert(
      'Sync This Report',
      isAiMode
        ? 'This will upload the report and mark it Complete. Recipients will be notified automatically.'
        : 'This will upload the report and move it to Processing for the typist.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync Now',
          onPress: async () => {
            setSyncProgress({ phase: 'photos', done: 0, total: 0 })
            try {
              const result = await syncSingleInspection(inspectionId, inspection, user, setSyncProgress)
              if (result.success) {
                await loadInspection(inspectionId)
                Alert.alert('Synced ✓', 'Report uploaded successfully.')
              } else {
                Alert.alert('Sync Failed', result.error || 'Something went wrong. Please try again.')
              }
            } finally {
              setSyncProgress(null)
            }
          },
        },
      ]
    )
  }

  return (
    <View style={[styles.screen, dm.bg, { paddingTop: insets.top }]}>
      <Header
        title="Property Overview"
        onBack={() => navigation.goBack()}

      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Overview photo */}
        <TouchableOpacity
          style={styles.photoArea}
          onPress={handleTakeOverviewPhoto}
          onLongPress={handlePickOverviewFromGallery}
          delayLongPress={400}
          activeOpacity={0.85}
        >
          {overviewPhoto ? (
            <Image source={{ uri: overviewPhoto }} style={styles.overviewImage} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderIcon}>📷</Text>
              <Text style={styles.photoPlaceholderText}>Tap to take photo</Text>
              <Text style={styles.photoPlaceholderHint}>Hold to select from gallery</Text>
            </View>
          )}
          <View style={styles.photoOverlay}>
            <Text style={styles.photoOverlayText}>📷  Tap — Camera  ·  Hold — Gallery</Text>
          </View>
        </TouchableOpacity>

        {/* Address + Maps button */}
        <View style={[styles.addressBlock, dm.surface, { borderBottomColor: c.border }]}>
          <View style={styles.addressRow}>
            <View style={styles.addressText}>
              <Text style={[styles.address, dm.text]}>{inspection.property_address || 'Unknown address'}</Text>
              <Text style={[styles.clientName, dm.textMid]}>{inspection.client_name || '—'}</Text>
            </View>
            <TouchableOpacity
              style={styles.mapsBtn}
              onPress={() => openMap(inspection.property_address || '')}
            >
              <Text style={styles.mapsBtnIcon}>📍</Text>
              <Text style={styles.mapsBtnText}>Map</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* CTA — immediately below address */}
        <View style={styles.ctaWrap}>
          {isActive ? (
            <>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => navigation.navigate('RoomSelection', { inspectionId })}
              >
                <Text style={styles.btnPrimaryText}>Continue Inspection →</Text>
              </TouchableOpacity>

              {isFinalised ? (
                <>
                  <TouchableOpacity
                    style={[styles.btnSecondary, styles.btnFinalised]}
                    onPress={handleFinalise}
                    disabled={finalising}
                  >
                    {finalising
                      ? <ActivityIndicator color={colors.success} size="small" />
                      : <Text style={styles.btnFinalisedText}>✓ Finalised — tap to undo</Text>
                    }
                  </TouchableOpacity>

                  {syncProgress ? (
                    <InlineSyncProgress progress={syncProgress} />
                  ) : (
                    <TouchableOpacity
                      style={[styles.btnSecondary, styles.btnSync]}
                      onPress={handleSyncReport}
                    >
                      <Text style={styles.btnSyncText}>⇅ Sync Report</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={openReview}
                  disabled={finalising}
                >
                  {finalising
                    ? <ActivityIndicator color={colors.primary} size="small" />
                    : <Text style={styles.btnSecondaryText}>Finalise Inspection</Text>
                  }
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity style={styles.btnPrimary} onPress={handleStartInspection} disabled={starting}>
              {starting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnPrimaryText}>Start Inspection</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* Detail rows */}
        <View style={[styles.section, dm.surface, dm.border]}>
          <Text style={[styles.sectionTitle, dm.textLight]}>Inspection Details</Text>
          <DetailRow label="Type"       value={TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type} />
          <DetailRow label="Date"       value={formatDate(inspection.conduct_date)} />
          <DetailRow label="Time"       value={formatTime(inspection.conduct_time_preference)} />
          <DetailRow label="Inspector"  value={inspection.inspector_name || '—'} />
          <DetailRow label="Typist"     value={inspection.typist_name || '—'} />
        </View>

        {/* Typist mode — clerks can change this per-report without a system-wide setting */}
        <View style={[styles.section, dm.surface, dm.border]}>
          <Text style={[styles.sectionTitle, dm.textLight]}>Typist Mode</Text>
          <Text style={styles.modeHint}>
            Choose how this report is processed. Changing this here only affects this inspection.
          </Text>
          {(
            [
              { key: 'ai_instant', label: '⚡ AI Instant',  sub: 'Per-item mic — fills fields immediately on device' },
              { key: 'ai_room',    label: '🏠 AI by Room',  sub: 'Record the whole room — AI transcribes all items at once' },
              { key: 'human',      label: '✍️ Human Typist', sub: 'Audio synced to server — typist types the report' },
            ] as const
          ).map(opt => {
            const current = (inspection as any).typist_mode
            const active  = current === opt.key
            return (
              <TouchableOpacity
                key={opt.key}
                style={[modeStyles.row, active && modeStyles.rowActive]}
                onPress={() => {
                  updateLocalTypistMode(inspectionId, opt.key)
                  loadInspection(inspectionId)
                }}
              >
                <View style={modeStyles.radio}>
                  {active && <View style={modeStyles.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[modeStyles.label, active && modeStyles.labelActive]}>{opt.label}</Text>
                  <Text style={modeStyles.sub}>{opt.sub}</Text>
                </View>
              </TouchableOpacity>
            )
          })}
          {(() => {
            const mode = (inspection as any).typist_mode
            const isAi = mode === 'ai_instant' || mode === 'ai_room' || (inspection as any).typist_is_ai
            return (
              <View style={modeStyles.infoBox}>
                <Text style={modeStyles.infoText}>
                  {isAi
                    ? '⚡ Syncing will upload and move directly to Complete — PDF sent automatically.'
                    : mode === 'human'
                      ? '✍️ Syncing will send to the typist queue (Processing stage).'
                      : 'ℹ️ No mode set — will inherit from your profile setting.'}
                </Text>
              </View>
            )
          })()}
        </View>

        <View style={[styles.section, dm.surface, dm.border]}>
          <Text style={[styles.sectionTitle, dm.textLight]}>Property Details</Text>
          <DetailRow label="Address"   value={inspection.property_address || '—'} />
          <DetailRow label="Client"    value={inspection.client_name || '—'} />
          <DetailRow label="Tenant"    value={inspection.tenant_email || '—'} />
        </View>

        {(inspection.key_location || inspection.key_return) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Keys</Text>
            {inspection.key_location && <DetailRow label="Key Location" value={inspection.key_location} />}
            {inspection.key_return   && <DetailRow label="Key Return"   value={inspection.key_return} />}
          </View>
        )}

        {inspection.internal_notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Internal Notes</Text>
            <Text style={styles.notesText}>{inspection.internal_notes}</Text>
          </View>
        ) : null}


      </ScrollView>


      {/* ── Signature capture modal ─────────────────────────────────────── */}
      <Modal visible={showSignature} animationType="slide" presentationStyle="fullScreen">
        <View style={[sigStyles.screen, { paddingTop: insets.top }]}>
          <View style={sigStyles.header}>
            <Text style={sigStyles.title}>
              {sigStep === 'clerk' ? 'Inspector Signature' : 'Tenant Signature'}
            </Text>
            <Text style={sigStyles.subtitle}>
              {sigStep === 'clerk'
                ? 'Please sign to confirm this report is accurate.'
                : 'Ask the tenant to sign below, or skip if not present.'}
            </Text>
          </View>

          <View style={sigStyles.padWrap}>
            <SignaturePad
              key={sigStep}
              height={180}
              onSave={(dataUrl) => {
                if (sigStep === 'clerk') {
                  setClerkSig(dataUrl)
                  // Move to tenant step
                  setSigStep('tenant')
                } else {
                  setTenantSig(dataUrl)
                  setShowSignature(false)
                  commitFinalise(clerkSig, dataUrl)
                }
              }}
              onClear={() => {}}
            />
          </View>

          <View style={[sigStyles.footer, { paddingBottom: insets.bottom + 8 }]}>
            {sigStep === 'clerk' ? (
              <TouchableOpacity
                style={sigStyles.btnCancel}
                onPress={() => setShowSignature(false)}
              >
                <Text style={sigStyles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={sigStyles.btnCancel}
                  onPress={() => { setSigStep('clerk') }}
                >
                  <Text style={sigStyles.btnCancelText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={sigStyles.btnSkip}
                  onPress={() => {
                    setShowSignature(false)
                    commitFinalise(clerkSig, null)
                  }}
                >
                  <Text style={sigStyles.btnSkipText}>Skip (not present)</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Pre-finalise review overlay ─────────────────────────────────────── */}
      <Modal visible={showReview} animationType="slide" presentationStyle="fullScreen">
        <View style={[rvStyles.screen, { paddingTop: insets.top }]}>
          <View style={rvStyles.header}>
            <Text style={rvStyles.title}>Review Report</Text>
            <Text style={rvStyles.subtitle}>Check all items before finalising. Red items are unfilled.</Text>
          </View>
          <ScrollView style={rvStyles.scroll} contentContainerStyle={rvStyles.scrollContent}>
            {reviewRooms.length === 0 ? (
              <Text style={rvStyles.noData}>No room data recorded yet. Complete the inspection first.</Text>
            ) : (
              reviewRooms.map((room, ri) => (
                <View key={ri} style={rvStyles.roomBlock}>
                  <Text style={rvStyles.roomName}>{room.name}</Text>
                  {room.items.map((item, ii) => (
                    <View
                      key={ii}
                      style={[rvStyles.itemRow, item.isEmpty && rvStyles.itemEmpty,
                               ii === room.items.length - 1 && rvStyles.itemLast]}
                    >
                      <Text style={rvStyles.itemLabel}>{item.label}</Text>
                      {item.isEmpty && !item.subs?.length
                        ? <Text style={rvStyles.itemMissing}>⚠ Not filled</Text>
                        : <>
                            {!!item.desc && (
                              <View style={rvStyles.fieldBlock}>
                                <Text style={rvStyles.fieldLabel}>Description</Text>
                                <Text style={rvStyles.itemDesc}>{item.desc}</Text>
                              </View>
                            )}
                            {!!item.cond && (
                              <View style={rvStyles.fieldBlock}>
                                <Text style={rvStyles.fieldLabel}>Condition</Text>
                                <Text style={rvStyles.itemCond}>{item.cond}</Text>
                              </View>
                            )}
                            {item.subs && item.subs.length > 0 && (
                              <View style={rvStyles.subsBlock}>
                                {item.subs.map((sub, si) => (
                                  <View key={si} style={rvStyles.subRow}>
                                    <Text style={rvStyles.subLabel}>{sub.label}</Text>
                                    {sub.cond
                                      ? <Text style={rvStyles.subCond}>{sub.cond}</Text>
                                      : <Text style={rvStyles.subMissing}>⚠ Not filled</Text>
                                    }
                                  </View>
                                ))}
                              </View>
                            )}
                          </>
                      }
                    </View>
                  ))}
                </View>
              ))
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
          <View style={[rvStyles.footer, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity
              style={rvStyles.btnEdit}
              onPress={() => {
                setShowReview(false)
                navigation.navigate('RoomSelection', { inspectionId })
              }}
            >
              <Text style={rvStyles.btnEditText}>✏️  Edit Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={rvStyles.btnGo}
              onPress={() => { setShowReview(false); openSignatureFlow() }}
            >
              <Text style={rvStyles.btnGoText}>Looks Good — Finalise ✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const c = useColors()
  return (
    <View style={[drStyles.row, { borderBottomColor: c.border }]}>
      <Text style={[drStyles.label, { color: c.textMid }]}>{label}</Text>
      <Text style={[drStyles.value, { color: c.text }]}>{value}</Text>
    </View>
  )
}

const drStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  value: { fontSize: font.sm, color: colors.text, flex: 1, textAlign: 'right', marginLeft: spacing.sm },
})

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40 },
  photoArea: { position: 'relative', height: 220, backgroundColor: colors.muted },
  overviewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.muted,
  },
  photoPlaceholderIcon: { fontSize: 40, marginBottom: spacing.sm },
  photoPlaceholderText: { fontSize: font.sm, color: colors.textLight },
  photoPlaceholderHint: { fontSize: font.xs, color: colors.textLight, opacity: 0.6, marginTop: 4 },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 6, paddingHorizontal: spacing.md,
  },
  photoOverlayText: { color: '#fff', fontSize: font.sm, fontWeight: '600' },
  addressBlock: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  addressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  addressText: { flex: 1 },
  mapsBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, minWidth: 56 },
  mapsBtnIcon: { fontSize: 20 },
  mapsBtnText: { fontSize: 10, color: colors.primary, fontWeight: '700', marginTop: 2 },
  address: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  clientName: { fontSize: font.sm, color: colors.textMid, marginTop: 2 },
  section: {
    margin: spacing.md,
    marginBottom: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  notesText: { fontSize: font.sm, color: colors.text, lineHeight: 20 },
  ctaWrap: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: 16,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: font.lg, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 13,
    alignItems: 'center',
    marginTop: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  btnSecondaryText: { color: colors.primary, fontSize: font.md, fontWeight: '600' },
  btnFinalised: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  btnFinalisedText: { color: colors.success, fontSize: font.md, fontWeight: '600' },
  btnSync: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  btnSyncText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  syncingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  modeHint: { fontSize: font.xs, color: colors.textLight, marginBottom: spacing.sm, lineHeight: 16 },
})

const modeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    marginBottom: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: colors.borderDark,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  radioDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.primary,
  },
  label:       { fontSize: font.sm, fontWeight: '700', color: colors.text },
  labelActive: { color: colors.primary },
  sub:         { fontSize: font.xs, color: colors.textMid, lineHeight: 16, marginTop: 1 },
  infoBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  infoText: { fontSize: font.xs, color: colors.textMid, lineHeight: 16 },
})

// ── Inline sync progress bar ──────────────────────────────────────────────────

function phaseLabel(p: SyncProgress): string {
  if (p.phase === 'audio')  return `Audio clip ${p.done}/${p.total}`
  if (p.phase === 'photos') return p.total > 0 ? `${p.done}/${p.total} photos` : 'Preparing photos…'
  return 'Uploading…'
}

function InlineSyncProgress({ progress }: { progress: SyncProgress }) {
  const isUpload = progress.phase === 'uploading'
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <View style={ipStyles.wrap}>
      <View style={ipStyles.header}>
        <Text style={ipStyles.label}>{phaseLabel(progress)}</Text>
        {!isUpload && progress.total > 0 && (
          <Text style={ipStyles.pct}>{pct}%</Text>
        )}
      </View>
      <View style={ipStyles.barBg}>
        <View
          style={[
            ipStyles.barFill,
            { width: isUpload ? '100%' : `${pct}%` },
            isUpload && ipStyles.barUpload,
          ]}
        />
      </View>
    </View>
  )
}

const ipStyles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  label: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  pct:   { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  barBg: {
    height: 6,
    backgroundColor: colors.muted,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  barUpload: { backgroundColor: colors.accent },
})

// ── Signature modal styles ────────────────────────────────────────────────────
const sigStyles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: colors.background },
  header: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title:    { fontSize: font.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textLight, marginTop: 3, lineHeight: 18 },
  padWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btnCancel: {
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    alignItems: 'center',
    backgroundColor: colors.background,
    minWidth: 80,
  },
  btnCancelText: { fontSize: font.md, fontWeight: '600', color: colors.textMid },
  btnSkip: {
    flex: 1,
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  btnSkipText: { fontSize: font.md, fontWeight: '600', color: colors.textMid },
})

// ── Pre-finalise review overlay styles ───────────────────────────────────────
const rvStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title:    { fontSize: font.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textLight, marginTop: 3, lineHeight: 18 },
  scroll:   { flex: 1 },
  scrollContent: { padding: spacing.md, paddingTop: spacing.sm },
  noData: {
    fontSize: font.sm, color: colors.textLight,
    textAlign: 'center', marginTop: 60, lineHeight: 20,
  },
  roomBlock: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  roomName: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.muted,
  },
  itemRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemLast:    { borderBottomWidth: 0 },
  itemEmpty:   { backgroundColor: '#fff5f5' },
  itemLabel:   { fontSize: font.sm, fontWeight: '600', color: colors.text },
  fieldBlock:  { marginTop: spacing.xs },
  fieldLabel:  { fontSize: font.xs, fontWeight: '700', color: colors.textLight, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  itemDesc:    { fontSize: font.sm, color: colors.text, lineHeight: 19 },
  itemCond:    { fontSize: font.sm, color: colors.textMid, lineHeight: 19 },
  itemMissing: { fontSize: font.xs, color: colors.danger, fontWeight: '700', marginTop: 2 },
  subsBlock: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: 6,
  },
  subRow:     { gap: 2 },
  subLabel:   { fontSize: font.xs, fontWeight: '700', color: colors.textLight },
  subCond:    { fontSize: font.sm, color: colors.textMid, lineHeight: 18 },
  subMissing: { fontSize: font.xs, color: colors.danger, fontWeight: '600' },
  footer: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btnEdit: {
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  btnEditText: { fontSize: font.md, fontWeight: '600', color: colors.textMid },
  btnGo: {
    padding: 15,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  btnGoText: { fontSize: font.lg, fontWeight: '700', color: '#fff' },
})
