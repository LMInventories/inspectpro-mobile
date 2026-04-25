import React, { useState, useEffect } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../services/api'
import { colors, font, radius, spacing } from '../utils/theme'
import PickerSheet from './PickerSheet'

const PROPERTY_TYPES  = ['House', 'Flat', 'Studio', 'Bungalow', 'Maisonette', 'Cottage', 'Commercial', 'Other']
const FURNISHED_OPTS  = ['Furnished', 'Part Furnished', 'Unfurnished']
const DETACHMENT_OPTS = ['Terraced', 'End Terrace', 'Semi-Detached', 'Detached', 'Purpose Built']
const ELEVATION_OPTS  = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor+', 'Top Floor', 'Penthouse']

interface Props {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}

export default function CreatePropertyModal({ visible, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets()

  const [loading,    setLoading]    = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')
  const [clients,    setClients]    = useState<any[]>([])

  // Form values
  const [clientId,        setClientId]        = useState<number | null>(null)
  const [address,         setAddress]         = useState('')
  const [propertyType,    setPropertyType]    = useState('')
  const [bedrooms,        setBedrooms]        = useState('')
  const [bathrooms,       setBathrooms]       = useState('')
  const [furnished,       setFurnished]       = useState('')
  const [detachmentType,  setDetachmentType]  = useState('')
  const [elevation,       setElevation]       = useState('')
  const [parking,         setParking]         = useState(false)
  const [garden,          setGarden]          = useState(false)
  const [elevator,        setElevator]        = useState(false)
  const [meterElec,       setMeterElec]       = useState('')
  const [meterGas,        setMeterGas]        = useState('')
  const [meterHeat,       setMeterHeat]       = useState('')
  const [meterWater,      setMeterWater]      = useState('')
  const [notes,           setNotes]           = useState('')

  // Sub-pickers
  const [showClientPicker,   setShowClientPicker]   = useState(false)
  const [showTypePicker,     setShowTypePicker]     = useState(false)
  const [showFurnPicker,     setShowFurnPicker]     = useState(false)
  const [showDetachPicker,   setShowDetachPicker]   = useState(false)
  const [showElevPicker,     setShowElevPicker]     = useState(false)

  useEffect(() => {
    if (!visible) return
    resetForm()
    loadClients()
  }, [visible])

  function resetForm() {
    setClientId(null); setAddress(''); setPropertyType(''); setBedrooms(''); setBathrooms('')
    setFurnished(''); setDetachmentType(''); setElevation('')
    setParking(false); setGarden(false); setElevator(false)
    setMeterElec(''); setMeterGas(''); setMeterHeat(''); setMeterWater('')
    setNotes(''); setError('')
  }

  async function loadClients() {
    setLoading(true)
    try {
      const res = await api.getClients()
      setClients(res.data || [])
    } catch {
      setError('Failed to load clients — check your connection')
    } finally {
      setLoading(false)
    }
  }

  const selectedClient = clients.find(c => c.id === clientId)

  async function handleSubmit() {
    if (!clientId)         { setError('Please select a client'); return }
    if (!address.trim())   { setError('Address is required'); return }

    setSubmitting(true); setError('')
    try {
      await api.createProperty({
        client_id:         clientId,
        address:           address.trim(),
        property_type:     propertyType     || null,
        bedrooms:          bedrooms !== ''  ? Number(bedrooms)   : null,
        bathrooms:         bathrooms !== '' ? Number(bathrooms)  : null,
        furnished:         furnished        || null,
        detachment_type:   detachmentType   || null,
        elevation:         elevation        || null,
        parking,
        garden,
        elevator,
        meter_electricity: meterElec  || null,
        meter_gas:         meterGas   || null,
        meter_heat:        meterHeat  || null,
        meter_water:       meterWater || null,
        notes:             notes      || null,
      })
      onCreated()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to create property')
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
            <Text style={styles.headerTitle}>New Property</Text>
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

              {/* Client */}
              <Text style={styles.label}>Client <Text style={styles.req}>*</Text></Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowClientPicker(true)}>
                <Text style={[styles.pickerText, !selectedClient && styles.pickerPlaceholder]}>
                  {selectedClient?.name || 'Select client…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Address */}
              <Text style={styles.label}>Address <Text style={styles.req}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="Full property address"
                placeholderTextColor={colors.textLight}
                value={address}
                onChangeText={setAddress}
              />

              {/* Property type */}
              <Text style={styles.label}>Property Type</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowTypePicker(true)}>
                <Text style={[styles.pickerText, !propertyType && styles.pickerPlaceholder]}>
                  {propertyType || 'Select type…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Bedrooms / Bathrooms */}
              <View style={styles.row}>
                <View style={styles.halfCol}>
                  <Text style={styles.label}>Bedrooms</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textLight}
                    value={bedrooms}
                    onChangeText={setBedrooms}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfCol}>
                  <Text style={styles.label}>Bathrooms</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textLight}
                    value={bathrooms}
                    onChangeText={setBathrooms}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* Furnished */}
              <Text style={styles.label}>Furnished</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowFurnPicker(true)}>
                <Text style={[styles.pickerText, !furnished && styles.pickerPlaceholder]}>
                  {furnished || 'Select…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Detachment */}
              <Text style={styles.label}>Detachment</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowDetachPicker(true)}>
                <Text style={[styles.pickerText, !detachmentType && styles.pickerPlaceholder]}>
                  {detachmentType || 'Select…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Elevation */}
              <Text style={styles.label}>Elevation / Floor</Text>
              <TouchableOpacity style={styles.pickerRow} onPress={() => setShowElevPicker(true)}>
                <Text style={[styles.pickerText, !elevation && styles.pickerPlaceholder]}>
                  {elevation || 'Select…'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>

              {/* Feature toggles */}
              <Text style={styles.label}>Features</Text>
              <View style={styles.toggleRow}>
                {([
                  { label: '🚗 Parking',  value: parking,  set: setParking },
                  { label: '🌿 Garden',   value: garden,   set: setGarden },
                  { label: '🛗 Elevator', value: elevator, set: setElevator },
                ] as const).map(f => (
                  <TouchableOpacity
                    key={f.label}
                    style={[styles.toggleChip, f.value && styles.toggleChipActive]}
                    onPress={() => f.set(!f.value)}
                  >
                    <Text style={[styles.toggleChipText, f.value && styles.toggleChipTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Meter readings */}
              <Text style={styles.label}>Meter Readings</Text>
              <View style={styles.meterGrid}>
                {([
                  { label: '⚡ Electricity', val: meterElec,  set: setMeterElec },
                  { label: '🔥 Gas',         val: meterGas,   set: setMeterGas },
                  { label: '🌡 Heat',         val: meterHeat,  set: setMeterHeat },
                  { label: '💧 Water',        val: meterWater, set: setMeterWater },
                ] as const).map(m => (
                  <View key={m.label} style={styles.meterRow}>
                    <Text style={styles.meterLabel}>{m.label}</Text>
                    <TextInput
                      style={styles.meterInput}
                      placeholder="—"
                      placeholderTextColor={colors.textLight}
                      value={m.val}
                      onChangeText={m.set}
                    />
                  </View>
                ))}
              </View>

              {/* Notes */}
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Any additional notes…"
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
                  : <Text style={styles.submitText}>Create Property</Text>
                }
              </TouchableOpacity>

              <View style={{ height: insets.bottom + 32 }} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showClientPicker}
        title="Select Client"
        options={clients.map(c => ({ label: c.name, value: c.id }))}
        selectedValue={clientId}
        onSelect={v => { setClientId(v); setShowClientPicker(false) }}
        onClose={() => setShowClientPicker(false)}
      />
      <PickerSheet
        visible={showTypePicker}
        title="Property Type"
        options={[{ label: 'None', value: '' }, ...PROPERTY_TYPES.map(t => ({ label: t, value: t }))]}
        selectedValue={propertyType}
        onSelect={v => { setPropertyType(v); setShowTypePicker(false) }}
        onClose={() => setShowTypePicker(false)}
      />
      <PickerSheet
        visible={showFurnPicker}
        title="Furnished"
        options={[{ label: 'None', value: '' }, ...FURNISHED_OPTS.map(f => ({ label: f, value: f }))]}
        selectedValue={furnished}
        onSelect={v => { setFurnished(v); setShowFurnPicker(false) }}
        onClose={() => setShowFurnPicker(false)}
      />
      <PickerSheet
        visible={showDetachPicker}
        title="Detachment"
        options={[{ label: 'None', value: '' }, ...DETACHMENT_OPTS.map(d => ({ label: d, value: d }))]}
        selectedValue={detachmentType}
        onSelect={v => { setDetachmentType(v); setShowDetachPicker(false) }}
        onClose={() => setShowDetachPicker(false)}
      />
      <PickerSheet
        visible={showElevPicker}
        title="Elevation / Floor"
        options={[{ label: 'None', value: '' }, ...ELEVATION_OPTS.map(e => ({ label: e, value: e }))]}
        selectedValue={elevation}
        onSelect={v => { setElevation(v); setShowElevPicker(false) }}
        onClose={() => setShowElevPicker(false)}
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
  label:        { fontSize: font.sm, fontWeight: '600', color: colors.textMid, marginTop: spacing.md, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  req:          { color: colors.danger },
  input:        { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, fontSize: font.md, color: colors.text },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  pickerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11 },
  pickerText:   { fontSize: font.md, color: colors.text, flex: 1 },
  pickerPlaceholder: { color: colors.textLight },
  chevron:      { fontSize: 20, color: colors.textLight, marginLeft: spacing.xs },
  row:          { flexDirection: 'row', gap: spacing.sm },
  halfCol:      { flex: 1 },
  toggleRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  toggleChip:   { paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  toggleChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toggleChipText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  toggleChipTextActive: { color: colors.primary },
  meterGrid:    { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  meterRow:     { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.sm },
  meterLabel:   { flex: 1, fontSize: font.sm, color: colors.textMid, fontWeight: '600', paddingVertical: 11 },
  meterInput:   { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 11, textAlign: 'right' },
  submitBtn:    { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: spacing.sm },
  submitDisabled: { backgroundColor: colors.borderDark },
  submitText:   { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
