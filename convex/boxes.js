import { ConvexError, v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { hasPublicContent } from '../src/lib/public-content.js';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import {
  NEW_SUGGESTIONS, boxByHandle, boxOfUser, cleanProfile, currentUser, handleState, isBlank, requireOwnBox, requireUser,
} from './lib';
import { syncReferences } from './files';
import { UNUSED_FILE_TTL } from './mediaPolicy';
import { eraseUser } from './accounts';

// Everything a page needs to draw a box, with live counts and what this visitor already did.
// Visitors get only finished tiles; the owner's editor gets everything.
async function present(ctx, box, visitorKey, { blanks = false } = {}) {
  const counters = await ctx.db.query('counters').withIndex('by_box_tile', q => q.eq('boxId', box._id)).collect();
  const counts = Object.fromEntries(counters.map(c => [c.tileId, c.count]));

  const scribbles = {};
  const gbTiles = box.tiles.filter(t => t.type === 'guestbook');
  for (const t of gbTiles) {
    const rows = await ctx.db.query('scribbles').withIndex('by_box_tile', q => q.eq('boxId', box._id).eq('tileId', t.id)).order('desc').take(200);
    scribbles[t.id] = { total: rows.length, recent: rows.slice(0, 12).reverse().map(r => ({ d: r.d, name: r.name })) };
  }

  let purred = [], subscribed = [];
  if (visitorKey) {
    purred = (await ctx.db.query('purrs').withIndex('by_box_visitor', q => q.eq('boxId', box._id).eq('visitorKey', visitorKey)).collect()).map(p => p.tileId);
    subscribed = (await ctx.db.query('subscribers').withIndex('by_box_visitor', q => q.eq('boxId', box._id).eq('visitorKey', visitorKey)).collect()).map(s => s.tileId);
  }

  const user = await currentUser(ctx);
  const tiles = box.tiles.filter(t => blanks || !isBlank(t)).map(t => (t.type === 'purr' ? { ...t, count: counts[t.id] ?? t.count ?? 0 } : t));

  return {
    _id: box._id,
    handle: box.handle,
    demo: !!box.demo,
    name: box.name,
    bio: box.bio,
    avatar: box.avatar ?? null,
    avatarVideo: box.avatarVideo ?? null,
    avatarPos: box.avatarPos ?? '50% 40%',
    avatarShape: box.avatarShape ?? 'circle',
    footer: box.footer ?? null,
    tiles,
    mobile: box.mobile ?? null,
    scribbles,
    viewer: { purred, subscribed },
    isOwner: !!user && box.ownerId === user._id,
    updatedAt: box.updatedAt,
  };
}

export const get = query({
  args: { handle: v.string(), visitorKey: v.optional(v.string()) },
  handler: async (ctx, { handle, visitorKey }) => {
    const box = await boxByHandle(ctx, handle.toLowerCase());
    return box ? await present(ctx, box, visitorKey) : null;
  },
});

// The signed-in person's own box, in the shape the editor works with.
export const mine = query({
  args: {},
  handler: async ctx => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const box = await boxOfUser(ctx, user._id);
    if (!box) return null;
    const view = await present(ctx, box, null, { blanks: true });
    return {
      ...view,
      email: user.email ?? null,
      onboarding: !!box.onboarding,
      shared: !!box.shared,
      showInExplore: box.showInExplore !== false,
      shareVisits: box.shareVisits !== false,
      notifySubscribers: box.notifySubscribers !== false,
      suggestions: box.suggestions ?? [],
      revision: box.revision ?? 0,
      lastSaveId: box.lastSaveId ?? null,
    };
  },
});

export const handleStatus = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const h = handle.trim().toLowerCase();
    const state = handleState(h);
    if (state === 'invalid') return { state: 'bad', msg: 'Letters, numbers, dots and dashes. 2 to 24 of them.' };
    if (state === 'blocked') return { state: 'bad', msg: 'That one’s reserved for the cats who run the place.' };
    const existing = await boxByHandle(ctx, h);
    if (!existing) return { state: 'free', msg: 'Empty box. It’s yours.' };
    const user = await currentUser(ctx);
    if (user && existing.ownerId === user._id) return { state: 'same', msg: 'That’s your address now.' };
    const base = h.replace(/[._-]+$/, '');
    for (const alt of [`${base}.ink`, `${base}cat`, `${base}-studio`, `hey${base}`]) {
      if (handleState(alt) === 'ok' && !(await boxByHandle(ctx, alt))) return { state: 'taken', msg: 'Someone’s napping here. Try', alt };
    }
    return { state: 'taken', msg: 'Someone’s napping here.' };
  },
});

