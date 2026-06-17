import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { api } from '../../services/api'
import { colors, font, radius, spacing } from '../../utils/theme'

const ACTION_COLORS = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981',
  '#ec4899', '#0ea5e9', '#f97316', '#14b8a6', '#64748b',
]

interface Action { id: string; name: string; color: string }

export default function ActionsTab() {
  const [actions,         setActions]         = useState<Action[]>([])
  const [responsibilities, setResponsibilities] = useState<string[]>([])
  const [loading,          setLoading]          = useState(true)
  const [saving,           setSaving]           = useState(false)
  const [dirty,            setDirty]            = useState(false)
  const [newActionName,    setNewActionName]    = useState('')
  const [newActionColor,   setNewActionColor]   = useState(ACTION_COLORS[0])
  const [newResp,          setNewResp]          = useState('')
  const [editingAction,    setEditingAction]    = useState<string | null>(null)
  const [editName,         setEditName]         = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.getActions()
      setActions(r.data?.actions || [])
      setResponsibilities(r.data?.responsibilities || [])
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Failed to load actions')
    } finally { setLoading(false) }
  }

  function mark() { setDirty(true) }

  function addAction() {
    if (!newActionName.trim()) return
    const id = `act_${Date.now()}`
    setActions(prev => [...prev, { id, name: newActionName.trim(), color: newActionColor }])
    setNewActionName('')
    setNewActionColor(ACTION_COLORS[0])
    mark()
  }

  function removeAction(id: string) {
    const action = actions.find(a => a.id === id)
    Alert.alert('Delete Action', `Delete "${action?.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { setActions(prev => prev.filter(a => a.id !== id)); mark() } },
    ])
  }

  function startEditAction(action: Action) {
    setEditingAction(action.id)
    setEditName(action.name)
  }

  function commitEditAction(id: string) {
    if (editName.trim()) {
      setActions(prev => prev.map(a => a.id === id ? { ...a, name: editName.trim() } : a))
      mark()
    }
    setEditingAction(null)
  }

  function setActionColor(id: string, color: string) {
    setActions(prev => prev.map(a => a.id === id ? { ...a, color } : a))
    mark()
  }

  function addResponsibility() {
    if (!newResp.trim()) return
    setResponsibilities(prev => [...prev, newResp.trim()])
    setNewResp('')
    mark()
  }

  function removeResponsibility(idx: number) {
    const label = responsibilities[idx]
    Alert.alert('Delete Responsibility', `Delete "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { setResponsibilities(prev => prev.filter((_, i) => i !== idx)); mark() } },
    ])
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.updateActions({ actions, responsibilities })
      setDirty(false)
      Alert.alert('Saved', 'Action settings updated.')
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.error || 'Could not save')
    } finally { setSaving(false) }
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={colors.primary} size="large" /></View>
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* ── Check-Out Actions ── */}
      <Text style={s.sectionLabel}>Check-Out Actions</Text>
      <Text style={s.sectionHint}>Actions that clerks can assign to items during a check-out inspection.</Text>

      <View style={s.card}>
        {actions.map(action => (
          <View key={action.id} style={s.actionRow}>
            {editingAction === action.id ? (
              <TextInput
                style={s.editInput}
                value={editName}
                onChangeText={setEditName}
                onBlur={() => commitEditAction(action.id)}
                onSubmitEditing={() => commitEditAction(action.id)}
                autoFocus
                placeholderTextColor={colors.textLight}
              />
            ) : (
              <TouchableOpacity style={s.actionNameWrap} onPress={() => startEditAction(action)}>
                <View style={[s.colorDot, { backgroundColor: action.color }]} />
                <Text style={s.actionName}>{action.name}</Text>
                <Text style={s.editHint}>tap to rename</Text>
              </TouchableOpacity>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.colorStrip}
              contentContainerStyle={s.colorStripInner}
            >
              {ACTION_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.colorSwatch, { backgroundColor: c }, action.color === c && s.colorSwatchSelected]}
                  onPress={() => setActionColor(action.id, c)}
                />
              ))}
            </ScrollView>

            <TouchableOpacity style={s.removeBtn} onPress={() => removeAction(action.id)}>
              <Text style={s.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add new action */}
        <View style={s.addRow}>
          <TextInput
            style={s.addInput}
            placeholder="New action name…"
            placeholderTextColor={colors.textLight}
            value={newActionName}
            onChangeText={setNewActionName}
            onSubmitEditing={addAction}
            returnKeyType="done"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.colorStrip} contentContainerStyle={s.colorStripInner}>
            {ACTION_COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[s.colorSwatch, { backgroundColor: c }, newActionColor === c && s.colorSwatchSelected]}
                onPress={() => setNewActionColor(c)}
              />
            ))}
          </ScrollView>
          <TouchableOpacity style={s.addBtn} onPress={addAction}>
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Responsibilities ── */}
      <Text style={[s.sectionLabel, { marginTop: spacing.md }]}>Responsibilities</Text>
      <Text style={s.sectionHint}>Who is responsible for resolving a flagged item.</Text>

      <View style={s.card}>
        {responsibilities.map((r, idx) => (
          <View key={idx} style={[s.respRow, idx < responsibilities.length - 1 && s.respRowBorder]}>
            <Text style={s.respText}>{r}</Text>
            <TouchableOpacity onPress={() => removeResponsibility(idx)}>
              <Text style={s.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={s.addRow}>
          <TextInput
            style={s.addInput}
            placeholder="New responsibility…"
            placeholderTextColor={colors.textLight}
            value={newResp}
            onChangeText={setNewResp}
            onSubmitEditing={addResponsibility}
            returnKeyType="done"
          />
          <TouchableOpacity style={s.addBtn} onPress={addResponsibility}>
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Save ── */}
      <TouchableOpacity
        style={[s.saveBtn, (!dirty || saving) && s.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!dirty || saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.saveBtnText}>{dirty ? 'Save Changes' : 'No Changes'}</Text>
        }
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll:   { flex: 1 },
  content:  { padding: spacing.md, gap: spacing.sm },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textLight, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionHint:  { fontSize: font.xs, color: colors.textMid, marginBottom: spacing.xs },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },

  // Action rows
  actionRow:     { borderBottomWidth: 1, borderBottomColor: colors.border, padding: spacing.sm, gap: spacing.xs },
  actionNameWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  colorDot:      { width: 14, height: 14, borderRadius: 7 },
  actionName:    { fontSize: font.sm, fontWeight: '600', color: colors.text, flex: 1 },
  editHint:      { fontSize: 10, color: colors.textLight },
  editInput:     { fontSize: font.sm, fontWeight: '600', color: colors.text, borderBottomWidth: 1.5, borderBottomColor: colors.primary, paddingBottom: 2, flex: 1 },

  colorStrip:      { maxHeight: 32, marginTop: 4 },
  colorStripInner: { gap: spacing.xs, paddingRight: spacing.xs },
  colorSwatch:     { width: 26, height: 26, borderRadius: 13 },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.text },

  removeBtn:     { alignSelf: 'flex-start' },
  removeBtnText: { fontSize: font.sm, color: colors.danger, fontWeight: '700' },

  // Add row
  addRow:    { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  addInput:  { flex: 1, fontSize: font.sm, color: colors.text, paddingVertical: 4 },
  addBtn:    { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  addBtnText: { color: '#fff', fontSize: font.xs, fontWeight: '700' },

  // Responsibility rows
  respRow:       { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.sm },
  respRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  respText:      { flex: 1, fontSize: font.sm, color: colors.text },

  // Save button
  saveBtn:        { backgroundColor: colors.accent, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: spacing.sm },
  saveBtnDisabled: { backgroundColor: colors.borderDark },
  saveBtnText:    { color: '#fff', fontSize: font.md, fontWeight: '700' },
})
