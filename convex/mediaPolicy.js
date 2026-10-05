// HTTP actions accept at most 20 MB. Reject before storing, rather than after upload.
export const MAX_UPLOAD_BYTES = 20_000_000;
export const MAX_OWNER_BYTES = 500 * 1024 * 1024;
export const MAX_OWNER_FILES = 500;
export const UNUSED_FILE_TTL = 24 * 60 * 60 * 1000;

const TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'image/x-icon', 'image/vnd.microsoft.icon',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac',
]);
export const mediaType = type => String(type || '').split(';')[0].trim().toLowerCase();
export function uploadError(bytes, contentType) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) return 'That file is empty.';
  if (bytes > MAX_UPLOAD_BYTES) return 'That file is too big. Keep it under 20 MB.';
  if (!TYPES.has(mediaType(contentType))) return 'Only supported photos, videos and voice recordings fit in a box.';
  return null;
}
const MEDIA_KEYS = new Set(['src', 'cover', 'video', 'before', 'avatar', 'avatarVideo', 'audio']);
export function mediaUrls(value, urls = new Set(), key = '') {
  if (typeof value === 'string' && MEDIA_KEYS.has(key) && /^https?:\/\//i.test(value)) urls.add(value);
  else if (Array.isArray(value)) for (const item of value) mediaUrls(item, urls, key);
  else if (value && typeof value === 'object') for (const [k, item] of Object.entries(value)) {
    // Provenance is for comparisons, not another live use of an old image.
    if (k !== 'previewSource' && k !== 'base') mediaUrls(item, urls, k);
  }
  return urls;
}
