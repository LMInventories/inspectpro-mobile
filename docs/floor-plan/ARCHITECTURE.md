# Floor Plan Feature — Architecture Assessment (Phase 0)

This document is the Phase 0 deliverable for the floor-plan scanning feature: an inspection of the
current InspectPro architecture, written before any scanner code exists. It exists so future work
(this codebase's first native Android module) starts from an accurate picture instead of assumptions.

No code, dependencies, or data model changes were made to produce this document. See
`IMPLEMENTATION_PLAN.md` in this same directory for the phased roadmap and blocker list this
assessment feeds into.

## Repo map

Two repos, two deploy targets:

- **`inspectpro-mobile`** (this repo) — React Native/Expo app, Android only, used by clerks in the field.
- **`lmsoftware`** — Flask backend + Vue 3 webapp, shared by both the mobile app and desktop report editor.

## Mobile app: Expo / React Native

- `expo ~55.0.0` (resolved `55.0.8`), `react-native 0.83.2`, `react 19.2.0`, `newArchEnabled: true` (`app.json`).
- **Bare workflow, not managed.** A full `android/` directory exists in the repo and is git-tracked,
  but it is **not the real source of truth** — CI regenerates it from scratch on every build via
  `expo prebuild --platform android --clean` (see CI section below). Evidence: the checked-in copy
  still has stale `com.helloworld` package names under
  `android/app/src/main/java/com/inspectpro/`, left over from an old template and mismatched with
  the real package `uk.co.lminventories.inspectpro` — nobody maintains the committed copy by hand.
- **No `expo-dev-client` package installed**, despite `eas.json`'s `development` build profile
  setting `developmentClient: true`. This is a gap (see blocker 2 in `IMPLEMENTATION_PLAN.md`).
- Two existing Expo config plugins already do native-level customization at prebuild time:
  - `plugins/withKotlinBuildFix.js` — patches Gradle/AGP/Kotlin versions post-prebuild.
  - `scripts/eas-gradle-patch.js` — invoked from `postinstall`, `postprebuild`, and
    `eas-build-post-install` npm scripts; does similar Gradle patching.
  This is real prior experience modifying the native build via config plugins — the same mechanism
  an ARCore integration would need to use (see below).
- Pinned native toolchain (from the patches above): **Gradle 8.13, AGP 8.9.1, Kotlin 2.0.21**.
  Any ARCore SDK version must be checked against these before adoption — not yet verified.

## CI/CD: GitHub Actions → GitHub Releases

Single workflow, `.github/workflows/build-android.yml`:

1. Triggers on push to `main`/`master`, or manual `workflow_dispatch`.
2. `npm install --legacy-peer-deps` (flag exists because `react-native-vision-camera` lists
   `reanimated` as a peer dep that's deliberately not installed — "photo-only use").
3. `npx expo prebuild --platform android --clean` — **this is the step that wipes `android/`**.
4. Forces the Gradle wrapper to `8.13`, then runs `scripts/eas-gradle-patch.js`.
5. Writes `android/local.properties`, builds with `./gradlew assembleRelease --no-daemon` — a
   **local Gradle build, not `eas build`**. `eas.json` exists and defines profiles, but nothing in
   this pipeline invokes EAS.
6. Publishes the resulting `app-release.apk` straight to a **GitHub Release** (tag
   `build-${{ github.run_number }}`) via `softprops/action-gh-release`.

No signing/keystore secrets are referenced — the release build is unsigned or signed with the
committed debug keystore. **No Play Store distribution** — installs are sideloaded APKs from
GitHub Releases. This matters for ARCore distribution (see blocker 4 in the implementation plan).

## Native module precedent

**None.** No `modules/` directory, no `NativeModules` or `ExpoModulesCore` usage anywhere in `src/`.
Every native-Android touchpoint today is either Expo/RN-generated boilerplate or the Gradle-level
config-plugin patches described above. An ARCore native module would be **the first custom native
Android code in this app.**

## Camera

- `react-native-vision-camera ^4.0.0` is the camera library already in use for inspection photo
  capture (not `expo-camera`).
- `app.json`'s `android.permissions` already includes `CAMERA`, `RECORD_AUDIO`, and storage/media
  permissions.
- ARCore requires its own exclusive `Session`/`Frame` camera access during a scan — vision-camera's
  session will need to be released while the floor-plan scan screen is active, and re-acquired
  cleanly afterward. No existing precedent for this hand-off in the codebase.

## Data model (backend — `lmsoftware/backend/models.py`)

- **`Property`** (line 101): `id`, `client_id` (FK), `address`, `property_type`, `bedrooms`,
  `bathrooms`, `furnished`, `parking`, `garden`, `elevator`, `detachment_type`, `elevation`,
  `meter_electricity/gas/heat/water`, `notes`, `overview_photo` (legacy base64, being migrated to
  S3 URLs), `created_at`. **No floor-plan/layout field exists today.**
- **`Inspection`** (line 165): `property_id` (FK), `source_inspection_id` (self-referential FK,
  used for check-out-from-check-in prefill), `drive_file_id`, `source_pdf_drive_file_id`,
  `pdf_import`, `conduct_date`, plus the usual status/assignment fields.
- **`TranscriptionFillDiff`** (line 427) — precedent for breaking structured, queryable data out
  into its own table rather than burying it in the `report_data` JSON blob, once that data needs
  more than flat key-value storage. A `FloorPlan` table (see implementation plan) should follow
  this precedent rather than adding a `_floorplan` key to `report_data`.

## Asset storage: S3 is primary, Drive is not

Two storage backends exist; they serve different purposes and neither is a drop-in fit for raw
scan binaries without adaptation:

- **S3** (`backend/utils/s3.py`) — the primary store for durable, report-referenced assets.
  Inspection photos go through `backend/routes/photos.py`: the mobile app requests a **presigned
  PUT URL** (`presign_put`, 15 min expiry) and uploads the JPEG **directly to S3**, bypassing Flask
  entirely — this keeps sync payloads small (~50KB vs ~18MB of base64 per photo). Stored URLs are
  plain public HTTPS (`public_url()`), e.g. `https://{bucket}.s3.{region}.amazonaws.com/inspections/{id}/photos/{uuid}.jpg`,
  embedded directly into `report_data`'s `_photos` arrays. `presign_get` exists for signed/private
  reads but nothing currently calls it — everything today is public.
  Exported functions: `is_configured`, `get_bucket`, `public_url`, `new_key`, `is_s3_url`,
  `is_base64_uri`, `upload_bytes`, `upload_base64`, `presign_put`, `presign_get`, `list_objects`,
  `delete_object`.
- **Google Drive** (`backend/services/google_drive.py`) — OAuth-based, used **only** to export
  finished PDF reports (and, as of a recent change, the original PDF an inspection was imported
  from) into an `InspectPro Reports/{Client}/{Property}/` folder tree. It's an archival delivery
  destination the clerk/client can browse, not an asset store `report_data` ever references. Not a
  fit for scan packages.

The floor-plan scanning plan explicitly requires signed/private uploads and configurable retention
for raw scan binaries (see `IMPLEMENTATION_PLAN.md` Phase 5/15) — this means the **existing public
`presign_put` pattern in `photos.py` is not sufficient as-is**; a scan-specific upload path using
`presign_put`/`presign_get` with private ACLs (or a separate bucket/prefix) is needed.

## PDF report generation (`backend/routes/pdf_generator.py`)

`_build_story()` (line 821) assembles the report in this order:

```
_cover()
  → (Heads-Up Reports stop here: _fixed_sections() only, no disclaimer/rooms/floor plan)
_contents()
_disclaimer()                              ← line 832
_action_summary()  (check-out, if act_pos == 'top')
_fixed_sections()                          ← line 835 ("Condition Summary" is its first entry)
_rooms()                                   (skipped for midterm reports)
_action_summary()  (check-out, if act_pos == 'bottom')
_signatures_page()
```

A floor-plan section slots cleanly between `_disclaimer()` (832) and `_fixed_sections()` (835),
with its own anchor added alongside the existing entries in `_contents()`. It should be **skipped
for Heads-Up Reports** (the `is_heads_up` early-return at line 827-830 already skips disclaimer and
rooms — a floor plan belongs in that same "full report only" category) and for midterm reports if
the same reasoning that excludes `_rooms()` applies. This confirms the exact PDF placement
originally requested (after Disclaimers, before Condition Summary) is realistic once the feature
reaches Milestone 9.

## AI integration precedent (`backend/routes/transcribe.py`)

Mature, already-in-production pattern for Claude-based classification/extraction with per-call cost
logging via the `TranscriptionUsage` model (provider, model, input/output tokens, linked to
inspection + user). A `FloorPlanAIService` for room/fixture classification (implementation plan
Phase 7) is a natural extension of this existing pattern — not new territory, low risk.

## Offline / sync architecture (mobile)

Local-first: SQLite (`src/services/database.ts`) holds inspection state and a sync queue; photos
and audio recordings are captured and stored locally first, then uploaded via the S3 presign flow
(photos) or a dedicated recordings upload path (audio) during an explicit sync pass
(`src/services/syncService.ts`, `src/stores/syncStore.ts`). Any floor-plan scan package will need
to follow the same "capture locally, queue, upload with retry" shape already established here,
per Phase 4/14 of the implementation plan (local scan package, resumable upload, offline capture).
