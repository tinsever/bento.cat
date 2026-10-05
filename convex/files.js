import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, query } from './_generated/server';
import { requireOwnBox } from './lib';
import { limit } from './limits';
import { MAX_OWNER_BYTES, MAX_OWNER_FILES, UNUSED_FILE_TTL, mediaType, mediaUrls, uploadError } from './mediaPolicy';
import { applyPreviews } from '../src/lib/link-previews';

async function reserveOwned(ctx, ownerId, bytes, contentType, digest) {
  const error = uploadError(bytes, contentType);
  if (error) throw new ConvexError(error);
  await limit(ctx, `upload:${ownerId}`, 120, 60 * 60 * 1000);
  const files = await ctx.db.query('uploads').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
  if (files.length >= MAX_OWNER_FILES || files.reduce((n, file) => n + file.bytes, 0) + bytes > MAX_OWNER_BYTES)
    throw new ConvexError('Your box has reached its file storage limit. Remove some media and try again after cleanup.');
  const uploadId = await ctx.db.insert('uploads', {
    ownerId, bytes, contentType: mediaType(contentType), referenced: false,
    ...(digest ? { digest } : {}), expiresAt: Date.now() + UNUSED_FILE_TTL,
  });
  await ctx.scheduler.runAfter(UNUSED_FILE_TTL, internal.files.cleanup, { uploadId });
  return uploadId;
}

export const reserve = internalMutation({
  args: { bytes: v.number(), contentType: v.string() },
  handler: async (ctx, { bytes, contentType }) => {
    const { user } = await requireOwnBox(ctx);
    return await reserveOwned(ctx, user._id, bytes, contentType);
  },
});

async function previewOwner(ctx, boxId) {
  if (!boxId) return (await requireOwnBox(ctx)).user._id;
  const box = await ctx.db.get(boxId);
  if (!box?.ownerId || !(await ctx.db.get(box.ownerId))) throw new ConvexError('That box is no longer here.');
  return box.ownerId;
}

// Only internal preview jobs may supply a box ID. Public uploads still require
// the signed-in owner. Unchanged preview bytes reuse that owner's stored file.
export const reservePreview = internalMutation({
  args: { boxId: v.optional(v.id('boxes')), bytes: v.number(), contentType: v.string(), digest: v.string() },
  handler: async (ctx, { boxId, bytes, contentType, digest }) => {
    const ownerId = await previewOwner(ctx, boxId);
    const error = uploadError(bytes, contentType);
    if (error) throw new ConvexError(error);
    const files = await ctx.db.query('uploads').withIndex('by_owner_digest', q => q.eq('ownerId', ownerId).eq('digest', digest)).collect();
    for (const file of files) if (file.storageId && await ctx.db.system.get(file.storageId)) {
      const url = await ctx.storage.getUrl(file.storageId);
      if (url) {
        // Reserve time for the caller to attach a reused file before an older
        // cleanup job can remove it. Abandoned imports still expire normally.
        if (!file.referenced) {
          await ctx.db.patch(file._id, { expiresAt: Date.now() + UNUSED_FILE_TTL });
          await ctx.scheduler.runAfter(UNUSED_FILE_TTL, internal.files.cleanup, { uploadId: file._id });
        }
        return { url };
      }
    }
    return { uploadId: await reserveOwned(ctx, ownerId, bytes, contentType, digest) };
  },
});

async function attachOwned(ctx, ownerId, uploadId, storageId) {
  const row = await ctx.db.get(uploadId);
  const meta = await ctx.db.system.get(storageId);
  if (!row || row.ownerId !== ownerId || row.storageId || !meta || meta.size !== row.bytes || (meta.contentType && mediaType(meta.contentType) !== row.contentType))
    throw new ConvexError('That upload couldn’t be completed.');
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new ConvexError('That upload couldn’t be completed.');
  await ctx.db.patch(uploadId, { storageId, url });
  return url;
}

// Turn an uploaded file into a URL that can sit in a tile.
export const attach = internalMutation({
  args: { uploadId: v.id('uploads'), storageId: v.id('_storage') },
  handler: async (ctx, { uploadId, storageId }) => {
    const { user } = await requireOwnBox(ctx);
    // contentType is optional in Convex metadata. The server validated the Blob
    // before storing it; if metadata has a type, it must agree with the reservation.
    return await attachOwned(ctx, user._id, uploadId, storageId);
  },
});

export const attachPreview = internalMutation({
  args: { boxId: v.optional(v.id('boxes')), uploadId: v.id('uploads'), storageId: v.id('_storage') },
  handler: async (ctx, { boxId, uploadId, storageId }) => await attachOwned(ctx, await previewOwner(ctx, boxId), uploadId, storageId),
});

