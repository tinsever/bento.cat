import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import { createHmac } from 'node:crypto';
import { api, internal } from '../convex/_generated/api.js';
import schema from '../convex/schema.js';
import { MAX_OWNER_BYTES, MAX_UPLOAD_BYTES, UNUSED_FILE_TTL } from '../convex/mediaPolicy.js';

const modules = import.meta.glob('../convex/**/*.js');
const identity = subject => ({ subject, issuer: 'https://clerk.example', tokenIdentifier: `https://clerk.example|${subject}`, email: `${subject}@example.com` });
async function owner(t, subject = 'user_owner') {
  const authed = t.withIdentity(identity(subject));
  await authed.mutation(api.users.store);
  await authed.mutation(api.boxes.claim, { handle: subject.replace('user_', '') });
  return authed;
}
const save = (t, data, expectedRevision = 0, saveId = crypto.randomUUID()) => t.mutation(api.boxes.save, { data, expectedRevision, saveId });
async function file(t, bytes = 'photo') {
  const blob = new Blob([bytes], { type: 'image/png' });
  const uploadId = await t.mutation(internal.files.reserve, { bytes: blob.size, contentType: blob.type });
  const storageId = await t.run(ctx => ctx.storage.store(blob));
  const url = await t.mutation(internal.files.attach, { uploadId, storageId });
  return { uploadId, storageId, url };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_fake'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('profile saves', () => {
  it('rejects stale tabs and makes a lost-response retry idempotent', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await expect(save(a, { name: 'First' }, 0, 'request-1')).resolves.toMatchObject({ revision: 1 });
    await expect(save(a, { name: 'First' }, 0, 'request-1')).resolves.toMatchObject({ revision: 1 });
    await expect(save(a, { name: 'Stale' }, 0, 'request-2')).rejects.toThrow();
    expect((await a.query(api.boxes.mine)).name).toBe('First');
  });
  it('requires authentication and rejects duplicate tile ids without changing the box', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await expect(save(t, { name: 'No' })).rejects.toThrow();
    await expect(save(a, { tiles: [{ id: 'same', type: 'note' }, { id: 'same', type: 'photo' }] })).rejects.toThrow();
    expect((await a.query(api.boxes.mine)).revision).toBe(0);
  });
});

describe('unfinished tiles', () => {
  it('keeps empty tiles in the editor but leaves them out of the public box', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    const tiles = [
      { id: 'draft', type: 'link', draft: true, title: '', url: '' },
      { id: 'nourl', type: 'music', title: 'Song', url: ' ' },
      { id: 'nomap', type: 'map', place: '', caption: 'Somewhere' },
      { id: 'nonote', type: 'note', html: '<br>&nbsp;' },
      { id: 'nosec', type: 'section', text: '' },
      { id: 'link', type: 'link', title: 'Site', url: 'https://example.com' },
      { id: 'map', type: 'map', place: '', lat: 46.2, lon: 6.1 },
      { id: 'note', type: 'note', html: '<b>Hi</b>' },
      { id: 'purr', type: 'purr', count: 0 },
    ];
    await save(a, { tiles });
    expect((await a.query(api.boxes.mine)).tiles.map(x => x.id)).toEqual(tiles.map(x => x.id));
    expect((await t.query(api.boxes.get, { handle: 'owner' })).tiles.map(x => x.id)).toEqual(['link', 'map', 'note', 'purr']);
  });
});

