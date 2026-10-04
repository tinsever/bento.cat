import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api.js';
import schema from '../convex/schema.js';
import { VISIT_RETENTION } from '../convex/retention.js';

const modules = import.meta.glob('../convex/**/*.js');
async function owner(t, subject) {
  const a = t.withIdentity({ subject, issuer: 'https://clerk.example', tokenIdentifier: `https://clerk.example|${subject}` });
  await a.mutation(api.users.store);
  await a.mutation(api.boxes.claim, { handle: subject });
  return a;
}
const drain = t => t.finishAllScheduledFunctions(() => vi.runAllTimers());
const rows = (t, table) => t.run(ctx => ctx.db.query(table).collect());

async function useProductionStorageUrls(t) {
  // convex-test substitutes a SHA checksum for the ID in file URLs. Exercise
  // the real /api/storage/<storageId> format while keeping its storage engine.
  await t.run(async () => {
    const syscall = globalThis.Convex.asyncSyscall;
    vi.spyOn(globalThis.Convex, 'asyncSyscall', 'get').mockReturnValue(async (name, args) => {
      const result = await syscall(name, args);
      if (name === '1.0/storageGetUrl' && JSON.parse(result) !== null)
        return JSON.stringify(`https://some-deployment.convex.cloud/api/storage/${JSON.parse(args).storageId}`);
      return result;
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_fake');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('deletion cleanup', () => {
  it('deletes untracked legacy files while preserving shared and other-owner files', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner'), b = await owner(t, 'other');
    await useProductionStorageUrls(t);
    const box = await a.query(api.boxes.mine), otherBox = await b.query(api.boxes.mine);
    const files = await t.run(async ctx => {
      const result = [];
      for (let i = 0; i < 4; i++) {
        const id = await ctx.storage.store(new Blob([`file${i}`], { type: 'image/png' }));
        result.push({ id, url: await ctx.storage.getUrl(id) });
      }
      await ctx.db.insert('assets', { key: 'shared', storageId: result[1].id, url: result[1].url });
      const otherUser = (await ctx.db.get(otherBox._id)).ownerId;
      await ctx.db.insert('uploads', { ownerId: otherUser, storageId: result[3].id, url: result[3].url, bytes: 5, contentType: 'image/png', referenced: true });
      await ctx.db.patch(box._id, { avatar: result[0].url, tiles: result.slice(1).map((f, i) => ({ id: `photo${i}`, type: 'photo', src: f.url })) });
      await ctx.db.patch(otherBox._id, { avatar: result[2].url });
      return result;
    });
    await a.mutation(api.boxes.remove);
    await drain(t);
    expect(await t.run(ctx => ctx.db.system.get(files[0].id))).toBeNull();
    for (const f of files.slice(1)) expect(await t.run(ctx => ctx.db.system.get(f.id))).not.toBeNull();
    expect(await rows(t, 'legacyMediaPurges')).toEqual([]);
  });

  it('blocks a concurrent save from adopting a legacy file reserved for deletion', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner'), b = await owner(t, 'other');
    await useProductionStorageUrls(t);
    const box = await a.query(api.boxes.mine);
    const url = await t.run(async ctx => {
      const id = await ctx.storage.store(new Blob(['legacy'], { type: 'image/png' }));
      const url = await ctx.storage.getUrl(id);
      await ctx.db.patch(box._id, { avatar: url });
      return url;
    });
    await a.mutation(api.boxes.remove);
    await expect(b.mutation(api.boxes.save, { data: { avatar: url }, expectedRevision: 0, saveId: 'other-save' })).rejects.toThrow('being removed');
    await drain(t);
  });

  it('purges more than one batch of uploads, activity and visits to other boxes', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner'), b = await owner(t, 'other');
    const box = await a.query(api.boxes.mine), other = await b.query(api.boxes.mine);
    const me = (await rows(t, 'users')).find(u => u.clerkId === 'owner');
    const storageIds = await t.run(async ctx => {
      const ids = [];
      for (let i = 0; i < 105; i++) {
        const storageId = await ctx.storage.store(new Blob([`f${i}`], { type: 'audio/ogg' }));
        ids.push(storageId);
        await ctx.db.insert('uploads', { ownerId: me._id, storageId, bytes: 4, contentType: 'audio/ogg', referenced: true });
      }
      for (let i = 0; i < 405; i++) {
        await ctx.db.insert('purrs', { boxId: box._id, tileId: `p${i}`, visitorKey: 'visitor-key' });
        await ctx.db.insert('visits', { boxId: other._id, viewerBoxId: box._id, visitorKey: 'visitor-key', at: Date.now() });
      }
      return ids;
    });
    await a.mutation(api.boxes.remove);
    await drain(t);
    for (const id of storageIds) expect(await t.run(ctx => ctx.db.system.get(id))).toBeNull();
    for (const table of ['uploads', 'purrs', 'visits']) expect(await rows(t, table)).toEqual([]);
    expect(await b.query(api.boxes.mine)).not.toBeNull();
  });

  it('cleans media and visitor rows after a Clerk-initiated account deletion too', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner');
    await useProductionStorageUrls(t);
    const box = await a.query(api.boxes.mine);
    const storageId = await t.run(async ctx => {
      const id = await ctx.storage.store(new Blob(['photo'], { type: 'image/png' }));
      await ctx.db.patch(box._id, { avatar: await ctx.storage.getUrl(id) });
      await ctx.db.insert('subscribers', { boxId: box._id, tileId: 'list', email: 'a@example.com', visitorKey: 'visitor-key' });
      return id;
    });
    await t.mutation(internal.accounts.deletedByClerk, { clerkId: 'owner' });
    await t.mutation(internal.accounts.deletedByClerk, { clerkId: 'owner' });
    await drain(t);
    expect(await t.run(ctx => ctx.db.system.get(storageId))).toBeNull();
    expect(await rows(t, 'subscribers')).toEqual([]);
    expect(await rows(t, 'deletedUsers')).toHaveLength(1);
    expect(await a.mutation(api.users.store)).toBeNull();
  });
});

