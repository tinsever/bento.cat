import { internal } from './_generated/api';

// Browser uploads and downloaded link-preview images share ownership and quotas.
export async function storeOwned(ctx, blob) {
  const uploadId = await ctx.runMutation(internal.files.reserve, { bytes: blob.size, contentType: blob.type });
  let storageId;
  try {
    storageId = await ctx.storage.store(blob);
    return await ctx.runMutation(internal.files.attach, { uploadId, storageId });
  } catch (error) {
    if (storageId) await ctx.storage.delete(storageId);
    await ctx.runMutation(internal.files.release, { uploadId });
    throw error;
  }
}

export async function storePreview(ctx, blob, boxId) {
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
  const target = boxId ? { boxId } : {};
  const reservation = await ctx.runMutation(internal.files.reservePreview, { ...target, bytes: blob.size, contentType: blob.type, digest });
  if (reservation.url) return reservation.url;
  const { uploadId } = reservation;
  let storageId;
  try {
    storageId = await ctx.storage.store(blob);
    return await ctx.runMutation(internal.files.attachPreview, { ...target, uploadId, storageId });
  } catch (error) {
    if (storageId) await ctx.storage.delete(storageId);
    await ctx.runMutation(internal.files.release, { uploadId });
    throw error;
  }
}
