import React from 'react'
import {
  Modal, View, Text, TouchableOpacity, FlatList, StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radius, spacing } from '../utils/theme'

interface Option {
  label: string
  value: any
}

interface Props {
  visible: boolean
  title: string
  options: Option[]
  selectedValue: any
  onSelect: (value: any) => void
  onClose: () => void
}

export default function PickerSheet({ visible, title, options, selectedValue, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <FlatList
          data={options}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => {
            const active = item.value === selectedValue
            return (
              <TouchableOpacity
                style={[styles.option, active && styles.optionActive]}
                onPress={() => onSelect(item.value)}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {item.label}
                </Text>
                {active && <Text style={styles.tick}>✓</Text>}
              </TouchableOpacity>
            )
          }}
          style={{ maxHeight: 360 }}
        />
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
  title: {
    fontSize: font.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionActive: {
    backgroundColor: colors.primaryLight,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  optionText: {
    fontSize: font.md,
    color: colors.text,
  },
  optionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  tick: {
    fontSize: font.md,
    color: colors.primary,
    fontWeight: '700',
  },
})
