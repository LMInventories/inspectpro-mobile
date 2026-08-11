# Floor Plan Feature — Implementation Plan

Adapted from the original 16-phase / 10-milestone plan, with this codebase's actual file paths,
existing patterns to reuse, and blockers called out against the milestones they affect. See
`ARCHITECTURE.md` in this directory for the full findings this plan is based on.

**Status: Phase 0 complete. Blockers 1 and 2 spiked and resolved (see below). No scanner code or
data model changes have been made. Milestone 1 has not started.**

## Blockers to resolve before Milestone 1

Blockers 1 and 2 have been spiked and resolved (see below); the rest are still open — each names
the milestone(s) it blocks.

1. ~~**Prebuild-destructive CI**~~ — **RESOLVED.** Spiked with a throwaway config plugin
   (`withFloorPlanArCoreSpike.js`, since removed) that injected a native Kotlin source file and the
   real ARCore `AndroidManifest.xml` `<meta-data>` entry. Ran `expo prebuild --platform android
   --clean` twice in a row; both injections survived identically both times alongside the existing
   `withKotlinBuildFix.js`, with no conflicts. **Confirmed**: the ARCore native module can ship as
   an Expo config plugin using the same `@expo/config-plugins` primitives (`withDangerousMod`,
   `withAndroidManifest`, etc.) `withKotlinBuildFix.js` already uses, and it will reliably survive
   CI's wipe-and-regenerate prebuild step.
