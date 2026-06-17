import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  Modal, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { api } from '../services/api'
import { colors, font, radius, spacing, STATUS_COLORS, TYPE_LABELS } from '../utils/theme'
import PickerSheet from '../components/PickerSheet'
import CreatePropertyModal from '../components/CreatePropertyModal'
import CreateInspectionModal from '../components/CreateInspectionModal'
import DashboardTab   from './admin/DashboardTab'
import TemplatesTab   from './admin/TemplatesTab'
import ActionsTab     from './admin/ActionsTab'
import SettingsTab    from './admin/SettingsTab'

// ── Constants ──────────────────────────────────────────────────────────────────
const TABS = ['Dashboard', 'Users', 'Properties', 'Clients', 'Inspections', 'Templates', 'Actions', 'Settings'] as const
type Tab = typeof TABS[number]

const CRUD_TABS: Tab[] = ['Users', 'Properties', 'Clients', 'Inspections']

const ROLES = ['admin', 'manager', 'clerk', 'typist']
const TYPIST_MODES = [
  { label: 'None (inherit profile)',  value: '' },
  { label: 'AI Instant',             value: 'ai_instant' },
  { label: 'AI Room Dictation',      value: 'ai_room' },
  { label: 'Human Typist',           value: 'human' },
]
const SWATCH_COLORS = [
  '#1e3a8a', '#2563eb', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
]
const CLIENT_BRAND_COLORS = [
  '#1e3a8a', '#2563eb', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#0f172a', '#334155', '#16a34a', '#d97706',
]
const PROPERTY_TYPES  = ['House', 'Flat', 'Studio', 'Bungalow', 'Maisonette', 'Cottage', 'Commercial', 'Other']
const FURNISHED_OPTS  = ['Furnished', 'Part Furnished', 'Unfurnished']
const DETACHMENT_OPTS = ['Detached', 'Semi-Detached', 'Terraced', 'End of Terrace', 'Mid-Terrace']
const TIME_PREFS      = ['Morning', 'Afternoon', 'Evening', 'Flexible', 'AM', 'PM']
const INSP_STATUSES   = ['created', 'assigned', 'active', 'processing', 'review', 'complete']

// ── Sheet discriminated union ──────────────────────────────────────────────────
type SheetState =
  | null
  | { mode: 'createUser' }
  | { mode: 'editUser';        item: any }
  | { mode: 'createProperty' }
  | { mode: 'editProperty';    item: any; clients: any[] }
  | { mode: 'createClient' }
  | { mode: 'editClient';      item: any }
  | { mode: 'createInspection' }
  | { mode: 'editInspection';  item: any; users: any[] }

// ── Shared form primitives ─────────────────────────────────────────────────────
function FLabel({ children, req }: { children: string; req?: boolean }) {
  return (
    <Text style={fs.label}>
      {children}{req && <Text style={{ color: colors.danger }}> *</Text>}
    </Text>
  )
}

function FInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput style={fs.input} placeholderTextColor={colors.textLight} {...props} />
}

function FPicker({ value, placeholder, onPress }: { value: string; placeholder: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={fs.pickerRow} onPress={onPress}>
      <Text style={[fs.pickerText, !value && fs.pickerPlaceholder]}>{value || placeholder}</Text>
      <Text style={fs.chevron}>›</Text>
    </TouchableOpacity>
  )
}

