// Claimed handles with no identity or finished tiles are not published content.
export const hasPublicContent = box => !!box && !!(
  box.name?.trim() || box.bio?.trim() || box.avatar ||
  box.tiles?.some(tile => tile.type !== 'section' && !tile.draft)
);