describe('Explore visibility', () => {
  const tiles = [{ id: 'note', type: 'text', text: 'Hello' }];

  it('includes existing boxes by default and leaves empty boxes out', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    expect((await a.query(api.boxes.mine)).showInExplore).toBe(true);
    expect(await t.query(api.boxes.explore)).toEqual([]);
    await save(a, { tiles });
    expect((await t.query(api.boxes.explore)).map(b => b.handle)).toEqual(['owner']);
  });

  it('excludes opted-out boxes from popular and recent picks while keeping direct links public', async () => {
    const t = convexTest(schema, modules), popular = await owner(t, 'user_popular'), recent = await owner(t, 'user_recent'), visible = await owner(t, 'user_visible');
    for (const a of [popular, recent]) await save(a, { tiles, showInExplore: false });
    await save(visible, { tiles });
    const box = await popular.query(api.boxes.mine);
    await t.run(ctx => ctx.db.insert('views', { boxId: box._id, count: 100 }));
    expect((await t.query(api.boxes.explore)).map(b => b.handle)).toEqual(['visible']);
    for (const handle of ['popular', 'recent']) {
      expect(await t.query(api.boxes.get, { handle })).toMatchObject({ handle, tiles });
    }
  });

  it('persists the choice across other saves and allows the owner to opt back in', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles, showInExplore: false });
    await save(a, { bio: 'Updated from an older editor' }, 1);
    expect((await a.query(api.boxes.mine)).showInExplore).toBe(false);
    expect(await t.query(api.boxes.explore)).toEqual([]);
    await expect(save(t, { showInExplore: true }, 2)).rejects.toThrow();
    await expect(save(a, { showInExplore: 'false' }, 2)).rejects.toThrow('Choose whether to show your box in Explore.');
    expect((await a.query(api.boxes.mine)).showInExplore).toBe(false);
    await save(a, { showInExplore: true }, 2);
    expect((await a.query(api.boxes.mine)).showInExplore).toBe(true);
    expect((await t.query(api.boxes.explore)).map(b => b.handle)).toEqual(['owner']);
  });
});

describe('sitemap discovery', () => {
  it('paginates across blank and opted-out boxes without exposing account data', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 28; i++) await ctx.db.insert('boxes', {
        handle: `box-${String(i).padStart(2, '0')}`, name: i === 27 ? 'Visible' : '', bio: '', tiles: [],
        updatedAt: i, ...(i === 26 ? { name: 'Hidden', showInExplore: false } : {}),
      });
    });
    const first = await t.query(api.boxes.sitemap, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.boxes.sitemap, { paginationOpts: { cursor: first.continueCursor, numItems: 25 } });
    expect(second.isDone).toBe(true);
    expect(second.page).toEqual([{ handle: 'box-27', updatedAt: 27 }]);
  });

  it('excludes unfinished tiles and includes finished content without an identity', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'draft', type: 'link', draft: true }, { id: 'section', type: 'section', text: 'Work' }] });
    const args = { paginationOpts: { cursor: null, numItems: 25 } };
    expect((await t.query(api.boxes.sitemap, args)).page).toEqual([]);
    expect(await t.query(api.boxes.explore)).toEqual([]);
    await save(a, { tiles: [{ id: 'note', type: 'note', html: '<b>Hello</b>' }] }, 1);
    expect((await t.query(api.boxes.sitemap, args)).page).toEqual([{ handle: 'owner', updatedAt: expect.any(Number) }]);
    expect((await t.query(api.boxes.explore)).map(b => b.handle)).toEqual(['owner']);
  });
});

describe('tile addresses', () => {
  it('keeps only web addresses in fields that end up in a src or href', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'say', type: 'sayname', audio: 'javascript:alert(1)', url: 'vbscript:x', cover: 'https://example.com/a.png' }] });
    const [tile] = (await a.query(api.boxes.mine)).tiles;
    expect(tile.audio).toBe('');
    expect(tile.url).toBe('');
    expect(tile.cover).toBe('https://example.com/a.png');
  });
});

describe('purr counts', () => {
  it('starts a new purr tile at zero whatever count the editor sends', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'paw', type: 'purr', count: 9999 }] });
    expect((await t.query(api.boxes.get, { handle: 'owner' })).tiles[0].count).toBe(0);
    const { _id: boxId } = await a.query(api.boxes.mine);
    await expect(t.mutation(api.interactions.purr, { boxId, tileId: 'paw', visitorKey: 'visitor-key-1' })).resolves.toMatchObject({ count: 1 });
    await save(a, { tiles: [{ id: 'paw', type: 'purr', count: 5000 }] }, 1);
    expect((await t.query(api.boxes.get, { handle: 'owner' })).tiles[0].count).toBe(1);
  });
});

