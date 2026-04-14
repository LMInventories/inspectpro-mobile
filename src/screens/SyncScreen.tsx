import React, { useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Modal,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'

import type { RootStackParamList } from '../../App'
import { useInspectionStore } from '../stores/inspectionStore'
import { useAuthStore } from '../stores/authStore'
import { deleteLocalInspection } from '../services/database'
import { syncSingleInspection, SyncResult, SyncProgress } from '../services/syncService'
import Header from '../components/Header'
import StatusBadge from '../components/StatusBadge'
import { colors, font, radius, spacing, TYPE_LABELS } from '../utils/theme'

type Nav = StackNavigationProp<RootStackParamList, 'Sync'>

export default function SyncScreen() {
  const navigation = useNavigation<Nav>()
  const insets     = useSafeAreaInsets()
  const { inspections, loadInspections } = useInspectionStore()
  const { user } = useAuthStore()

  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const [syncing, setSyncing]           = useState(false)
  const [results, setResults]           = useState<SyncResult[] | null>(null)
  const [confirmModal, setConfirmModal] = useState(false)
  const [progress, setProgress]         = useState<SyncProgress | null>(null)
  const [syncIndex, setSyncIndex]       = useState(0)   // which inspection we're on
  const [syncTotal, setSyncTotal]       = useState(0)   // total selected

  useFocusEffect(useCallback(() => {
    loadInspections()
    setResults(null)
  }, []))

  const syncable = inspections.filter(i => !i.synced)
  const done     = inspections.filter(i => i.synced)

  function toggleSelect(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(selected.size === syncable.length ? new Set() : new Set(syncable.map(i => i.id)))
  }

  async function runSync() {
    setConfirmModal(false)
    setSyncing(true)
    setResults(null)
    const ids = Array.from(selected)
    setSyncTotal(ids.length)
    const res: SyncResult[] = []

    for (let i = 0; i < ids.length; i++) {
      setSyncIndex(i + 1)
      setProgress(null)
      const inspection = inspections.find(insp => insp.id === ids[i])
      if (!inspection) continue
      const result = await syncSingleInspection(ids[i], inspection, user, setProgress)
      res.push(result)
    }

    await loadInspections()
    setSyncing(false)
    setProgress(null)
    setResults(res)
    setSelected(new Set())
  }

  async function handleRemove(id: number, address: string) {
    Alert.alert(`Remove "${address}"?`, 'Removes the local copy. Only remove synced inspections.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteLocalInspection(id); await loadInspections() } },
    ])
  }

  function formatDate(str: string | null) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // Explain what status transition will happen for this user
  function syncNote() {
    const selectedList = syncable.filter(i => selected.has(i.id))
    const anyFinalised = selectedList.some(i => (i as any).is_finalised)
    const allFinalised = selectedList.length > 0 && selectedList.every(i => (i as any).is_finalised)

    if (user?.role === 'clerk') {
      const finalisedList = selectedList.filter(i => (i as any).is_finalised)

      // Per-inspection typist mode: check each finalised inspection individually
      const isInspAi = (insp: any) => {
        const mode = insp.typist_mode
        return mode === 'ai_instant' || mode === 'ai_room' ||
               insp.typist_is_ai === true ||
               (insp.typist?.is_ai === true) ||
               (insp.typist_name || '').toLowerCase().startsWith('ai ')
      }

      const allAi    = finalisedList.length > 0 && finalisedList.every(isInspAi)
      const noneAi   = finalisedList.every(i => !isInspAi(i))
      const mixedAi  = !allAi && !noneAi

      if (allFinalised) {
        if (allAi)   return 'All selected inspections are finalised. Syncing will upload and mark Complete.'
        if (noneAi)  return 'All selected inspections are finalised. Syncing will upload and move to Processing for the typist.'
        return 'All selected inspections are finalised. AI reports will move to Complete; human-typed reports will move to Processing.'
      }
      if (anyFinalised) {
        if (allAi)   return 'Finalised inspections will move to Complete. Unfinalised inspections will stay Active.'
        if (noneAi)  return 'Finalised inspections will move to Processing. Unfinalised inspections will stay Active.'
        return 'Finalised AI reports will move to Complete; human-typed reports will move to Processing. Unfinalised inspections will stay Active.'
      }
      return 'None of the selected inspections are finalised. Syncing will upload data but leave them Active.'
    }
    if (user?.role === 'typist')
      return 'Syncing will upload your report and move the inspection to Review.'
    return 'Syncing will upload report data to the server.'
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Sync" subtitle="Upload completed inspections" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {results && (
          <View style={styles.resultsBox}>
            <Text style={styles.resultsTitle}>{results.filter(r => r.success).length}/{results.length} synced successfully</Text>
            {results.map(r => (
              <View key={r.id} style={styles.resultRow}>
                <Text style={r.success ? styles.resultOk : styles.resultFail}>{r.success ? '✓' : '✕'} {r.address}</Text>
                {!r.success && <Text style={styles.resultError}>{r.error}</Text>}
              </View>
            ))}
          </View>
        )}

        {syncable.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Ready to Sync ({syncable.length})</Text>
              <TouchableOpacity onPress={toggleAll}>
                <Text style={styles.toggleAllText}>{selected.size === syncable.length ? 'Deselect All' : 'Select All'}</Text>
              </TouchableOpacity>
            </View>

            {syncable.map(inspection => {
              const isSel = selected.has(inspection.id)
              return (
                <TouchableOpacity key={inspection.id} style={[styles.card, isSel && styles.cardSelected]} onPress={() => toggleSelect(inspection.id)}>
                  <View style={styles.cardCheck}>
                    <View style={[styles.checkbox, isSel && styles.checkboxChecked]}>
                      {isSel && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardAddress} numberOfLines={2}>{inspection.property_address}</Text>
                    <Text style={styles.cardMeta}>{TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type} · {formatDate(inspection.conduct_date)}</Text>
                    <View style={styles.badgeRow}>
                      <StatusBadge status={inspection.status} small />
                      {(inspection as any).is_finalised && (
                        <View style={styles.finalisedBadge}>
                          <Text style={styles.finalisedBadgeText}>✓ Finalised</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              )
            })}

            {syncing && progress ? (
              <SyncProgressBar
                progress={progress}
                inspectionIndex={syncIndex}
                inspectionTotal={syncTotal}
              />
            ) : (
              <TouchableOpacity
                style={[styles.syncBtn, (selected.size === 0 || syncing) && styles.syncBtnDisabled]}
                onPress={() => { if (selected.size > 0) setConfirmModal(true) }}
                disabled={syncing || selected.size === 0}
              >
                {syncing ? (
                  <View style={styles.syncingRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.syncBtnText}>Preparing…</Text>
                  </View>
                ) : (
                  <Text style={styles.syncBtnText}>
                    ⇅ Sync {selected.size > 0 ? `${selected.size} Inspection${selected.size !== 1 ? 's' : ''}` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        {done.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
              <Text style={styles.sectionLabel}>Synced — Awaiting Removal ({done.length})</Text>
            </View>
            {done.map(inspection => (
              <View key={inspection.id} style={[styles.card, styles.cardDone]}>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardAddress, styles.cardAddressDone]} numberOfLines={2}>{inspection.property_address}</Text>
                  <Text style={styles.cardMeta}>{TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type} · {formatDate(inspection.conduct_date)}</Text>
                </View>
                <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(inspection.id, inspection.property_address)}>
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {syncable.length === 0 && done.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>☁️</Text>
            <Text style={styles.emptyTitle}>Nothing to sync</Text>
            <Text style={styles.emptySub}>Download inspections from the Fetch screen first.</Text>
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={confirmModal} transparent animationType="fade">
        <View style={mStyles.overlay}><View style={mStyles.box}>
          <Text style={mStyles.title}>Sync {selected.size} Inspection{selected.size !== 1 ? 's' : ''}?</Text>
          <View style={mStyles.warning}>
            <Text style={mStyles.warningIcon}>ℹ️</Text>
            <Text style={mStyles.warningText}>{syncNote()}</Text>
          </View>
          <View style={mStyles.warning}>
            <Text style={mStyles.warningIcon}>⚠️</Text>
            <Text style={mStyles.warningText}>Make sure you have a working internet connection before syncing.</Text>
          </View>
          <View style={mStyles.actions}>
            <TouchableOpacity style={mStyles.cancel} onPress={() => setConfirmModal(false)}>
              <Text style={mStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={mStyles.confirm} onPress={runSync}>
              <Text style={mStyles.confirmText}>Sync Now</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </View>
  )
}

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, width: '85%' },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  warning: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  warningIcon: { fontSize: 16 },
  warningText: { flex: 1, fontSize: font.sm, color: colors.warning, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  cancel: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.muted, alignItems: 'center' },
  cancelText: { color: colors.textMid, fontWeight: '600' },
  confirm: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700' },
})
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md },
  resultsBox: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  resultsTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  resultRow: { marginBottom: 4 },
  resultOk: { fontSize: font.sm, color: colors.success, fontWeight: '600' },
  resultFail: { fontSize: font.sm, color: colors.danger, fontWeight: '600' },
  resultError: { fontSize: font.xs, color: colors.danger, marginLeft: 18, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textLight, textTransform: 'uppercase', letterSpacing: 0.6 },
  toggleAllText: { fontSize: font.sm, color: colors.accent, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1.5, borderColor: colors.border },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  cardDone: { opacity: 0.7 },
  cardCheck: { marginRight: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.borderDark, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cardContent: { flex: 1, gap: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginTop: 2 },
  finalisedBadge: { backgroundColor: colors.successLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  finalisedBadgeText: { fontSize: font.xs, color: colors.success, fontWeight: '700' },
  cardAddress: { fontSize: font.md, fontWeight: '700', color: colors.text, lineHeight: 20 },
  cardAddressDone: { color: colors.textMid },
  cardMeta: { fontSize: font.xs, color: colors.textLight },
  removeBtn: { backgroundColor: colors.dangerLight, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.sm },
  removeBtnText: { fontSize: font.xs, color: colors.danger, fontWeight: '700' },
  syncBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: spacing.md },
  syncBtnDisabled: { backgroundColor: colors.borderDark },
  syncBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  syncingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: spacing.md },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.textMid },
  emptySub: { fontSize: font.sm, color: colors.textLight, textAlign: 'center' },
})

// ── Sync progress bar component ───────────────────────────────────────────────

function phaseLabel(p: SyncProgress): string {
  if (p.phase === 'audio')    return `Audio clip ${p.done}/${p.total}`
  if (p.phase === 'photos')   return `${p.done}/${p.total} photos`
  return 'Uploading…'
}

function SyncProgressBar({
  progress, inspectionIndex, inspectionTotal,
}: {
  progress: SyncProgress
  inspectionIndex: number
  inspectionTotal: number
}) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const isUpload = progress.phase === 'uploading'
  return (
    <View style={pbStyles.wrap}>
      <View style={pbStyles.header}>
        <Text style={pbStyles.insp}>
          Inspection {inspectionIndex}/{inspectionTotal}
        </Text>
        {!isUpload && (
          <Text style={pbStyles.pct}>{pct}%</Text>
        )}
      </View>
      <View style={pbStyles.barBg}>
        <View
          style={[
            pbStyles.barFill,
            { width: isUpload ? '100%' : `${pct}%` },
            isUpload && pbStyles.barUpload,
          ]}
        />
      </View>
      <Text style={pbStyles.label}>{phaseLabel(progress)}</Text>
    </View>
  )
}

const pbStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  insp: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  pct:  { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  barBg: {
    height: 8,
    backgroundColor: colors.muted,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  barUpload: { backgroundColor: colors.accent },
  label: { fontSize: font.xs, color: colors.textMid, fontWeight: '600' },
})