2. ~~**No working dev-client loop**~~ — **RESOLVED** (as far as verifiable without a physical
   device). Installed `expo-dev-client` (`~55.0.37`, via `npx expo install` for SDK-55
   compatibility). Confirmed: `postinstall` Gradle patches and `expo prebuild --clean` both still
   succeed with it present, and Expo's native autolinking resolver (`npx expo-modules-autolinking
   resolve --platform android`) correctly detects `expo-dev-client`, `expo-dev-launcher`,
   `expo-dev-menu`, and `expo-dev-menu-interface` as linkable modules. Added
   `.github/workflows/build-dev-client.yml` — an on-demand (`workflow_dispatch`-only) build
   mirroring `build-android.yml` exactly but producing a debug/dev-client APK published as a
   marked prerelease. **Not yet done**: nobody has triggered that workflow and sideloaded the
   result to a real device to confirm the dev-client menu actually connects to a local Metro
   bundler — do that before relying on this loop for real native-module iteration.
3. **Camera session hand-off** (blocks Milestone 2 onward — needed as soon as scanning UI exists).
   `react-native-vision-camera` owns the camera today; ARCore needs exclusive access during a scan.
   No existing precedent for releasing/re-acquiring a camera session in this app.
4. **Sideloaded APK distribution, not Play Store** (blocks Milestone 1 device testing). ARCore
   ("AR Optional") needs "Google Play Services for AR" on-device; the app must runtime-check via
   `ArCoreApk.checkAvailability()` and prompt a Play Store install/update if missing. Should work
   on consumer Samsung/Honor/OnePlus devices with normal Play Store access, but hasn't been
   confirmed on the actual target devices.
5. **Test device access** (blocks Milestone 1-4 validation). Target devices: Galaxy S21 Ultra
   (primary), Honor Magic V3, OnePlus 13. Physical availability not yet confirmed.
6. **ARCore SDK / toolchain compatibility** (blocks Milestone 1). This project pins Gradle 8.13,
   AGP 8.9.1, Kotlin 2.0.21 (via the existing config-plugin patches) — not yet checked against
   ARCore SDK's minimum requirements.

## Non-negotiable rules (carried over unchanged)

- Inspect before changing; don't rewrite unrelated functionality.
- Reuse existing auth, inspection, photo, storage, and report infrastructure — see the reuse
  targets called out per phase below.
- Never store raw scan binaries in Postgres — S3, following the `photos.py` presign pattern (with
  private ACLs, unlike today's public photo uploads — see blocker in `ARCHITECTURE.md`).
- Floor plan stays structured geometry (dedicated tables), never "just a PNG."
- AI provider calls stay behind an abstraction (`FloorPlanAIService`); never used for exact
  measurement or final rendering.
- Manual inspector correction is required; offline scanning and resumable upload are required.
- Detect ARCore/device capability at runtime; never assume identical support across devices.
- Preserve the existing GitHub Actions/Releases pipeline; extend it only where the native build
  genuinely requires it (e.g. ARCore Gradle dependency, NDK if needed).
- Implement milestone-by-milestone. Estimate AI cost per inspection before adding any paid API call.

## Milestones

### Milestone 1 — Native ARCore scanner
Native Android module (Kotlin, Expo Modules API) exposing `startScan`/`pauseScan`/`resumeScan`/
`stopScan`/`cancelScan` plus progress/tracking/warning/completion/failure events, delivered via a
new config plugin. Collects camera frames, timestamps, pose, depth, planes, point cloud (where
available), orientation, camera intrinsics. Runtime capability detection per device — do not
assume Galaxy S21 Ultra, Honor Magic V3, and OnePlus 13 support identical ARCore/depth features.
**Blocked by**: blockers 1, 2, 4, 5, 6 above. **Success criteria**: S21 Ultra scans one room and
produces usable raw depth/pose data.

### Milestone 2 — Single-room geometry
Convert camera poses + depth/point-cloud data into wall geometry — walls, intersections, room
boundary, dimensions, with retained uncertainty/error info. Runs backend-side (new processing
pipeline, not in the mobile app). **Blocked by**: blocker 3 (scanning UI needs the camera hand-off
solved). **Success criteria**: recognisable 2D room outline generated.

### Milestone 3 — Measurement/calibration
Inspector enters one or more known real-world measurements (e.g. a wall length) to correct scale.
Clearly distinguish measured vs. estimated values in the data model. **Success criteria**: an
accuracy threshold is established and tested against it.

### Milestone 4 — Multiple rooms
Scan connected rooms through doorways; stitch geometry across the property. **Success criteria**:
multi-room scan produces a connected layout.

### Milestone 5 — AI room classification
New `FloorPlanAIService` abstraction (reusing the Claude-based classification pattern and
`TranscriptionUsage`-style cost logging already established in `backend/routes/transcribe.py`).
Classifies rooms (living room, kitchen, bedroom, bathroom, hallway, study, utility, garage, WC)
from representative images — not every scan frame. **Success criteria**: rooms classified with
confidence scores.

### Milestone 6 — Doors/windows/fixtures
Extend the same AI service to detect likely doors, windows, and fixtures from representative
images. **Success criteria**: common openings and fixtures added to the model.

### Milestone 7 — Interactive editing
In-app editor: room renaming/correction, wall move/resize, add/delete/move doors and windows, edit
door direction and fixture positions, edit dimensions, undo/redo. Inspector approval required
before a plan becomes the report version (new `FloorPlan.approved_at`/`approved_by` fields).
**Success criteria**: inspector can correct a generated plan end-to-end.

### Milestone 8 — Professional rendering
Deterministic SVG renderer (source of truth) with PNG/PDF export — never an image-generation
model. UK estate-agent style: walls, doors, windows, stairs, fixtures, room labels, dimensions,
north arrow, property/InspectPro branding. **Success criteria**: SVG/PNG/PDF output matches the
target style.

### Milestone 9 — Report integration
This is where the original narrower request (button + storage + PDF placement) lands:
- **Mobile**: "Create Floorplan" entry point on `PropertyOverviewScreen.tsx`, below the
  Finalise Inspection button (reuses the existing `DetailRow`/button styling already in that
  screen — see `ARCHITECTURE.md`'s note on existing screen patterns). Becomes "View Floorplan"
  once a `FloorPlan` record exists for the inspection.
- **Backend**: new `FloorPlan` table (FK to `inspection_id`), rendered PNG/PDF stored in S3 (private,
  following the presign pattern in `photos.py`, adapted for private ACLs).
- **PDF report**: new section inserted between `_disclaimer()` and `_fixed_sections()` in
  `pdf_generator.py`'s `_build_story()` (confirmed exact insertion point in `ARCHITECTURE.md`),
  skipped for Heads-Up/midterm reports consistent with how `_rooms()` is already skipped.
- **Webapp**: new floor-plan section in the desktop report editor (`InspectionReportView.vue`),
  displaying the final 2D image, following the existing pattern for other report sections.
- Track floor-plan version, approval time/user, and rendered file references; integrate with
  existing report regeneration if a plan changes post-generation.
**Success criteria**: an approved plan appears in the generated PDF and webapp report.

### Milestone 10 — Production hardening
Offline capture, resumable/retry upload, signed URLs, encryption in transit, secure deletion,
configurable raw-scan retention, performance (no UI freeze during scanning, RAM/battery/storage
monitoring), and full device-matrix testing (S21 Ultra, Honor Magic V3, OnePlus 13) across ARCore
availability, depth support, scan stability, multi-room scanning, uploads, offline capture,
processing, review/editing, and report generation. **Success criteria**: passes the device test
matrix and accuracy test (manually measured walls/doors/windows vs. scanned values, with recorded
absolute/percentage error) before any precision claims are made.

## Cost control

- ARCore/device-side scanning: no AI API call required.
- Only representative images go to the vision model, not every frame — mirrors how
  `transcribe.py` already avoids sending full audio/video where a summary suffices.
- `FloorPlanAIService` stays provider-abstracted (the existing OpenAI/Anthropic split in
  `transcribe.py` is the template) so the provider can change later without touching callers.
- Track provider, model, tokens, and estimated cost per inspection via a new usage-logging model,
  following `TranscriptionUsage`'s shape.
- Raw scan retention should be configurable (a setting, not hardcoded) so storage costs don't grow
  unbounded — same spirit as the existing `SystemSetting` pattern used elsewhere in the backend.

## Next step

Blockers 1 and 2 are resolved. Before Milestone 1 begins: (a) trigger
`.github/workflows/build-dev-client.yml` and sideload the result to a real device to confirm the
dev-client loop actually works end-to-end (not just "prebuild succeeds"), and (b) confirm test
device availability (blocker 5) and check ARCore SDK compatibility against this project's pinned
Gradle 8.13 / AGP 8.9.1 / Kotlin 2.0.21 (blocker 6) — neither has been done yet. Blockers 3
(camera hand-off) and 4 (Play Store / ARCore availability check) remain design questions for
Milestone 1-2, not yet started.
