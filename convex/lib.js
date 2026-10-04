import { ConvexError } from 'convex/values';

export const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;
export const RESERVED = ['admin', 'explore', 'login', 'edit', 'settings', 'help', 'api', 'credits', 'about', 'new', 'claim', 'logout', 'signup', 'signin', 'privacy', 'terms', 'imprint', 'impressum', 'legal', 'support', 'blog', 'docs', 'status', 'app', 'www', 'mail', 'static', 'assets', 'robots.txt', 'favicon.ico', 'sitemap.xml', '_app'];
export const SHAPES = ['circle', 'rounded', 'square', 'cat'];

export async function currentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (await ctx.db.query('deletedUsers').withIndex('by_clerk', q => q.eq('clerkId', identity.subject)).first()) return null;
  return await ctx.db
    .query('users')
    .withIndex('by_token', q => q.eq('tokenIdentifier', identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx) {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError('Sign in first.');
  return user;
}

export async function boxByHandle(ctx, handle) {
  return await ctx.db.query('boxes').withIndex('by_handle', q => q.eq('handle', handle)).unique();
}

export async function boxOfUser(ctx, userId) {
  return await ctx.db.query('boxes').withIndex('by_owner', q => q.eq('ownerId', userId)).first();
}

export async function requireOwnBox(ctx) {
  const user = await requireUser(ctx);
  const box = await boxOfUser(ctx, user._id);
  if (!box) throw new ConvexError('You don’t have a box yet.');
  return { user, box };
}

export function handleState(handle) {
  if (!HANDLE_RE.test(handle)) return 'invalid';
  if (RESERVED.includes(handle)) return 'blocked';
  return 'ok';
}

const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const safeUrl = s => (typeof s === 'string' && /^https?:\/\//i.test(s) && s.length < 2048 ? s : '');

// Fields that end up in a src, href or CSS url(), and fields that end up in a style.
const URL_KEYS = new Set(['url', 'src', 'cover', 'video', 'before', 'avatar', 'audio']);
const COLOR_KEYS = new Set(['bg', 'fg']);
const POS_RE = /^-?\d{1,3}(\.\d+)?%( -?\d{1,3}(\.\d+)?%)?$/;

// Tiles are free-form objects, but nothing oversized, no inline data URLs, no
// script-y links, and no keys Convex can't store.
function cleanValue(value, depth = 0, key = '') {
  if (depth > 6) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return Number.isFinite(value) || typeof value !== 'number' ? value : 0;
  if (typeof value === 'string') {
    if (URL_KEYS.has(key)) return value ? safeUrl(value) : '';
    if (key === 'pos') return POS_RE.test(value) ? value : '50% 50%';
    if (COLOR_KEYS.has(key)) return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '';
    return value.startsWith('data:') || value.startsWith('blob:') ? '' : value.slice(0, 4000);
  }
  if (Array.isArray(value)) return value.slice(0, key === 'counts' ? 400 : 60).map(v => cleanValue(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_') || k.startsWith('$') || v === undefined) continue;
      out[k.slice(0, 40)] = cleanValue(v, depth + 1, k);
    }
    return out;
  }
  return null;
}

// Tiles still waiting for their content: a link or song with no address yet, a map
// with no place, a note or section title with no words. The editor keeps them so
// people can lay out a box first, but visitors never get them.
const words = html => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
export function isBlank(t) {
  if (t.draft) return true;
  switch (t.type) {
    case 'link': case 'music': return !String(t.url ?? '').trim();
    case 'map': return !String(t.place ?? '').trim() && !(Number.isFinite(t.lat) && Number.isFinite(t.lon));
    case 'note': return !words(t.html);
    case 'section': return !String(t.text ?? '').trim();
    default: return false;
  }
}

export function cleanTiles(tiles) {
  if (!Array.isArray(tiles)) return [];
  const ids = new Set();
  for (const tile of tiles) {
    if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || !tile.id || tile.id.length > 40 || ids.has(tile.id))
      throw new ConvexError('Every tile needs a unique id.');
    ids.add(tile.id);
  }
  if (tiles.length > 150) throw new ConvexError('A box can hold at most 150 tiles.');
  return tiles
    .slice(0, 150)
    .filter(t => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.type === 'string')
    .map(t => cleanValue(t));
}

export function cleanProfile(data) {
  const out = {};
  if ('name' in data) out.name = str(data.name, 80);
  if ('bio' in data) out.bio = str(data.bio, 400);
  if ('avatar' in data) out.avatar = data.avatar ? safeUrl(data.avatar) || null : null;
  if ('avatarVideo' in data) out.avatarVideo = data.avatarVideo ? safeUrl(data.avatarVideo) || null : null;
  if ('avatarPos' in data) out.avatarPos = POS_RE.test(data.avatarPos) ? data.avatarPos : '50% 40%';
  if ('avatarShape' in data) out.avatarShape = SHAPES.includes(data.avatarShape) ? data.avatarShape : 'circle';
  if ('onboarding' in data) out.onboarding = !!data.onboarding;
  if ('shared' in data) out.shared = !!data.shared;
  if ('showInExplore' in data) {
    if (typeof data.showInExplore !== 'boolean') throw new ConvexError('Choose whether to show your box in Explore.');
    out.showInExplore = data.showInExplore;
  }
  if ('shareVisits' in data) {
    if (typeof data.shareVisits !== 'boolean') throw new ConvexError('Choose whether boxes you visit can see you.');
    out.shareVisits = data.shareVisits;
  }
  if ('notifySubscribers' in data) {
    if (typeof data.notifySubscribers !== 'boolean') throw new ConvexError('Choose whether to get an email about new subscribers.');
    out.notifySubscribers = data.notifySubscribers;
  }
  if ('suggestions' in data) out.suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 10).map(s => cleanValue(s)) : [];
  if ('tiles' in data) out.tiles = cleanTiles(data.tiles);
  if ('mobile' in data) out.mobile = Array.isArray(data.mobile) ? data.mobile.filter(id => typeof id === 'string').slice(0, 150).map(id => id.slice(0, 40)) : [];
  return out;
}

export const NEW_SUGGESTIONS = [
  { kind: 'photo', size: 'tower', label: 'A photo you love' },
  { kind: 'music', size: 'loaf', label: 'A song on repeat' },
  { kind: 'map', size: 'curl', label: 'Where you are' },
  { kind: 'text', size: 'loaf', label: 'Say hello in a note' },
  { kind: 'link', size: 'curl', label: 'Link to your work' },
];
