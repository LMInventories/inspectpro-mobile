import * as SQLite from 'expo-sqlite'
import * as FileSystem from 'expo-file-system'
import { copyClipToSaveLocation } from './audioSaveLocation'

const db = SQLite.openDatabaseSync('inspectpro.db')

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      report_data TEXT,
      status TEXT NOT NULL DEFAULT 'assigned',
      local_status TEXT NOT NULL DEFAULT 'downloaded',
      downloaded_at TEXT NOT NULL,
      updated_at TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audio_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id INTEGER NOT NULL,
      section_key TEXT NOT NULL,
      section_name TEXT NOT NULL DEFAULT '',
      item_key TEXT,
      item_name TEXT,
      label TEXT NOT NULL DEFAULT '',
      file_uri TEXT NOT NULL,
      duration_ms INTEGER,
      transcription TEXT,
      created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `)

  // Migrations — safe to run repeatedly (errors silently ignored)
  try { db.runSync("ALTER TABLE audio_recordings ADD COLUMN section_name TEXT NOT NULL DEFAULT ''") } catch {}
  try { db.runSync('ALTER TABLE audio_recordings ADD COLUMN item_name TEXT') } catch {}
  try { db.runSync("ALTER TABLE audio_recordings ADD COLUMN label TEXT NOT NULL DEFAULT ''") } catch {}
  try { db.runSync('ALTER TABLE inspections ADD COLUMN is_finalised INTEGER NOT NULL DEFAULT 0') } catch {}
  // Per-inspection typist mode — overrides the clerk-level global setting.
  // Null means "inherit from clerk profile".  Stored as TEXT: 'ai_instant'|'ai_room'|'human'
  try { db.runSync('ALTER TABLE inspections ADD COLUMN typist_mode TEXT') } catch {}
  // Source check-in report_data cached at CO download time so CI photos are
  // available offline without a network call during the inspection.
  try { db.runSync('ALTER TABLE inspections ADD COLUMN source_report_data TEXT') } catch {}
  // Conflict detection: the server-side updated_at when this inspection was last
  // downloaded or synced.  Sent on next sync so the server can reject if someone
  // else has made a change in the meantime (HTTP 409).
  try { db.runSync('ALTER TABLE inspections ADD COLUMN server_updated_at TEXT') } catch {}
  // Idempotency key: a UUID sent with every sync request so the server can safely
  // deduplicate retries without double-applying changes.
  try { db.runSync('ALTER TABLE inspections ADD COLUMN idempotency_key TEXT') } catch {}
  // Per-inspection camera option: 'perItem' (default) | 'floating'
  try { db.runSync('ALTER TABLE inspections ADD COLUMN camera_option TEXT') } catch {}
}

export function saveInspection(inspection: any, defaultCameraOption?: string | null, defaultTypistMode?: string | null): void {
  const existing = db.getFirstSync<{ id: number }>(
    'SELECT id FROM inspections WHERE id = ?', [inspection.id]
  )
  const now = new Date().toISOString()
  const serverUpdatedAt = inspection.updated_at || null
  if (existing) {
    db.runSync(
      'UPDATE inspections SET data = ?, report_data = ?, source_report_data = ?, status = ?, updated_at = ?, server_updated_at = ? WHERE id = ?',
      [JSON.stringify(inspection), inspection.report_data || null, inspection.source_report_data || null, inspection.status, now, serverUpdatedAt, inspection.id]
    )
  } else {
    // Server-resolved typist_mode wins if present; otherwise apply user default
    const effectiveTypist = inspection.typist_mode ?? defaultTypistMode ?? null
    db.runSync(
      `INSERT INTO inspections (id, data, report_data, source_report_data, status, local_status, downloaded_at, updated_at, synced, server_updated_at, typist_mode, camera_option)
       VALUES (?, ?, ?, ?, ?, 'downloaded', ?, ?, 0, ?, ?, ?)`,
      [inspection.id, JSON.stringify(inspection), inspection.report_data || null, inspection.source_report_data || null, inspection.status, now, now, serverUpdatedAt, effectiveTypist, defaultCameraOption ?? null]
    )
  }
}

export function getLocalInspections(): any[] {
  const rows = db.getAllSync<{
    data: string; report_data: string | null; source_report_data: string | null;
    local_status: string; synced: number; is_finalised: number; typist_mode: string | null;
    camera_option: string | null; server_updated_at: string | null; idempotency_key: string | null;
  }>('SELECT data, report_data, source_report_data, local_status, synced, is_finalised, typist_mode, camera_option, server_updated_at, idempotency_key FROM inspections ORDER BY downloaded_at DESC')
  return rows.map(r => {
    const base = JSON.parse(r.data)
    return {
      ...base,
      report_data:        r.report_data,
      source_report_data: r.source_report_data,
      local_status:       r.local_status,
      synced:             r.synced === 1,
      is_finalised:       r.is_finalised === 1,
      typist_mode:        r.typist_mode ?? base.typist_mode ?? null,
      local_typist_override: r.typist_mode ?? null,
      camera_option:      r.camera_option ?? null,
      server_updated_at:  r.server_updated_at,
      idempotency_key:    r.idempotency_key,
    }
  }).sort((a, b) => {
    if (!a.conduct_date && !b.conduct_date) return 0
    if (!a.conduct_date) return 1
    if (!b.conduct_date) return -1
    return new Date(a.conduct_date).getTime() - new Date(b.conduct_date).getTime()
  })
}

export function getLocalInspection(id: number): any | null {
  const r = db.getFirstSync<{
    data: string; report_data: string | null; source_report_data: string | null;
    local_status: string; synced: number; is_finalised: number; typist_mode: string | null;
    camera_option: string | null; server_updated_at: string | null; idempotency_key: string | null;
  }>('SELECT data, report_data, source_report_data, local_status, synced, is_finalised, typist_mode, camera_option, server_updated_at, idempotency_key FROM inspections WHERE id = ?', [id])
  if (!r) return null
  const base = JSON.parse(r.data)
  return {
    ...base,
    report_data:        r.report_data,
    source_report_data: r.source_report_data,
    local_status:       r.local_status,
    synced:             r.synced === 1,
    is_finalised:       r.is_finalised === 1,
    typist_mode:        r.typist_mode ?? base.typist_mode ?? null,
    local_typist_override: r.typist_mode ?? null,
    camera_option:      r.camera_option ?? null,
    server_updated_at:  r.server_updated_at,
    idempotency_key:    r.idempotency_key,
  }
}

export function updateReportData(inspectionId: number, reportData: string): void {
  db.runSync(
    'UPDATE inspections SET report_data = ?, updated_at = ?, synced = 0 WHERE id = ?',
    [reportData, new Date().toISOString(), inspectionId]
  )
}

export function updateLocalStatus(inspectionId: number, localStatus: string): void {
  db.runSync(
    'UPDATE inspections SET local_status = ?, updated_at = ? WHERE id = ?',
    [localStatus, new Date().toISOString(), inspectionId]
  )
}

/**
 * Patch the server-side status field inside the stored JSON data blob AND the
 * status column.  Call this after a successful api.updateInspection() so that
 * inspection.status stays accurate on device (otherwise the blob is frozen at
 * the value it had when the inspection was first downloaded).
 */
export function updateInspectionServerStatus(inspectionId: number, status: string): void {
  const r = db.getFirstSync<{ data: string }>(
    'SELECT data FROM inspections WHERE id = ?', [inspectionId]
  )
  if (!r) return
  try {
    const data = JSON.parse(r.data)
    data.status = status
    db.runSync(
      'UPDATE inspections SET status = ?, data = ?, updated_at = ? WHERE id = ?',
      [status, JSON.stringify(data), new Date().toISOString(), inspectionId]
    )
  } catch {}
}

export function markSynced(inspectionId: number, newServerUpdatedAt?: string): void {
  const now = new Date().toISOString()
  db.runSync(
    'UPDATE inspections SET synced = 1, updated_at = ?, server_updated_at = COALESCE(?, server_updated_at) WHERE id = ?',
    [now, newServerUpdatedAt ?? null, inspectionId]
  )
}

/**
 * Mark all audio recordings for an inspection as synced.
 * Does NOT delete the files — that is done by syncService after confirming
 * the server received them.
 */
export function markAudioSynced(inspectionId: number): void {
  db.runSync(
    'UPDATE audio_recordings SET synced = 1 WHERE inspection_id = ?',
    [inspectionId]
  )
}

/**
 * Override the typist mode for a single inspection locally.
 * The value is sent to the server as `typist_mode` during the next sync,
 * allowing clerks to change the mode per-report without a system-wide change.
 * Pass null to revert to the server/clerk-profile default.
 */
export function updateLocalTypistMode(inspectionId: number, mode: string | null): void {
  db.runSync(
    'UPDATE inspections SET typist_mode = ?, synced = 0, updated_at = ? WHERE id = ?',
    [mode, new Date().toISOString(), inspectionId]
  )
}

export function updateLocalCameraOption(inspectionId: number, option: string | null): void {
  db.runSync(
    'UPDATE inspections SET camera_option = ?, updated_at = ? WHERE id = ?',
    [option, new Date().toISOString(), inspectionId]
  )
}

export function markFinalised(inspectionId: number): void {
  db.runSync(
    'UPDATE inspections SET is_finalised = 1, synced = 0, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), inspectionId]
  )
}

export function unmarkFinalised(inspectionId: number): void {
  db.runSync(
    'UPDATE inspections SET is_finalised = 0, synced = 0, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), inspectionId]
  )
}

export function deleteLocalInspection(inspectionId: number): void {
  db.runSync('DELETE FROM inspections WHERE id = ?', [inspectionId])
  db.runSync('DELETE FROM audio_recordings WHERE inspection_id = ?', [inspectionId])
}

export function saveAudioRecording(
  inspectionId: number,
  sectionKey: string,
  sectionName: string,
  itemKey: string | undefined,
  itemName: string | undefined,
  label: string,
  fileUri: string,
  durationMs: number,
  transcription?: string
): number {
  const result = db.runSync(
    `INSERT INTO audio_recordings
       (inspection_id, section_key, section_name, item_key, item_name, label, file_uri, duration_ms, transcription, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [inspectionId, sectionKey, sectionName, itemKey || null, itemName || null, label, fileUri, durationMs, transcription || null, new Date().toISOString()]
  )

  // Fire-and-forget backup copy to the clerk's chosen save-location folder
  // (if the setting is enabled) — never blocks or fails the DB write.
  const filename = fileUri.split('/').pop() || `clip_${Date.now()}.m4a`
  copyClipToSaveLocation(fileUri, filename).catch(() => {})

  return result.lastInsertRowId
}

