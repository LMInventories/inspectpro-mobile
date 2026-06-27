import React, { useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import { useAuthStore } from '../stores/authStore'
import { useInspectionStore } from '../stores/inspectionStore'
import { getAudioRecordings } from '../services/database'
import { api } from '../services/api'
import { colors, font, radius, spacing, TYPE_LABELS } from '../utils/theme'
import {
  fetchLatestRelease, downloadAndInstall, getCurrentBuildNumber,
  type ReleaseInfo,
} from '../services/updateService'

interface Props {
  visible: boolean
  onClose: () => void
  onOpenAdmin?: () => void
}

export default function AccountModal({ visible, onClose, onOpenAdmin }: Props) {
  const insets = useSafeAreaInsets()
  const { user, logout, updateDefaults } = useAuthStore()
  const { inspections } = useInspectionStore()
  const isAdmin = user?.role === 'admin'

  const [defaultsTypist, setDefaultsTypist] = useState<string>(user?.typist_mode ?? '')
  const [defaultsCamera, setDefaultsCamera] = useState<string>(user?.camera_option ?? 'perItem')
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [defaultsSaved,  setDefaultsSaved]  = useState(false)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw]         = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [exporting, setExporting]     = useState(false)

  type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'error'
  const [updateStatus, setUpdateStatus]   = useState<UpdateStatus>('idle')
  const [updateProgress, setUpdateProgress] = useState(0)
  const [releaseInfo, setReleaseInfo]     = useState<ReleaseInfo | null>(null)
  const [updateError, setUpdateError]     = useState('')

  async function handleCheckForUpdates() {
    setUpdateStatus('checking')
    setUpdateError('')
    try {
      const info = await fetchLatestRelease()
      const current = getCurrentBuildNumber()
      setReleaseInfo(info)
      if (info.buildNumber > current && info.downloadUrl) {
        setUpdateStatus('available')
      } else {
        setUpdateStatus('up-to-date')
      }
    } catch (err: any) {
      setUpdateError(err?.message || 'Could not check for updates.')
      setUpdateStatus('error')
    }
  }

  async function handleDownloadAndInstall() {
    if (!releaseInfo?.downloadUrl) return
    setUpdateStatus('downloading')
    setUpdateProgress(0)
    try {
      await downloadAndInstall(releaseInfo.downloadUrl, setUpdateProgress)
    } catch (err: any) {
      setUpdateError(err?.message || 'Download failed.')
      setUpdateStatus('error')
    }
  }

  // Inspections that have been worked on enough to have meaningful transcription data
  const exportableInspections = inspections.filter(i =>
    i.is_finalised || ['processing', 'review', 'complete'].includes(i.status)
  )

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSaveDefaults() {
    setDefaultsSaving(true)
    setDefaultsSaved(false)
    try {
      await updateDefaults(defaultsTypist || null, defaultsCamera || null)
      setDefaultsSaved(true)
      setTimeout(() => setDefaultsSaved(false), 2500)
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || err?.message || 'Could not save defaults.')
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function handleChangePassword() {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert('Missing fields', 'Please fill in all password fields.')
      return
    }
    if (newPw !== confirmPw) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.')
      return
    }
    if (newPw.length < 8) {
      Alert.alert('Too short', 'New password must be at least 8 characters.')
      return
    }
    setPwLoading(true)
    try {
      await api.changePassword({ current_password: currentPw, new_password: newPw })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      Alert.alert('Password updated', 'Your password has been changed successfully.')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Could not update password.'
      Alert.alert('Error', msg)
    } finally {
      setPwLoading(false)
    }
  }

  function handleLogout() {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => { onClose(); logout() } },
    ])
  }

  function buildInspectionExport(inspection: any): string[] {
    const lines: string[] = []
    const rd = inspection.report_data ? JSON.parse(inspection.report_data) : {}
    const isCheckOut = inspection.inspection_type === 'check_out'
    const template = inspection.template

    lines.push(`Inspection ID : ${inspection.id}`)
    lines.push(`Property      : ${inspection.property_address || '—'}`)
    lines.push(`Client        : ${inspection.client_name || '—'}`)
    lines.push(`Type          : ${TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type ?? '—'}`)
    lines.push(`Status        : ${inspection.local_status || inspection.status || '—'}`)
    lines.push(`Finalised     : ${inspection.is_finalised ? 'Yes' : 'No'}`)
    lines.push('')

    // ── Audio recordings from SQLite ─────────────────────────────────────────
    const recordings = getAudioRecordings(inspection.id)
    lines.push('AUDIO RECORDINGS (SQLite)')
    lines.push('─'.repeat(34))
    if (recordings.length === 0) {
      lines.push('(no audio recordings found)')
    } else {
      recordings.forEach((rec: any, i: number) => {
        const durationSec = rec.durationMs ? (rec.durationMs / 1000).toFixed(1) : '?'
        lines.push('')
        lines.push(`[${i + 1}] Room : ${rec.section_name || rec.sectionKey} (key: ${rec.sectionKey})`)
        if (rec.itemKey) {
          lines.push(`    Item : ${rec.item_name || rec.itemName || rec.itemKey} (key: ${rec.itemKey})`)
        } else {
          lines.push('    Item : (room-level recording)')
        }
        lines.push(`    Label    : ${rec.label || '—'}`)
        lines.push(`    Duration : ${durationSec}s`)
        lines.push(`    Recorded : ${rec.createdAt || rec.created_at || '—'}`)
        lines.push(`    Synced   : ${rec.synced ? 'Yes' : 'No'}`)
        lines.push('    Transcription:')
        if (rec.transcription) {
          rec.transcription.split('\n').forEach((l: string) => lines.push(`      ${l}`))
        } else {
          lines.push('      (none)')
        }
      })
    }
    lines.push('')

    // ── Item descriptions from report_data ───────────────────────────────────
    lines.push('ITEM DESCRIPTIONS (report_data)')
    lines.push('─'.repeat(34))
    const roomNames: Record<string, string> = rd['_roomNames'] || {}
    const hiddenRooms: string[] = rd['_hiddenRooms'] || []
    let descCount = 0

    const processRoomItems = (sectionKey: string, displayName: string) => {
      const sectionData = rd[sectionKey]
      if (!sectionData) return
      const deleted = new Set<string>((sectionData._deleted || []).map(String))
      const itemLines: string[] = []

      const addItemLine = (label: string, itemData: any) => {
        const desc = !isCheckOut ? (itemData?.description || '') : ''
        const cond = isCheckOut
          ? (itemData?.checkOutCondition || itemData?.condition || '')
          : (itemData?.condition || '')
        if (desc || cond) {
          if (desc) itemLines.push(`  ${label}: ${desc}`)
          if (cond) itemLines.push(`  ${label} [condition]: ${cond}`)
          descCount++
        }
      }

      const templateSection = (template?.sections || []).find((s: any) => String(s.id) === sectionKey)
      for (const item of (templateSection?.items || [])) {
        if (deleted.has(String(item.id))) continue
        addItemLine(item.name || item.label || String(item.id), sectionData[String(item.id)])
      }
      for (const extra of (sectionData._extra || [])) {
        if (!extra._eid || deleted.has(String(extra._eid))) continue
        addItemLine(extra.name || extra.label || 'Added item', { ...(sectionData[extra._eid] || {}), ...extra })
      }

      if (itemLines.length > 0) {
        lines.push('')
        lines.push(`Room: ${displayName}`)
        lines.push(...itemLines)
      }
    }

    const templateSections: any[] = (template?.sections || []).filter(
      (s: any) => s.section_type === 'room'
    )
    for (const section of templateSections) {
      const key = String(section.id)
      if (hiddenRooms.includes(key)) continue
      processRoomItems(key, roomNames[key] || section.name || key)
    }
    const customRooms: { key: string; name: string }[] = rd['_customRooms'] || []
    for (const cr of customRooms) {
      if (hiddenRooms.includes(cr.key)) continue
      processRoomItems(cr.key, roomNames[cr.key] ?? cr.name ?? 'Room')
    }
    if (descCount === 0) lines.push('(no descriptions found)')
    lines.push('')

    // ── Synced audio transcripts from _recordings ────────────────────────────
    const syncedRecordings: any[] = rd['_recordings'] || []
    if (syncedRecordings.length > 0) {
      lines.push('SYNCED AUDIO TRANSCRIPTS (report_data._recordings)')
      lines.push('─'.repeat(34))
      syncedRecordings.forEach((rec: any, i: number) => {
        lines.push('')
        lines.push(`[${i + 1}] Item Key : ${rec.itemKey || '—'}`)
        lines.push(`    Duration : ${rec.duration != null ? `${rec.duration}s` : '—'}`)
        lines.push('    Transcript:')
        if (rec.transcript) {
          rec.transcript.split('\n').forEach((l: string) => lines.push(`      ${l}`))
        } else {
          lines.push('      (none)')
        }
      })
      lines.push('')
    }

    return lines
  }

  async function handleExport() {
    if (selectedIds.size === 0) {
      Alert.alert('Nothing selected', 'Tick at least one inspection to export.')
      return
    }
    setExporting(true)
    try {
      const now = new Date()
      const exportedAt = now.toLocaleString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })

      const allLines: string[] = []
      allLines.push('INSPECTPRO TRANSCRIPTION EXPORT')
      allLines.push('================================')
      allLines.push(`Exported   : ${exportedAt}`)
      allLines.push(`Exported by: ${user?.name || '—'} (${user?.role || '—'})`)
      allLines.push(`Inspections: ${selectedIds.size}`)
      allLines.push('')

      for (const id of selectedIds) {
        const inspection = inspections.find(i => i.id === id)
        if (!inspection) continue
        allLines.push('═'.repeat(50))
        allLines.push(...buildInspectionExport(inspection))
      }

      const content = allLines.join('\n')
      const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 16)
      const fileUri = `${FileSystem.documentDirectory}transcription_export_${ts}.txt`

      await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 })

      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Save Transcription Export' })
      } else {
        Alert.alert('Saved', `Export saved to:\n${fileUri}`)
      }
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Could not generate export.')
    } finally {
      setExporting(false)
    }
  }

  const initial = user?.name?.charAt(0).toUpperCase() || '?'

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top }]}>
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Account</Text>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* ── Profile block ──────────────────────────────────────────────── */}
          <View style={s.profileBlock}>
            <View style={s.avatarLarge}>
              <Text style={s.avatarLargeText}>{initial}</Text>
            </View>
            <View style={s.profileInfo}>
              <Text style={s.profileName}>{user?.name || '—'}</Text>
              <Text style={s.profileRole}>{user?.role || '—'}</Text>
              {!!user?.email && <Text style={s.profileEmail}>{user.email}</Text>}
            </View>
          </View>

          {/* ── App Update ────────────────────────────────────────────────── */}
          {Platform.OS === 'android' && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>APP UPDATE</Text>
              <View style={s.updateRow}>
                <Text style={s.updateBuildText}>
                  {getCurrentBuildNumber() > 0
                    ? `Installed: build #${getCurrentBuildNumber()}`
                    : 'Installed: dev build'}
                </Text>
                {updateStatus === 'up-to-date' && (
                  <Text style={s.updateUpToDate}>Up to date</Text>
                )}
                {updateStatus === 'available' && releaseInfo && (
                  <Text style={s.updateAvailableTag}>
                    Build #{releaseInfo.buildNumber} available
                  </Text>
                )}
              </View>

              {updateStatus === 'error' && (
                <Text style={s.updateError}>{updateError}</Text>
              )}

              {updateStatus === 'downloading' && (
                <View style={s.progressBar}>
                  <View style={[s.progressFill, { width: `${Math.round(updateProgress * 100)}%` as any }]} />
                </View>
              )}

              {updateStatus !== 'downloading' && updateStatus !== 'available' && (
                <TouchableOpacity
                  style={[s.actionBtn, s.actionBtnUpdate, updateStatus === 'checking' && s.actionBtnDisabled]}
                  onPress={handleCheckForUpdates}
                  disabled={updateStatus === 'checking'}
                >
                  {updateStatus === 'checking'
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.actionBtnText}>Check for Updates</Text>
                  }
                </TouchableOpacity>
              )}

              {updateStatus === 'available' && (
                <TouchableOpacity
                  style={[s.actionBtn, s.actionBtnUpdate]}
                  onPress={handleDownloadAndInstall}
                >
                  <Text style={s.actionBtnText}>Download & Install</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Default Settings ───────────────────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>DEFAULT SETTINGS</Text>
            <Text style={s.defaultsHint}>
              Applied to every new inspection. Can be overridden per inspection.
            </Text>

            <Text style={s.defaultsFieldLabel}>Typist Mode</Text>
            {(
              [
                { value: 'ai_instant', label: 'AI Instant',  sub: 'Per-item mic, fills immediately on device' },
                { value: 'ai_room',    label: 'AI by Room',  sub: 'Record whole room, AI fills all at once' },
                { value: 'human',      label: 'Human Typist', sub: 'Audio synced to server for typist' },
              ] as const
            ).map(opt => {
              const active = defaultsTypist === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.defaultsRow, active && s.defaultsRowActive]}
                  onPress={() => setDefaultsTypist(opt.value)}
                  activeOpacity={0.75}
                >
                  <View style={[s.defaultsRadio, active && s.defaultsRadioActive]}>
                    {active && <View style={s.defaultsRadioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.defaultsRowLabel, active && s.defaultsRowLabelActive]}>{opt.label}</Text>
                    <Text style={s.defaultsRowSub}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}

            <Text style={[s.defaultsFieldLabel, { marginTop: spacing.sm }]}>Camera Mode</Text>
            {(
              [
                { value: 'perItem',  label: 'Per Item',             sub: 'Camera button beside each item' },
                { value: 'floating', label: 'Floating with Preview', sub: 'Live overlay, auto-assigns to active item' },
              ] as const
            ).map(opt => {
              const active = defaultsCamera === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.defaultsRow, active && s.defaultsRowActive]}
                  onPress={() => setDefaultsCamera(opt.value)}
                  activeOpacity={0.75}
                >
                  <View style={[s.defaultsRadio, active && s.defaultsRadioActive]}>
                    {active && <View style={s.defaultsRadioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.defaultsRowLabel, active && s.defaultsRowLabelActive]}>{opt.label}</Text>
                    <Text style={s.defaultsRowSub}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}

            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, defaultsSaving && s.actionBtnDisabled, { marginTop: spacing.xs }]}
              onPress={handleSaveDefaults}
              disabled={defaultsSaving}
            >
              {defaultsSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.actionBtnText}>{defaultsSaved ? 'Saved ✓' : 'Save Defaults'}</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Change Password ────────────────────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>CHANGE PASSWORD</Text>
            <TextInput
              style={s.input}
              placeholder="Current password"
              placeholderTextColor={colors.textLight}
              secureTextEntry
              value={currentPw}
              onChangeText={setCurrentPw}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={s.input}
              placeholder="New password"
              placeholderTextColor={colors.textLight}
              secureTextEntry
              value={newPw}
              onChangeText={setNewPw}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={[s.input, s.inputLast]}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textLight}
              secureTextEntry
              value={confirmPw}
              onChangeText={setConfirmPw}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, pwLoading && s.actionBtnDisabled]}
              onPress={handleChangePassword}
              disabled={pwLoading}
            >
              {pwLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.actionBtnText}>Update Password</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Admin Tools ────────────────────────────────────────────────── */}
          {isAdmin && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>ADMIN TOOLS</Text>
              <Text style={s.exportHeading}>Export Transcription</Text>
              <Text style={s.exportHint}>
                Select completed inspections to download a diagnostic .txt of their transcription data.
              </Text>

              {exportableInspections.length === 0 ? (
                <Text style={s.emptyHint}>No completed inspections on device.</Text>
              ) : (
                <>
                  {exportableInspections.map(i => {
                    const checked = selectedIds.has(i.id)
                    return (
                      <TouchableOpacity
                        key={i.id}
                        style={[s.checkRow, checked && s.checkRowActive]}
                        onPress={() => toggleSelect(i.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[s.checkbox, checked && s.checkboxChecked]}>
                          {checked && <Text style={s.checkmark}>✓</Text>}
                        </View>
                        <View style={s.checkInfo}>
                          <Text style={s.checkAddress} numberOfLines={1}>
                            {i.property_address || `Inspection ${i.id}`}
                          </Text>
                          <Text style={s.checkMeta}>
                            {TYPE_LABELS[i.inspection_type] ?? i.inspection_type ?? '—'}
                            {'  ·  '}
                            {i.status || '—'}
                            {i.is_finalised ? '  ·  Finalised' : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })}

                  <TouchableOpacity
                    style={[
                      s.actionBtn, s.actionBtnExport,
                      (exporting || selectedIds.size === 0) && s.actionBtnDisabled,
                    ]}
                    onPress={handleExport}
                    disabled={exporting || selectedIds.size === 0}
                  >
                    {exporting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.actionBtnText}>
                          {selectedIds.size > 0
                            ? `Export ${selectedIds.size} Inspection${selectedIds.size > 1 ? 's' : ''}`
                            : 'Select inspections above'}
                        </Text>
                    }
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <View style={{ height: spacing.lg }} />
        </ScrollView>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <View style={[s.footer, { paddingBottom: insets.bottom + 8 }]}>
          {isAdmin && !!onOpenAdmin && (
            <TouchableOpacity style={s.adminBtn} onPress={onOpenAdmin}>
              <Text style={s.adminBtnText}>Admin Panel</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <Text style={s.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.background },
  header:  {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  closeBtn:    {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },

  scroll:        { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md },

  // Profile
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avatarLarge: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLargeText: { fontSize: font.xl, fontWeight: '700', color: '#fff' },
  profileInfo:    { flex: 1 },
  profileName:    { fontSize: font.md, fontWeight: '700', color: colors.text },
  profileRole:    {
    fontSize: font.xs, fontWeight: '600',
    color: colors.primary, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 2,
  },
  profileEmail:   { fontSize: font.xs, color: colors.textLight, marginTop: 2 },

  // Sections
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sectionLabel: {
    fontSize: font.xs, fontWeight: '700',
    color: colors.textLight,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },

  // Change password inputs
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 11,
    fontSize: font.sm,
    color: colors.text,
  },
  inputLast: { marginBottom: spacing.xs },

  // Buttons
  actionBtn: {
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  actionBtnPrimary:  { backgroundColor: colors.primary },
  actionBtnExport:   { backgroundColor: colors.accent, marginTop: spacing.xs },
  actionBtnDisabled: { opacity: 0.45 },
  actionBtnText:     { color: '#fff', fontSize: font.sm, fontWeight: '700' },

  // Admin Tools
  exportHeading: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 2 },
  exportHint:    { fontSize: font.xs, color: colors.textMid, lineHeight: 17, marginBottom: spacing.sm },
  emptyHint:     { fontSize: font.sm, color: colors.textLight, fontStyle: 'italic' },

  // Inspection checkboxes
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  checkRowActive: {
    borderColor: colors.accent,
    backgroundColor: '#f0fdf4',
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 2, borderColor: colors.borderDark,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark:   { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  checkInfo:   { flex: 1 },
  checkAddress: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  checkMeta:    { fontSize: font.xs, color: colors.textMid, marginTop: 1 },

  // Update section
  updateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  updateBuildText:   { fontSize: font.xs, color: colors.textMid },
  updateUpToDate:    { fontSize: font.xs, color: colors.accent, fontWeight: '600' },
  updateAvailableTag:{ fontSize: font.xs, color: colors.primary, fontWeight: '700' },
  updateError:       { fontSize: font.xs, color: colors.danger, marginBottom: spacing.xs },
  actionBtnUpdate:   { backgroundColor: colors.primaryMid },
  progressBar: {
    height: 6,
    backgroundColor: colors.muted,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.primaryMid,
    borderRadius: 3,
  },

  // Default Settings
  defaultsHint:       { fontSize: font.xs, color: colors.textMid, lineHeight: 17, marginBottom: spacing.xs },
  defaultsFieldLabel: { fontSize: font.xs, fontWeight: '700', color: colors.text, marginBottom: 4, marginTop: 2 },
  defaultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: 6,
  },
  defaultsRowActive:      { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  defaultsRowLabel:       { fontSize: font.sm, fontWeight: '600', color: colors.text },
  defaultsRowLabelActive: { color: colors.primary },
  defaultsRowSub:         { fontSize: font.xs, color: colors.textMid, marginTop: 1 },
  defaultsRadio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: colors.borderDark,
    alignItems: 'center', justifyContent: 'center',
  },
  defaultsRadioActive: { borderColor: colors.primary },
  defaultsRadioDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.primary,
  },

  // Footer
  footer: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  adminBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  adminBtnText: { color: colors.primary, fontSize: font.md, fontWeight: '700' },
  logoutBtn: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  logoutBtnText: { color: colors.danger, fontSize: font.md, fontWeight: '700' },
})
