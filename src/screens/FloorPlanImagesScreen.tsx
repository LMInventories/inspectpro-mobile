/**
 * FloorPlanImagesScreen.tsx
 *
 * Replaces the manual measure-and-draw floor plan tool (FloorPlanDrawScreen)
 * as the destination of Property Overview's "Create/View Floorplan" button.
 *
 * The clerk lays out the floor plan in a 3rd-party app in the field, exports
 * one image per floor, and adds those images here — one per floor, with an
 * editable label, reorderable, replaceable, deletable, and viewable
 * full-screen. Images are stored in report_data._floorplan.images (not a
 * dedicated backend table) so they ride through the existing offline-first
 * photo sync pipeline (see syncService.ts's collectLocalUris) exactly like
 * item photos and the property overview photo.
 *
 * The old draw tool (FloorPlanDrawScreen) and ARCore scanner (FloorPlanScreen)
 * are left untouched and dormant elsewhere in the codebase — this screen does
 * not replace their code, only what the Property Overview button opens.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  Image, Modal, Alert, Animated, useWindowDimensions, BackHandler,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp, RouteProp } from '@react-navigation/stack'
import * as ImagePicker from 'expo-image-picker'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import type { RootStackParamList } from '../../App'
import { useInspectionStore } from '../stores/inspectionStore'
import { getLocalInspection } from '../services/database'
import Header from '../components/Header'
import { colors, font, radius, spacing } from '../utils/theme'

type Nav   = StackNavigationProp<RootStackParamList, 'FloorPlanImages'>
type Route = RouteProp<RootStackParamList, 'FloorPlanImages'>

export type FloorPlanImage = { id: string; label: string; uri: string; order: number }

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function FloorPlanImagesScreen() {
  const navigation = useNavigation<Nav>()
  const route      = useRoute<Route>()
  const insets     = useSafeAreaInsets()
  const { inspectionId } = route.params
  const { updateSectionInReport } = useInspectionStore()

  const [images, setImages]           = useState<FloorPlanImage[]>([])
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  useEffect(() => {
    const inspection = getLocalInspection(inspectionId)
    try {
      const rd = inspection?.report_data ? JSON.parse(inspection.report_data) : {}
      const loaded: FloorPlanImage[] = rd._floorplan?.images || []
      setImages([...loaded].sort((a, b) => a.order - b.order))
    } catch {
      setImages([])
    }
  }, [inspectionId])

  function persist(next: FloorPlanImage[]) {
    const resequenced = next.map((img, idx) => ({ ...img, order: idx }))
    setImages(resequenced)
    updateSectionInReport(inspectionId, '_floorplan', { images: resequenced })
  }

  async function pickImage(fromCamera: boolean): Promise<string | null> {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', fromCamera
        ? 'Camera permission is needed to take a photo.'
        : 'Photo library permission is needed to select a photo.')
      return null
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9, base64: false, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, base64: false, allowsEditing: false })
    if (result.canceled) return null
    return result.assets[0].uri
  }

  function handleAddImage() {
    Alert.alert('Add Floor Plan Image', undefined, [
      {
        text: 'Take Photo',
        onPress: async () => {
          const uri = await pickImage(true)
          if (uri) persist([...images, { id: genId(), label: `Floor ${images.length + 1}`, uri, order: images.length }])
        },
      },
      {
        text: 'Choose from Library',
        onPress: async () => {
          const uri = await pickImage(false)
          if (uri) persist([...images, { id: genId(), label: `Floor ${images.length + 1}`, uri, order: images.length }])
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function handleReplace(id: string) {
    Alert.alert('Replace Image', undefined, [
      {
        text: 'Take Photo',
        onPress: async () => {
          const uri = await pickImage(true)
          if (uri) persist(images.map(img => (img.id === id ? { ...img, uri } : img)))
        },
      },
      {
        text: 'Choose from Library',
        onPress: async () => {
          const uri = await pickImage(false)
          if (uri) persist(images.map(img => (img.id === id ? { ...img, uri } : img)))
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function handleDelete(id: string) {
    Alert.alert('Delete image?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => persist(images.filter(img => img.id !== id)) },
    ])
  }

  function handleRelabel(id: string, label: string) {
    setImages(prev => prev.map(img => (img.id === id ? { ...img, label } : img)))
  }

  function commitLabels() {
    persist(images)
  }

  function moveUp(index: number) {
    if (index <= 0) return
    const next = [...images]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    persist(next)
  }

  function moveDown(index: number) {
    if (index >= images.length - 1) return
    const next = [...images]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    persist(next)
  }

  return (
    <View style={styles.screen}>
      <Header title="Floor Plan" onBack={() => navigation.goBack()} />

      <FlatList
        data={images}
        keyExtractor={(img) => img.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏠</Text>
            <Text style={styles.emptyTitle}>No floor plan images yet</Text>
            <Text style={styles.emptySubtitle}>
              Add one image per floor, exported from your floor plan app.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setViewerIndex(index)} activeOpacity={0.85}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
            </TouchableOpacity>
            <View style={styles.rowMain}>
              <TextInput
                style={styles.labelInput}
                value={item.label}
                onChangeText={(t) => handleRelabel(item.id, t)}
                onBlur={commitLabels}
                placeholder={`Floor ${index + 1}`}
                placeholderTextColor={colors.textLight}
              />
              <View style={styles.rowActions}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => moveUp(index)} disabled={index === 0} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.iconBtnText, index === 0 && styles.iconBtnTextDisabled]}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => moveDown(index)} disabled={index === images.length - 1} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.iconBtnText, index === images.length - 1 && styles.iconBtnTextDisabled]}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => handleReplace(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.iconBtnText}>⟳</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.iconBtnText, { color: colors.danger }]}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity style={styles.addBtn} onPress={handleAddImage}>
          <Text style={styles.addBtnText}>+ Add Floor Image</Text>
        </TouchableOpacity>
      </View>

      <FloorPlanViewer
        images={images}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onChangeIndex={setViewerIndex}
      />
    </View>
  )
}

// ── Full-screen viewer ────────────────────────────────────────────────────────
// Simplified version of ItemGalleryScreen's lightbox: swipe/pinch/double-tap
// zoom via the same gesture composition, minus rotate/annotate/delete/
// reassign — this viewer is navigation + zoom only, all editing happens in
// the list screen above.

function FloorPlanViewer({
  images, index, onClose, onChangeIndex,
}: {
  images: FloorPlanImage[]
  index: number | null
  onClose: () => void
  onChangeIndex: (i: number) => void
}) {
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const flatRef = useRef<FlatList<FloorPlanImage>>(null)

  const scale        = useRef(new Animated.Value(1)).current
  const lastScale     = useRef(1)
  const translateX     = useRef(new Animated.Value(0)).current
  const translateY     = useRef(new Animated.Value(0)).current
  const lastTranslate  = useRef({ x: 0, y: 0 })
  const [flatScrollEnabled, setFlatScrollEnabled] = useState(true)
  const [panEnabled, setPanEnabled]               = useState(false)

  function resetTransform() {
    lastScale.current = 1
    lastTranslate.current = { x: 0, y: 0 }
    scale.setValue(1)
    translateX.setValue(0)
    translateY.setValue(0)
    setFlatScrollEnabled(true)
    setPanEnabled(false)
  }

  useEffect(() => {
    if (index === null) return
    resetTransform()
    const t = setTimeout(() => {
      flatRef.current?.scrollToOffset({ offset: screenWidth * index, animated: false })
    }, 0)
    return () => clearTimeout(t)
  }, [index])

  useEffect(() => {
    if (index === null) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [index])

  const zoomGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onUpdate(e => {
        scale.setValue(Math.max(1, Math.min(4, lastScale.current * e.scale)))
      })
      .onEnd(e => {
        const final = Math.max(1, Math.min(4, lastScale.current * e.scale))
        lastScale.current = final <= 1.05 ? 1 : final
        if (lastScale.current === 1) {
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start()
          lastTranslate.current = { x: 0, y: 0 }
          translateX.setValue(0)
          translateY.setValue(0)
          setFlatScrollEnabled(true)
          setPanEnabled(false)
        } else {
          setFlatScrollEnabled(false)
          setPanEnabled(true)
        }
      })

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd(() => {
        const next = lastScale.current > 1 ? 1 : 2.5
        lastScale.current = next
        Animated.spring(scale, { toValue: next, useNativeDriver: true }).start()
        if (next === 1) {
          lastTranslate.current = { x: 0, y: 0 }
          translateX.setValue(0)
          translateY.setValue(0)
        }
        setFlatScrollEnabled(next === 1)
        setPanEnabled(next !== 1)
      })

    // Disabled at 1× so the pan recogniser doesn't compete with FlatList's
    // own swipe-to-navigate recogniser.
    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(panEnabled)
      .onUpdate(e => {
        translateX.setValue(lastTranslate.current.x + e.translationX)
        translateY.setValue(lastTranslate.current.y + e.translationY)
      })
      .onEnd(e => {
        lastTranslate.current = {
          x: lastTranslate.current.x + e.translationX,
          y: lastTranslate.current.y + e.translationY,
        }
      })

    return Gesture.Simultaneous(pinch, doubleTap, pan)
  }, [panEnabled])

  if (index === null) return null

  return (
    <Modal visible={index !== null} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={vS.screen}>
          <FlatList
            ref={flatRef}
            data={images}
            keyExtractor={(img) => img.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={flatScrollEnabled}
            style={StyleSheet.absoluteFill}
            getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth)
              if (newIndex >= 0 && newIndex < images.length) {
                resetTransform()
                onChangeIndex(newIndex)
              }
            }}
            renderItem={({ item }) => (
              <GestureDetector gesture={zoomGesture}>
                <View style={{ width: screenWidth, height: screenHeight, justifyContent: 'center', alignItems: 'center' }}>
                  <Animated.Image
                    source={{ uri: item.uri }}
                    style={{
                      width: screenWidth, height: screenHeight,
                      transform: [{ scale }, { translateX }, { translateY }],
                    }}
                    resizeMode="contain"
                  />
                </View>
              </GestureDetector>
            )}
          />

          <TouchableOpacity style={[vS.closeBtn, { top: insets.top + 12 }]} onPress={onClose}>
            <Text style={vS.closeBtnText}>✕</Text>
          </TouchableOpacity>

          <View style={[vS.caption, { top: insets.top + 16 }]}>
            <Text style={vS.captionText} numberOfLines={1}>{images[index]?.label || `Floor ${index + 1}`}</Text>
            <Text style={vS.counterText}>{index + 1} / {images.length}  ·  pinch or double-tap to zoom</Text>
          </View>

          {images.length > 1 && (
            <>
              {index > 0 && (
                <TouchableOpacity style={[vS.navBtn, vS.navLeft]} onPress={() => { resetTransform(); onChangeIndex(index - 1) }}>
                  <Text style={vS.navText}>‹</Text>
                </TouchableOpacity>
              )}
              {index < images.length - 1 && (
                <TouchableOpacity style={[vS.navBtn, vS.navRight]} onPress={() => { resetTransform(); onChangeIndex(index + 1) }}>
                  <Text style={vS.navText}>›</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list:   { padding: spacing.md, paddingBottom: 100 },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: 80, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.textMid },
  emptySubtitle: { fontSize: font.sm, color: colors.textLight, textAlign: 'center' },
  row: {
    flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm,
  },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.muted },
  rowMain: { flex: 1, justifyContent: 'space-between' },
  labelInput: {
    fontSize: font.md, fontWeight: '600', color: colors.text,
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4,
  },
  rowActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  iconBtn: { padding: 4 },
  iconBtnText: { fontSize: font.lg, color: colors.primary },
  iconBtnTextDisabled: { color: colors.textLight },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
  },
  addBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  addBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
})

const vS = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  caption: {
    position: 'absolute', left: 16, right: 64, alignItems: 'flex-start',
  },
  captionText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  counterText: { color: 'rgba(255,255,255,0.75)', fontSize: font.xs, marginTop: 2 },
  navBtn: {
    position: 'absolute', top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  navLeft:  { left: 10 },
  navRight: { right: 10 },
  navText:  { color: '#fff', fontSize: 26, fontWeight: '300', marginTop: -2 },
})
