/**
 * AvailabilityScreen — "My Availability" for clerks (and managers/admins).
 *
 * Phone-first list UI rather than the web's drag grid:
 *   Weekly   — a card per weekday with its repeating unavailable times.
 *   Time off — date ranges (holidays), optionally a time window on a single day.
 *
 * While a block covers a slot the user drops out of the clerk pickers and shows
 * as Unavailable in Telegram. Availability is server-side state, so this screen
 * needs a connection (it is not part of the offline-first inspection data).
 */
import React, { useCallback, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal,
  Switch, ActivityIndicator, RefreshControl, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import DateTimePicker from '@react-native-community/datetimepicker'

import type { RootStackParamList } from '../../App'
import { api } from '../services/api'
import { useToastStore } from '../stores/toastStore'
import Header from '../components/Header'
import { colors, font, radius, spacing } from '../utils/theme'
import {
  WEEKDAYS, byStart, clock, dateAtMinutes, dateFromIso, dateRangeLabel, isoFromDate,
  minutesOf, timeLabel, todayIso,
  type AvailabilityBlock, type AvailabilityPayload,
} from '../utils/availabilityFormat'

type Nav = StackNavigationProp<RootStackParamList, 'Availability'>
type Tab = 'repeating' | 'holiday'
type SheetState = { kind: 'repeating'; weekday: number } | { kind: 'holiday' } | null

function errMsg(e: any, fallback: string) {
  return e?.response?.data?.error || (e?.response ? fallback : 'No connection — availability needs the internet')
}

export default function AvailabilityScreen() {
  const navigation = useNavigation<Nav>()
  const insets     = useSafeAreaInsets()
  const showToast  = useToastStore(s => s.showToast)

  const [tab, setTab]               = useState<Tab>('repeating')
  const [blocks, setBlocks]         = useState<AvailabilityBlock[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError]   = useState('')
  const [sheet, setSheet]           = useState<SheetState>(null)
  const [showPast, setShowPast]     = useState(false)

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const res = await api.getMyAvailability()
      setBlocks(res.data)
      setLoadError('')
    } catch (e: any) {
      setLoadError(errMsg(e, 'Could not load availability'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  function confirmRemove(b: AvailabilityBlock, what: string) {
    Alert.alert('Remove unavailability?', what, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(b.id) },
    ])
  }

  async function remove(id: number) {
    const prev = blocks
    setBlocks(prev.filter(b => b.id !== id))          // optimistic
    try {
      await api.deleteAvailability(id)
    } catch (e: any) {
      setBlocks(prev)                                  // roll back
      showToast(errMsg(e, 'Could not remove'), 'error')
    }
  }

  async function create(payload: AvailabilityPayload): Promise<string | null> {
    try {
      const res = await api.createAvailability(payload)
      setBlocks(prev => [...prev, res.data])
      return null
    } catch (e: any) {
      return errMsg(e, 'Could not save')
    }
  }

  const weekly  = blocks.filter(b => b.kind === 'repeating')
  const today   = todayIso()
  const timeOff = blocks.filter(b => b.kind === 'holiday')
  const upcoming = timeOff.filter(b => (b.end_date || b.start_date || '') >= today)
    .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))
  const past = timeOff.filter(b => (b.end_date || b.start_date || '') < today)
    .sort((a, b) => (a.start_date! < b.start_date! ? 1 : -1))

  return (
    <View style={s.screen}>
      <Header title="My Availability" subtitle="Times you can't be booked" onBack={() => navigation.goBack()} />

      <View style={s.tabs}>
        {(['repeating', 'holiday'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t === 'repeating' ? 'Weekly' : 'Time off'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {!!loadError && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{loadError}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load() }}>
                <Text style={s.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.hint}>
            While you're unavailable you won't appear as a clerk option, and you'll show as Unavailable in Telegram.
          </Text>

          {tab === 'repeating' ? (
            WEEKDAYS.map((name, i) => {
              const mine = weekly.filter(b => b.weekday === i).sort(byStart)
              return (
                <View key={name} style={s.card}>
                  <View style={s.cardHead}>
                    <Text style={s.dayName}>{name}</Text>
                    <TouchableOpacity onPress={() => setSheet({ kind: 'repeating', weekday: i })} hitSlop={8}>
                      <Text style={s.addLink}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                  {mine.length === 0 ? (
                    <Text style={s.free}>Available</Text>
                  ) : (
                    <View style={s.chips}>
                      {mine.map(b => (
                        <TouchableOpacity key={b.id} style={s.chip}
                          onPress={() => confirmRemove(b, `${name}: ${timeLabel(b)}`)}>
                          <Text style={s.chipText}>{timeLabel(b)}</Text>
                          <Text style={s.chipX}>✕</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )
            })
          ) : (
            <>
              <TouchableOpacity style={s.primaryBtn} onPress={() => setSheet({ kind: 'holiday' })}>
                <Text style={s.primaryBtnText}>+ Add time off</Text>
              </TouchableOpacity>

              {upcoming.length === 0 && (
                <Text style={s.empty}>No time off booked.</Text>
              )}
              {upcoming.map(b => <TimeOffRow key={b.id} b={b} onRemove={() => confirmRemove(b, rowText(b))} />)}

              {past.length > 0 && (
                <>
                  <TouchableOpacity style={s.pastToggle} onPress={() => setShowPast(v => !v)}>
                    <Text style={s.pastToggleText}>{showPast ? '▾' : '▸'} Past ({past.length})</Text>
                  </TouchableOpacity>
                  {showPast && past.map(b => (
                    <TimeOffRow key={b.id} b={b} muted onRemove={() => confirmRemove(b, rowText(b))} />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      <AddSheet state={sheet} onClose={() => setSheet(null)} onSave={create} />
    </View>
  )
}

function rowText(b: AvailabilityBlock) {
  return `${dateRangeLabel(b.start_date!, b.end_date)}: ${timeLabel(b)}`
}

function TimeOffRow({ b, onRemove, muted }: { b: AvailabilityBlock; onRemove: () => void; muted?: boolean }) {
  return (
    <View style={[s.card, s.rowCard, muted && { opacity: 0.55 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.dayName}>{dateRangeLabel(b.start_date!, b.end_date)}</Text>
        <Text style={s.free}>{timeLabel(b)} unavailable</Text>
      </View>
      <TouchableOpacity onPress={onRemove} hitSlop={10} style={s.trash}>
        <Text style={s.trashText}>Remove</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Add sheet ──────────────────────────────────────────────────────────────────
type PickerField = 'from' | 'to' | 'start' | 'end' | null

function AddSheet({ state, onClose, onSave }: {
  state: SheetState
  onClose: () => void
  onSave: (p: AvailabilityPayload) => Promise<string | null>
}) {
  const insets = useSafeAreaInsets()
  const [allDay, setAllDay]   = useState(true)
  const [from, setFrom]       = useState(todayIso())
  const [to, setTo]           = useState(todayIso())
  const [startMin, setStartMin] = useState(9 * 60)
  const [endMin, setEndMin]     = useState(17 * 60)
  const [picker, setPicker]   = useState<PickerField>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Reset to defaults every time the sheet opens
  React.useEffect(() => {
    if (!state) return
    setAllDay(true); setFrom(todayIso()); setTo(todayIso())
    setStartMin(9 * 60); setEndMin(17 * 60)
    setPicker(null); setSaving(false); setError('')
  }, [state])

  if (!state) return null
  const isHoliday = state.kind === 'holiday'
  const multiDay  = isHoliday && to !== from
  const timed     = !allDay && !multiDay            // multi-day ranges are always all day

  async function save() {
    setError('')
    if (isHoliday && to < from) { setError('The end date must be on or after the start date'); return }
    if (timed && startMin >= endMin) { setError('The end time must be after the start time'); return }
    const sm = timed ? startMin : null
    const em = timed ? endMin : null
    const payload: AvailabilityPayload = state!.kind === 'repeating'
      ? { kind: 'repeating', weekday: state!.weekday, start_min: sm, end_min: em }
      : { kind: 'holiday', start_date: from, end_date: to, start_min: sm, end_min: em }
    setSaving(true)
    const err = await onSave(payload)
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  function onPick(_: any, d?: Date) {
    if (Platform.OS === 'android') setPicker(null)   // Android shows a dialog that closes itself
    if (!d) return
    if (picker === 'from') {
      const iso = isoFromDate(d)
      setFrom(iso)
      if (to < iso) setTo(iso)
    } else if (picker === 'to') setTo(isoFromDate(d))
    else if (picker === 'start') setStartMin(minutesOf(d))
    else if (picker === 'end') setEndMin(minutesOf(d))
  }

  const pickerMode = picker === 'from' || picker === 'to' ? 'date' : 'time'
  const pickerValue =
    picker === 'from' ? dateFromIso(from)
    : picker === 'to' ? dateFromIso(to)
    : picker === 'start' ? dateAtMinutes(startMin)
    : dateAtMinutes(endMin)

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={s.sheetTitle}>
            {state.kind === 'repeating' ? `Unavailable every ${WEEKDAYS[state.weekday]}` : 'Add time off'}
          </Text>

          {isHoliday && (
            <View style={s.fieldRow}>
              <FieldButton label="From" value={dateRangeLabel(from)} onPress={() => setPicker('from')} />
              <FieldButton label="To" value={dateRangeLabel(to)} onPress={() => setPicker('to')} />
            </View>
          )}

          <View style={s.switchRow}>
            <Text style={s.switchLabel}>All day</Text>
            <Switch value={allDay || multiDay} onValueChange={setAllDay} disabled={multiDay}
              trackColor={{ true: colors.primary }} />
          </View>
          {multiDay && <Text style={s.note}>Specific hours can only be set for a single day.</Text>}

          {timed && (
            <View style={s.fieldRow}>
              <FieldButton label="Start time" value={clock(startMin)} onPress={() => setPicker('start')} />
              <FieldButton label="End time" value={clock(endMin)} onPress={() => setPicker('end')} />
            </View>
          )}

          {picker && (
            <View>
              <DateTimePicker
                value={pickerValue}
                mode={pickerMode}
                is24Hour={false}
                minuteInterval={15}
                display={Platform.OS === 'ios' ? (pickerMode === 'date' ? 'inline' : 'spinner') : 'default'}
                minimumDate={picker === 'to' ? dateFromIso(from) : undefined}
                onChange={onPick}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity style={s.doneBtn} onPress={() => setPicker(null)}>
                  <Text style={s.doneText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!!error && <Text style={s.sheetError}>{error}</Text>}

          <View style={s.sheetActions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function FieldButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.field} onPress={onPress}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: 'row', margin: spacing.md, backgroundColor: colors.muted, borderRadius: radius.md, padding: 3 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.md - 2 },
  tabOn: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { fontSize: font.md, fontWeight: '600', color: colors.textMid },
  tabTextOn: { color: colors.primary },
  scroll: { paddingHorizontal: spacing.md },
  hint: { fontSize: font.xs, color: colors.textLight, fontStyle: 'italic', marginBottom: spacing.sm },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  errorText: { flex: 1, color: colors.danger, fontSize: font.sm },
  retry: { color: colors.danger, fontWeight: '700', fontSize: font.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rowCard: { flexDirection: 'row', alignItems: 'center' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  addLink: { fontSize: font.md, fontWeight: '700', color: colors.primaryMid },
  free: { fontSize: font.sm, color: colors.textLight, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.borderDark, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  chipX: { fontSize: font.sm, color: colors.textMid },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 15, alignItems: 'center', marginBottom: spacing.md },
  primaryBtnText: { color: '#fff', fontSize: font.lg, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textLight, marginVertical: spacing.lg },
  trash: { paddingVertical: 6, paddingHorizontal: 10 },
  trashText: { color: colors.danger, fontWeight: '700', fontSize: font.sm },
  pastToggle: { paddingVertical: spacing.sm },
  pastToggleText: { color: colors.textMid, fontWeight: '600', fontSize: font.sm },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.md },
  sheetTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  fieldRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  field: { flex: 1, borderWidth: 1, borderColor: colors.borderDark, borderRadius: radius.md, padding: 12, backgroundColor: colors.background },
  fieldLabel: { fontSize: font.xs, color: colors.textMid, fontWeight: '600', marginBottom: 2 },
  fieldValue: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  switchLabel: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  note: { fontSize: font.xs, color: colors.textLight, marginBottom: spacing.sm },
  doneBtn: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 },
  doneText: { color: colors.primaryMid, fontWeight: '700', fontSize: font.md },
  sheetError: { color: colors.danger, fontSize: font.sm, marginVertical: spacing.sm },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.muted },
  cancelText: { color: colors.textMid, fontWeight: '700', fontSize: font.md },
  saveBtn: { flex: 2, padding: 15, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  saveText: { color: '#fff', fontWeight: '700', fontSize: font.md },
})