export async function deleteAudioRecording(id: number, fileUri: string): Promise<void> {
  db.runSync('DELETE FROM audio_recordings WHERE id = ?', [id])
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true })
  } catch {}
}

// Map snake_case DB columns to camelCase so callers always see durationMs, fileUri, etc.
function normaliseRow(row: any): any {
  if (!row) return row
  return {
    ...row,
    durationMs: row.durationMs ?? row.duration_ms ?? 0,
    fileUri:    row.fileUri    ?? row.file_uri    ?? '',
    sectionKey: row.sectionKey ?? row.section_key ?? '',
    itemKey:    row.itemKey    ?? row.item_key    ?? '',
    itemName:   row.itemName   ?? row.item_name   ?? '',
    createdAt:  row.createdAt  ?? row.created_at  ?? '',
  }
}

export function getAudioRecordings(inspectionId: number): any[] {
  const rows = db.getAllSync(
    'SELECT * FROM audio_recordings WHERE inspection_id = ? ORDER BY created_at DESC',
    [inspectionId]
  )
  return rows.map(normaliseRow)
}

export function getAudioRecordingsForSection(inspectionId: number, sectionKey: string): any[] {
  const rows = db.getAllSync(
    // Exclude clips that already have a transcription — those were processed by
    // AI Room mode and their transcription text was saved before the file was
    // deleted. Restoring them would cause stale re-transcription on remount.
    'SELECT * FROM audio_recordings WHERE inspection_id = ? AND section_key = ? AND item_key IS NULL AND transcription IS NULL ORDER BY created_at ASC',
    [inspectionId, sectionKey]
  )
  return rows.map(normaliseRow)
}

export function getAudioRecordingsForItem(inspectionId: number, sectionKey: string, itemKey: string): any[] {
  const rows = db.getAllSync(
    'SELECT * FROM audio_recordings WHERE inspection_id = ? AND section_key = ? AND item_key = ? ORDER BY created_at DESC',
    [inspectionId, sectionKey, itemKey]
  )
  return rows.map(normaliseRow)
}

export function updateTranscription(recordingId: number, transcription: string): void {
  db.runSync(
    'UPDATE audio_recordings SET transcription = ?, synced = 0 WHERE id = ?',
    [transcription, recordingId]
  )
}