export const release = internalMutation({
  args: { uploadId: v.id('uploads') },
  handler: async (ctx, { uploadId }) => {
    const row = await ctx.db.get(uploadId);
    if (row && !row.storageId) await ctx.db.delete(uploadId);
  },
});

export const cleanup = internalMutation({
  args: { uploadId: v.id('uploads') },
  handler: async (ctx, { uploadId }) => {
    const row = await ctx.db.get(uploadId);
    if (!row || row.referenced || row.expiresAt > Date.now()) return;
    if (row.storageId && await ctx.db.system.get(row.storageId)) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(uploadId);
  },
});

// Keep removed files for 24 hours so Undo can restore them. Older cleanup jobs
// also check the current expiry before deleting anything.
export async function syncReferences(ctx, userId, profile) {
  // Only the effective tile images are live. Raw tiles and cache comparison
  // values may still name an automatic image that a refresh already replaced.
  const effective = profile.linkPreviews && profile.tiles ? { ...profile, tiles: applyPreviews(profile), linkPreviews: [] } : profile;
  const urls = mediaUrls(effective);
  for (const url of urls) {
    if (await ctx.db.query('legacyMediaPurges').withIndex('by_url', q => q.eq('url', url)).first())
      throw new ConvexError('That media is being removed. Upload your own copy instead.');
    const other = await ctx.db.query('uploads').withIndex('by_url', q => q.eq('url', url)).first();
    if (other && other.ownerId !== userId) throw new ConvexError('That media belongs to another box.');
  }
  const files = await ctx.db.query('uploads').withIndex('by_owner', q => q.eq('ownerId', userId)).collect();
  for (const file of files) {
    const referenced = !!file.url && urls.has(file.url);
    if (referenced === file.referenced) continue;
    await ctx.db.patch(file._id, { referenced, expiresAt: referenced ? undefined : Date.now() + UNUSED_FILE_TTL });
    if (!referenced) await ctx.scheduler.runAfter(UNUSED_FILE_TTL, internal.files.cleanup, { uploadId: file._id });
  }
}

// Capture legacy files before deleting the only box that knows their URLs.
// Only canonical URLs for this deployment are accepted, never arbitrary URLs/IDs.
export async function queueLegacyMedia(ctx, ownerId, boxes) {
  const urls = new Set();
  for (const box of boxes) mediaUrls(box, urls);
  for (const url of urls) {
    let storageId;
    try { storageId = ctx.db.system.normalizeId('_storage', new URL(url).pathname.split('/api/storage/')[1]); }
    catch { continue; }
    if (!storageId || await ctx.storage.getUrl(storageId) !== url) continue;
    if (await ctx.db.query('uploads').withIndex('by_storage', q => q.eq('storageId', storageId)).first()) continue;
    if (await ctx.db.query('assets').withIndex('by_storage', q => q.eq('storageId', storageId)).first()) continue;
    if (await ctx.db.query('legacyMediaPurges').withIndex('by_url', q => q.eq('url', url)).first()) continue;
    await ctx.db.insert('legacyMediaPurges', { ownerId, storageId, url });
  }
  await ctx.scheduler.runAfter(0, internal.files.purgeLegacyMedia, { ownerId });
}

export const purgeLegacyMedia = internalMutation({
  args: { ownerId: v.id('users'), cursor: v.optional(v.string()), checked: v.optional(v.boolean()) },
  handler: async (ctx, { ownerId, cursor, checked }) => {
    const files = await ctx.db.query('legacyMediaPurges').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
    if (!files.length) return;
    if (!checked) {
      const page = await ctx.db.query('boxes').paginate({ cursor: cursor ?? null, numItems: 10 });
      const referenced = new Set();
      for (const box of page.page) mediaUrls(box, referenced);
      for (const file of files) if (referenced.has(file.url)) await ctx.db.delete(file._id);
      await ctx.scheduler.runAfter(0, internal.files.purgeLegacyMedia, {
        ownerId, ...(page.isDone ? { checked: true } : { cursor: page.continueCursor }),
      });
      return;
    }
    for (const file of files.slice(0, 100)) {
      const asset = await ctx.db.query('assets').withIndex('by_storage', q => q.eq('storageId', file.storageId)).first();
      const upload = await ctx.db.query('uploads').withIndex('by_storage', q => q.eq('storageId', file.storageId)).first();
      if (!asset && !upload && await ctx.db.system.get(file.storageId)) await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    if (files.length > 100) await ctx.scheduler.runAfter(0, internal.files.purgeLegacyMedia, { ownerId, checked: true });
  },
});

// Shared images, keyed by name.
export const assets = query({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query('assets').collect();
    return Object.fromEntries(rows.map(r => [r.key, r.url]));
  },
});
