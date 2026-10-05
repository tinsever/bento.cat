import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import schema from '../convex/schema.js';
import { api, internal } from '../convex/_generated/api.js';
import { PREVIEW_RETRY, PREVIEW_STALE, mergePreview, previewSource } from '../src/lib/link-previews.js';
import { UNUSED_FILE_TTL, mediaUrls } from '../convex/mediaPolicy.js';

const modules = import.meta.glob('../convex/**/*.js');
const URL = 'https://example.com/page';
const PLAYLIST = 'https://www.youtube.com/playlist?list=PLcats';
const image = value => new Response(value.repeat(128), { headers: { 'content-type': 'image/png' } });
const html = (title, cover = 'cover', icon = 'icon') => new Response(`<head><title>${title}</title>${cover ? `<meta property="og:image" content="https://images.example.com/${cover}.png">` : ''}<link rel="icon" href="https://images.example.com/${icon}.png"></head>`, { headers: { 'content-type': 'text/html' } });
function mockSite({ title = 'Original title', cover = 'cover', icon = 'icon', fail = false } = {}) {
  const fetch = vi.fn(async url => {
    const href = String(url);
    if (fail) return new Response('', { status: 503 });
    if (href.startsWith('https://images.example.com/')) return image(href);
    if (href === URL || href === PLAYLIST) return html(title, cover, icon);
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function setup(tile) {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ subject: 'owner', issuer: 'https://clerk.example', tokenIdentifier: 'https://clerk.example|owner' });
  await a.mutation(api.users.store);
  await a.mutation(api.boxes.claim, { handle: 'owner' });
  const imported = tile || { id: 'link', ...(await a.action(api.links.unfurl, { url: URL })), size: { d: 'loaf', m: 'curl' } };
  const save = (tiles, revision = 1) => a.mutation(api.boxes.save, { data: { tiles }, expectedRevision: revision, saveId: crypto.randomUUID() });
  await save([imported], 0);
  return { t, a, save, tile: imported, boxId: (await a.query(api.boxes.mine))._id };
}
const view = t => t.query(api.boxes.get, { handle: 'owner' });
const publicTile = tile => Object.fromEntries(Object.entries(tile).filter(([key]) => key !== 'previewSource'));
const jobs = t => t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
const uploads = t => t.run(ctx => ctx.db.query('uploads').collect());
async function refresh(t, boxId) {
  await t.mutation(api.interactions.refreshBox, { boxId });
  vi.advanceTimersByTime(0);
  await t.finishInProgressScheduledFunctions();
}

beforeEach(() => { vi.useFakeTimers(); mockSite(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('automatic link previews', () => {
  it.each(['link', 'music', 'video'])('replaces automatic text after a failed first %s import recovers', async type => {
    const original = { id: 'tile', type, url: URL, title: type === 'link' ? 'Example' : '', sub: '', meta: '' };
    const { t, boxId } = await setup({ ...original, previewSource: previewSource(original, 0) });
    if (type === 'link') mockSite({ title: 'Recovered title' });
    else {
      const url = type === 'music' ? 'https://open.spotify.com/playlist/cats' : 'https://www.youtube.com/watch?v=cat';
      await t.run(async ctx => {
        await ctx.db.patch(boxId, { tiles: [{ ...original, url, previewSource: previewSource({ ...original, url }, 0) }] });
      });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ title: 'Recovered title' }), { headers: { 'content-type': 'application/json' } })));
    }
    await refresh(t, boxId);
    expect((await view(t)).tiles[0].title).toBe('Recovered title');
  });

  it('keeps the refresh timestamp for a URL stored without its trailing slash', async () => {
    const original = { id: 'tile', type: 'link', url: 'https://example.com', title: 'Original' };
    const { t, a, boxId } = await setup({ ...original, previewSource: previewSource(original, 0) });
    const fetch = vi.fn(async url => String(url) === 'https://example.com/' ? html('Updated') : image(String(url)));
    vi.stubGlobal('fetch', fetch);
    await refresh(t, boxId);
    const fresh = (await a.query(api.boxes.mine)).tiles[0];
    expect(fresh.previewSource.url).toBe(original.url);
    expect(fresh.previewSource.fetchedAt).toBe(Date.now());
    fetch.mockClear();
    vi.advanceTimersByTime(PREVIEW_RETRY);
    await refresh(t, boxId);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers an automatic title after a refresh temporarily returns empty text', async () => {
    const { t, a, boxId, tile, save } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    mockSite({ title: '' });
    await refresh(t, boxId);
    const kept = (await a.query(api.boxes.mine)).tiles[0];
    expect(kept.title).toBe(tile.title);
    expect(kept.previewSource.values.title).toBe(tile.title);
    await save([kept]);
    vi.advanceTimersByTime(PREVIEW_STALE);
    mockSite({ title: 'Recovered title' });
    await refresh(t, boxId);
    expect((await view(t)).tiles[0].title).toBe('Recovered title');
  });

  it('serves the stored preview immediately and fetches only after 24 hours', async () => {
    const { t, a, boxId, tile } = await setup();
    const fetch = mockSite({ title: 'New title', cover: 'new-cover', icon: 'new-icon' });
    await refresh(t, boxId);
    expect(fetch).not.toHaveBeenCalled();
    expect((await view(t)).tiles[0]).toEqual(publicTile(tile));
    vi.advanceTimersByTime(PREVIEW_STALE);
    await t.mutation(api.interactions.refreshBox, { boxId });
    expect((await view(t)).tiles[0]).toEqual(publicTile(tile));
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const fresh = (await view(t)).tiles[0];
    expect(fresh.title).toBe('New title');
    expect(fresh.icon.src).not.toBe(tile.icon.src);
    expect(fresh.preview.src).not.toBe(tile.preview.src);
    expect(fresh.size).toEqual(tile.size);
    expect((await a.query(api.boxes.mine)).revision).toBe(1);
    expect(await t.run(ctx => ctx.db.query('visits').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('views').collect())).toEqual([]);
  });

  it('queues one job per stale tile across concurrent visitors and skips demos and uploads', async () => {
    const { t, boxId, save, tile } = await setup();
    await save([tile, { ...tile, id: 'demo', demo: true }, { id: 'upload', type: 'video', video: 'https://example.com/movie.mp4', url: URL }]);
    vi.advanceTimersByTime(PREVIEW_STALE);
    await Promise.all(Array.from({ length: 6 }, () => t.mutation(api.interactions.refreshBox, { boxId })));
    expect((await jobs(t)).filter(job => job.name === 'links:refreshPreview')).toHaveLength(1);
  });

  it('keeps custom text and images, cropping and layout during refresh and old editor saves', async () => {
    const { t, save, tile, boxId } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    mockSite({ title: 'New title', cover: 'new-cover' });
    await refresh(t, boxId);
    const fresh = (await view(t)).tiles[0];
    // A tab opened yesterday saves its old copy without losing the refreshed picture.
    await save([{ ...tile, title: 'My title', caption: 'My caption', pos: '15% 30%', size: { d: 'tower', m: 'curl' } }]);
    expect((await view(t)).tiles[0]).toMatchObject({ title: 'My title', caption: 'My caption', pos: '15% 30%', size: { d: 'tower', m: 'curl' }, preview: fresh.preview });
    const custom = { ...tile, preview: { kind: 'image', src: 'https://example.com/my-photo.png' } };
    await save([custom], 2);
    expect((await view(t)).tiles[0].preview).toEqual(custom.preview);
  });

  it('keeps the last working preview through failures and throttles retries to an hour', async () => {
    const { t, tile, boxId } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    const fetch = mockSite({ fail: true });
    await refresh(t, boxId);
    expect((await view(t)).tiles[0]).toEqual(publicTile(tile));
    expect(fetch).toHaveBeenCalledTimes(1);
    await refresh(t, boxId);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PREVIEW_RETRY);
    mockSite({ title: 'Recovered', cover: 'recovered' });
    await refresh(t, boxId);
    expect((await view(t)).tiles[0].title).toBe('Recovered');
  });

  it('keeps a working thumbnail if its download fails and retries incomplete results', async () => {
    const { t, tile, boxId } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    vi.stubGlobal('fetch', vi.fn(async url => String(url) === URL ? html('New title', 'missing') : new Response('', { status: 503 })));
    await refresh(t, boxId);
    expect((await view(t)).tiles[0]).toMatchObject({ title: 'New title', icon: tile.icon, preview: tile.preview });
    vi.advanceTimersByTime(PREVIEW_RETRY);
    mockSite({ fail: true });
    await refresh(t, boxId);
    vi.advanceTimersByTime(PREVIEW_RETRY);
    mockSite({ title: 'Recovered', cover: 'recovered' });
    await refresh(t, boxId);
    expect((await view(t)).tiles[0].preview).not.toEqual(tile.preview);
  });

  it('updates metadata and keeps working images when the upload quota is exhausted', async () => {
    const { t, a, tile, boxId } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    await t.run(async ctx => {
      const { ownerId } = await ctx.db.get(boxId);
      const quota = await ctx.db.query('limits').withIndex('by_key', q => q.eq('key', `upload:${ownerId}`)).unique();
      await ctx.db.patch(quota._id, { windowStart: Date.now(), count: 120 });
    });
    mockSite({ title: 'Updated title', cover: 'new-cover', icon: 'new-icon' });
    await refresh(t, boxId);
    expect((await view(t)).tiles[0]).toMatchObject({ title: 'Updated title', preview: tile.preview, icon: tile.icon });
    expect((await t.run(ctx => ctx.db.get(boxId))).linkPreviews[0].incomplete).toBe(true);
    expect(await uploads(t)).toHaveLength(2);
    const imported = await a.action(api.links.unfurl, { url: URL });
    expect(imported).toMatchObject({ title: 'Updated title', preview: null, icon: null });
    vi.advanceTimersByTime(PREVIEW_RETRY);
    await refresh(t, boxId);
    expect((await view(t)).tiles[0].preview).not.toEqual(tile.preview);
    expect((await t.run(ctx => ctx.db.get(boxId))).linkPreviews[0].incomplete).toBe(false);
  });

  it.each(['link', 'music', 'video'])('clears an automatic %s image when successful metadata removes it', async type => {
    const url = type === 'music' ? 'https://open.spotify.com/playlist/cats' : type === 'video' ? 'https://www.youtube.com/watch?v=cat' : URL;
    const field = type === 'music' ? 'cover' : type === 'video' ? 'src' : 'preview';
    const original = { id: 'tile', type, url, title: 'Original', [field]: type === 'link' ? { kind: 'image', src: 'https://example.com/old.png' } : 'https://example.com/old.png' };
    const { t, boxId } = await setup({ ...original, previewSource: previewSource(original, 1) });
    if (type === 'link') mockSite({ title: 'Updated', cover: null });
    else vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ title: 'Updated' }), { headers: { 'content-type': 'application/json' } })));
    await refresh(t, boxId);
    expect((await view(t)).tiles[0][field]).toBeNull();
    expect((await view(t)).tiles[0].title).toBe('Updated');
    vi.advanceTimersByTime(PREVIEW_STALE);
    await refresh(t, boxId);
    expect((await view(t)).tiles[0][field]).toBeNull();
  });

  it('reuses unchanged stored images without filling the owner quota', async () => {
    const { t, boxId, tile } = await setup();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(PREVIEW_STALE);
      await refresh(t, boxId);
      expect((await view(t)).tiles[0].icon).toEqual(tile.icon);
      expect(await uploads(t)).toHaveLength(2);
    }
    expect((await uploads(t)).every(file => file.referenced)).toBe(true);
  });

  it.each(['removed', 'changed URL', 'changed type'])('ignores a delayed result after a tile is %s', async change => {
    const { t, tile, boxId, save } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    await t.mutation(api.interactions.refreshBox, { boxId });
    const cached = (await t.run(ctx => ctx.db.get(boxId))).linkPreviews[0];
    const tiles = change === 'removed' ? [] : [{ ...tile, ...(change === 'changed URL' ? { url: 'https://other.example.com/' } : { type: 'photo' }) }];
    await save(tiles);
    await t.mutation(internal.links.finishPreview, { boxId, tileId: tile.id, url: tile.url, checkedAt: cached.checkedAt, result: { type: 'link', url: tile.url, title: 'Late result' } });
    expect((await view(t)).tiles).toEqual(tiles.map(publicTile));
    expect((await t.run(ctx => ctx.db.get(boxId))).linkPreviews).toEqual([]);
  });

  it('keeps refreshed files referenced and cleans replaced files after the grace period', async () => {
    const { t, a, boxId, tile, save } = await setup();
    vi.advanceTimersByTime(PREVIEW_STALE);
    mockSite({ icon: 'new-icon', cover: 'new-cover' });
    await refresh(t, boxId);
    const fresh = (await a.query(api.boxes.mine)).tiles[0];
    await save([fresh]);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect((await uploads(t)).map(row => row.url).sort()).toEqual([fresh.icon.src, fresh.preview.src].sort());
    expect((await uploads(t)).map(row => row.url)).not.toContain(tile.icon.src);
    await save([], 2);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await uploads(t)).toEqual([]);
  });

  it('does not expose provenance cache to another owner or anonymous callers', async () => {
    const { t, boxId } = await setup();
    await expect(t.query(api.links.previews, { boxId })).rejects.toThrow('Sign in first');
    const b = t.withIdentity({ subject: 'other', issuer: 'https://clerk.example', tokenIdentifier: 'https://clerk.example|other' });
    await b.mutation(api.users.store);
    await b.mutation(api.boxes.claim, { handle: 'other' });
    expect(await b.query(api.links.previews, { boxId })).toEqual([]);
  });

  it('hides replaced preview content from public responses while retaining editor provenance', async () => {
    const { t, a, tile, save } = await setup();
    await save([{ ...tile, title: 'My replacement title', icon: null, preview: null }]);
    const publicBox = await view(t);
    expect(publicBox.tiles[0]).not.toHaveProperty('previewSource');
    expect(JSON.stringify(publicBox)).not.toContain('Original title');
    expect(JSON.stringify(publicBox)).not.toContain(tile.icon.src);
    expect(JSON.stringify(publicBox)).not.toContain(tile.preview.src);
    expect((await a.query(api.boxes.get, { handle: 'owner' })).tiles[0]).not.toHaveProperty('previewSource');
    expect((await a.query(api.boxes.mine)).tiles[0].previewSource).toEqual(tile.previewSource);
  });
});