describe('removed tiles', () => {
  it('clears what visitors left on a removed tile after the grace period, unless it came back', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    const tiles = [{ id: 'list', type: 'subscribe', title: 'News' }, { id: 'book', type: 'guestbook' }, { id: 'paw', type: 'purr', count: 0 }];
    await save(a, { tiles });
    const { _id: boxId } = await a.query(api.boxes.mine);
    await t.mutation(api.interactions.subscribe, { boxId, tileId: 'list', email: 'cat@example.com', visitorKey: 'visitor-key-1' });
    await t.mutation(api.interactions.scribble, { boxId, tileId: 'book', d: 'M1 1 L2 2', name: 'Cat', visitorKey: 'visitor-key-1' });
    await t.mutation(api.interactions.purr, { boxId, tileId: 'paw', visitorKey: 'visitor-key-1' });
    const rows = () => t.run(async ctx => Promise.all(['subscribers', 'scribbles', 'purrs', 'counters'].map(async n => (await ctx.db.query(n).collect()).length)));
    expect(await rows()).toEqual([1, 1, 1, 1]);
    // Removed then restored within the grace period: nothing is lost.
    await save(a, { tiles: [] }, 1);
    await save(a, { tiles }, 2);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await rows()).toEqual([1, 1, 1, 1]);
    // Removed for good: the email, the drawing and the purrs go.
    await save(a, { tiles: [] }, 3);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await rows()).toEqual([0, 0, 0, 0]);
  });
});

describe('media storage', () => {
  it('rejects oversized and active content before reserving storage', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    for (const [bytes, contentType] of [[MAX_UPLOAD_BYTES + 1, 'image/png'], [10, 'image/svg+xml'], [0, 'video/mp4']])
      await expect(a.mutation(internal.files.reserve, { bytes, contentType })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query('uploads').collect())).toEqual([]);
  });
  it('counts concurrent reservations against the owner quota', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    const me = await t.run(ctx => ctx.db.query('users').first());
    await t.run(ctx => ctx.db.insert('uploads', { ownerId: me._id, bytes: MAX_OWNER_BYTES - 10, contentType: 'image/png', referenced: true }));
    await a.mutation(internal.files.reserve, { bytes: 6, contentType: 'image/png' });
    await expect(a.mutation(internal.files.reserve, { bytes: 6, contentType: 'image/png' })).rejects.toThrow();
  });
  it('does not let another owner attach or save someone else’s media', async () => {
    const t = convexTest(schema, modules), a = await owner(t), b = await owner(t, 'user_other');
    const f = await file(a);
    await expect(b.mutation(internal.files.attach, { uploadId: f.uploadId, storageId: f.storageId })).rejects.toThrow();
    await expect(save(b, { avatar: f.url })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.system.get(f.storageId))).not.toBeNull();
  });
  it('keeps referenced files, allows undo, and deletes removed files after the grace period', async () => {
    const t = convexTest(schema, modules), a = await owner(t), f = await file(a);
    await save(a, { avatar: f.url });
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run(ctx => ctx.db.system.get(f.storageId))).not.toBeNull();
    await save(a, { avatar: null }, 1);
    await save(a, { avatar: f.url }, 2);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run(ctx => ctx.db.system.get(f.storageId))).not.toBeNull();
    await save(a, { avatar: null }, 3);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run(ctx => ctx.db.system.get(f.storageId))).toBeNull();
  });
  it('rejects unauthenticated HTTP uploads and supplies CORS on failures', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'photo' });
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await t.run(ctx => ctx.db.query('uploads').collect())).toHaveLength(0);
  });
  it('uploads through the authenticated HTTP path and enforces size and type limits there', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    const response = await a.fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'photo' });
    expect(response.status).toBe(200);
    const { src } = await response.json();
    const row = await t.run(ctx => ctx.db.query('uploads').first());
    expect(row.url).toBe(src);
    expect(row.bytes).toBe(5);
    const oversized = await a.fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_UPLOAD_BYTES + 1) }, body: 'photo' });
    expect(oversized.status).toBe(413);
    const svg = await a.fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' });
    expect(svg.status).toBe(415);
    expect(await t.run(ctx => ctx.db.query('uploads').collect())).toHaveLength(1);
  });
});

