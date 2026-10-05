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
  for (const key of FIELDS) {
    const value = cached.data.values[key];
    if (!(key in cached.data.values) || value === '') continue;
    if (same(tile[key], base?.values[key]) || (tile[key] == null && base?.values[key] == null)) next[key] = value;
  }
  next.previewSource = cached.data;
  return next;
}

export function applyPreviews(box) {
  return box.tiles.map(tile => mergePreview(tile, box.linkPreviews?.find(p => p.tileId === tile.id)));
}
