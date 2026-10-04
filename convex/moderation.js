import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOwnBox } from './lib';

// Owners see what was left, never the visitor key it was left with: that key is
// what lets a visitor unsubscribe or forget their visits.
const without = (page, pick) => ({ ...page, page: page.page.map(pick) });

export const scribbles = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { box } = await requireOwnBox(ctx);
    const page = await ctx.db.query('scribbles').withIndex('by_box_tile', q => q.eq('boxId', box._id)).order('desc').paginate(paginationOpts);
    return without(page, ({ _id, _creationTime, tileId, d, name }) => ({ _id, _creationTime, tileId, d, name }));
  },
});
export const subscribers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { box } = await requireOwnBox(ctx);
    const page = await ctx.db.query('subscribers').withIndex('by_box_tile_email', q => q.eq('boxId', box._id)).paginate(paginationOpts);
    return without(page, ({ _id, _creationTime, tileId, email }) => ({ _id, _creationTime, tileId, email }));
  },
});
// Each subscribe tile with its people, newest first, for the Subscribers drawer.
export const lists = query({
  args: {},
  handler: async ctx => {
    const { box } = await requireOwnBox(ctx);
    const out = [];
    for (const t of box.tiles.filter(t => t.type === 'subscribe')) {
      const rows = await ctx.db.query('subscribers').withIndex('by_box_tile_email', q => q.eq('boxId', box._id).eq('tileId', t.id)).take(10000);
      rows.sort((a, b) => b._creationTime - a._creationTime);
      out.push({ tileId: t.id, title: t.title ?? '', people: rows.map(({ _id, _creationTime, email }) => ({ _id, _creationTime, email })) });
    }
    return out;
  },
});
async function remove(ctx, table, id) {
  const { box } = await requireOwnBox(ctx);
  const row = await ctx.db.get(id);
  if (!row) return;
  if (row.boxId !== box._id) throw new ConvexError(`That ${table === 'scribbles' ? 'scribble' : 'subscriber'} belongs to another box.`);
  await ctx.db.delete(id);
}
export const removeScribble = mutation({ args: { id: v.id('scribbles') }, handler: (ctx, { id }) => remove(ctx, 'scribbles', id) });
export const removeSubscriber = mutation({ args: { id: v.id('subscribers') }, handler: (ctx, { id }) => remove(ctx, 'subscribers', id) });

// Visitor keys are bearer capabilities. This removes only that browser's signup;
// knowing an email address alone does not grant permission to unsubscribe it.
export const unsubscribe = mutation({
  args: { boxId: v.id('boxes'), tileId: v.string(), visitorKey: v.string() },
  handler: async (ctx, { boxId, tileId, visitorKey }) => {
    if (visitorKey.length < 8 || visitorKey.length > 64) throw new ConvexError('Bad visitor key.');
    const rows = await ctx.db.query('subscribers').withIndex('by_box_visitor', q => q.eq('boxId', boxId).eq('visitorKey', visitorKey)).collect();
    for (const row of rows) if (row.tileId === tileId) await ctx.db.delete(row._id);
  },
});
