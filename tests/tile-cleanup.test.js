import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import schema from '../convex/schema.js';
import { api, internal } from '../convex/_generated/api.js';
import { purgeTiles } from '../convex/boxes.js';
import { UNUSED_FILE_TTL } from '../convex/mediaPolicy.js';

const modules = import.meta.glob('../convex/**/*.js');
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function setup(tiles) {
  const t = convexTest(schema, modules);
  const a = t.withIdentity({ subject: 'owner', tokenIdentifier: 'https://clerk.example|owner', issuer: 'https://clerk.example' });
  await a.mutation(api.users.store);
  await a.mutation(api.boxes.claim, { handle: 'owner' });
  const save = (tiles, expectedRevision) => a.mutation(api.boxes.save, { data: { tiles }, expectedRevision, saveId: crypto.randomUUID() });
  await save(tiles, 0);
  return { t, save, boxId: (await a.query(api.boxes.mine))._id };
}
const rows = (t, table) => t.run(ctx => ctx.db.query(table).collect());

describe('tile cleanup jobs', () => {
  it('starts a fresh grace period when a restored tile is removed again', async () => {
    const tiles = [{ id: 'list', type: 'subscribe', title: 'News' }];
    const { t, save, boxId } = await setup(tiles);
    await t.mutation(api.interactions.subscribe, { boxId, tileId: 'list', email: 'cat@example.com', visitorKey: 'visitor-123' });
    await save([], 1);
    vi.advanceTimersByTime(UNUSED_FILE_TTL / 2);
    await save(tiles, 2);
    expect(await rows(t, 'tilePurges')).toEqual([]);
    await save([], 3);
    vi.advanceTimersByTime(UNUSED_FILE_TTL / 2);
    await t.finishInProgressScheduledFunctions();
    expect(await rows(t, 'subscribers')).toHaveLength(1);
    vi.advanceTimersByTime(UNUSED_FILE_TTL / 2);
    await t.finishInProgressScheduledFunctions();
    expect(await rows(t, 'subscribers')).toEqual([]);
    expect(await rows(t, 'tilePurges')).toEqual([]);
  });

  it('bounds the entire invocation across many tiles and schedules the remainder', async () => {
    let deletes = 0;
    const runAfter = vi.fn();
    const db = {
      get: async () => ({ tiles: [] }), delete: async () => { deletes++; },
      query: table => ({
        withIndex: (_, select) => {
          const fields = {};
          select({ eq(name, value) { fields[name] = value; return this; } });
          return {
            unique: async () => ({ _id: 'queued-' + fields.tileId, expiresAt: 0 }),
            take: async n => table === 'subscribers' ? Array.from({ length: n }, (_, i) => ({ _id: String(i) })) : [],
          };
        },
      }),
    };
    const tileIds = Array.from({ length: 41 }, (_, i) => 'list' + i);
    await purgeTiles._handler({ db, scheduler: { runAfter } }, { boxId: 'fixture', tileIds });
    expect(deletes).toBe(400);
    expect(runAfter).toHaveBeenCalledWith(0, internal.boxes.purgeTiles, { boxId: 'fixture', tileIds });
  });

  it('drains multiple tiles over several batches without losing the queue or unrelated rows', async () => {
    const tiles = ['a', 'b', 'c', 'kept'].map(id => ({ id, type: 'subscribe', title: 'News' }));
    const { t, save, boxId } = await setup(tiles);
    await t.run(async ctx => {
      for (const tileId of ['a', 'b', 'c']) for (let i = 0; i < 450; i++)
        await ctx.db.insert('subscribers', { boxId, tileId, email: 'cat' + i + '@example.com', visitorKey: 'visitor-' + i });
      await ctx.db.insert('subscribers', { boxId, tileId: 'kept', email: 'stay@example.com', visitorKey: 'visitor-kept' });
    });
    await save([tiles[3]], 1);
    vi.advanceTimersByTime(UNUSED_FILE_TTL);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await rows(t, 'subscribers')).map(r => r.email)).toEqual(['stay@example.com']);
    expect(await rows(t, 'tilePurges')).toEqual([]);
  });
});
