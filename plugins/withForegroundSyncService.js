/**
 * withForegroundSyncService.js
 *
 * react-native-background-actions runs the sync inside an Android foreground
 * service so uploads keep going with the screen off / the phone in a pocket.
 * Targeting Android 14+ (we target SDK 35) requires that service to declare a
 * foreground-service type and the matching permissions, which the library's own
 * manifest does not do. We declare `dataSync` (uploading user data).
 *
 * The attribute merges onto the library's <service> entry of the same name.
 */
const { withAndroidManifest } = require('@expo/config-plugins')

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask'
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.WAKE_LOCK',
]

module.exports = function withForegroundSyncService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest

    if (!manifest['uses-permission']) manifest['uses-permission'] = []
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$?.['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } })
      }
    }

    const app = manifest.application?.[0]
    if (!app) {
      console.warn('[withForegroundSyncService] No <application> tag — skipping service declaration')
      return config
    }
    if (!app.service) app.service = []
    let svc = app.service.find((s) => s.$?.['android:name'] === SERVICE)
    if (!svc) {
      svc = { $: { 'android:name': SERVICE } }
      app.service.push(svc)
    }
    svc.$['android:foregroundServiceType'] = 'dataSync'
    svc.$['android:exported'] = 'false'
    return config
  })
}