function ErrorBanner({ msg }: { msg: string }) {
  if (!msg) return null
  return <View style={fs.errorBanner}><Text style={fs.errorText}>{msg}</Text></View>
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={fs.header}>
      <Text style={fs.headerTitle} numberOfLines={1}>{title}</Text>
      <TouchableOpacity style={fs.closeBtn} onPress={onClose}>
        <Text style={fs.closeBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── User Form Sheet ────────────────────────────────────────────────────────────
function UserFormSheet({ mode, item, onClose, onSaved }: {
  mode: 'create' | 'edit'; item?: any; onClose: () => void; onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [name,         setName]         = useState(item?.name || '')
  const [email,        setEmail]        = useState(item?.email || '')
  const [phone,        setPhone]        = useState(item?.phone || '')
  const [password,     setPassword]     = useState('')
  const [role,         setRole]         = useState(item?.role || 'clerk')
  const [color,        setColor]        = useState(item?.color || SWATCH_COLORS[0])
  const [typistMode,   setTypistMode]   = useState(item?.typist_mode || '')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [showRolePicker,       setShowRolePicker]       = useState(false)
  const [showTypistModePicker, setShowTypistModePicker] = useState(false)

  async function handleSave() {
    if (!name.trim())  { setError('Name is required');  return }
    if (!email.trim()) { setError('Email is required'); return }
    if (mode === 'create') {
      if (!password)           { setError('Password is required');                   return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    }
    setLoading(true); setError('')
    try {
      if (mode === 'create') {
        await api.createUser({
          name: name.trim(), email: email.trim(), password, role, color,
          phone: phone.trim() || undefined,
          typist_mode: role === 'clerk' && typistMode ? typistMode : undefined,
        })
      } else {
        const updateData: any = { name: name.trim(), email: email.trim(), role, color,
          phone: phone.trim() || undefined,
          typist_mode: role === 'clerk' ? (typistMode || null) : null,
        }
        if (password) {
          if (password.length < 8) { setError('Password must be at least 8 characters'); setLoading(false); return }
          updateData.password = password
        }
        await api.updateUser(item.id, updateData)
      }
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed')
    } finally { setLoading(false) }
  }

  const typistModeLabel = TYPIST_MODES.find(t => t.value === typistMode)?.label || 'None (inherit profile)'

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[fs.screen, { paddingTop: insets.top }]}>
          <SheetHeader title={mode === 'create' ? 'New User' : 'Edit User'} onClose={onClose} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={fs.form} keyboardShouldPersistTaps="handled">
            <ErrorBanner msg={error} />

            <FLabel req>Name</FLabel>
            <FInput placeholder="Full name" value={name} onChangeText={setName} autoCapitalize="words" />

            <FLabel req>Email</FLabel>
            <FInput
              placeholder="user@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FLabel>Phone</FLabel>
            <FInput
              placeholder="+44 7700 000000"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            {mode === 'create' ? (
              <>
                <FLabel req>Password</FLabel>
                <FInput
                  placeholder="Min. 8 characters"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : (
              <>
                <FLabel>New Password</FLabel>
                <FInput
                  placeholder="Leave blank to keep current"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

            <FLabel>Role</FLabel>
            <FPicker
              value={role.charAt(0).toUpperCase() + role.slice(1)}
              placeholder="Select role…"
              onPress={() => setShowRolePicker(true)}
            />

            {role === 'clerk' && (
              <>
                <FLabel>Typist Mode</FLabel>
                <FPicker
                  value={typistModeLabel}
                  placeholder="None (inherit profile)"
                  onPress={() => setShowTypistModePicker(true)}
                />
              </>
            )}

            <FLabel>Avatar Color</FLabel>
            <View style={fs.swatchRow}>
              {SWATCH_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[fs.swatch, { backgroundColor: c }, color === c && fs.swatchSelected]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>

            <TouchableOpacity
              style={[fs.submitBtn, loading && fs.submitDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={fs.submitText}>{mode === 'create' ? 'Create User' : 'Save Changes'}</Text>
              }
            </TouchableOpacity>
            <View style={{ height: insets.bottom + 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showRolePicker}
        title="Select Role"
        options={ROLES.map(r => ({ label: r.charAt(0).toUpperCase() + r.slice(1), value: r }))}
        selectedValue={role}
        onSelect={v => { setRole(v); setShowRolePicker(false) }}
        onClose={() => setShowRolePicker(false)}
      />
      <PickerSheet
        visible={showTypistModePicker}
        title="Typist Mode"
        options={TYPIST_MODES}
        selectedValue={typistMode}
        onSelect={v => { setTypistMode(v); setShowTypistModePicker(false) }}
        onClose={() => setShowTypistModePicker(false)}
      />
    </Modal>
  )
}

// ── Property Edit Sheet (create uses existing CreatePropertyModal) ─────────────
function PropertyEditSheet({ item, clients, onClose, onSaved }: {
  item: any; clients: any[]; onClose: () => void; onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [address,          setAddress]          = useState(item?.address || '')
  const [clientId,         setClientId]         = useState<number | null>(item?.client_id || item?.client?.id || null)
  const [propType,         setPropType]         = useState(item?.property_type || '')
  const [detachmentType,   setDetachmentType]   = useState(item?.detachment_type || '')
  const [bedrooms,         setBedrooms]         = useState(item?.bedrooms != null ? String(item.bedrooms) : '')
  const [bathrooms,        setBathrooms]        = useState(item?.bathrooms != null ? String(item.bathrooms) : '')
  const [furnished,        setFurnished]        = useState(item?.furnished || '')
  const [parking,          setParking]          = useState<boolean>(item?.parking ?? false)
  const [garden,           setGarden]           = useState<boolean>(item?.garden ?? false)
  const [elevator,         setElevator]         = useState<boolean>(item?.elevator ?? false)
  const [meterElectricity, setMeterElectricity] = useState(item?.meter_electricity || '')
  const [meterGas,         setMeterGas]         = useState(item?.meter_gas || '')
  const [meterHeat,        setMeterHeat]        = useState(item?.meter_heat || '')
  const [meterWater,       setMeterWater]       = useState(item?.meter_water || '')
  const [notes,            setNotes]            = useState(item?.notes || '')
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState('')
  const [showClientPicker,     setShowClientPicker]     = useState(false)
  const [showTypePicker,       setShowTypePicker]       = useState(false)
  const [showFurnPicker,       setShowFurnPicker]       = useState(false)
  const [showDetachmentPicker, setShowDetachmentPicker] = useState(false)

  const selectedClient = clients.find(c => c.id === clientId)

  async function handleSave() {
    if (!address.trim()) { setError('Address is required'); return }
    setLoading(true); setError('')
    try {
      await api.updateProperty(item.id, {
        address:           address.trim(),
        client_id:         clientId || undefined,
        property_type:     propType         || null,
        detachment_type:   detachmentType   || null,
        bedrooms:          bedrooms  ? Number(bedrooms)  : null,
        bathrooms:         bathrooms ? Number(bathrooms) : null,
        furnished:         furnished || null,
        parking, garden, elevator,
        meter_electricity: meterElectricity || null,
        meter_gas:         meterGas         || null,
        meter_heat:        meterHeat        || null,
        meter_water:       meterWater       || null,
        notes:             notes || null,
      })
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed')
    } finally { setLoading(false) }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[fs.screen, { paddingTop: insets.top }]}>
          <SheetHeader title="Edit Property" onClose={onClose} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={fs.form} keyboardShouldPersistTaps="handled">
            <ErrorBanner msg={error} />

            <FLabel>Client</FLabel>
            <FPicker
              value={selectedClient?.name || ''}
              placeholder="Select client…"
              onPress={() => setShowClientPicker(true)}
            />

            <FLabel req>Address</FLabel>
            <FInput placeholder="Full address" value={address} onChangeText={setAddress} autoCapitalize="words" />

            <FLabel>Property Type</FLabel>
            <FPicker value={propType} placeholder="Select type…" onPress={() => setShowTypePicker(true)} />

            <FLabel>Detachment Type</FLabel>
            <FPicker value={detachmentType} placeholder="Select…" onPress={() => setShowDetachmentPicker(true)} />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <FLabel>Bedrooms</FLabel>
                <FInput placeholder="0" value={bedrooms} onChangeText={setBedrooms} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <FLabel>Bathrooms</FLabel>
                <FInput placeholder="0" value={bathrooms} onChangeText={setBathrooms} keyboardType="numeric" />
              </View>
            </View>

            <FLabel>Furnished</FLabel>
            <FPicker value={furnished} placeholder="Select…" onPress={() => setShowFurnPicker(true)} />

            <FLabel>Features</FLabel>
            <View style={fs.toggleRow}>
              {[
                { label: '🚗 Parking',  val: parking,  set: setParking },
                { label: '🌿 Garden',   val: garden,   set: setGarden },
                { label: '🛗 Lift',     val: elevator, set: setElevator },
              ].map(f => (
                <TouchableOpacity
                  key={f.label}
                  style={[fs.toggleChip, f.val && fs.toggleChipActive]}
                  onPress={() => f.set(!f.val)}
                >
                  <Text style={[fs.toggleChipText, f.val && fs.toggleChipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <FLabel>Meter References</FLabel>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={[fs.label, { marginTop: 4 }]}>Electric</Text>
                <FInput placeholder="Ref / serial" value={meterElectricity} onChangeText={setMeterElectricity} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[fs.label, { marginTop: 4 }]}>Gas</Text>
                <FInput placeholder="Ref / serial" value={meterGas} onChangeText={setMeterGas} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={[fs.label, { marginTop: 4 }]}>Heat</Text>
                <FInput placeholder="Ref / serial" value={meterHeat} onChangeText={setMeterHeat} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[fs.label, { marginTop: 4 }]}>Water</Text>
                <FInput placeholder="Ref / serial" value={meterWater} onChangeText={setMeterWater} />
              </View>
            </View>

            <FLabel>Notes</FLabel>
            <FInput
              placeholder="Optional notes…"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={[fs.input, fs.inputMulti]}
            />

            <TouchableOpacity
              style={[fs.submitBtn, loading && fs.submitDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={fs.submitText}>Save Changes</Text>
              }
            </TouchableOpacity>
            <View style={{ height: insets.bottom + 32 }} />
          </ScrollView>
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
        selectedValue={propType}
        onSelect={v => { setPropType(v); setShowTypePicker(false) }}
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
        visible={showDetachmentPicker}
        title="Detachment Type"
        options={[{ label: 'None', value: '' }, ...DETACHMENT_OPTS.map(d => ({ label: d, value: d }))]}
        selectedValue={detachmentType}
        onSelect={v => { setDetachmentType(v); setShowDetachmentPicker(false) }}
        onClose={() => setShowDetachmentPicker(false)}
      />
    </Modal>
  )
}

// ── Client Form Sheet ──────────────────────────────────────────────────────────
function ClientFormSheet({ mode, item, onClose, onSaved }: {
  mode: 'create' | 'edit'; item?: any; onClose: () => void; onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [name,              setName]              = useState(item?.name || '')
  const [company,           setCompany]           = useState(item?.company || '')
  const [email,             setEmail]             = useState(item?.email || '')
  const [phone,             setPhone]             = useState(item?.phone || '')
  const [clientAddress,     setClientAddress]     = useState(item?.address || '')
  const [primaryColor,      setPrimaryColor]      = useState(item?.primary_color || '')
  const [reportDisclaimer,  setReportDisclaimer]  = useState(item?.report_disclaimer || '')
  const [loading,           setLoading]           = useState(false)
  const [error,             setError]             = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true); setError('')
    try {
      const data = {
        name:               name.trim(),
        company:            company.trim()           || undefined,
        email:              email.trim()             || undefined,
        phone:              phone.trim()             || undefined,
        address:            clientAddress.trim()     || undefined,
        primary_color:      primaryColor             || undefined,
        report_disclaimer:  reportDisclaimer.trim()  || undefined,
      }
      if (mode === 'create') await api.createClient(data)
      else                   await api.updateClient(item.id, data)
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed')
    } finally { setLoading(false) }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[fs.screen, { paddingTop: insets.top }]}>
          <SheetHeader title={mode === 'create' ? 'New Client' : 'Edit Client'} onClose={onClose} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={fs.form} keyboardShouldPersistTaps="handled">
            <ErrorBanner msg={error} />

            <FLabel req>Name</FLabel>
            <FInput placeholder="Client / agency name" value={name} onChangeText={setName} autoCapitalize="words" />

            <FLabel>Company</FLabel>
            <FInput placeholder="Registered company name" value={company} onChangeText={setCompany} autoCapitalize="words" />

            <FLabel>Email</FLabel>
            <FInput
              placeholder="contact@client.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FLabel>Phone</FLabel>
            <FInput placeholder="+44 7700 000000" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

            <FLabel>Address</FLabel>
            <FInput
              placeholder="Office / registered address"
              value={clientAddress}
              onChangeText={setClientAddress}
              multiline
              numberOfLines={2}
              style={[fs.input, { minHeight: 64, textAlignVertical: 'top' }]}
              autoCapitalize="words"
            />

            <FLabel>Brand Color</FLabel>
            <View style={fs.swatchRow}>
              {CLIENT_BRAND_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[fs.swatch, { backgroundColor: c }, primaryColor === c && fs.swatchSelected]}
                  onPress={() => setPrimaryColor(primaryColor === c ? '' : c)}
                />
              ))}
            </View>
            {primaryColor ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 }}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: primaryColor, borderWidth: 1, borderColor: colors.border }} />
                <Text style={{ fontSize: font.xs, color: colors.textMid }}>{primaryColor}</Text>
                <TouchableOpacity onPress={() => setPrimaryColor('')}>
                  <Text style={{ fontSize: font.xs, color: colors.danger, fontWeight: '600' }}>Clear</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <FLabel>Report Disclaimer</FLabel>
            <FInput
              placeholder="Disclaimer text shown on every report…"
              value={reportDisclaimer}
              onChangeText={setReportDisclaimer}
              multiline
              numberOfLines={4}
              style={[fs.input, fs.inputMulti]}
            />

            <TouchableOpacity
              style={[fs.submitBtn, loading && fs.submitDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={fs.submitText}>{mode === 'create' ? 'Create Client' : 'Save Changes'}</Text>
              }
            </TouchableOpacity>
            <View style={{ height: insets.bottom + 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Inspection Edit Sheet ──────────────────────────────────────────────────────
function InspectionEditSheet({ item, users, onClose, onSaved }: {
  item: any; users: any[]; onClose: () => void; onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [status,         setStatus]         = useState(item?.status || 'created')
  const [inspectorId,    setInspectorId]    = useState<number | null>(item?.inspector?.id || item?.inspector_id || null)
  const [typistId,       setTypistId]       = useState<number | null>(item?.typist?.id || item?.typist_id || null)
  const [conductDate,    setConductDate]    = useState(item?.conduct_date ? item.conduct_date.split('T')[0] : '')
  const [timePref,       setTimePref]       = useState(item?.conduct_time_preference || '')
  const [refNumber,      setRefNumber]      = useState(item?.reference_number || '')
  const [keyLocation,    setKeyLocation]    = useState(item?.key_location || '')
  const [keyReturn,      setKeyReturn]      = useState(item?.key_return || '')
  const [tenantName,     setTenantName]     = useState(item?.tenant_name || '')
  const [tenantEmail,    setTenantEmail]    = useState(item?.tenant_email || '')
  const [landlordEmail,  setLandlordEmail]  = useState(item?.landlord_email || '')
  const [notes,          setNotes]          = useState(item?.internal_notes || '')
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState('')
  const [showStatusPicker,    setShowStatusPicker]    = useState(false)
  const [showInspectorPicker, setShowInspectorPicker] = useState(false)
  const [showTypistPicker,    setShowTypistPicker]    = useState(false)
  const [showTimePrefPicker,  setShowTimePrefPicker]  = useState(false)

  const assignable        = users.filter(u => ['admin', 'manager', 'clerk'].includes(u.role))
  const typists           = users.filter(u => u.role === 'typist')
  const selectedInspector = assignable.find(u => u.id === inspectorId)
  const selectedTypist    = typists.find(u => u.id === typistId)

  async function handleSave() {
    setLoading(true); setError('')
    try {
      await api.updateInspection(item.id, {
        status,
        inspector_id:             inspectorId   || null,
        typist_id:                typistId      || null,
        conduct_date:             conductDate   || null,
        conduct_time_preference:  timePref      || null,
        reference_number:         refNumber     || null,
        key_location:             keyLocation   || null,
        key_return:               keyReturn     || null,
        tenant_name:              tenantName    || null,
        tenant_email:             tenantEmail   || null,
        landlord_email:           landlordEmail || null,
        internal_notes:           notes         || null,
      })
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed')
    } finally { setLoading(false) }
  }

  const sc = STATUS_COLORS[status]

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[fs.screen, { paddingTop: insets.top }]}>
          <SheetHeader title={item?.property_address || `Inspection #${item?.id}`} onClose={onClose} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={fs.form} keyboardShouldPersistTaps="handled">
            <ErrorBanner msg={error} />

            <Text style={fs.inspMeta}>
              {TYPE_LABELS[item?.inspection_type] ?? item?.inspection_type ?? '—'}
              {item?.client_name ? `  ·  ${item.client_name}` : ''}
              {item?.reference_number ? `  ·  ${item.reference_number}` : ''}
            </Text>

            <FLabel>Status</FLabel>
            <FPicker
              value={sc?.label || status}
              placeholder="Select status…"
              onPress={() => setShowStatusPicker(true)}
            />

            <FLabel>Reference Number</FLabel>
            <FInput
              placeholder="e.g. INS-123"
              value={refNumber}
              onChangeText={setRefNumber}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <FLabel>Assigned Inspector</FLabel>
            <FPicker
              value={selectedInspector ? `${selectedInspector.name} (${selectedInspector.role})` : ''}
              placeholder="Unassigned"
              onPress={() => setShowInspectorPicker(true)}
            />

            <FLabel>Assigned Typist</FLabel>
            <FPicker
              value={selectedTypist ? selectedTypist.name : ''}
              placeholder="Unassigned"
              onPress={() => setShowTypistPicker(true)}
            />

            <FLabel>Inspection Date</FLabel>
            <FInput
              placeholder="YYYY-MM-DD"
              value={conductDate}
              onChangeText={setConductDate}
              keyboardType="numbers-and-punctuation"
            />

            <FLabel>Time Preference</FLabel>
            <FPicker
              value={timePref}
              placeholder="None"
              onPress={() => setShowTimePrefPicker(true)}
            />

            <FLabel>Key Location</FLabel>
            <FInput placeholder="Where keys are held / access method" value={keyLocation} onChangeText={setKeyLocation} />

            <FLabel>Key Return</FLabel>
            <FInput placeholder="Where keys should be returned" value={keyReturn} onChangeText={setKeyReturn} />

            <FLabel>Tenant Name</FLabel>
            <FInput placeholder="Tenant full name" value={tenantName} onChangeText={setTenantName} autoCapitalize="words" />

            <FLabel>Tenant Email</FLabel>
            <FInput
              placeholder="tenant@example.com"
              value={tenantEmail}
              onChangeText={setTenantEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FLabel>Landlord / Agent Email</FLabel>
            <FInput
              placeholder="landlord@example.com"
              value={landlordEmail}
              onChangeText={setLandlordEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FLabel>Internal Notes</FLabel>
            <FInput
              placeholder="Notes visible to admins/managers…"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              style={[fs.input, fs.inputMulti]}
            />

            <TouchableOpacity
              style={[fs.submitBtn, loading && fs.submitDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={fs.submitText}>Save Changes</Text>
              }
            </TouchableOpacity>
            <View style={{ height: insets.bottom + 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showStatusPicker}
        title="Inspection Status"
        options={INSP_STATUSES.map(st => ({ label: STATUS_COLORS[st]?.label ?? st, value: st }))}
        selectedValue={status}
        onSelect={v => { setStatus(v); setShowStatusPicker(false) }}
        onClose={() => setShowStatusPicker(false)}
      />
      <PickerSheet
        visible={showInspectorPicker}
        title="Assign Inspector"
        options={[
          { label: 'None (unassigned)', value: null },
          ...assignable.map(u => ({ label: `${u.name} (${u.role})`, value: u.id })),
        ]}
        selectedValue={inspectorId}
        onSelect={v => { setInspectorId(v); setShowInspectorPicker(false) }}
        onClose={() => setShowInspectorPicker(false)}
      />
      <PickerSheet
        visible={showTypistPicker}
        title="Assign Typist"
        options={[
          { label: 'None (unassigned)', value: null },
          ...typists.map(u => ({ label: u.name, value: u.id })),
        ]}
        selectedValue={typistId}
        onSelect={v => { setTypistId(v); setShowTypistPicker(false) }}
        onClose={() => setShowTypistPicker(false)}
      />
      <PickerSheet
        visible={showTimePrefPicker}
        title="Time Preference"
        options={[{ label: 'None', value: '' }, ...TIME_PREFS.map(t => ({ label: t, value: t }))]}
        selectedValue={timePref}
        onSelect={v => { setTimePref(v); setShowTimePrefPicker(false) }}
        onClose={() => setShowTimePrefPicker(false)}
      />
    </Modal>
  )
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function AdminPanelScreen() {
  const navigation = useNavigation()
  const insets     = useSafeAreaInsets()

  const [activeTab,    setActiveTab]    = useState<Tab>('Users')
  const [users,        setUsers]        = useState<any[]>([])
  const [properties,   setProperties]   = useState<any[]>([])
  const [clients,      setClients]      = useState<any[]>([])
  const [inspections,  setInspections]  = useState<any[]>([])
  const [loading,      setLoading]      = useState(false)
  const [refreshing,   setRefreshing]   = useState(false)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [sheet,        setSheet]        = useState<SheetState>(null)

  useEffect(() => {
    setSearch('')
    if (CRUD_TABS.includes(activeTab)) loadTab(activeTab)
  }, [activeTab])

  async function loadTab(tab: Tab, isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      if (tab === 'Users') {
        const r = await api.getUsers()
        setUsers(r.data || [])
      } else if (tab === 'Properties') {
        const [pr, cr] = await Promise.all([api.getProperties(), api.getClients()])
        setProperties(pr.data || [])
        setClients(cr.data || [])
      } else if (tab === 'Clients') {
        const r = await api.getClients()
        setClients(r.data || [])
      } else if (tab === 'Inspections') {
        const [ir, ur] = await Promise.all([api.getAllInspections(), api.getUsers()])
        setInspections(ir.data || [])
        setUsers(ur.data || [])
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Failed to load data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = useCallback(() => loadTab(activeTab, true), [activeTab])

  function onSaved() {
    setSheet(null)
    loadTab(activeTab)
  }

  function handleFab() {
    if (activeTab === 'Users')        setSheet({ mode: 'createUser' })
    else if (activeTab === 'Properties') setSheet({ mode: 'createProperty' })
    else if (activeTab === 'Clients')    setSheet({ mode: 'createClient' })
    else                                 setSheet({ mode: 'createInspection' })
  }

  function confirmDelete(entity: Tab, item: any, label: string) {
    Alert.alert(
      `Delete ${entity.slice(0, -1)}`,
      `Delete "${label}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              if (entity === 'Users')        await api.deleteUser(item.id)
              else if (entity === 'Properties') await api.deleteProperty(item.id)
              else if (entity === 'Clients')    await api.deleteClient(item.id)
              else                              await api.deleteInspection(item.id)
              loadTab(entity)
            } catch (e: any) {
              Alert.alert('Delete failed', e?.response?.data?.error || 'Could not delete')
            }
          }
        }
      ]
    )
  }

  // ── Filtered data ────────────────────────────────────────────────────────
  const lc = search.toLowerCase()

  const filteredUsers = users.filter(u =>
    !lc || u.name?.toLowerCase().includes(lc) || u.email?.toLowerCase().includes(lc)
  )
  const filteredProperties = properties.filter(p =>
    !lc || p.address?.toLowerCase().includes(lc) ||
    (p.client_name || p.client?.name || '').toLowerCase().includes(lc)
  )
  const filteredClients = clients.filter(c =>
    !lc || c.name?.toLowerCase().includes(lc) || c.email?.toLowerCase().includes(lc)
  )
  const filteredInspections = inspections.filter(i => {
    const matchSearch = !lc ||
      i.property_address?.toLowerCase().includes(lc) ||
      i.client_name?.toLowerCase().includes(lc) ||
      i.inspector_name?.toLowerCase().includes(lc)
    const matchStatus = !statusFilter || i.status === statusFilter
    return matchSearch && matchStatus
  })

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // ── Row renderers ────────────────────────────────────────────────────────
  function renderUser({ item }: { item: any }) {
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => setSheet({ mode: 'editUser', item })}
        activeOpacity={0.7}
      >
        <View style={[s.avatar, { backgroundColor: item.color || colors.primary }]}>
          <Text style={s.avatarText}>{item.name?.charAt(0).toUpperCase() || '?'}</Text>
        </View>
        <View style={s.rowContent}>
          <Text style={s.rowTitle}>{item.name}</Text>
          <Text style={s.rowSub}>{item.email}  ·  {item.role}</Text>
        </View>
        <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete('Users', item, item.name)}>
          <Text style={s.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  function renderProperty({ item }: { item: any }) {
    const clientName = item.client_name || item.client?.name || '—'
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => setSheet({ mode: 'editProperty', item, clients })}
        activeOpacity={0.7}
      >
        <View style={s.rowContent}>
          <Text style={s.rowTitle} numberOfLines={1}>{item.address}</Text>
          <Text style={s.rowSub}>
            {clientName}
            {item.property_type ? `  ·  ${item.property_type}` : ''}
            {item.bedrooms != null ? `  ·  ${item.bedrooms} bed` : ''}
          </Text>
        </View>
        <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete('Properties', item, item.address)}>
          <Text style={s.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  function renderClient({ item }: { item: any }) {
    const contact = [item.company || item.email, item.phone].filter(Boolean).join('  ·  ')
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => setSheet({ mode: 'editClient', item })}
        activeOpacity={0.7}
      >
        {item.primary_color ? (
          <View style={[s.clientColorDot, { backgroundColor: item.primary_color }]} />
        ) : null}
        <View style={s.rowContent}>
          <Text style={s.rowTitle}>{item.name}</Text>
          <Text style={s.rowSub}>{contact || 'No contact info'}</Text>
        </View>
        <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete('Clients', item, item.name)}>
          <Text style={s.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  function renderInspection({ item }: { item: any }) {
    const sc = STATUS_COLORS[item.status] || STATUS_COLORS.created
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => setSheet({ mode: 'editInspection', item, users })}
        activeOpacity={0.7}
      >
        <View style={s.rowContent}>
          <Text style={s.rowTitle} numberOfLines={1}>{item.property_address || `Inspection #${item.id}`}</Text>
          <View style={s.rowMeta}>
            <View style={[s.statusPill, { backgroundColor: sc.bg }]}>
              <Text style={[s.statusPillText, { color: sc.text }]}>{sc.label}</Text>
            </View>
            <Text style={s.rowSub}>
              {TYPE_LABELS[item.inspection_type] ?? item.inspection_type ?? '—'}
              {item.conduct_date ? `  ·  ${formatDate(item.conduct_date)}` : ''}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete('Inspections', item, item.property_address || `#${item.id}`)}>
          <Text style={s.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  const listData = activeTab === 'Users'        ? filteredUsers
    : activeTab === 'Properties'  ? filteredProperties
    : activeTab === 'Clients'     ? filteredClients
    : filteredInspections

  const renderItem: any = activeTab === 'Users'       ? renderUser
    : activeTab === 'Properties' ? renderProperty
    : activeTab === 'Clients'    ? renderClient
    : renderInspection

  const counts: Partial<Record<Tab, number>> = {
    Users:       filteredUsers.length,
    Properties:  filteredProperties.length,
    Clients:     filteredClients.length,
    Inspections: filteredInspections.length,
  }

  const isCrudTab = CRUD_TABS.includes(activeTab)

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Admin Panel</Text>
        <View style={{ width: 72 }} />
      </View>

      {/* Tab strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabStrip}
        contentContainerStyle={s.tabStripInner}
      >
        {TABS.map(tab => {
          const count = counts[tab]
          return (
            <TouchableOpacity
              key={tab}
              style={[s.tab, activeTab === tab && s.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>{tab}</Text>
              {count != null && !loading && (
                <View style={[s.tabBadge, activeTab === tab && s.tabBadgeActive]}>
                  <Text style={[s.tabBadgeText, activeTab === tab && s.tabBadgeTextActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* ── Self-contained new tabs ── */}
      {activeTab === 'Dashboard' && <DashboardTab />}
      {activeTab === 'Templates' && <TemplatesTab />}
      {activeTab === 'Actions'   && <ActionsTab />}
      {activeTab === 'Settings'  && <SettingsTab />}

      {/* ── CRUD tabs: search + filter + list + FAB ── */}
      {isCrudTab && (
        <>
          {/* Search bar */}
          <View style={s.searchWrap}>
            <TextInput
              style={s.searchInput}
              placeholder={`Search ${activeTab.toLowerCase()}…`}
              placeholderTextColor={colors.textLight}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Status filter — Inspections only */}
          {activeTab === 'Inspections' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.filterBar}
            >
              <TouchableOpacity
                style={[s.filterChip, !statusFilter && s.filterChipActive]}
                onPress={() => setStatusFilter(null)}
              >
                <Text style={[s.filterChipText, !statusFilter && s.filterChipTextActive]}>All</Text>
              </TouchableOpacity>
              {INSP_STATUSES.map(st => {
                const sc     = STATUS_COLORS[st]
                const active = statusFilter === st
                return (
                  <TouchableOpacity
                    key={st}
                    style={[s.filterChip, active && { backgroundColor: sc?.bg, borderColor: sc?.text }]}
                    onPress={() => setStatusFilter(active ? null : st)}
                  >
                    <Text style={[s.filterChipText, active && { color: sc?.text }]}>
                      {sc?.label ?? st}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}

          {/* List */}
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={s.loadingText}>Loading {activeTab.toLowerCase()}…</Text>
            </View>
          ) : (
            <FlatList
              data={listData}
              keyExtractor={i => String(i.id)}
              renderItem={renderItem}
              contentContainerStyle={s.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              ListEmptyComponent={
                <Text style={s.emptyText}>
                  {search ? 'No results match your search.' : `No ${activeTab.toLowerCase()} found.`}
                </Text>
              }
            />
          )}

          {/* FAB */}
          <TouchableOpacity
            style={[s.fab, { bottom: insets.bottom + 24 }]}
            onPress={handleFab}
            activeOpacity={0.85}
          >
            <Text style={s.fabIcon}>+</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── Sheets ── */}
      {sheet?.mode === 'createUser' && (
        <UserFormSheet mode="create" onClose={() => setSheet(null)} onSaved={onSaved} />
      )}
      {sheet?.mode === 'editUser' && (
        <UserFormSheet mode="edit" item={sheet.item} onClose={() => setSheet(null)} onSaved={onSaved} />
      )}
      {sheet?.mode === 'createProperty' && (
        <CreatePropertyModal
          visible
          onClose={() => setSheet(null)}
          onCreated={() => onSaved()}
        />
      )}
      {sheet?.mode === 'editProperty' && (
        <PropertyEditSheet
          item={sheet.item}
          clients={sheet.clients}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
      {sheet?.mode === 'createClient' && (
        <ClientFormSheet mode="create" onClose={() => setSheet(null)} onSaved={onSaved} />
      )}
      {sheet?.mode === 'editClient' && (
        <ClientFormSheet mode="edit" item={sheet.item} onClose={() => setSheet(null)} onSaved={onSaved} />
      )}
      {sheet?.mode === 'createInspection' && (
        <CreateInspectionModal
          visible
          onClose={() => setSheet(null)}
          onCreated={() => onSaved()}
        />
      )}
      {sheet?.mode === 'editInspection' && (
        <InspectionEditSheet
          item={sheet.item}
          users={sheet.users}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: colors.background },
  header:    {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn:       { width: 72, justifyContent: 'flex-start' },
  backBtnText:   { fontSize: font.md, color: colors.primary, fontWeight: '600' },
  headerTitle:   { fontSize: font.lg, fontWeight: '700', color: colors.text },

  // Tabs
  tabStrip:      { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexGrow: 0 },
  tabStripInner: { paddingHorizontal: spacing.sm, gap: 4 },
  tab:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 12, gap: spacing.xs, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:     { borderBottomColor: colors.primary },
  tabText:       { fontSize: font.sm, fontWeight: '600', color: colors.textLight },
  tabTextActive: { color: colors.primary },
  tabBadge:      { backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 20, alignItems: 'center' },
  tabBadgeActive:     { backgroundColor: colors.primaryLight },
  tabBadgeText:       { fontSize: 10, fontWeight: '700', color: colors.textLight },
  tabBadgeTextActive: { color: colors.primary },

  // Search
  searchWrap:  { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchInput: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: font.sm,
    color: colors.text,
  },

  // Filter bar
  filterBar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive:    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  filterChipText:      { fontSize: font.xs, fontWeight: '600', color: colors.textMid },
  filterChipTextActive: { color: colors.primary },

  // List rows
  list:    { padding: spacing.md, gap: spacing.sm, paddingBottom: 120 },
  row:     {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  avatar:         { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  clientColorDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', flexShrink: 0 },
  avatarText:  { fontSize: font.md, fontWeight: '700', color: '#fff' },
  rowContent:  { flex: 1 },
  rowTitle:    { fontSize: font.sm, fontWeight: '700', color: colors.text },
  rowSub:      { fontSize: font.xs, color: colors.textMid, marginTop: 2 },
  rowMeta:     { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
  statusPill:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  deleteBtn:   { padding: spacing.xs },
  deleteBtnText: { fontSize: font.sm, color: colors.danger, fontWeight: '700' },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 56, height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 6,
  },
  fabIcon: { fontSize: 30, color: '#fff', fontWeight: '300', lineHeight: 34, marginTop: -2 },

  // Empty / loading
  loadingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText:  { fontSize: font.sm, color: colors.textMid },
  emptyText:    { textAlign: 'center', color: colors.textLight, fontSize: font.sm, marginTop: spacing.xl },
})

// ── Form sheet styles (shared) ─────────────────────────────────────────────────
const fs = StyleSheet.create({
  screen:     { flex: 1, backgroundColor: colors.background },
  header:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  closeBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  form:        { padding: spacing.md, gap: 4 },
  errorBanner: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  errorText:   { color: colors.danger, fontSize: font.sm, fontWeight: '600' },
  label:       { fontSize: font.sm, fontWeight: '600', color: colors.textMid, marginTop: spacing.md, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:       { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, fontSize: font.md, color: colors.text },
  inputMulti:  { minHeight: 88, textAlignVertical: 'top' },
  pickerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11 },
  pickerText:  { fontSize: font.md, color: colors.text, flex: 1 },
  pickerPlaceholder: { color: colors.textLight },
  chevron:     { fontSize: 20, color: colors.textLight, marginLeft: spacing.xs },
  swatchRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch:      { width: 36, height: 36, borderRadius: 18 },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },
  toggleRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  toggleChip:  { paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  toggleChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toggleChipText:   { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  toggleChipTextActive: { color: colors.primary },
  inspMeta:    { fontSize: font.sm, color: colors.textMid, marginBottom: spacing.xs },
  submitBtn:   { backgroundColor: colors.primary, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: spacing.md },
  submitDisabled: { backgroundColor: colors.borderDark },
  submitText:  { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