export const claim = mutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const user = await requireUser(ctx);
    const h = handle.trim().toLowerCase();
    const mine = await boxOfUser(ctx, user._id);
    if (mine) return { handle: mine.handle, existing: true };
    if (handleState(h) !== 'ok') throw new ConvexError('That address can’t be used.');
    if (await boxByHandle(ctx, h)) throw new ConvexError('Someone just took that one.');
    await ctx.db.insert('boxes', {
      handle: h,
      ownerId: user._id,
      name: '',
      bio: '',
      avatar: null,
      avatarShape: 'circle',
      onboarding: true,
      shared: false,
      suggestions: NEW_SUGGESTIONS,
      tiles: [],
      updatedAt: Date.now(),
    });
    return { handle: h, existing: false };
  },
});

// The editor sends the whole profile and layout; only the owner may write it.
export const save = mutation({
  args: { data: v.any(), expectedRevision: v.number(), saveId: v.string() },
  handler: async (ctx, { data, expectedRevision, saveId }) => {
    const { user, box } = await requireOwnBox(ctx);
    if (!saveId || saveId.length > 80 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new ConvexError('Invalid save request. Refresh your editor.');
    // Retry of a save whose response was lost must not advance the revision twice.
    if (box.lastSaveId === saveId) return { revision: box.revision ?? 0, updatedAt: box.updatedAt };
    if ((box.revision ?? 0) !== expectedRevision)
      throw new ConvexError({ code: 'SAVE_CONFLICT', message: 'Your box changed in another tab. Your edits are kept in this browser.' });
    if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 250_000)
      throw new ConvexError('That box is too large to save.');
    const patch = cleanProfile(data ?? {});
    const revision = expectedRevision + 1, updatedAt = Date.now();
    await syncReferences(ctx, user._id, { ...box, ...patch });
    await ctx.db.patch(box._id, { ...patch, revision, lastSaveId: saveId, updatedAt });
    // Turning off visit sharing also takes this box out of everyone's past visitors.
    if (patch.shareVisits === false && box.shareVisits !== false)
      await ctx.scheduler.runAfter(0, internal.accounts.purgeViewerVisits, { boxId: box._id });
    // What visitors left on a removed tile goes too, after the same grace as media so Undo can bring it back.
    if (patch.tiles) {
      const kept = new Set(patch.tiles.map(t => t.id));
      for (const tileId of kept) {
        const queued = await ctx.db.query('tilePurges').withIndex('by_box_tile', q => q.eq('boxId', box._id).eq('tileId', tileId)).unique();
        if (queued) await ctx.db.delete(queued._id);
      }
      const tileIds = box.tiles.filter(t => TILE_ROWS.some(([, , types]) => types.includes(t.type)) && !kept.has(t.id)).map(t => t.id);
      for (const tileId of tileIds) {
        const queued = await ctx.db.query('tilePurges').withIndex('by_box_tile', q => q.eq('boxId', box._id).eq('tileId', tileId)).unique();
        const expiresAt = updatedAt + UNUSED_FILE_TTL;
        if (queued) await ctx.db.patch(queued._id, { expiresAt });
        else await ctx.db.insert('tilePurges', { boxId: box._id, tileId, expiresAt });
      }
      if (tileIds.length) await ctx.scheduler.runAfter(UNUSED_FILE_TTL, internal.boxes.purgeTiles, { boxId: box._id, tileIds });
    }
    // Seed counters for new purr tiles so visitor purrs have something to add to.
    // They start at zero: only visitors' purrs count, never a number the editor sends.
    for (const t of patch.tiles ?? []) {
      if (t.type !== 'purr') continue;
      const c = await ctx.db.query('counters').withIndex('by_box_tile', q => q.eq('boxId', box._id).eq('tileId', t.id)).unique();
      if (!c) await ctx.db.insert('counters', { boxId: box._id, tileId: t.id, count: 0 });
    }
    return { revision, updatedAt };
  },
});

export const rename = mutation({
  args: { to: v.string() },
  handler: async (ctx, { to }) => {
    const { box } = await requireOwnBox(ctx);
    const h = to.trim().toLowerCase();
    if (h === box.handle) return { handle: h };
    if (handleState(h) !== 'ok') throw new ConvexError('That address can’t be used.');
    if (await boxByHandle(ctx, h)) throw new ConvexError('Someone’s napping there already.');
    await ctx.db.patch(box._id, { handle: h, updatedAt: Date.now() });
    return { handle: h };
  },
});

const EXPLORE = 9;

// The most visited boxes with something in them, topped up with recent ones while visits are thin.
export const explore = query({
  args: {},
  handler: async ctx => {
    const picked = new Map();
    const add = b => b && b.showInExplore !== false && b.tiles.some(t => t.type !== 'section' && !isBlank(t)) && picked.size < EXPLORE && picked.set(b._id, b);
    for (const row of await ctx.db.query('views').withIndex('by_count').order('desc').take(EXPLORE * 3)) add(await ctx.db.get(row.boxId));
    if (picked.size < EXPLORE) {
      for (const b of await ctx.db.query('boxes').withIndex('by_updated').order('desc').take(60)) if (!picked.has(b._id)) add(b);
    }
    return await Promise.all([...picked.values()].map(b => present(ctx, b, null)));
  },
});

