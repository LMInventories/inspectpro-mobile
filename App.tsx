import React, { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { StatusBar, View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuthStore } from './src/stores/authStore'
import { initDatabase } from './src/services/database'
import { useNetworkStatus } from './src/hooks/useNetworkStatus'
import { lightColors } from './src/utils/theme'
import { registerBackgroundSyncTask } from './src/tasks/backgroundSync'
import FlashToast from './src/components/FlashToast'
import { useSyncStore } from './src/stores/syncStore'
import { useToastStore } from './src/stores/toastStore'
import { setupNotifications } from './src/services/notificationService'
import { checkApiStatuses } from './src/services/apiStatusService'

import LoginScreen from './src/screens/LoginScreen'
import InspectionListScreen from './src/screens/InspectionListScreen'
import FetchInspectionsScreen from './src/screens/FetchInspectionsScreen'
import PropertyOverviewScreen from './src/screens/PropertyOverviewScreen'
import RoomSelectionScreen from './src/screens/RoomSelectionScreen'
import RoomInspectionScreen from './src/screens/RoomInspectionScreen'
import ItemGalleryScreen from './src/screens/ItemGalleryScreen'
import SyncScreen from './src/screens/SyncScreen'
import CameraScreen from './src/screens/CameraScreen'
import AdminPanelScreen from './src/screens/AdminPanelScreen'

export type RootStackParamList = {
  Login: undefined
  InspectionList: undefined
  FetchInspections: undefined
  PropertyOverview: { inspectionId: number }
  RoomSelection: { inspectionId: number }
  RoomInspection: {
    inspectionId: number
    sectionKey: string
    sectionName: string
    sectionType: 'room' | 'fixed'
    templateSectionId?: number
    fixedSectionData?: string  // JSON stringified fixed section for 'fixed' type
    sectionIndex?: number      // 1-based position of this section in the template (for photo labels)
  }
  ItemGallery: {
    inspectionId: number
    sectionKey:   string   // current room's key
    sectionName:  string   // current room's display name
    itemKey:      string
    itemName:     string
    itemPosition?: string  // e.g. "2.4" — section.item for display label
  }
  Camera: {
    inspectionId: number
    // Gallery context — passed so the thumbnail can link straight to ItemGallery
    sectionKey?:  string
    sectionName?: string
    itemKey?:     string
    itemName?:    string
  }
  Sync: undefined
  AdminPanel: undefined
}

const Stack = createStackNavigator<RootStackParamList>()

// ── Offline banner ────────────────────────────────────────────────────────────
function OfflineBanner() {
  return (
    <View style={bannerStyles.offlineBanner}>
      <Text style={bannerStyles.offlineText}>⚠️  No connection — working offline</Text>
    </View>
  )
}

// ── Global sync progress banner ───────────────────────────────────────────────
function SyncProgressBanner() {
  const { syncing, syncIndex, syncTotal, progress } = useSyncStore()
  const insets = useSafeAreaInsets()
  if (!syncing) return null

  let label = `Syncing ${syncIndex}/${syncTotal}…`
  if (progress) {
    if (progress.phase === 'photos')   label = `Syncing ${syncIndex}/${syncTotal} — photos ${progress.done}/${progress.total}`
    if (progress.phase === 'audio')    label = `Syncing ${syncIndex}/${syncTotal} — audio ${progress.done}/${progress.total}`
    if (progress.phase === 'uploading') label = `Syncing ${syncIndex}/${syncTotal} — uploading…`
    if (progress.phase === 'retrying') label = `Syncing ${syncIndex}/${syncTotal} — retrying…`
  }

  return (
    <View style={[bannerStyles.syncBanner, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="none">
      <ActivityIndicator color="#a5f3fc" size="small" />
      <Text style={bannerStyles.syncText}>{label}</Text>
    </View>
  )
}

const bannerStyles = StyleSheet.create({
  offlineBanner: {
    backgroundColor: '#92400e',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fef3c7',
    fontSize: 13,
    fontWeight: '600',
  },
  syncBanner: {
    position:         'absolute',
    bottom:           0,
    left:             0,
    right:            0,
    backgroundColor:  '#0f172a',
    paddingVertical:  10,
    paddingHorizontal: 16,
    flexDirection:    'row',
    alignItems:       'center',
    gap:              10,
    zIndex:           9000,
    borderTopWidth:   1,
    borderTopColor:   'rgba(99,102,241,0.4)',
  },
  syncText: {
    color:      '#a5f3fc',
    fontSize:   13,
    fontWeight: '600',
    flex:       1,
  },
})

// ── AI API status check ────────────────────────────────────────────────────────
// Runs once in the background at launch — flashes a quick "all good" toast, or
// pops an Alert naming whichever provider(s) are degraded, so clerks know
// upfront whether AI transcription is likely to work before they start dictating.
async function checkAiApiStatusOnLaunch() {
  try {
    const result = await checkApiStatuses()
    if (!result || !result.checked) return  // offline — skip silently

    if (result.allOperational) {
      useToastStore.getState().showToast('OpenAI & Anthropic: fully operational', 'success')
      return
    }

    const degraded = [result.openai, result.anthropic].filter(p => !p.operational)
    const lines = degraded.map(p => `${p.name}: ${p.description}`).join('\n')
    Alert.alert(
      'AI Service Notice',
      `${lines}\n\nAI transcription may be slow or unavailable until this clears.`
    )
  } catch (err) {
    console.warn('[App] AI API status check failed (non-fatal):', err)
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, initAuth } = useAuthStore()
  const [dbReady, setDbReady]         = useState(false)
  const { isOnline } = useNetworkStatus()

  useEffect(() => {
    async function bootstrap() {
      initDatabase()
      await initAuth()
      setDbReady(true)
      // Register background sync task — best-effort, non-blocking
      registerBackgroundSyncTask().catch(() => {})
      setupNotifications().catch(() => {})  // request notification permission
      checkAiApiStatusOnLaunch()  // background — flashes/alerts once ready, non-blocking
    }
    bootstrap()
  }, [])

  if (!dbReady) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="dark-content"
          backgroundColor={lightColors.background}
        />
        {!isOnline && <OfflineBanner />}
        <NavigationContainer>
          <Stack.Navigator screenOptions={{
            headerShown: false,
            cardStyle: { backgroundColor: lightColors.background },
          }}>
            {!isAuthenticated ? (
              <Stack.Screen name="Login" component={LoginScreen} />
            ) : (
              <>
                <Stack.Screen name="InspectionList"    component={InspectionListScreen} />
                <Stack.Screen name="FetchInspections"  component={FetchInspectionsScreen} />
                <Stack.Screen name="PropertyOverview"  component={PropertyOverviewScreen} />
                <Stack.Screen name="RoomSelection"     component={RoomSelectionScreen} />
                <Stack.Screen name="RoomInspection"    component={RoomInspectionScreen} />
                <Stack.Screen name="ItemGallery"       component={ItemGalleryScreen} />
                <Stack.Screen name="Camera"            component={CameraScreen} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="Sync"              component={SyncScreen} />
                <Stack.Screen name="AdminPanel"        component={AdminPanelScreen} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
        {/* Global overlays — rendered above all screens */}
        <SyncProgressBanner />
        <FlashToast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
