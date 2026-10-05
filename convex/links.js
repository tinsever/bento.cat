import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { requireOwnBox } from './lib';
import { limit } from './limits';
import { storePreview } from './media';
import { applyPreviews, hasLinkPreview, PREVIEW_RETRY, PREVIEW_STALE, previewBaseline, previewSource } from '../src/lib/link-previews';
import { syncReferences } from './files';

/* Link previews, read on the server so the browser never has to trust a stranger's page.
   Everything fetched here goes through publicUrl() first. */

const UA = 'Mozilla/5.0 (compatible; bento.cat link preview; +https://bento.cat)';
const PAGE_MAX = 600 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const GH_WEEKS = 26;
export const GH_STALE = 6 * 60 * 60 * 1000;

function privateV4(h) {
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// Only ordinary public web addresses. No local names, private ranges, odd ports or credentials.
export function publicUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  // A trailing dot is the same host to DNS ("localhost." is localhost), so drop it before checking.
  const h = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!h.includes('.') || h.includes(':') || h.startsWith('[')) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  if (privateV4(h)) return null;
  return u;
}

// fetch with a deadline, a size cap and redirects checked one hop at a time.
async function get(raw, { max = PAGE_MAX, accept = 'text/html,application/xhtml+xml', ms = 7000 } = {}) {
  let url = publicUrl(raw);
  for (let hop = 0; url && hop < 5; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    let res;
    try {
      res = await fetch(url.href, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en', 'Cache-Control': 'no-cache' } });
    } catch {
      clearTimeout(timer);
      return null;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = publicUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok || !res.body) { clearTimeout(timer); return null; }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); if (accept.startsWith('image')) return null; break; }
        chunks.push(value);
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    return { url, type: (res.headers.get('content-type') || '').toLowerCase(), bytes };
  }
  return null;
}

const text = r => (r ? new TextDecoder('utf-8', { fatal: false }).decode(r.bytes) : '');
async function json(raw) {
  const r = await get(raw, { accept: 'application/json' });
  try { return r ? JSON.parse(text(r)) : null; } catch { return null; }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ')
  .trim();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

// The bits of a page's <head> a preview needs.
function readHead(html, base) {
  const head = html.slice(0, 300000);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const k = (a.property || a.name || '').toLowerCase();
    if (k && a.content && !(k in meta)) meta[k] = decode(a.content);
  }
  const icons = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || '').toLowerCase();
    if (a.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel)) icons.push({ href: a.href, touch: rel.includes('apple'), size: parseInt(a.sizes) || 0 });
  }
  const abs = u => { try { return u ? new URL(decode(u), base).href : ''; } catch { return ''; } };
  icons.sort((x, y) => (y.touch - x.touch) || (y.size - x.size));
  const title = meta['og:title'] || meta['twitter:title'] || decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  return {
    title: title.slice(0, 120),
    description: (meta['og:description'] || meta['description'] || '').slice(0, 200),
    site: (meta['og:site_name'] || '').slice(0, 60),
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src']),
    icons: [...new Set([...icons.map(i => abs(i.href)), abs('/favicon.ico')])].filter(Boolean),
  };
}