describe('account deletion', () => {
  it('keeps the account intact when Clerk deletion is not configured', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    vi.stubEnv('CLERK_SECRET_KEY', '');
    await expect(a.mutation(api.boxes.remove)).rejects.toThrow();
    expect((await a.query(api.boxes.mine)).handle).toBe('owner');
  });
  it('purges owned media and visitor rows without touching another account or shared assets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const t = convexTest(schema, modules), a = await owner(t), b = await owner(t, 'user_other');
    const f = await file(a), other = await file(b);
    const box = await a.query(api.boxes.mine);
    await t.run(async ctx => {
      await ctx.db.insert('subscribers', { boxId: box._id, tileId: 's', email: 'visitor@example.com', visitorKey: 'visitor-key' });
      await ctx.db.insert('views', { boxId: box._id, count: 2 });
    });
    await a.mutation(api.boxes.remove);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run(ctx => ctx.db.system.get(f.storageId))).toBeNull();
    expect(await t.run(ctx => ctx.db.system.get(other.storageId))).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query('subscribers').collect())).toEqual([]);
    expect(await a.mutation(api.users.store)).toBeNull();
    expect((await b.query(api.boxes.mine)).handle).toBe('other');
  });
  it('retries Clerk failures and treats an already deleted Clerk user as success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const t = convexTest(schema, modules), a = await owner(t);
    await a.mutation(api.boxes.remove);
    vi.advanceTimersByTime(0); await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(0); await t.finishInProgressScheduledFunctions();
    expect((await t.run(ctx => ctx.db.query('deletedUsers').first())).clerkDeleted).toBe(false);
    vi.advanceTimersByTime(60_000); await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(0); await t.finishInProgressScheduledFunctions();
    expect((await t.run(ctx => ctx.db.query('deletedUsers').first())).clerkDeleted).toBe(true);
  });
  it('rejects unsigned Clerk webhooks', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', 'whsec_ZmFrZQ==');
    const t = convexTest(schema, modules), a = await owner(t);
    const response = await t.fetch('/clerk-webhook', { method: 'POST', body: JSON.stringify({ type: 'user.deleted', data: { id: 'user_owner' } }) });
    expect(response.status).toBe(400);
    expect(await a.query(api.boxes.mine)).not.toBeNull();
  });
  it('verifies signed dashboard deletions and handles repeated deliveries idempotently', async () => {
    const secret = Buffer.from('a-real-test-signing-secret').toString('base64');
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', `whsec_${secret}`);
    const t = convexTest(schema, modules), a = await owner(t);
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_owner', object: 'user', deleted: true } });
    const timestamp = String(Math.floor(Date.now() / 1000)), messageId = 'msg_test';
    const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${messageId}.${timestamp}.${body}`).digest('base64');
    const request = { method: 'POST', body, headers: { 'svix-id': messageId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } };
    expect((await t.fetch('/clerk-webhook', request)).status).toBe(200);
    expect((await t.fetch('/clerk-webhook', request)).status).toBe(200);
    expect(await a.query(api.boxes.mine)).toBeNull();
    expect(await a.mutation(api.users.store)).toBeNull();
    expect(await t.run(ctx => ctx.db.query('deletedUsers').collect())).toHaveLength(1);
  });
});

describe('moderation and retention', () => {
  it('allows only the owner to list or remove visitor entries', async () => {
    const t = convexTest(schema, modules), a = await owner(t), b = await owner(t, 'user_other');
    const box = await a.query(api.boxes.mine);
    const id = await t.run(ctx => ctx.db.insert('scribbles', { boxId: box._id, tileId: 'guestbook', d: 'M1 1 L2 2', name: 'Visitor' }));
    expect((await a.query(api.moderation.scribbles, { paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(1);
    expect((await b.query(api.moderation.scribbles, { paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(0);
    await expect(b.mutation(api.moderation.removeScribble, { id })).rejects.toThrow();
    await a.mutation(api.moderation.removeScribble, { id });
    expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
  });
  it('never hands visitor keys to the owner', async () => {
    const t = convexTest(schema, modules), a = await owner(t);
    const box = await a.query(api.boxes.mine);
    await t.run(async ctx => {
      await ctx.db.insert('scribbles', { boxId: box._id, tileId: 'book', d: 'M1 1 L2 2', name: 'Visitor', visitorKey: 'visitor-key-1' });
      await ctx.db.insert('subscribers', { boxId: box._id, tileId: 'list', email: 'cat@example.com', visitorKey: 'visitor-key-1' });
    });
    const opts = { paginationOpts: { numItems: 10, cursor: null } };
    const [scribble] = (await a.query(api.moderation.scribbles, opts)).page;
    const [subscriber] = (await a.query(api.moderation.subscribers, opts)).page;
    expect(scribble).toMatchObject({ name: 'Visitor', d: 'M1 1 L2 2' });
    expect(subscriber).toMatchObject({ email: 'cat@example.com' });
    expect(scribble).not.toHaveProperty('visitorKey');
    expect(subscriber).not.toHaveProperty('visitorKey');
  });
  it('removes only the matching browser’s subscription', async () => {
    const t = convexTest(schema, modules), a = await owner(t), box = await a.query(api.boxes.mine);
    await t.run(async ctx => {
      for (const visitorKey of ['visitor-one', 'visitor-two']) await ctx.db.insert('subscribers', { boxId: box._id, tileId: 's', email: `${visitorKey}@example.com`, visitorKey });
    });
    await t.mutation(api.moderation.unsubscribe, { boxId: box._id, tileId: 's', visitorKey: 'visitor-one' });
    expect((await t.run(ctx => ctx.db.query('subscribers').collect())).map(row => row.visitorKey)).toEqual(['visitor-two']);
  });
  it('expires raw visits and old rate limits while keeping aggregate views', async () => {
    const t = convexTest(schema, modules), a = await owner(t), box = await a.query(api.boxes.mine);
    await t.run(async ctx => {
      await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'old-visitor', at: Date.now() - 31 * 86400000 });
      await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'new-visitor', at: Date.now() });
      await ctx.db.insert('limits', { key: 'expired', windowStart: Date.now() - 2 * 86400000, count: 1 });
      await ctx.db.insert('limits', { key: 'active', windowStart: Date.now(), count: 1 });
      await ctx.db.insert('views', { boxId: box._id, count: 2 });
    });
    await t.mutation(internal.retention.cleanup);
    expect((await t.run(ctx => ctx.db.query('visits').collect())).map(row => row.visitorKey)).toEqual(['new-visitor']);
    expect((await t.run(ctx => ctx.db.query('limits').collect())).map(row => row.key)).toEqual(['active']);
    expect((await t.run(ctx => ctx.db.query('views').first())).count).toBe(2);
  });
});

describe('subscriber emails', () => {
  const join = (t, boxId, email, visitorKey = `key-${email}`) => t.mutation(api.interactions.subscribe, { boxId, tileId: 'list', email, visitorKey });
  const run = async t => { vi.advanceTimersByTime(0); await t.finishInProgressScheduledFunctions(); };
  const sent = fetch => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

  it('emails the owner once per new address, and not after they turn it off', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'Kerning <Notes>' }] });
    const { _id: boxId } = await a.query(api.boxes.mine);

    await join(t, boxId, 'Mia@Example.com ');
    await run(t);
    const [mail] = sent(fetch);
    expect(fetch.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
    expect(mail).toMatchObject({ sender: { email: 'hello@bento.cat' }, to: [{ email: 'user_owner@example.com' }], subject: 'New on Kerning <Notes>: mia@example.com' });
    expect(mail.htmlContent).toContain('Someone joined Kerning &lt;Notes&gt;');
    expect(mail.htmlContent).toContain('https://bento.cat/edit?open=subscribers');
    expect(mail.textContent).toContain('first one on the list');

    // The same address again is not a new subscriber.
    await join(t, boxId, 'mia@example.com', 'another-key');
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(1);

    await join(t, boxId, 'jonas@example.com');
    await run(t);
    expect(sent(fetch)[1].textContent).toContain('That makes 2 people on the list.');

    await save(a, { notifySubscribers: false }, 1);
    expect((await a.query(api.boxes.mine)).notifySubscribers).toBe(false);
    await join(t, boxId, 'ana@example.com');
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends nothing without a Brevo key, and caps a flood', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    const { _id: boxId } = await a.query(api.boxes.mine);
    await join(t, boxId, 'one@example.com');
    await run(t);
    expect(fetch).not.toHaveBeenCalled();

    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    for (let i = 0; i < 25; i++) await join(t, boxId, `cat${i}@example.com`);
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(19);
  });

  it('lists people per tile, newest first, for the owner only', async () => {
    const t = convexTest(schema, modules), a = await owner(t), b = await owner(t, 'user_other');
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }, { id: 'empty', type: 'subscribe', title: '' }] });
    const { _id: boxId } = await a.query(api.boxes.mine);
    await join(t, boxId, 'first@example.com');
    vi.advanceTimersByTime(1000);
    await join(t, boxId, 'second@example.com');
    const lists = await a.query(api.moderation.lists);
    expect(lists.map(l => [l.tileId, l.title, l.people.map(p => p.email)])).toEqual([
      ['list', 'News', ['second@example.com', 'first@example.com']],
      ['empty', '', []],
    ]);
    expect(lists[0].people[0]).not.toHaveProperty('visitorKey');
    expect(await b.query(api.moderation.lists)).toEqual([]);
  });

  it.each(['network', 429, 503])('retries a temporary failure (%s) with the same idempotency key', async failure => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn().mockImplementationOnce(async () => {
      if (failure === 'network') throw new Error('Connection reset');
      return new Response('{}', { status: failure });
    }).mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    await join(t, (await a.query(api.boxes.mine))._id, 'cat@example.com');
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, second] = sent(fetch);
    expect(first.headers.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(second.headers.idempotencyKey).toBe(first.headers.idempotencyKey);
    expect(await t.run(ctx => ctx.db.query('subscribers').collect())).toHaveLength(1);
  });

  it.each(['unsubscribe', 'opt-out', 'removed tile'])('cancels a retry after %s', async change => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    const boxId = (await a.query(api.boxes.mine))._id;
    await join(t, boxId, 'cat@example.com', 'visitor-test');
    await run(t);
    if (change === 'unsubscribe') await t.mutation(api.moderation.unsubscribe, { boxId, tileId: 'list', visitorKey: 'visitor-test' });
    else await save(a, change === 'opt-out' ? { notifySubscribers: false } : { tiles: [] }, 1);
    vi.advanceTimersByTime(30_000);
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401])('does not retry a permanent Brevo error (%s)', async status => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn(async () => new Response('{}', { status }));
    vi.stubGlobal('fetch', fetch);
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    const boxId = (await a.query(api.boxes.mine))._id;
    await t.run(ctx => ctx.db.insert('subscribers', { boxId, tileId: 'list', email: 'cat@example.com', visitorKey: 'visitor-test' }));
    const sub = await t.run(ctx => ctx.db.query('subscribers').first());
    await expect(t.action(internal.notify.newSubscriber, { subscriberId: sub._id })).rejects.toThrow(`HTTP ${status}`);
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0);
  });

  it('treats a Brevo duplicate response as an already accepted email', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'duplicate_parameter' }), { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    await join(t, (await a.query(api.boxes.mine))._id, 'cat@example.com');
    await run(t);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).every(job => job.state.kind === 'success')).toBe(true);
  });

  it('stops after three retries and records the exhausted notification as failed', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = convexTest(schema, modules), a = await owner(t);
    await save(a, { tiles: [{ id: 'list', type: 'subscribe', title: 'News' }] });
    await join(t, (await a.query(api.boxes.mine))._id, 'cat@example.com');
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(new Set(sent(fetch).map(mail => mail.headers.idempotencyKey)).size).toBe(1);
    const jobs = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(jobs.filter(job => job.state.kind === 'failed')).toHaveLength(1);
  });
});
