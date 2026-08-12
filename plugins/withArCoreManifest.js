/**
 * withArCoreManifest.js
 *
 * Injects the <meta-data android:name="com.google.ar.core" android:value="optional">
 * entry ARCore requires in AndroidManifest.xml. "optional" (not "required") because
 * this app must still run on devices without ARCore support — the floor-plan scan
 * entry point is offered conditionally based on FloorPlanScannerModule.checkAvailability().
 *
 * Uses the same @expo/config-plugins primitives already established in
 * plugins/withKotlinBuildFix.js — validated to survive `expo prebuild --clean`
 * during the blocker-1 spike (see docs/floor-plan/IMPLEMENTATION_PLAN.md).
 */

const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withArCoreManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest

    // <uses-feature> — top-level manifest child, sibling of <application>.
    // required="false" for the same "AR Optional" reasoning as the meta-data below.
    if (!manifest['uses-feature']) manifest['uses-feature'] = []
    const hasArFeature = manifest['uses-feature'].find(
      (f) => f.$?.['android:name'] === 'android.hardware.camera.ar'
    )
    if (!hasArFeature) {
      manifest['uses-feature'].push({
        $: {
          'android:name':     'android.hardware.camera.ar',
          'android:required': 'false',
        },
      })
      console.log('[withArCoreManifest] Injected android.hardware.camera.ar uses-feature (required=false)')
    } else {
      console.log('[withArCoreManifest] android.hardware.camera.ar uses-feature already present — skipping')
    }

    const app = manifest.application?.[0]
    if (!app) {
      console.warn('[withArCoreManifest] No <application> tag found — skipping meta-data patch')
      return config
    }
    if (!app['meta-data']) app['meta-data'] = []

    const already = app['meta-data'].find(
      (m) => m.$?.['android:name'] === 'com.google.ar.core'
    )
    if (already) {
      console.log('[withArCoreManifest] com.google.ar.core meta-data already present — skipping')
      return config
    }

    app['meta-data'].push({
      $: {
        'android:name':  'com.google.ar.core',
        'android:value': 'optional',
      },
    })
    console.log('[withArCoreManifest] Injected com.google.ar.core meta-data (optional) into AndroidManifest.xml')
    return config
  })
}