describe('playlist thumbnails and favicon discovery', () => {
  it('does not return a made-up title when a changed link cannot be fetched', async () => {
    const { a } = await setup({ id: 'note', type: 'note', html: 'Hello' });
    mockSite({ fail: true });
    expect(await a.action(api.links.unfurl, { url: URL, refresh: true })).toBeNull();
  });

  it.each(['video', 'link'])('refreshes a legacy playlist stored as a %s tile and preserves its title and crop', async type => {
    const tile = { id: 'playlist', type, url: PLAYLIST, title: 'My playlist title', pos: '25% 75%', size: { d: 'tower', m: 'curl' }, ...(type === 'video' ? { src: 'https://example.com/old.png' } : { preview: { kind: 'image', src: 'https://example.com/old.png' } }) };
    const { t, boxId } = await setup(tile);
    mockSite({ title: 'Updated playlist', cover: 'new-playlist-cover' });
    await refresh(t, boxId);
    const fresh = (await view(t)).tiles[0];
    expect(fresh).toMatchObject({ title: tile.title, type, pos: tile.pos, size: tile.size });
    expect(type === 'video' ? fresh.src : fresh.preview.src).not.toBe('https://example.com/old.png');
    expect((await uploads(t))[0].referenced).toBe(true);
  });

  it('uses the playlist page cover when adding a playlist instead of a video thumbnail', async () => {
    const { a } = await setup({ id: 'note', type: 'note', html: 'Hello' });
    const fetch = mockSite({ title: 'Cats playlist', cover: 'playlist-cover' });
    const tile = await a.action(api.links.unfurl, { url: PLAYLIST + '&si=share' });
    expect(tile).toMatchObject({ type: 'video', title: 'Cats playlist', meta: 'Playlist on YouTube' });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([PLAYLIST, 'https://images.example.com/playlist-cover.png']);
  });

  it('leaves a video watch link with a playlist parameter on the video oEmbed path', async () => {
    const { a } = await setup({ id: 'note', type: 'note', html: 'Hello' });
    const fetch = vi.fn(async url => String(url).includes('/oembed?') ? new Response(JSON.stringify({ title: 'A video', thumbnail_url: 'https://images.example.com/video.png' })) : image('video'));
    vi.stubGlobal('fetch', fetch);
    const tile = await a.action(api.links.unfurl, { url: 'https://www.youtube.com/watch?v=cat&list=PLcats' });
    expect(tile.title).toBe('A video');
    expect(String(fetch.mock.calls[0][0])).toContain('/oembed?');
  });

  it('tries another advertised icon and favicon.ico when the preferred SVG cannot be stored', async () => {
    const { a } = await setup({ id: 'note', type: 'note', html: 'Hello' });
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url) === URL) return new Response('<head><title>A site</title><link rel="icon" href="/icon.svg"></head>', { headers: { 'content-type': 'text/html' } });
      if (String(url).endsWith('.svg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      if (String(url).endsWith('/favicon.ico')) return image('favicon');
      return new Response('', { status: 404 });
    }));
    expect((await a.action(api.links.unfurl, { url: URL })).icon.src).toMatch(/^https?:/);
  });
});

