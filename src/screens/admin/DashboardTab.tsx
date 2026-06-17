import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native'
import { api } from '../../services/api'
import { colors, font, radius, spacing, STATUS_COLORS, TYPE_LABELS } from '../../utils/theme'

export default function DashboardTab() {
  const [stats,      setStats]      = useState<any>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => { load() }, [])

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else           setLoading(true)
    setError('')
    try {
      const r = await api.getDashboardStats()
      setStats(r.data)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = useCallback(() => load(true), [])

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
          <Text style={s.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const totals   = stats?.totals       || {}
  const sc       = stats?.status_counts || {}
  const upcoming = stats?.upcoming      || []
  const activity = stats?.activity      || []

  const statCards = [
    { label: 'Inspections', value: totals.inspections, color: colors.primary },
    { label: 'Properties',  value: totals.properties,  color: colors.primaryMid },
    { label: 'Clients',     value: totals.clients,     color: colors.accent },
    { label: 'Users',       value: totals.users,       color: '#8b5cf6' },
  ]

  const statusItems = [
    { key: 'created',    label: 'Created' },
    { key: 'assigned',   label: 'Assigned' },
    { key: 'active',     label: 'Active' },
    { key: 'processing', label: 'Processing' },
    { key: 'review',     label: 'Review' },
    { key: 'complete',   label: 'Complete' },
  ]

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* ── Totals grid ── */}
      <Text style={s.sectionLabel}>Overview</Text>
      <View style={s.cardGrid}>
        {statCards.map(c => c.value != null && (
          <View key={c.label} style={[s.statCard, { borderLeftColor: c.color }]}>
            <Text style={[s.statValue, { color: c.color }]}>{c.value}</Text>
            <Text style={s.statLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Status breakdown ── */}
      <Text style={s.sectionLabel}>Inspection Status</Text>
      <View style={s.statusGrid}>
        {statusItems.map(({ key, label }) => {
          const count = sc[key] ?? 0
          const cfg   = STATUS_COLORS[key]
          return (
            <View key={key} style={[s.statusCard, { backgroundColor: cfg?.bg || colors.muted }]}>
              <Text style={[s.statusCount, { color: cfg?.text || colors.text }]}>{count}</Text>
              <Text style={[s.statusLabel, { color: cfg?.text || colors.textMid }]}>{label}</Text>
            </View>
          )
        })}
      </View>

      {/* ── Upcoming ── */}
      <Text style={s.sectionLabel}>Upcoming</Text>
      {upcoming.length === 0 ? (
        <View style={s.emptyRow}>
          <Text style={s.emptyText}>Nothing scheduled</Text>
        </View>
      ) : (
        <View style={s.listCard}>
          {upcoming.map((item: any, idx: number) => {
              const sc2 = STATUS_COLORS[item.status] || STATUS_COLORS.created
              return (
                <View
                  key={item.id}
                  style={[s.listRow, idx < upcoming.length - 1 && s.listRowBorder]}
                >
                  <View style={s.listRowLeft}>
                    <Text style={s.listRowTitle} numberOfLines={1}>{item.property_address}</Text>
                    <Text style={s.listRowSub}>
                      {TYPE_LABELS[item.inspection_type] ?? item.inspection_type}
                      {item.inspector_name ? `  ·  ${item.inspector_name}` : ''}
                    </Text>
                  </View>
                  <View style={s.listRowRight}>
                    <Text style={s.listRowDate}>{formatDate(item.conduct_date)}</Text>
                    <View style={[s.statusPill, { backgroundColor: sc2.bg }]}>
                      <Text style={[s.statusPillText, { color: sc2.text }]}>{sc2.label}</Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
      )}

      {/* ── Recent activity ── */}
      {activity.length > 0 && (
        <>
          <Text style={s.sectionLabel}>Recent Activity</Text>
          <View style={s.listCard}>
            {activity.slice(0, 10).map((item: any, idx: number) => {
              const sc2 = STATUS_COLORS[item.status] || STATUS_COLORS.created
              return (
                <View
                  key={item.id}
                  style={[s.listRow, idx < Math.min(activity.length, 10) - 1 && s.listRowBorder]}
                >
                  <View style={s.listRowLeft}>
                    <Text style={s.listRowTitle} numberOfLines={1}>{item.label}</Text>
                    <Text style={s.listRowSub}>
                      {item.sub || '—'}
                      {'  ·  '}
                      {TYPE_LABELS[item.inspection_type] ?? item.inspection_type}
                    </Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: sc2.bg }]}>
                    <Text style={[s.statusPillText, { color: sc2.text }]}>{sc2.label}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll:   { flex: 1 },
  content:  { padding: spacing.md, gap: spacing.md },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  errorText: { fontSize: font.sm, color: colors.danger, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: font.sm },

  sectionLabel: {
    fontSize: font.xs, fontWeight: '700', color: colors.textLight,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2,
  },

  // Stat cards
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    flex: 1, minWidth: '45%',
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.sm,
  },
  statValue: { fontSize: font.xxxl, fontWeight: '800', lineHeight: 36 },
  statLabel: { fontSize: font.xs, color: colors.textMid, fontWeight: '600', marginTop: 2 },

  // Status grid
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statusCard: {
    flex: 1, minWidth: '30%',
    borderRadius: radius.md, padding: spacing.sm, alignItems: 'center',
  },
  statusCount: { fontSize: font.xl, fontWeight: '800' },
  statusLabel: { fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },

  // List card
  listCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  listRow:       { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.sm },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  listRowLeft:   { flex: 1 },
  listRowRight:  { alignItems: 'flex-end', gap: 4 },
  listRowTitle:  { fontSize: font.sm, fontWeight: '600', color: colors.text },
  listRowSub:    { fontSize: font.xs, color: colors.textMid, marginTop: 1 },
  listRowDate:   { fontSize: font.xs, color: colors.textLight, fontWeight: '500' },
  statusPill:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  emptyRow:  { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  emptyText: { fontSize: font.sm, color: colors.textLight, fontStyle: 'italic' },
})