// Copy a picture into our own storage so previews don't break when the source moves.
async function keep(ctx, raw, boxId) {
  const r = await get(raw, { max: IMAGE_MAX, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,image/*' });
  if (!r || !/^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon)/.test(r.type) || r.bytes.length < 64) return null;
  return await storePreview(ctx, new Blob([r.bytes], { type: r.type.split(';')[0] }), boxId);
}

async function keepIcon(ctx, candidates, boxId) {
  // Try a few advertised icons and always include the conventional fallback.
  const urls = [...new Set([...candidates.slice(0, 2), candidates.at(-1)])];
  for (const url of urls) {
    const icon = await keep(ctx, url, boxId);
    if (icon) return icon;
  }
  return null;
}

const prettyHost = host => {
  const base = host.replace(/^www\./, '').split('.')[0] || host;
  return base.split(/[-_]/).map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
};

/* ---------- GitHub contribution graph ---------- */

export async function githubGraph(user) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(user)) return null;
  const html = text(await get(`https://github.com/users/${user}/contributions`, { max: 2 * 1024 * 1024 }));
  if (!html) return null;
  const tips = {};
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g)) {
    const n = m[2].match(/([\d,]+)\s+contribution/);
    tips[m[1]] = n ? +n[1].replace(/,/g, '') : 0;
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a['data-date'])) continue;
    days.push({ date: a['data-date'], level: Math.max(0, Math.min(4, +a['data-level'] || 0)), count: tips[a.id] ?? 0 });
  }
  if (!days.length) return null;
  days.sort((x, y) => (x.date < y.date ? -1 : 1));
  // Whole weeks, Sunday first like GitHub, ending on the latest day.
  const lastDow = new Date(days[days.length - 1].date + 'T12:00:00Z').getUTCDay();
  const take = Math.min(days.length, (GH_WEEKS - 1) * 7 + lastDow + 1);
  const recent = days.slice(-take);
  return {
    levels: recent.map(d => d.level).join(''),
    counts: recent.map(d => d.count),
    start: recent[0].date,
    total: recent.reduce((a, d) => a + d.count, 0),
    fetchedAt: Date.now(),
  };
}

/* ---------- what a link becomes ---------- */

const SPOTIFY_KIND = { playlist: 'Playlist', album: 'Album', track: 'Song', artist: 'Artist', show: 'Podcast', episode: 'Episode' };

async function unfurlUrl(ctx, u, { boxId, refresh = false } = {}) {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const url = u.href;

  if (host === 'github.com' && parts.length === 1) {
    const graph = await githubGraph(parts[0]);
    return { type: 'github', user: parts[0], url, ...(graph || { levels: '' }) };
  }

  if (host === 'open.spotify.com') {
    const o = await json(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (refresh && !o?.title) return null;
    const kind = SPOTIFY_KIND[parts.find(p => SPOTIFY_KIND[p])] || '';
    const cover = o?.thumbnail_url ? await keep(ctx, o.thumbnail_url, boxId) : null;
    return { type: 'music', url, title: (o?.title || 'Something to listen to').slice(0, 120), sub: kind, cover, incomplete: !o?.title || (!!o.thumbnail_url && !cover), failedFields: o?.thumbnail_url && !cover ? ['cover'] : [] };
  }

  // A playlist's page describes its current cover. A watch URL with both v and
  // list still describes that video, so only canonical playlist links take this path.
  if (['youtube.com', 'm.youtube.com'].includes(host) && parts[0] === 'playlist' && u.searchParams.get('list')) {
    const playlist = new URL('https://www.youtube.com/playlist');
    playlist.searchParams.set('list', u.searchParams.get('list'));
    const page = await get(playlist.href);
    const head = page && /html/.test(page.type) ? readHead(text(page), page.url) : null;
    if (head?.title && head.image) {
      const src = await keep(ctx, head.image, boxId);
      return { type: 'video', url, title: head.title, meta: 'Playlist on YouTube', src, pos: '50% 50%', incomplete: !src, failedFields: src ? [] : ['src'] };
    }
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'vimeo.com') {
    const endpoint = host === 'vimeo.com' ? 'https://vimeo.com/api/oembed.json?url=' : 'https://www.youtube.com/oembed?format=json&url=';
    const o = await json(endpoint + encodeURIComponent(url));
    if (o?.title) {
      const thumb = o.thumbnail_url ? await keep(ctx, o.thumbnail_url, boxId) : null;
      return { type: 'video', url, title: o.title.slice(0, 120), meta: `${o.author_name ? o.author_name.slice(0, 60) + ' on ' : 'On '}${host === 'vimeo.com' ? 'Vimeo' : 'YouTube'}`, src: thumb, pos: '50% 50%', incomplete: !!o.thumbnail_url && !thumb, failedFields: o.thumbnail_url && !thumb ? ['src'] : [] };
    }
  }

  const page = await get(url);
  const head = page && /html/.test(page.type) ? readHead(text(page), page.url) : null;
  if (refresh && !head) return null;
  const image = head?.image ? await keep(ctx, head.image, boxId) : null;
  const icon = head ? await keepIcon(ctx, head.icons, boxId) : null;
  return {
    type: 'link',
    url,
    title: head?.title || (refresh ? '' : prettyHost(host)),
    preview: image ? { kind: 'image', src: image } : null,
    icon: icon ? { src: icon } : null,
    incomplete: !head || (!!head.image && !image) || !icon,
    failedFields: [...(!head || (head.image && !image) ? ['preview'] : []), ...(!icon ? ['icon'] : [])],
  };
}

// The editor calls this when someone pastes a link.
export const unfurl = action({
  args: { url: v.string(), refresh: v.optional(v.boolean()) },
  handler: async (ctx, { url, refresh = false }) => {
    const who = await ctx.auth.getUserIdentity();
    if (!who) throw new ConvexError('Sign in first.');
    await ctx.runMutation(internal.links.count, { key: `unfurl:${who.tokenIdentifier}` });
    const u = publicUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url);
    if (!u) throw new ConvexError('That link can’t be opened from here.');
    const result = await unfurlUrl(ctx, u, { refresh });
    if (!result) return null;
    const fetchedAt = result.incomplete ? 0 : Date.now();
    const failedFields = result.failedFields || [];
    delete result.incomplete;
    delete result.failedFields;
    if (hasLinkPreview(result)) {
      result.previewSource = previewSource(result, fetchedAt);
      for (const key of failedFields) delete result.previewSource.values[key];
    }
    return result;
  },
});

