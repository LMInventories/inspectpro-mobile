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
import { colors, font, radius, spacing, TYPE_LABELS } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'PropertyOverview'>
type Route = RouteProp<RootStackParamList, 'PropertyOverview'>

type ReviewItem = { label: string; desc: string; cond: string; isEmpty: boolean }
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
  const { activeInspection, loadInspection, updateItemInReport } = useInspectionStore()
  const { user } = useAuthStore()
  const [starting, setStarting] = useState(false)
  const [finalising, setFinalising] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [reviewRooms, setReviewRooms] = useState<ReviewRoom[]>([])

  useEffect(() => { loadInspection(inspectionId) }, [inspectionId])

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
    const rooms: ReviewRoom[] = []

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
        const cond = isCheckOut
          ? (rd[key]?.[String(item.id)]?.checkOutCondition || '')
          : (rd[key]?.[String(item.id)]?.condition || '')
        const desc = isCheckOut ? '' : (rd[key]?.[String(item.id)]?.description || '')
        items.push({ label: item.name || item.label || '', desc, cond, isEmpty: !cond && !desc })
      }
      for (const extra of (rd[key]?._extra || [])) {
        const eid = extra._eid
        const cond = isCheckOut
          ? (rd[key]?.[eid]?.checkOutCondition || '')
          : (rd[key]?.[eid]?.condition || '')
        const desc = isCheckOut ? '' : (rd[key]?.[eid]?.description || '')
        items.push({ label: extra.name || 'Added item', desc, cond, isEmpty: !cond && !desc })
      }
      if (items.length > 0) rooms.push({ name: displayName, items })
    }

    // Custom rooms
    const customRooms: { key: string; name: string }[] = rd['_customRooms'] || []
    for (const cr of customRooms) {
      if (hiddenRooms.includes(cr.key)) continue
      const items: ReviewItem[] = []
      for (const extra of (rd[cr.key]?._extra || [])) {
        const eid = extra._eid
        const cond = isCheckOut
          ? (rd[cr.key]?.[eid]?.checkOutCondition || '')
          : (rd[cr.key]?.[eid]?.condition || '')
        const desc = isCheckOut ? '' : (rd[cr.key]?.[eid]?.description || '')
        items.push({ label: extra.name || 'Added item', desc, cond, isEmpty: !cond && !desc })
      }
      if (items.length > 0) rooms.push({ name: cr.name || 'Room', items })
    }

    setReviewRooms(rooms)
    setShowReview(true)
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
      Alert.alert(
        'Finalise Inspection',
        isAiMode
          ? 'This report will be marked Complete and automatically sent to all recipients when synced.\n\nPlease ensure all rooms, conditions, and photos have been reviewed and are accurate before finalising — once synced, the report is delivered immediately.'
          : 'Mark this inspection as complete on device. When synced, it will be queued for typist processing instead of staying Active.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Finalise',
            onPress: async () => {
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
            },
          },
        ]
      )
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
    <View style={[styles.screen, { paddingTop: insets.top }]}>
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
        <View style={styles.addressBlock}>
          <View style={styles.addressRow}>
            <View style={styles.addressText}>
              <Text style={styles.address}>{inspection.property_address || 'Unknown address'}</Text>
              <Text style={styles.clientName}>{inspection.client_name || '—'}</Text>
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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inspection Details</Text>
          <DetailRow label="Type"       value={TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type} />
          <DetailRow label="Date"       value={formatDate(inspection.conduct_date)} />
          <DetailRow label="Time"       value={formatTime(inspection.conduct_time_preference)} />
          <DetailRow label="Inspector"  value={inspection.inspector_name || '—'} />
          <DetailRow label="Typist"     value={inspection.typist_name || '—'} />
        </View>

        {/* Typist mode — clerks can change this per-report without a system-wide setting */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Typist Mode</Text>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Property Details</Text>
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
                      {item.isEmpty
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
                                <Text style={rvStyles.fieldLabel}>{inspection.inspection_type === 'check_out' ? 'Condition' : 'Condition'}</Text>
                                <Text style={rvStyles.itemCond}>{item.cond}</Text>
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
              onPress={() => { setShowReview(false); handleFinalise() }}
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
  return (
    <View style={drStyles.row}>
      <Text style={drStyles.label}>{label}</Text>
      <Text style={drStyles.value}>{value}</Text>
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
