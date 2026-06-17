import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { api } from '../../services/api'
import { colors, font, radius, spacing } from '../../utils/theme'
import PickerSheet from '../../components/PickerSheet'

const ORIENTATIONS = [
  { label: 'Portrait',  value: 'portrait' },
  { label: 'Landscape', value: 'landscape' },
]

const REPORT_COLORS = [
  '#000000', '#1e293b', '#1e3a8a', '#0ea5e9',
  '#10b981', '#f59e0b', '#ef4444', '#7c3aed',
  '#374151', '#6b7280', '#ffffff',
]

function FLabel({ children }: { children: string }) {
  return <Text style={s.label}>{children}</Text>
}

function FInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput style={s.input} placeholderTextColor={colors.textLight} {...props} />
}

function SectionHead({ title }: { title: string }) {
  return <Text style={s.sectionHead}>{title}</Text>
}

export default function SettingsTab() {
  // Company Info
  const [companyName,   setCompanyName]   = useState('')
  const [addressLine1,  setAddressLine1]  = useState('')
  const [addressLine2,  setAddressLine2]  = useState('')
  const [city,          setCity]          = useState('')
  const [postcode,      setPostcode]      = useState('')
  const [email,         setEmail]         = useState('')
  const [phone,         setPhone]         = useState('')
  const [website,       setWebsite]       = useState('')

  // Report Settings
  const [orientation,    setOrientation]    = useState('portrait')
  const [headerColor,    setHeaderColor]    = useState('#000000')
  const [bodyColor,      setBodyColor]      = useState('#1e293b')
  const [disclaimer,     setDisclaimer]     = useState('')

  // Integrations
  const [depositaryUrl, setDepositaryUrl] = useState('')
  const [depositaryKey, setDepositaryKey] = useState('')
  const [sheetId,       setSheetId]       = useState('')

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [dirty,    setDirty]    = useState(false)

  const [showOrientationPicker, setShowOrientationPicker] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.getSystemSettings()
      const d = r.data || {}
      setCompanyName(d.company_name || '')
      setAddressLine1(d.address_line1 || '')
      setAddressLine2(d.address_line2 || '')
      setCity(d.city || '')
      setPostcode(d.postcode || '')
      setEmail(d.email || '')
      setPhone(d.phone || '')
      setWebsite(d.website || '')
      setOrientation(d.report_orientation || 'portrait')
      setHeaderColor(d.report_header_text_color || '#000000')
      setBodyColor(d.report_body_text_color || '#1e293b')
      setDisclaimer(d.report_disclaimer || '')
      setDepositaryUrl(d.depositary_api_url || '')
      setDepositaryKey(d.depositary_api_key || '')
      setSheetId(d.google_master_sheet_id || '')
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Failed to load settings')
    } finally { setLoading(false) }
  }

  function mark() { setDirty(true) }

  async function handleSave() {
    setSaving(true)
    try {
      await api.updateSystemSettings({
        company_name:            companyName,
        address_line1:           addressLine1,
        address_line2:           addressLine2,
        city,
        postcode,
        email,
        phone,
        website,
        report_orientation:      orientation,
        report_header_text_color: headerColor,
        report_body_text_color:  bodyColor,
        report_disclaimer:       disclaimer,
        depositary_api_url:      depositaryUrl,
        depositary_api_key:      depositaryKey,
        google_master_sheet_id:  sheetId,
      })
      setDirty(false)
      Alert.alert('Saved', 'Settings updated successfully.')
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.error || 'Could not save settings')
    } finally { setSaving(false) }
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={colors.primary} size="large" /></View>
  }

  const orientationLabel = ORIENTATIONS.find(o => o.value === orientation)?.label || 'Portrait'

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* ── Company Info ── */}
      <SectionHead title="Company Info" />
      <View style={s.card}>
        <FLabel>Company Name</FLabel>
        <FInput placeholder="Acme Lettings Ltd" value={companyName} onChangeText={t => { setCompanyName(t); mark() }} autoCapitalize="words" />

        <FLabel>Address Line 1</FLabel>
        <FInput placeholder="123 High Street" value={addressLine1} onChangeText={t => { setAddressLine1(t); mark() }} autoCapitalize="words" />

        <FLabel>Address Line 2</FLabel>
        <FInput placeholder="Optional" value={addressLine2} onChangeText={t => { setAddressLine2(t); mark() }} autoCapitalize="words" />

        <View style={s.row}>
          <View style={{ flex: 2 }}>
            <FLabel>City</FLabel>
            <FInput placeholder="London" value={city} onChangeText={t => { setCity(t); mark() }} autoCapitalize="words" />
          </View>
          <View style={{ flex: 1 }}>
            <FLabel>Postcode</FLabel>
            <FInput placeholder="SW1A 1AA" value={postcode} onChangeText={t => { setPostcode(t.toUpperCase()); mark() }} autoCapitalize="characters" />
          </View>
        </View>

        <FLabel>Email</FLabel>
        <FInput placeholder="info@company.com" value={email} onChangeText={t => { setEmail(t); mark() }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

        <FLabel>Phone</FLabel>
        <FInput placeholder="+44 20 0000 0000" value={phone} onChangeText={t => { setPhone(t); mark() }} keyboardType="phone-pad" />

        <FLabel>Website</FLabel>
        <FInput placeholder="https://yourcompany.com" value={website} onChangeText={t => { setWebsite(t); mark() }} keyboardType="url" autoCapitalize="none" autoCorrect={false} />
      </View>

      {/* ── Report Settings ── */}
      <SectionHead title="Report Settings" />
      <View style={s.card}>
        <FLabel>Page Orientation</FLabel>
        <TouchableOpacity style={s.pickerRow} onPress={() => setShowOrientationPicker(true)}>
          <Text style={s.pickerText}>{orientationLabel}</Text>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>

        <FLabel>Header Text Color</FLabel>
        <View style={s.colorPickRow}>
          <View style={[s.colorPreview, { backgroundColor: headerColor }]} />
          <Text style={s.colorHex}>{headerColor}</Text>
        </View>
        <View style={s.swatchGrid}>
          {REPORT_COLORS.map(c => (
            <TouchableOpacity
              key={c}
              style={[s.swatch, { backgroundColor: c }, headerColor === c && s.swatchSelected,
                c === '#ffffff' && { borderWidth: 1, borderColor: colors.border }]}
              onPress={() => { setHeaderColor(c); mark() }}
            />
          ))}
        </View>

        <FLabel>Body Text Color</FLabel>
        <View style={s.colorPickRow}>
          <View style={[s.colorPreview, { backgroundColor: bodyColor }]} />
          <Text style={s.colorHex}>{bodyColor}</Text>
        </View>
        <View style={s.swatchGrid}>
          {REPORT_COLORS.map(c => (
            <TouchableOpacity
              key={c}
              style={[s.swatch, { backgroundColor: c }, bodyColor === c && s.swatchSelected,
                c === '#ffffff' && { borderWidth: 1, borderColor: colors.border }]}
              onPress={() => { setBodyColor(c); mark() }}
            />
          ))}
        </View>

        <FLabel>Report Disclaimer</FLabel>
        <FInput
          placeholder="Disclaimer text shown on every report…"
          value={disclaimer}
          onChangeText={t => { setDisclaimer(t); mark() }}
          multiline
          numberOfLines={4}
          style={[s.input, s.inputMulti]}
        />
      </View>

      {/* ── Integrations ── */}
      <SectionHead title="Integrations" />
      <View style={s.card}>
        <FLabel>Depositary API URL</FLabel>
        <FInput
          placeholder="https://api.depositary.co.uk/..."
          value={depositaryUrl}
          onChangeText={t => { setDepositaryUrl(t); mark() }}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FLabel>Depositary API Key</FLabel>
        <FInput
          placeholder="API key"
          value={depositaryKey}
          onChangeText={t => { setDepositaryKey(t); mark() }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <FLabel>Google Master Sheet ID</FLabel>
        <FInput
          placeholder="Spreadsheet ID from Google Sheets URL"
          value={sheetId}
          onChangeText={t => { setSheetId(t); mark() }}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── Save ── */}
      <TouchableOpacity
        style={[s.saveBtn, (!dirty || saving) && s.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!dirty || saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.saveBtnText}>{dirty ? 'Save Settings' : 'No Changes'}</Text>
        }
      </TouchableOpacity>

      <View style={{ height: 60 }} />

      <PickerSheet
        visible={showOrientationPicker}
        title="Page Orientation"
        options={ORIENTATIONS}
        selectedValue={orientation}
        onSelect={v => { setOrientation(v); mark(); setShowOrientationPicker(false) }}
        onClose={() => setShowOrientationPicker(false)}
      />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll:   { flex: 1 },
  content:  { padding: spacing.md, gap: spacing.sm },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionHead: {
    fontSize: font.xs, fontWeight: '800', color: colors.textLight,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: spacing.sm, marginBottom: 4,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 4,
  },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMid, marginTop: spacing.sm, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, fontSize: font.md, color: colors.text },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  row:         { flexDirection: 'row', gap: spacing.sm },
  pickerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11 },
  pickerText:  { fontSize: font.md, color: colors.text, flex: 1 },
  chevron:     { fontSize: 20, color: colors.textLight },

  colorPickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  colorPreview: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  colorHex:     { fontSize: font.xs, color: colors.textMid, fontFamily: 'monospace' },
  swatchGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  swatch:       { width: 32, height: 32, borderRadius: 8 },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },

  saveBtn:        { backgroundColor: colors.accent, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: spacing.sm },
  saveBtnDisabled: { backgroundColor: colors.borderDark },
  saveBtnText:    { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
