import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Switch,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'

import * as FileSystem from 'expo-file-system/legacy'

import type { RootStackParamList } from '../../App'
import { api } from '../services/api'
import { saveInspection, getLocalInspections } from '../services/database'
import { colors, font, radius, spacing, TYPE_LABELS, STATUS_COLORS } from '../utils/theme'
import Header from '../components/Header'
import StatusBadge from '../components/StatusBadge'

/**
 * When the server returns report_data with photos as base64 data URIs, write each
 * one to a local file and replace the data URI with a file:// path.
 * This prevents massive inline strings in SQLite and ensures Image components
 * can render photos reliably.
 *
 * Works for any itemKey including '_overview' (the room overview key).
 */
async function extractBase64PhotosToFiles(inspectionId: number, rd: any): Promise<any> {
  const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
  let dirReady = false

  const ensureDir = async () => {
    if (!dirReady) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
      dirReady = true
    }
  }

  for (const sectionKey of Object.keys(rd)) {
    const section = rd[sectionKey]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue

    for (const itemKey of Object.keys(section)) {
      const item = section[itemKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (!Array.isArray(item._photos)) continue

      const hasBase64 = item._photos.some((u: string) => typeof u === 'string' && u.startsWith('data:'))
      if (!hasBase64) continue

      await ensureDir()
      item._photos = await Promise.all(
        item._photos.map(async (uri: string) => {
          if (!uri.startsWith('data:image')) return uri
          try {
            const b64 = uri.split(',')[1]
            // Unique filename — timestamp + short random suffix avoids collisions
            const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
            await FileSystem.writeAsStringAsync(dest, b64, {
              encoding: FileSystem.EncodingType.Base64,
            })
            return dest
          } catch (e) {
            console.warn('[FetchInspections] could not extract photo to file:', e)
            return uri  // keep data URI as fallback — better than losing the photo
          }
        })
      )
    }
  }
  return rd
}

/**
 * Download remote HTTPS photo URLs to local files and replace the URLs with
 * file:// paths. Runs after extractBase64PhotosToFiles so S3-hosted photos from
 * completed source inspections are also available offline during check-out.
 */