/* ---------- keeping link previews fresh ---------- */

export const previews = query({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => {
    const { box } = await requireOwnBox(ctx);
    return box._id === boxId ? box.linkPreviews || [] : [];
  },
});

export async function queuePreviews(ctx, box) {
  if (!box.ownerId || box.demo) return;
  const now = Date.now();
  const cached = [...(box.linkPreviews || [])];
  let changed = false;
  for (const tile of applyPreviews(box)) {
    if (!hasLinkPreview(tile) || !publicUrl(tile.url)) continue;
    const at = cached.findIndex(p => p.tileId === tile.id);
    const previous = at >= 0 && cached[at].url === tile.url && cached[at].type === tile.type ? cached[at] : null;
    const source = previewBaseline(tile);
    if (now - source.fetchedAt < PREVIEW_STALE && !previous?.incomplete) continue;
    if (previous && now - previous.checkedAt < PREVIEW_RETRY) continue;
    const entry = { tileId: tile.id, url: tile.url, type: tile.type, base: source, data: previous?.data || null, checkedAt: now, incomplete: !!previous?.incomplete };
    if (at >= 0) cached[at] = entry;
    else cached.push(entry);
    changed = true;
    await ctx.scheduler.runAfter(0, internal.links.refreshPreview, { boxId: box._id, tileId: tile.id, url: tile.url, checkedAt: now });
  }
  if (changed) await ctx.db.patch(box._id, { linkPreviews: cached });
}

export const previewJob = internalQuery({
  args: { boxId: v.id('boxes'), tileId: v.string(), url: v.string(), checkedAt: v.number() },
  handler: async (ctx, { boxId, tileId, url, checkedAt }) => {
    const box = await ctx.db.get(boxId);
    if (!box?.ownerId || !(await ctx.db.get(box.ownerId))) return null;
    const tile = box.tiles.find(t => t.id === tileId);
    const cached = box.linkPreviews?.find(p => p.tileId === tileId);
    return tile && hasLinkPreview(tile) && tile.url === url && cached?.url === url && cached.type === tile.type && cached.checkedAt === checkedAt ? { type: tile.type } : null;
  },
});