// Only public discovery data leaves this query, never owner or visitor details.
export const sitemap = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query('boxes').withIndex('by_handle').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100) });
    return {
      ...result,
      page: result.page.filter(box => box.showInExplore !== false && hasPublicContent({ ...box, tiles: box.tiles.filter(t => !isBlank(t)) }))
        .map(({ handle, updatedAt }) => ({ handle, updatedAt })),
    };
  },
});

// Seed missing totals from older visits without overwriting anonymous page views.
export const backfillViews = internalMutation({
  args: {},
  handler: async ctx => {
    const totals = new Map();
    for await (const r of ctx.db.query('visits')) totals.set(r.boxId, (totals.get(r.boxId) ?? 0) + 1);
    for (const [boxId, count] of totals) {
      const row = await ctx.db.query('views').withIndex('by_box', q => q.eq('boxId', boxId)).unique();
      if (!row) await ctx.db.insert('views', { boxId, count });
    }
    return totals.size;
  },
});

// Delete the signed-in person's box and everything visitors left on it.
export const remove = mutation({
  args: {},
  handler: async ctx => {
    const { user } = await requireOwnBox(ctx);
    if (!process.env.CLERK_SECRET_KEY) throw new ConvexError('Account deletion is not configured. Please contact hello@bento.cat.');
    const identity = await ctx.auth.getUserIdentity();
    const id = await ctx.db.insert('deletedUsers', {
      tokenIdentifier: identity.tokenIdentifier, clerkId: identity.subject, clerkDeleted: false, attempts: 0, requestedAt: Date.now(),
    });
    await eraseUser(ctx, user);
    await ctx.scheduler.runAfter(0, internal.accounts.processDeletion, { id });
    return { deletionId: id };
  },
});

const PURGE = [
  ['tilePurges', 'by_box_tile'],
  ['counters', 'by_box_tile'],
  ['purrs', 'by_box_visitor'],
  ['scribbles', 'by_box_tile'],
  ['subscribers', 'by_box_tile_email'],
  ['visits', 'by_box_at'],
  ['views', 'by_box'],
  ['viewHours', 'by_box_hour'],
];

// Rows visitors leave on a tile, by the tile types that collect them.
const TILE_ROWS = [
  ['counters', 'by_box_tile', ['purr']],
  ['purrs', 'by_box_tile', ['purr']],
  ['scribbles', 'by_box_tile', ['guestbook']],
  ['subscribers', 'by_box_tile_email', ['subscribe']],
];

// One budget for all tiles and tables, including removal of the queue markers.
const TILE_PURGE_BATCH = 400;

// Clears what visitors left on tiles that have been gone for the full grace period.
export const purgeTiles = internalMutation({
  args: { boxId: v.id('boxes'), tileIds: v.array(v.string()) },
  handler: async (ctx, { boxId, tileIds }) => {
    const box = await ctx.db.get(boxId);
    if (!box) return;
    const kept = new Set(box.tiles.map(t => t.id));
    let remaining = TILE_PURGE_BATCH;
    for (let i = 0; i < tileIds.length; i++) {
      const tileId = tileIds[i];
      const queued = await ctx.db.query('tilePurges').withIndex('by_box_tile', q => q.eq('boxId', boxId).eq('tileId', tileId)).unique();
      if (!queued || queued.expiresAt > Date.now() || kept.has(tileId)) continue;
      if (!remaining) {
        await ctx.scheduler.runAfter(0, internal.boxes.purgeTiles, { boxId, tileIds: tileIds.slice(i) });
        return;
      }
      for (const [table, index] of TILE_ROWS) {
        const rows = await ctx.db.query(table).withIndex(index, q => q.eq('boxId', boxId).eq('tileId', tileId)).take(remaining);
        for (const r of rows) { await ctx.db.delete(r._id); remaining--; }
        if (!remaining) {
          await ctx.scheduler.runAfter(0, internal.boxes.purgeTiles, { boxId, tileIds: tileIds.slice(i) });
          return;
        }
      }
      await ctx.db.delete(queued._id);
      remaining--;
    }
  },
});

// Clears related rows a batch at a time, then calls itself until nothing is left.
export const purge = internalMutation({
  args: { boxId: v.id('boxes') },
  handler: async (ctx, { boxId }) => {
    let left = false;
    for (const [table, index] of PURGE) {
      const rows = await ctx.db.query(table).withIndex(index, q => q.eq('boxId', boxId)).take(400);
      for (const r of rows) await ctx.db.delete(r._id);
      if (rows.length === 400) left = true;
    }
    if (left) await ctx.scheduler.runAfter(0, internal.boxes.purge, { boxId });
  },
});
