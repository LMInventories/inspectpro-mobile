import React, { useState, useEffect } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../services/api'
import { saveInspection } from '../services/database'
import { colors, font, radius, spacing } from '../utils/theme'
import PickerSheet from './PickerSheet'

const INSPECTION_TYPES = [
  { value: 'check_in',      label: 'Check In' },
  { value: 'check_out',     label: 'Check Out' },
  { value: 'inventory',     label: 'Inventory' },
  { value: 'midterm',       label: 'Midterm' },
  { value: 'damage_report', label: 'Damage Report' },
]

const KEY_LOCATIONS = [
  'With Agent', 'With Landlord', 'With Tenant',
  'At Property', 'At Concierge', 'In Key Safe',
]

interface Props {
  visible: boolean
  onClose: () => void
  onCreated: (inspectionId: number) => void
}

export default function CreateInspectionModal({ visible, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets()

  const [loading,    setLoading]    = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  // Data lists
  const [properties, setProperties] = useState<any[]>([])
  const [templates,  setTemplates]  = useState<any[]>([])
  const [clerks,     setClerks]     = useState<any[]>([])

  // Form values
  const [propertyId,   setPropertyId]   = useState<number | null>(null)
  const [propSearch,   setPropSearch]   = useState('')
  const [showPropList, setShowPropList] = useState(false)
  const [inspType,     setInspType]     = useState('check_in')
  const [templateId,   setTemplateId]   = useState<number | null>(null)
  const [conductDate,  setConductDate]  = useState('')
  const [inspectorId,  setInspectorId]  = useState<number | null>(null)
  const [incPhotos,    setIncPhotos]    = useState(false)
  const [keyLocation,  setKeyLocation]  = useState('')
  const [tenantEmail,  setTenantEmail]  = useState('')
  const [notes,        setNotes]        = useState('')

  // Lifecycle suggestion
  const [sourceId,   setSourceId]   = useState<number | null>(null)
  const [lifecycle,  setLifecycle]  = useState<{ label: string; dateStr: string } | null>(null)

  // Sub-pickers
  const [showTplPicker,  setShowTplPicker]  = useState(false)
  const [showClerkPicker,setShowClerkPicker] = useState(false)
  const [showKeyPicker,  setShowKeyPicker]  = useState(false)

  useEffect(() => {
    if (!visible) return
    resetForm()
    loadData()
  }, [visible])

  useEffect(() => {
    if (propertyId) loadLifecycle()
    else { setSourceId(null); setLifecycle(null) }
  }, [propertyId, inspType])

  function resetForm() {
    setPropertyId(null); setPropSearch(''); setShowPropList(false)
    setInspType('check_in'); setTemplateId(null); setConductDate('')
    setInspectorId(null); setIncPhotos(false); setKeyLocation('')
    setTenantEmail(''); setNotes('')
    setSourceId(null); setLifecycle(null); setError('')
  }

  async function loadData() {
    setLoading(true)
    try {
      const [pRes, tRes, uRes] = await Promise.all([
        api.getProperties(),
        api.getTemplates(),
        api.getUsers(),
      ])
      setProperties(pRes.data || [])
      setTemplates(tRes.data || [])
      setClerks((uRes.data || []).filter((u: any) => u.role === 'clerk'))
    } catch {
      setError('Failed to load data — check your connection')
    } finally {
      setLoading(false)
    }
  }

  async function loadLifecycle() {
    if (!propertyId) return
    try {
      const res     = await api.getPropertyHistory(propertyId)
      const history = res.data || []

      if (inspType === 'check_out') {
        const src = history.find((h: any) => h.inspection_type === 'check_in')
        if (src) {
          setSourceId(src.id)
          setLifecycle({ label: 'Check In', dateStr: fmtDate(src.conduct_date || src.created_at) })
          return
        }
      } else if (inspType === 'check_in') {
        const src = history.find((h: any) => h.inspection_type === 'check_out' && h.has_report_data)
        if (src) {
          setSourceId(src.id)
          setLifecycle({ label: 'Check Out', dateStr: fmtDate(src.conduct_date || src.created_at) })
          return
        }
      }
      setSourceId(null); setLifecycle(null)
    } catch { /* offline — skip */ }
  }

  function fmtDate(str: string | null) {
    if (!str) return ''
    return new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function parseDateInput(str: string): string | null {
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
    return null
  }

  const filteredProps  = properties.filter(p =>
    !propSearch || p.address?.toLowerCase().includes(propSearch.toLowerCase())
  )
  const filteredTmpls  = templates.filter(t => t.inspection_type === inspType)
  const selectedProp   = properties.find(p => p.id === propertyId)
  const selectedTmpl   = templates.find(t => t.id === templateId)
  const selectedClerk  = clerks.find(c => c.id === inspectorId)

  async function handleSubmit() {
    if (!propertyId) { setError('Please select a property'); return }
    const parsedDate = conductDate ? parseDateInput(conductDate) : null
    if (conductDate && !parsedDate) { setError('Date must be DD/MM/YYYY or YYYY-MM-DD'); return }

    setSubmitting(true); setError('')
    try {
      const res     = await api.createInspection({
        property_id:          propertyId,
        inspection_type:      inspType,
        template_id:          templateId  || null,
        conduct_date:         parsedDate,
        inspector_id:         inspectorId || null,
        source_inspection_id: sourceId    || null,
        include_photos:       incPhotos,
        key_location:         keyLocation || null,
        tenant_email:         tenantEmail || null,
        internal_notes:       notes       || null,
      })
      const created = res.data?.inspection_detail || res.data
      const id      = created.id

      // Fetch full detail and save locally (mirrors FetchInspectionsScreen flow)
      const detail   = await api.getInspection(id)
      const d        = detail.data
      const normalised: any = {
        ...d,
        property_address: d.property?.address         ?? 'Unknown address',
        client_name:      d.client?.name               ?? '',
        client_id:        d.client?.id                 ?? d.property?.client_id ?? null,
        inspector_name:   d.inspector?.name            ?? '',
        typist_name:      d.typist?.name               ?? '',
        typist_is_ai:     d.typist_is_ai               ?? d.typist?.is_ai ?? false,
      }

      if (normalised.template_id) {
        try {
          const tRes = await api.getTemplate(normalised.template_id)
          normalised.template = tRes.data
        } catch { /* non-fatal */ }
      }

      try {
        // Midterm inspections use a separate fixed section set
        const fsRes = inspType === 'midterm'
          ? await api.getMidtermSections()
          : await api.getFixedSections()
        if (Array.isArray(fsRes.data) && fsRes.data.length > 0) {
          normalised.fixedSections = fsRes.data
        }
      } catch { /* non-fatal */ }

      saveInspection(normalised)
      onCreated(id)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to create inspection')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Inspection</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
            >
              {!!error && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Lifecycle banner */}
              {lifecycle && (
                <View style={styles.lifecycleBanner}>
                  <Text style={styles.lifecycleText}>
                    💡 Linked to {lifecycle.label} on {lifecycle.dateStr}. Report data will be carried over.
                  </Text>
                </View>
              )}

              {/* Property */}
              <Text style={styles.label}>Property <Text style={styles.req}>*</Text></Text>
              {propertyId ? (
                <TouchableOpacity
                  style={styles.selectedPill}
                  onPress={() => { setPropertyId(null); setShowPropList(true) }}
                >
                  <Text style={styles.selectedPillText} numberOfLines={1}>{selectedProp?.address}</Text>
                  <Text style={styles.selectedPillClear}>✕</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Search address…"
                    placeholderTextColor={colors.textLight}
                    value={propSearch}
                    onChangeText={t => { setPropSearch(t); setShowPropList(true) }}
                    onFocus={() => setShowPropList(true)}
                  />
                  {showPropList && filteredProps.length > 0 && (
                    <View style={styles.propDropdown}>
                      <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                        {filteredProps.slice(0, 50).map(p => (
                          <TouchableOpacity
                            key={p.id}
                            style={styles.propOption}
                            onPress={() => { setPropertyId(p.id); setPropSearch(''); setShowPropList(false) }}
                          >
                            <Text style={styles.propOptionText}>{p.address}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {/* Inspection type */}
              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {INSPECTION_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.typeChip, inspType === t.value && styles.typeChipActive]}
                    onPress={() => { setInspType(t.value); setTemplateId(null) }}
                  >
                    <Text style={[styles.typeChipText, inspType === t.value && styles.typeChipTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Template */}
              <Text style={styles.label}>Template</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowTplPicker(true)}>
                <Text style={[styles.pickerText, !selectedTmpl && styles.pickerPlaceholder]}>
                  {selectedTmpl?.name || 'Select template…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Date */}
              <Text style={styles.label}>Inspection Date</Text>
              <TextInput
                style={styles.input}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={colors.textLight}
                value={conductDate}
                onChangeText={setConductDate}
                keyboardType="numbers-and-punctuation"
              />

              {/* Clerk */}
              <Text style={styles.label}>Assigned Clerk</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowClerkPicker(true)}>
                <Text style={[styles.pickerText, !selectedClerk && styles.pickerPlaceholder]}>
                  {selectedClerk?.name || 'Select clerk…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Key location */}
              <Text style={styles.label}>Key Location</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowKeyPicker(true)}>
                <Text style={[styles.pickerText, !keyLocation && styles.pickerPlaceholder]}>
                  {keyLocation || 'Select key location…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Include photos toggle */}
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Include Photos from Source</Text>
                <Switch
                  value={incPhotos}
                  onValueChange={setIncPhotos}
                  trackColor={{ false: colors.border, true: colors.primaryMid }}
                  thumbColor={incPhotos ? colors.primary : colors.surface}
                />
              </View>

              {/* Tenant email */}
              <Text style={styles.label}>Tenant Email</Text>
              <TextInput
                style={styles.input}
                placeholder="tenant@example.com"
                placeholderTextColor={colors.textLight}
                value={tenantEmail}
                onChangeText={setTenantEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Notes */}
              <Text style={styles.label}>Internal Notes</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Notes for this inspection…"
                placeholderTextColor={colors.textLight}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />

              <View style={{ height: spacing.md }} />

              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.submitText}>Create Inspection</Text>
                }
              </TouchableOpacity>

              <View style={{ height: insets.bottom + 32 }} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showTplPicker}
        title="Select Template"
        options={[
          { label: 'None', value: null },
          ...filteredTmpls.map(t => ({ label: t.name, value: t.id })),
        ]}
        selectedValue={templateId}
        onSelect={v => { setTemplateId(v); setShowTplPicker(false) }}
        onClose={() => setShowTplPicker(false)}
      />
      <PickerSheet
        visible={showClerkPicker}
        title="Assign Clerk"
        options={[
          { label: 'None', value: null },
          ...clerks.map(c => ({ label: c.name, value: c.id })),
        ]}
        selectedValue={inspectorId}
        onSelect={v => { setInspectorId(v); setShowClerkPicker(false) }}
        onClose={() => setShowClerkPicker(false)}
      />
      <PickerSheet
        visible={showKeyPicker}
        title="Key Location"
        options={[
          { label: 'None', value: '' },
          ...KEY_LOCATIONS.map(k => ({ label: k, value: k })),
        ]}
        selectedValue={keyLocation}
        onSelect={v => { setKeyLocation(v); setShowKeyPicker(false) }}
        onClose={() => setShowKeyPicker(false)}
      />
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: colors.background },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:  { fontSize: font.lg, fontWeight: '700', color: colors.text },
  closeBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: font.md, color: colors.textMid, fontWeight: '600' },
  loadingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText:  { fontSize: font.md, color: colors.textMid },
  scroll:       { flex: 1 },
  form:         { padding: spacing.md, gap: 4 },
  errorBanner:  { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  errorText:    { color: colors.danger, fontSize: font.sm, fontWeight: '600' },
  lifecycleBanner: { backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: '#fde68a' },
  lifecycleText:   { color: colors.warning, fontSize: font.sm, lineHeight: 18 },
  label:        { fontSize: font.sm, fontWeight: '600', color: colors.textMid, marginTop: spacing.md, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  req:          { color: colors.danger },
  input:        { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, fontSize: font.md, color: colors.text },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  selectedPill:      { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, borderWidth: 1.5, borderColor: colors.primary },
  selectedPillText:  { flex: 1, fontSize: font.md, color: colors.primary, fontWeight: '600' },
  selectedPillClear: { fontSize: font.md, color: colors.primary, marginLeft: spacing.sm },
  propDropdown:    { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, marginTop: 4, overflow: 'hidden' },
  propOption:      { paddingHorizontal: spacing.sm, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  propOptionText:  { fontSize: font.md, color: colors.text },
  typeRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  typeChip:        { paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive:  { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeChipText:    { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  typeChipTextActive: { color: colors.primary },
  pickerRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11 },
  pickerText:      { fontSize: font.md, color: colors.text, flex: 1 },
  pickerPlaceholder: { color: colors.textLight },
  chevron:         { fontSize: 20, color: colors.textLight, marginLeft: spacing.xs },
  switchRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 10, marginTop: spacing.md },
  switchLabel:     { fontSize: font.md, color: colors.text, fontWeight: '500' },
  submitBtn:       { backgroundColor: colors.primary, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: spacing.sm },
  submitDisabled:  { backgroundColor: colors.borderDark },
  submitText:      { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