function countRemotePhotos(rd: any): number {
  let n = 0
  for (const sKey of Object.keys(rd)) {
    const section = rd[sKey]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    for (const iKey of Object.keys(section)) {
      const item = section[iKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (Array.isArray(item._photos)) {
        n += item._photos.filter((u: string) => typeof u === 'string' && u.startsWith('https://')).length
      }
    }
  }
  return n
}

async function downloadRemotePhotosToFiles(inspectionId: number, rd: any, onPhoto?: () => void): Promise<any> {
  const dir = `${FileSystem.documentDirectory}photos/${inspectionId}/`
  let dirReady = false

  const ensureDir = async () => {
    if (!dirReady) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
      dirReady = true
    }
  }

  for (const sectionKey of Object.keys(rd)) {
    const section = rd[sectionKey]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue

    for (const itemKey of Object.keys(section)) {
      const item = section[itemKey]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (!Array.isArray(item._photos)) continue

      const hasRemote = item._photos.some((u: string) => typeof u === 'string' && u.startsWith('https://'))
      if (!hasRemote) continue

      await ensureDir()
      item._photos = await Promise.all(
        item._photos.map(async (uri: string) => {
          if (!uri.startsWith('https://')) return uri
          try {
            const dest = `${dir}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
            const result = await FileSystem.downloadAsync(uri, dest)
            const out = result.status === 200 ? result.uri : uri
            onPhoto?.()
            return out
          } catch {
            onPhoto?.()
            return uri  // keep remote URL as fallback
          }
        })
      )
    }
  }
  return rd
}

type SortMode = 'date-desc' | 'name-asc' | 'name-desc'

type FetchProgress = {
  current: number
  total: number
  address: string
  photosDone: number
  photosTotal: number
}

function sortList(list: any[], mode: SortMode): any[] {
  const copy = [...list]
  if (mode === 'date-desc') return copy.sort((a, b) => new Date(a.conduct_date || 0).getTime() - new Date(b.conduct_date || 0).getTime())
  if (mode === 'name-asc')  return copy.sort((a, b) => (a.property_address || '').localeCompare(b.property_address || ''))
  return copy.sort((a, b) => (b.property_address || '').localeCompare(a.property_address || ''))
}

type Nav = StackNavigationProp<RootStackParamList, 'FetchInspections'>

export default function FetchInspectionsScreen() {
  const navigation = useNavigation<Nav>()
  const insets = useSafeAreaInsets()

  const [serverList, setServerList]   = useState<any[]>([])
  const [localIds, setLocalIds]       = useState<Set<number>>(new Set())
  const [selected, setSelected]       = useState<Set<number>>(new Set())
  const [loading, setLoading]         = useState(false)
  const [fetching, setFetching]       = useState(false)
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null)
  const [results, setResults]         = useState<{ id: number; address: string; success: boolean; error?: string }[] | null>(null)
  const [confirmModal, setConfirmModal] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [sortBy, setSortBy]           = useState<SortMode>('date-desc')

  const displayList = showComplete
    ? serverList
    : serverList.filter(i => i.status !== 'complete')

  const sortedList = useMemo(() => sortList(displayList, sortBy), [displayList, sortBy])

  function toggleShowComplete(val: boolean) {
    setShowComplete(val)
    if (!val) {
      setSelected(prev => {
        const completeIds = new Set(serverList.filter(i => i.status === 'complete').map(i => i.id))
        const n = new Set(prev)
        for (const id of completeIds) n.delete(id)
        return n
      })
    }
  }

  useFocusEffect(useCallback(() => {
    loadServer()
  }, []))

  async function loadServer() {
    setLoading(true)
    setResults(null)
    try {
      const [serverRes, local] = await Promise.all([
        api.getInspections(),
        getLocalInspections(),
      ])
      // Show all inspections for this clerk regardless of status — completed/review
      // reports must remain downloadable so clerks can re-open and amend them offline.
      setServerList(serverRes.data as any[])
      setLocalIds(new Set(local.map((i: any) => i.id)))
    } catch {
      Alert.alert('Error', 'Could not load inspections. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === sortedList.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sortedList.map(i => i.id)))
    }
  }

  async function runFetch() {
    setConfirmModal(false)
    setFetching(true)
    setFetchProgress(null)
    const res: { id: number; address: string; success: boolean; error?: string }[] = []
    const total = selected.size

    // Fetch both fixed and midterm sections once before the loop.
    // We embed the appropriate copy in each downloaded inspection for offline use.
    let fixedSectionsData: any[] = []
    let midtermSectionsData: any[] = []
    try {
      const fsRes = await api.getFixedSections()
      fixedSectionsData = Array.isArray(fsRes.data) ? fsRes.data : []
    } catch (fsErr) {
      console.warn('[FetchInspections] Could not pre-fetch fixed sections:', fsErr)
    }
    try {
      const msRes = await api.getMidtermSections()
      midtermSectionsData = Array.isArray(msRes.data) ? msRes.data : []
    } catch (msErr) {
      console.warn('[FetchInspections] Could not pre-fetch midterm sections:', msErr)
    }

    let current = 0
    for (const id of Array.from(selected)) {
      const inspection = serverList.find(i => i.id === id)
      if (!inspection) continue
      current++
      setFetchProgress({ current, total, address: inspection.property_address || '', photosDone: 0, photosTotal: 0 })
      try {
        // Fetch full inspection detail (includes property.overview_photo)
        const detail = await api.getInspection(id)
        // Normalise detail response: add flat fields the app reads everywhere
        // Detail has nested property/client/inspector/typist objects;
        // the list endpoint has flat fields. We need both.
        const d = detail.data
        const normalised: any = {
          ...d,
          property_address:  d.property?.address   ?? inspection.property_address ?? 'Unknown address',
          client_name:       d.client?.name         ?? inspection.client_name      ?? '',
          client_id:         d.client?.id           ?? d.property?.client_id       ?? null,
          inspector_name:    d.inspector?.name      ?? inspection.inspector_name   ?? '',
          typist_name:       d.typist?.name         ?? inspection.typist_name      ?? '',
          typist_is_ai:      d.typist_is_ai         ?? d.typist?.is_ai              ?? false,
        }

        // Always fetch the full template and overwrite whatever the inspection
        // detail API returned. The detail endpoint may include a partial template
        // object (e.g. {id, name} without sections), which is truthy but useless.
        // We need the full object with sections[].items[] for rooms to work offline.
        const templateId = d.template_id
        if (templateId) {
          try {
            const tmplRes = await api.getTemplate(templateId)
            normalised.template = tmplRes.data
          } catch (tmplErr) {
            console.warn('[FetchInspections] Could not pre-fetch template:', tmplErr)
            // Non-fatal: app will attempt a live fetch when rooms are opened
          }
        }

        // Source check-in inspection — fetch for two purposes:
        //   1. Template inheritance: CO inspections may have no template; inherit from CI.
        //   2. Photo caching: download CI photos to device so they're visible offline
        //      during the check-out (shown in the per-item "Check-In Photos" accordion).
        if (d.source_inspection_id) {
          try {
            const srcRes  = await api.getInspection(d.source_inspection_id)
            const srcData = srcRes.data

            // 1. Template inheritance when CO has no sections
            const hasSections = Array.isArray(normalised.template?.sections) &&
                                normalised.template.sections.length > 0
            if (!hasSections) {
              const srcTmplId = srcData?.template_id
              if (srcTmplId && srcTmplId !== templateId) {
                try {
                  const srcTmplRes = await api.getTemplate(srcTmplId)
                  normalised.template    = srcTmplRes.data
                  normalised.template_id = srcTmplId
                  console.log(`[FetchInspections] check-out template inherited from source inspection ${d.source_inspection_id}`)
                } catch (tmplErr) {
                  console.warn('[FetchInspections] Could not fetch source template:', tmplErr)
                }
              }
            }

            // 2. Cache source CI report_data with all photos materialised to local files
            const srcRd = srcData?.report_data
            if (srcRd) {
              try {
                const srcRdObj = typeof srcRd === 'string' ? JSON.parse(srcRd) : srcRd
                // Store CI photos under the CO inspection's own directory (not the CI's)
                // so they're isolated and can be cleanly deleted when the CO report syncs.
                let processed = await extractBase64PhotosToFiles(id, srcRdObj)
                const photosTotal = countRemotePhotos(processed)
                if (photosTotal > 0) {
                  setFetchProgress(p => p ? { ...p, photosTotal, photosDone: 0 } : p)
                }
                processed = await downloadRemotePhotosToFiles(id, processed, () => {
                  setFetchProgress(p => p ? { ...p, photosDone: p.photosDone + 1 } : p)
                })
                normalised.source_report_data = JSON.stringify(processed)
              } catch (rdErr) {
                console.warn('[FetchInspections] Could not cache source CI photos:', rdErr)
              }
            }
          } catch (srcErr) {
            console.warn('[FetchInspections] Could not fetch source inspection:', srcErr)
          }
        }

        // Embed fixed sections so the app works fully offline.
        // Midterm inspections use a separate section set.
        const isMidterm = d.inspection_type === 'midterm'
        const sectionsToEmbed = isMidterm ? midtermSectionsData : fixedSectionsData
        if (sectionsToEmbed.length > 0) {
          normalised.fixedSections = sectionsToEmbed
        }

        // Normalise report_data from the server response:
        //  - Server may return it as a parsed object or as a JSON string — handle both.
        //  - Extract any base64 data URIs to local files so Image renders them reliably
        //    and SQLite doesn't store huge inline strings.
        if (normalised.report_data) {
          try {
            const rdObj = typeof normalised.report_data === 'string'
              ? JSON.parse(normalised.report_data)
              : normalised.report_data
            const extracted = await extractBase64PhotosToFiles(id, rdObj)
            normalised.report_data = JSON.stringify(extracted)
          } catch (e) {
            console.warn('[FetchInspections] report_data processing failed:', e)
            // Ensure it's stored as a string at minimum
            if (typeof normalised.report_data !== 'string') {
              normalised.report_data = JSON.stringify(normalised.report_data)
            }
          }
        }

        await saveInspection(normalised)
        res.push({ id, address: normalised.property_address, success: true })
      } catch (err: any) {
        res.push({ id, address: inspection.property_address, success: false, error: err.message || 'Network error' })
      }
    }

    // Refresh local IDs
    const local = await getLocalInspections()
    setLocalIds(new Set(local.map((i: any) => i.id)))
    setSelected(new Set())
    setFetching(false)
    setFetchProgress(null)
    setResults(res)
  }

  function formatDate(str: string | null) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function renderItem({ item }: { item: any }) {
    const isLocal = localIds.has(item.id)
    const isSel   = selected.has(item.id)
    return (
      <TouchableOpacity
        style={[styles.card, isSel && styles.cardSelected]}
        onPress={() => toggleSelect(item.id)}
        activeOpacity={0.75}
      >
        <View style={styles.cardCheck}>
          <View style={[styles.checkbox, isSel && styles.checkboxChecked]}>
            {isSel && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.address} numberOfLines={2}>{item.property_address}</Text>
          <Text style={styles.client}>{item.client_name || '—'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{TYPE_LABELS[item.inspection_type] ?? item.inspection_type}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>{formatDate(item.conduct_date)}</Text>
          </View>
          <View style={styles.badges}>
            <StatusBadge status={item.status} small />
            {isLocal && (
              <View style={styles.localBadge}>
                <Text style={styles.localBadgeText}>✓ Downloaded</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        title="Fetch Inspections"
        subtitle="Select inspections to download"
        onBack={() => navigation.goBack()}
      />

      {/* Results banner */}
      {results && (
        <View style={styles.resultsBanner}>
          <Text style={styles.resultsTitle}>
            {results.filter(r => r.success).length}/{results.length} downloaded
          </Text>
          {results.map(r => (
            <Text key={r.id} style={r.success ? styles.resultOk : styles.resultFail}>
              {r.success ? '✓' : '✕'} {r.address}{!r.success && ` — ${r.error}`}
            </Text>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : serverList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No inspections found</Text>
          <Text style={styles.emptySub}>There are no inspections on the server for your account.</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadServer}>
            <Text style={styles.refreshBtnText}>↺ Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Show Complete</Text>
            <Switch
              value={showComplete}
              onValueChange={toggleShowComplete}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={showComplete ? colors.primary : colors.textLight}
            />
          </View>

          <View style={styles.sortRow}>
            {(['date-desc', 'name-asc', 'name-desc'] as SortMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.sortPill, sortBy === mode && styles.sortPillActive]}
                onPress={() => setSortBy(mode)}
              >
                <Text style={[styles.sortPillText, sortBy === mode && styles.sortPillTextActive]}>
                  {mode === 'date-desc' ? 'Date ↑' : mode === 'name-asc' ? 'A → Z' : 'Z → A'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listCount}>{sortedList.length} inspection{sortedList.length !== 1 ? 's' : ''} available</Text>
            <TouchableOpacity onPress={toggleAll}>
              <Text style={styles.toggleAll}>
                {selected.size === sortedList.length ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={sortedList}
            keyExtractor={i => String(i.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshing={loading}
            onRefresh={loadServer}
          />

          {fetching && fetchProgress && (
            <View style={styles.progressBanner}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressTitle}>
                  Downloading {fetchProgress.current} of {fetchProgress.total}
                </Text>
                <Text style={styles.progressAddress} numberOfLines={1}>
                  {fetchProgress.address}
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${Math.round((fetchProgress.current / fetchProgress.total) * 100)}%` as any }]} />
              </View>
              {fetchProgress.photosTotal > 0 && (
                <>
                  <Text style={styles.progressPhotos}>
                    Photos {fetchProgress.photosDone}/{fetchProgress.photosTotal}
                  </Text>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, styles.progressBarPhotoFill, {
                      width: `${Math.round((fetchProgress.photosDone / fetchProgress.photosTotal) * 100)}%` as any,
                    }]} />
                  </View>
                </>
              )}
            </View>
          )}

          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity
              style={[styles.fetchBtn, (selected.size === 0 || fetching) && styles.fetchBtnDisabled]}
              onPress={() => { if (selected.size > 0) setConfirmModal(true) }}
              disabled={selected.size === 0 || fetching}
            >
              <Text style={styles.fetchBtnText}>
                {fetching
                  ? 'Downloading…'
                  : `↓ Download ${selected.size > 0 ? `${selected.size} Inspection${selected.size !== 1 ? 's' : ''}` : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal visible={confirmModal} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.box}>
            <Text style={modalStyles.title}>Download {selected.size} Inspection{selected.size !== 1 ? 's' : ''}?</Text>
            <Text style={modalStyles.body}>
              This will download all inspection data to your device, including property photos and templates. Make sure you have a good connection.
            </Text>
            {Array.from(selected).map(id => {
              const insp = serverList.find(i => i.id === id)
              return (
                <Text key={id} style={modalStyles.listItem}>
                  • {insp?.property_address}
                </Text>
              )
            })}
            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancel} onPress={() => setConfirmModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={modalStyles.confirm} onPress={runFetch}>
                <Text style={modalStyles.confirmText}>Download</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, width: '88%' },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: font.sm, color: colors.textMid, marginBottom: spacing.sm, lineHeight: 20 },
  listItem: { fontSize: font.sm, color: colors.text, marginBottom: 4, paddingLeft: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cancel: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.muted, alignItems: 'center' },
  cancelText: { color: colors.textMid, fontWeight: '600' },
  confirm: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700' },
})

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resultsBanner: { backgroundColor: colors.surface, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultsTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  resultOk: { fontSize: font.sm, color: colors.success, fontWeight: '600' },
  resultFail: { fontSize: font.sm, color: colors.danger },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterLabel: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  listCount: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  toggleAll: { fontSize: font.sm, color: colors.accent, fontWeight: '600' },
  list: { padding: spacing.md, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  cardCheck: { marginRight: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.borderDark, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cardBody: { flex: 1, gap: 2 },
  address: { fontSize: font.md, fontWeight: '700', color: colors.text, lineHeight: 20 },
  client: { fontSize: font.sm, color: colors.textMid },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  meta: { fontSize: font.xs, color: colors.textLight },
  metaDot: { fontSize: font.xs, color: colors.textLight },
  badges: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
  localBadge: { backgroundColor: colors.successLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  localBadgeText: { fontSize: 10, color: colors.success, fontWeight: '700' },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sortPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  sortPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  sortPillText: { fontSize: font.xs, fontWeight: '600', color: colors.textMid },
  sortPillTextActive: { color: colors.primary },

  progressBanner: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  progressTitle:  { fontSize: font.sm, fontWeight: '700', color: colors.text },
  progressAddress:{ fontSize: font.xs, color: colors.textMid, flex: 1, textAlign: 'right' },
  progressBarBg:  { height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: 'hidden' },
  progressBarFill:{ height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressBarPhotoFill: { backgroundColor: colors.accent },
  progressPhotos: { fontSize: font.xs, color: colors.textMid, fontWeight: '600', marginTop: 2 },

  footer: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  fetchBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  fetchBtnDisabled: { backgroundColor: colors.borderDark },
  fetchBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.textMid },
  emptySub: { fontSize: font.sm, color: colors.textLight, textAlign: 'center' },
  refreshBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  refreshBtnText: { color: '#fff', fontWeight: '700' },
})