describe('preview merging', () => {
  it('preserves custom text, uploaded media and intentional removals without changing type or crop', () => {
    const original = { id: 'video', type: 'video', url: PLAYLIST, title: 'Fetched title', src: 'https://example.com/old.png', pos: '20% 80%' };
    const tile = { ...original, title: 'My title', src: 'https://example.com/upload.png', previewSource: previewSource(original, 1) };
    const data = previewSource({ ...original, title: 'Fresh title', src: 'https://example.com/new.png' }, 2);
    expect(mergePreview(tile, { url: tile.url, type: tile.type, data })).toMatchObject({ title: 'My title', src: tile.src, pos: tile.pos, type: tile.type });
    expect(mergePreview({ ...tile, src: null }, { url: tile.url, type: tile.type, data }).src).toBeNull();
  });

  it('does not keep old comparison images alive as media references', () => {
    const source = { url: URL, type: 'link', values: { icon: { src: 'https://example.com/old.png' } } };
    const profile = { tiles: [{ icon: { src: 'https://example.com/current.png' }, previewSource: source }], linkPreviews: [{ base: source, data: { values: { icon: { src: 'https://example.com/fresh.png' } } } }] };
    expect([...mediaUrls(profile)]).toEqual(['https://example.com/current.png', 'https://example.com/fresh.png']);
  });
});
