import React, { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../services/api'
import { colors, font, radius, spacing } from '../utils/theme'

interface Props {
  visible: boolean
  onClose: () => void
  inspectionId: number
  clientEmail: string | null
  tenantEmail: string | null
}

/**
 * Admin/manager-only "Share Report" sheet, opened from PropertyOverviewScreen for a
 * completed inspection. Recipient candidates (client/tenant email) are passed in from
 * the already-downloaded local inspection — no network call needed to populate this.
 * Sending calls the same POST /api/inspections/<id>/share-pdf endpoint the web app's
 * Share PDF feature uses; the backend queues PDF generation + send server-side and
 * returns immediately (see routes/inspections.py's share_pdf()).
 */
export default function ShareReportModal({ visible, onClose, inspectionId, clientEmail, tenantEmail }: Props) {
  const insets = useSafeAreaInsets()
  const [sendToClient, setSendToClient] = useState(true)
  const [sendToTenant, setSendToTenant] = useState(true)
  const [sending, setSending] = useState(false)

  const hasClient = !!clientEmail
  const hasTenant = !!tenantEmail
  const hasAny    = hasClient || hasTenant

  const selectedEmails = [
    ...(hasClient && sendToClient ? [clientEmail as string] : []),
    ...(hasTenant && sendToTenant ? [tenantEmail as string] : []),
  ]

  async function handleSend() {
    if (!selectedEmails.length) return
    setSending(true)
    try {
      await api.sharePdf(inspectionId, selectedEmails)
      Alert.alert('Report Sent', `The report is being sent to ${selectedEmails.join(', ')}.`)
      onClose()
    } catch (e: any) {
      Alert.alert('Could Not Send', e.response?.data?.error || 'Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  function Row({ label, email, checked, onToggle }: { label: string; email: string; checked: boolean; onToggle: () => void }) {
    return (
      <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.75}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowEmail}>{email}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Share Report</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {hasAny ? (
          <View style={styles.body}>
            <Text style={styles.subtitle}>Select who should receive the report by email.</Text>
            {hasClient && (
              <Row label="Client" email={clientEmail as string} checked={sendToClient} onToggle={() => setSendToClient(v => !v)} />
            )}
            {hasTenant && (
              <Row label="Tenant" email={tenantEmail as string} checked={sendToTenant} onToggle={() => setSendToTenant(v => !v)} />
            )}
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.emptyText}>
              No client or tenant email found on this report. Add one via Report Details on the web app, then try again.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.sendBtn, (!selectedEmails.length || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!selectedEmails.length || sending}
        >
          {sending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.sendBtnText}>Send Report</Text>
          }
        </TouchableOpacity>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderDark,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: font.md, color: colors.textMid, fontWeight: '600' },
  body: { gap: spacing.sm, marginBottom: spacing.md },
  subtitle: { fontSize: font.sm, color: colors.textMid, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.background, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1.5, borderColor: colors.border,
  },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.borderDark, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  rowEmail: { fontSize: font.sm, color: colors.textMid, marginTop: 2 },
  emptyText: { fontSize: font.sm, color: colors.textMid, lineHeight: 20 },
  sendBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 15, alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: colors.borderDark },
  sendBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
