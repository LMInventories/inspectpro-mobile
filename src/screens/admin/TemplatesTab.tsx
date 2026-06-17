import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput, Switch,
  StyleSheet, Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../../services/api'
import { colors, font, radius, spacing, TYPE_LABELS } from '../../utils/theme'
import PickerSheet from '../../components/PickerSheet'

const INSPECTION_TYPES = [
  { value: 'check_in',      label: 'Check In' },
  { value: 'check_out',     label: 'Check Out' },
  { value: 'inventory',     label: 'Inventory' },
  { value: 'midterm',       label: 'Midterm' },
  { value: 'damage_report', label: 'Damage Report' },
]

type FormState = null | { mode: 'create' } | { mode: 'edit'; item: any }

// ── Template Form Sheet ────────────────────────────────────────────────────────
function TemplateFormSheet({ mode, item, onClose, onSaved }: {
  mode: 'create' | 'edit'; item?: any; onClose: () => void; onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [name,      setName]      = useState(item?.name || '')
  const [inspType,  setInspType]  = useState(item?.inspection_type || 'check_in')
  const [isDefault, setIsDefault] = useState(item?.is_default ?? false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [showTypePicker, setShowTypePicker] = useState(false)

  const typelabel = INSPECTION_TYPES.find(t => t.value === inspType)?.label || inspType

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }
    setLoading(true); setError('')
    try {
      if (mode === 'create') {
        await api.createTemplate({ name: name.trim(), inspection_type: inspType, is_default: isDefault })
      } else {
        await api.updateTemplate(item.id, { name: name.trim(), inspection_type: inspType, is_default: isDefault })
      }
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed')
    } finally { setLoading(false) }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[fs.screen, { paddingTop: insets.top }]}>
          <View style={fs.header}>
            <Text style={fs.headerTitle}>{mode === 'create' ? 'New Template' : 'Edit Template'}</Text>
            <TouchableOpacity style={fs.closeBtn} onPress={onClose}>
              <Text style={fs.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={fs.form} keyboardShouldPersistTaps="handled">
            {!!error && <View style={fs.errorBanner}><Text style={fs.errorText}>{error}</Text></View>}

            <Text style={fs.label}>Template Name <Text style={{ color: colors.danger }}>*</Text></Text>
            <TextInput
              style={fs.input}
              placeholder="e.g. Standard Check In"
              placeholderTextColor={colors.textLight}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <Text style={fs.label}>Inspection Type</Text>
            <TouchableOpacity style={fs.pickerRow} onPress={() => setShowTypePicker(true)}>
              <Text style={fs.pickerText}>{typelabel}</Text>
              <Text style={fs.chevron}>›</Text>
            </TouchableOpacity>

            <View style={fs.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={fs.switchLabel}>Set as Default</Text>
                <Text style={fs.switchSub}>This template will be pre-selected for new {typelabel} inspections</Text>
              </View>
              <Switch
                value={isDefault}
                onValueChange={setIsDefault}
                trackColor={{ false: colors.border, true: colors.primaryMid }}
                thumbColor={isDefault ? colors.primary : colors.surface}
              />
            </View>

            <TouchableOpacity
              style={[fs.submitBtn, loading && fs.submitDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={fs.submitText}>{mode === 'create' ? 'Create Template' : 'Save Changes'}</Text>
              }
            </TouchableOpacity>
            <View style={{ height: insets.bottom + 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showTypePicker}
        title="Inspection Type"
        options={INSPECTION_TYPES}
        selectedValue={inspType}
        onSelect={v => { setInspType(v); setShowTypePicker(false) }}
        onClose={() => setShowTypePicker(false)}
      />
    </Modal>
  )
}

// ── Templates Tab ──────────────────────────────────────────────────────────────
export default function TemplatesTab() {
  const [templates,  setTemplates]  = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search,     setSearch]     = useState('')
  const [form,       setForm]       = useState<FormState>(null)

  useEffect(() => { load() }, [])

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else           setLoading(true)
    try {
      const r = await api.getTemplates()
      setTemplates(r.data || [])
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Failed to load templates')
    } finally { setLoading(false); setRefreshing(false) }
  }

  const onRefresh = useCallback(() => load(true), [])

  async function handleCopy(item: any) {
    try {
      await api.copyTemplate(item.id)
      load()
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Copy failed')
    }
  }

  function confirmDelete(item: any) {
    Alert.alert(
      'Delete Template',
      `Delete "${item.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteTemplate(item.id)
              load()
            } catch (e: any) {
              Alert.alert('Delete failed', e?.response?.data?.error || 'Could not delete')
            }
          }
        }
      ]
    )
  }

  const lc      = search.toLowerCase()
  const filtered = templates.filter(t =>
    !lc || t.name?.toLowerCase().includes(lc) ||
    (TYPE_LABELS[t.inspection_type] || t.inspection_type)?.toLowerCase().includes(lc)
  )

  function renderItem({ item }: { item: any }) {
    const typeLabel = TYPE_LABELS[item.inspection_type] ?? item.inspection_type ?? '—'
    return (
      <View style={s.row}>
        <TouchableOpacity style={s.rowMain} onPress={() => setForm({ mode: 'edit', item })} activeOpacity={0.7}>
          <View style={s.rowContent}>
            <View style={s.rowTitleRow}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
              {item.is_default && <View style={s.defaultBadge}><Text style={s.defaultBadgeText}>Default</Text></View>}
            </View>
            <Text style={s.rowSub}>{typeLabel}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={() => handleCopy(item)}>
          <Text style={s.actionBtnText}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete(item)}>
          <Text style={s.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Search */}
      <View style={s.searchWrap}>
        <TextInput
          style={s.searchInput}
          placeholder="Search templates…"
          placeholderTextColor={colors.textLight}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => String(i.id)}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <Text style={s.emptyText}>{search ? 'No matching templates.' : 'No templates yet.'}</Text>
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setForm({ mode: 'create' })} activeOpacity={0.85}>
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      {form && (
        <TemplateFormSheet
          mode={form.mode}
          item={form.mode === 'edit' ? form.item : undefined}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load() }}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  searchWrap:  { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchInput: { backgroundColor: colors.muted, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 9, fontSize: font.sm, color: colors.text },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:        { padding: spacing.md, gap: spacing.sm, paddingBottom: 100 },
  emptyText:   { textAlign: 'center', color: colors.textLight, fontSize: font.sm, marginTop: spacing.xl },
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rowMain:     { flex: 1, padding: spacing.sm },
  rowContent:  { flex: 1 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowTitle:    { fontSize: font.sm, fontWeight: '700', color: colors.text, flex: 1 },
  rowSub:      { fontSize: font.xs, color: colors.textMid, marginTop: 2 },
  defaultBadge: { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  defaultBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  actionBtn:   { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderLeftWidth: 1, borderLeftColor: colors.border },
  actionBtnText: { fontSize: font.xs, fontWeight: '600', color: colors.primaryMid },
  deleteBtn:   { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderLeftWidth: 1, borderLeftColor: colors.border },
  deleteBtnText: { fontSize: font.sm, color: colors.danger, fontWeight: '700' },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 6 },
  fabIcon: { fontSize: 30, color: '#fff', fontWeight: '300', lineHeight: 34, marginTop: -2 },
})

const fs = StyleSheet.create({
  screen:     { flex: 1, backgroundColor: colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  closeBtn:   { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: font.sm, color: colors.textMid, fontWeight: '600' },
  form:       { padding: spacing.md, gap: 4 },
  errorBanner: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  errorText:  { color: colors.danger, fontSize: font.sm, fontWeight: '600' },
  label:      { fontSize: font.sm, fontWeight: '600', color: colors.textMid, marginTop: spacing.md, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:      { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11, fontSize: font.md, color: colors.text },
  pickerRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 11 },
  pickerText: { fontSize: font.md, color: colors.text, flex: 1 },
  chevron:    { fontSize: 20, color: colors.textLight },
  switchRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  switchLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  switchSub:  { fontSize: font.xs, color: colors.textMid, marginTop: 2 },
  submitBtn:  { backgroundColor: colors.primary, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: spacing.md },
  submitDisabled: { backgroundColor: colors.borderDark },
  submitText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