describe('visit retention', () => {
  it('records a member’s visit once per half hour, ignores the owner, and stores no browser key', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner'), b = await owner(t, 'member');
    const box = await a.query(api.boxes.mine);
    await b.mutation(api.interactions.visit, { boxId: box._id });
    await b.mutation(api.interactions.visit, { boxId: box._id });
    await a.mutation(api.interactions.visit, { boxId: box._id });
    const visits = await rows(t, 'visits');
    expect(visits).toHaveLength(1);
    expect(visits[0].visitorKey).toBeUndefined();
    expect(visits[0].viewerBoxId).toBe((await b.query(api.boxes.mine))._id);
    expect(await rows(t, 'views')).toEqual([]);
    vi.advanceTimersByTime(31 * 60 * 1000);
    await b.mutation(api.interactions.visit, { boxId: box._id });
    expect(await rows(t, 'visits')).toHaveLength(2);
  });

  it('expires visits in batches at 30 days and stale rate limits without losing aggregates', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner');
    const box = await a.query(api.boxes.mine), boundary = Date.now() - VISIT_RETENTION;
    await t.run(async ctx => {
      for (let i = 0; i < 405; i++) await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'old-key-123', at: boundary - i });
      await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'recent-key', at: boundary + 1 });
      await ctx.db.insert('views', { boxId: box._id, count: 406 });
      await ctx.db.insert('viewHours', { boxId: box._id, hour: boundary - 3_600_000, count: 3 });
      await ctx.db.insert('viewHours', { boxId: box._id, hour: boundary + 3_600_000, count: 2 });
      await ctx.db.insert('limits', { key: 'expired-visitor-key', windowStart: boundary, count: 5 });
      await ctx.db.insert('limits', { key: 'active-key', windowStart: Date.now(), count: 1 });
    });
    await t.mutation(internal.retention.cleanup);
    await drain(t);
    expect(await rows(t, 'visits')).toHaveLength(1);
    expect((await rows(t, 'visits'))[0].at).toBe(boundary + 1);
    expect((await rows(t, 'views'))[0].count).toBe(406);
    expect((await rows(t, 'viewHours')).map(r => r.count)).toEqual([2]);
    expect((await rows(t, 'limits')).map(r => r.key)).toEqual(['active-key']);
  });

  it('erasing an old opt-in key removes only visits under that key, including multiple batches', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner');
    const box = await a.query(api.boxes.mine);
    await t.run(async ctx => {
      for (let i = 0; i < 405; i++) await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'withdrawn-key', at: Date.now() });
      await ctx.db.insert('visits', { boxId: box._id, visitorKey: 'other-key', at: Date.now() });
    });
    await t.mutation(api.interactions.forgetVisits, { visitorKey: 'withdrawn-key' });
    await drain(t);
    expect((await rows(t, 'visits')).map(r => r.visitorKey)).toEqual(['other-key']);
    expect(await rows(t, 'revokedVisitKeys')).toHaveLength(1);
    vi.advanceTimersByTime(VISIT_RETENTION);
    await t.mutation(internal.retention.cleanup);
    expect(await rows(t, 'revokedVisitKeys')).toEqual([]);
  });
});

describe('observable Clerk failures', () => {
  it.each([401, 429, 503])('persists HTTP %s and exposes retrying status without account data', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    const t = convexTest(schema, modules), a = await owner(t, 'owner');
    const { deletionId } = await a.mutation(api.boxes.remove);
    await t.mutation(internal.accounts.processDeletion, { id: deletionId });
    await expect(t.action(internal.accounts.deleteClerk, { id: deletionId })).rejects.toThrow('durable retry');
    const job = await t.query(internal.accounts.job, { id: deletionId });
    expect(job.lastError).toContain(`HTTP ${status}`);
    expect(job.attempts).toBe(1);
    expect(job.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(await t.query(api.accounts.deletionStatus, { id: deletionId })).toEqual({ status: 'retrying' });
    expect(await t.query(internal.accounts.pendingDeletions)).toHaveLength(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await drain(t);
    expect(await t.query(api.accounts.deletionStatus, { id: deletionId })).toEqual({ status: 'complete' });
    expect((await t.query(internal.accounts.job, { id: deletionId })).lastError).toBeUndefined();
  });

  it('records network and missing-configuration failures instead of swallowing them', async () => {
    const t = convexTest(schema, modules), a = await owner(t, 'owner');
    const { deletionId } = await a.mutation(api.boxes.remove);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network unavailable'); }));
    await expect(t.action(internal.accounts.deleteClerk, { id: deletionId })).rejects.toThrow('Network unavailable');
    expect((await t.query(internal.accounts.job, { id: deletionId })).lastError).toBe('Network unavailable');
    vi.stubEnv('CLERK_SECRET_KEY', '');
    await expect(t.action(internal.accounts.deleteClerk, { id: deletionId })).rejects.toThrow('CLERK_SECRET_KEY');
    expect((await t.query(internal.accounts.job, { id: deletionId })).lastError).toContain('CLERK_SECRET_KEY');
  });

  it('the watchdog recovers an old pending deletion with no scheduled retry', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('deletedUsers', { tokenIdentifier: 'old-token', clerkId: 'old-user', clerkDeleted: false, attempts: 3 }));
    await t.mutation(internal.accounts.retryDeletions);
    await drain(t);
    expect((await t.query(internal.accounts.job, { id })).clerkDeleted).toBe(true);
  });
});
