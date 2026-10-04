import { ConvexError } from 'convex/values';

// Count a hit for a key and say whether it fits in `max` per `windowMs`.
export async function allow(ctx, key, max, windowMs) {
  const now = Date.now();
  const row = await ctx.db.query('limits').withIndex('by_key', q => q.eq('key', key)).unique();
  if (!row) {
    await ctx.db.insert('limits', { key, windowStart: now, count: 1 });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    return true;
  }
  if (row.count >= max) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}

// Allow `max` hits per `windowMs` for a key, or refuse with a friendly message.
export async function limit(ctx, key, max, windowMs, msg = 'That’s a lot at once. Try again in a little while.') {
  if (!(await allow(ctx, key, max, windowMs))) throw new ConvexError(msg);
}