export const finishPreview = internalMutation({
  args: { boxId: v.id('boxes'), tileId: v.string(), url: v.string(), checkedAt: v.number(), result: v.any() },
  handler: async (ctx, { boxId, tileId, url, checkedAt, result }) => {
    const box = await ctx.db.get(boxId);
    if (!box?.ownerId || !(await ctx.db.get(box.ownerId))) return;
    const tile = box.tiles.find(t => t.id === tileId);
    const cached = box.linkPreviews?.find(p => p.tileId === tileId);
    if (!tile || !hasLinkPreview(tile) || tile.url !== url || cached?.url !== url || cached.checkedAt !== checkedAt || cached.type !== tile.type) return;
    let data = result;
    let failedFields = result?.failedFields || [];
    // Refresh imported playlist tiles that older versions stored as generic links
    // without changing their type, size, or crop.
    if (result?.type === 'video' && tile.type === 'link') {
      data = { ...result, type: 'link', preview: result.src ? { kind: 'image', src: result.src } : null };
      if (failedFields.includes('src')) failedFields = [...failedFields, 'preview'];
    } else if (result?.type === 'link' && tile.type === 'video') {
      data = { ...result, type: 'video', src: result.preview?.src || null };
      if (failedFields.includes('preview')) failedFields = [...failedFields, 'src'];
    }
    if (!data || data.type !== tile.type) return;
    const fresh = previewSource(data);
    for (const key of failedFields) delete fresh.values[key];
    const source = { ...fresh, values: { ...(cached.data?.values || cached.base.values), ...fresh.values } };
    const linkPreviews = box.linkPreviews.map(p => p.tileId === tileId ? { ...p, data: source, incomplete: !!data.incomplete } : p);
    await syncReferences(ctx, box.ownerId, { ...box, linkPreviews });
    await ctx.db.patch(boxId, { linkPreviews });
  },
});

export const refreshPreview = internalAction({
  args: { boxId: v.id('boxes'), tileId: v.string(), url: v.string(), checkedAt: v.number() },
  handler: async (ctx, job) => {
    if (!(await ctx.runQuery(internal.links.previewJob, job))) return;
    const u = publicUrl(job.url);
    if (!u) return;
    const result = await unfurlUrl(ctx, u, { boxId: job.boxId, refresh: true });
    await ctx.runMutation(internal.links.finishPreview, { ...job, result });
  },
});

export const count = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => limit(ctx, key, 40, 60 * 1000, 'Lots of links at once. Give it a minute.'),
});

/* ---------- keeping GitHub graphs fresh ---------- */

export const githubTiles = internalQuery({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => {
    const box = await ctx.db.get(boxId);
    return (box?.tiles || []).filter(t => t.type === 'github' && t.user && !t.demo).map(t => ({ id: t.id, user: t.user, fetchedAt: t.fetchedAt || 0 }));
  },
});

export const patchTiles = internalMutation({
  args: { boxId: v.id('boxes'), patches: v.any() },
  handler: async (ctx, { boxId, patches }) => {
    const box = await ctx.db.get(boxId);
    if (!box) return;
    let changed = false;
    const tiles = box.tiles.map(t => {
      const p = patches[t.id];
      if (!p || t.type !== 'github' || t.demo) return t;
      changed = true;
      return { ...t, ...p };
    });
    if (changed) await ctx.db.patch(boxId, { tiles });
  },
});

export const refreshGithub = internalAction({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => {
    const tiles = await ctx.runQuery(internal.links.githubTiles, { boxId });
    const patches = {};
    for (const t of tiles) {
      if (Date.now() - t.fetchedAt < GH_STALE) continue;
      const graph = await githubGraph(t.user);
      if (graph) patches[t.id] = graph;
    }
    if (Object.keys(patches).length) await ctx.runMutation(internal.links.patchTiles, { boxId, patches });
  },
});
