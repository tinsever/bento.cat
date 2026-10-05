export const PREVIEW_STALE = 24 * 60 * 60 * 1000;
export const PREVIEW_RETRY = 60 * 60 * 1000;
const FIELDS = ['title', 'sub', 'meta', 'src', 'cover', 'preview', 'icon'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function hasLinkPreview(tile) {
  return ['link', 'video', 'music'].includes(tile.type) && !!tile.url && !tile.video && !tile.demo && !tile.draft && !tile.loading;
}

export function previewSource(tile, fetchedAt = Date.now()) {
  return { url: tile.url, type: tile.type, fetchedAt, values: Object.fromEntries(FIELDS.filter(k => k in tile && tile[k] !== undefined).map(k => [k, tile[k]])) };
}

// Older tiles have no record of their fetched title. Keep their wording, but
// refresh the images supplied by the link importer.
export function previewBaseline(tile) {
  if (tile.previewSource?.url === tile.url && tile.previewSource?.type === tile.type) return tile.previewSource;
  const source = previewSource(tile, 0);
  for (const key of ['title', 'sub', 'meta']) delete source.values[key];
  return source;
}

export function mergePreview(tile, cached) {
  if (!hasLinkPreview(tile) || !cached?.data || cached.url !== tile.url || cached.type !== tile.type) return tile;
  const baseline = previewBaseline(tile);
  if (baseline.fetchedAt > cached.data.fetchedAt) return tile;
  const base = tile.previewSource?.url === tile.url ? baseline : cached.base;
  const next = { ...tile };
  const source = { ...cached.data, values: { ...cached.data.values } };
  for (const key of FIELDS) {
    const value = cached.data.values[key];
    if (!(key in cached.data.values)) continue;
    if (value === '') {
      // A skipped empty field must keep its old automatic baseline, otherwise
      // the displayed value would look like a custom edit on the next refresh.
      if (key in (base?.values || {})) source.values[key] = base.values[key];
      else delete source.values[key];
      continue;
    }
    if (same(tile[key], base?.values[key]) || (tile[key] == null && base?.values[key] == null)) next[key] = value;
    else if (same(tile[key], value)) {
      // A custom removal may coincide with a temporarily unavailable image.
      // Keep the comparison value so a recovery cannot undo that custom edit.
      if (key in (base?.values || {})) source.values[key] = base.values[key];
      else delete source.values[key];
    }
  }
  next.previewSource = source;
  return next;
}

// A replacement URL cannot keep another destination's automatic fields. Mark
// unavailable fields as empty so future retries can fill them, while the normal
// merge still protects values that the owner changed from the old baseline.
export function mergeReplacementPreview(tile, source, baseline) {
  const data = { ...source, values: { ...source.values } };
  for (const key of FIELDS) {
    if (key in baseline && (!(key in data.values) || data.values[key] === '')) data.values[key] = null;
  }
  return mergePreview({ ...tile, url: source.url, previewSource: { ...source, fetchedAt: 0, values: baseline } }, { url: source.url, type: tile.type, data });
}

export function applyPreviews(box) {
  return box.tiles.map(tile => mergePreview(tile, box.linkPreviews?.find(p => p.tileId === tile.id)));
}
