/**
 * audioMime — best-effort MIME type detection for an audio clip file.
 *
 * The room/item transcription payloads must send the clip's real MIME type so
 * the backend picks the right container extension for Whisper (see
 * backend/routes/transcribe.py's `ext_map`). Normal in-app recordings are
 * always .m4a, but an inserted/imported clip (see importAudioClip.ts) can be
 * any format the clerk had lying around (mp3, wav, etc.) — guessing from the
 * file extension keeps that working without needing a DB schema change.
 */
const EXT_MIME: Record<string, string> = {
  m4a:  'audio/m4a',
  aac:  'audio/aac',
  mp3:  'audio/mp3',
  mpga: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mp4:  'audio/mp4',
  wav:  'audio/wav',
  webm: 'audio/webm',
  ogg:  'audio/ogg',
  oga:  'audio/ogg',
  flac: 'audio/flac',
}

/**
 * hint — a MIME type reported by the OS (e.g. expo-document-picker's
 * asset.mimeType) is trusted first when present and recognised; otherwise
 * falls back to guessing from the file extension in `uri`.
 */
export function mimeTypeForUri(uri: string, hint?: string | null): string {
  const hintBase = hint?.split(';')[0].trim().toLowerCase()
  if (hintBase && Object.values(EXT_MIME).includes(hintBase)) return hintBase

  const ext = (uri.split('.').pop() || '').toLowerCase().split('?')[0]
  return EXT_MIME[ext] || 'audio/m4a'
}
