import { mutation, reason } from '../api.js';
import { DAY } from './data.js';
import { hasCoords, mountMap, osmUrl } from './map.js';
import { Visitor } from './state.js';
import { I, PLATFORM_ICONS, Sound, Tip, catLogo, clamp, esc, fmtDate, fmtHour, fmtK, fmtSec, h, hostOf, hoursIn, htmlText, isEmojiOnly, isQuote, normUrl, platformOf, plural, relTime, sanitize, timeIn, toast, tzOffset } from './util.js';

/* Tile types, how each one draws itself, and what visitors can do with it. */

export const POSES = {
  curl: { w: 1, h: 1, name: 'Curl' },
  loaf: { w: 2, h: 1, name: 'Loaf' },
  tower: { w: 1, h: 2, name: 'Tower' },
  sprawl: { w: 2, h: 2, name: 'Sprawl' },
};
export const ALL_POSES = ['curl', 'loaf', 'tower', 'sprawl'];

export const TYPES = {
  link: { label: 'Link', poses: ALL_POSES },
  note: { label: 'Note', poses: ALL_POSES },
  photo: { label: 'Photo', poses: ALL_POSES },
  video: { label: 'Video', poses: ALL_POSES },
  map: { label: 'Map', poses: ALL_POSES },
  feed: { label: 'Photo feed', poses: ALL_POSES },
  purr: { label: 'Purr', poses: ['curl', 'loaf'] },
  music: { label: 'Music', poses: ['curl', 'loaf', 'sprawl'] },
  github: { label: 'Code activity', poses: ['loaf', 'sprawl'] },
  status: { label: 'Status', poses: ['curl', 'loaf'] },
  sayname: { label: 'Say my name', poses: ['loaf'] },
  hours: { label: 'Good time to write', poses: ['loaf'] },
  guestbook: { label: 'Guestbook', poses: ['sprawl', 'tower'] },
  beforeafter: { label: 'Before and after', poses: ALL_POSES },
  subscribe: { label: 'Subscribe', poses: ['loaf', 'sprawl'] },
  section: { label: 'Section title', poses: [] },
};

export const TINTS = {
  white: { bg: '#FFFFFF', name: 'White' },
  curb: { bg: '#F4F4F2', name: 'Curb' },
  sage: { bg: '#DCE3D8', name: 'Sage' },
  paw: { bg: '#F9E3E7', name: 'Paw pad' },
  fur: { bg: '#161616', name: 'Fur' },
};

// Notes start on curb, purrs on white.
export const tintOf = t => (TINTS[t.tint] ? t.tint : t.type === 'note' ? 'curb' : 'white');

export const WAVE = [4, 10, 20, 14, 26, 16, 8, 18, 24, 12, 6, 16, 22, 10, 18, 8, 14, 4, 20, 12, 6, 16, 10, 4, 14, 8, 2, 6, 4, 2, 2, 2, 2];

// Scribbles already on the guestbook, drawn in a 340 × 230 space.
export const GB_OLD = [
  'M30 60 L36 34 L48 50 Q56 47 64 50 L76 34 L80 60 Q86 80 70 92 Q56 100 42 94 Q24 84 30 60 Z M44 66 h0.1 M66 66 h0.1 M52 78 q3 3 6 0',
  'M262 40 c4 -10 12 -10 14 0 c2 -10 12 -10 14 0 c2 12 -14 22 -14 22 c0 0 -16 -10 -14 -22',
  'M240 180 c10 -14 20 14 30 0 c10 -14 20 14 30 0',
  'M52 176 l6 -16 l6 16 l-16 -10 h20 z',
];
export const GB_HI = { d: 'M140 92 C138 110 137 128 138 146 M138 124 C144 112 158 110 160 124 C161 132 160 140 161 146 M178 120 C177 130 178 138 179 146 M178 102 L178.5 103 M200 90 C199 104 199 116 200 128 M200 144 L200.5 145 M132 164 C160 158 190 160 214 166', name: 'Tobi' };

export const titleOf = t => t.title || t.place || (t.handle && '@' + t.handle) || t.user || t.name || (t.type === 'note' && htmlText(t.html).trim().slice(0, 28)) || t.text || TYPES[t.type]?.label || 'Tile';
export const sizeOf = (t, dev) => (t.size && (t.size[dev] || t.size.d)) || 'curl';

// Desktop follows box.tiles. Mobile keeps its own order once someone arranges it;
// tiles it hasn't placed yet sit after whatever comes before them on desktop.
export function tilesFor(box, dev) {
  if (dev !== 'm' || !box.mobile) return box.tiles;
  const byId = new Map(box.tiles.map(t => [t.id, t]));
  const out = [...new Set(box.mobile)].map(id => byId.get(id)).filter(Boolean);
  const placed = new Set(out.map(t => t.id));
  box.tiles.forEach((t, i) => {
    if (placed.has(t.id)) return;
    const prev = i ? out.indexOf(box.tiles[i - 1]) : -1;
    out.splice(prev + 1, 0, t);
    placed.add(t.id);
  });
  return out;
}
export const tileKey = (box, t) => box.handle + '/' + t.id;

// Public cards expose real destinations to crawlers and keyboard users.
export function tileHref(t) {
  if (t.draft) return '';
  if (t.type === 'map' && (t.place || hasCoords(t))) return osmUrl(t);
  if (!t.url) return '';
  try {
    const url = new URL(t.url);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

/* ---------- small renderer helpers ---------- */

export function ce(c, field, rich = false) {
  if (!c.edit) return '';
  return `contenteditable="${rich ? 'true' : 'plaintext-only'}" spellcheck="false" data-field="${field}"`;
}

/* Tile data comes from the owner, so anything that lands in markup is checked here. */
const POS_RE = /^-?\d{1,3}(\.\d+)?%( -?\d{1,3}(\.\d+)?%)?$/;
export const cssPos = (p, d = '50% 50%') => (POS_RE.test(p) ? p : d);
export const cssColor = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : d);
export const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
export function safeSrc(src) {
  const u = String(src || '');
  if (!/^https?:\/\//i.test(u) && !/^\/[^/]/.test(u)) return '';
  return u.replace(/["'()\\\s<>]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}
export const bg = (src, pos) => `background-image:url('${safeSrc(src)}');background-position:${cssPos(pos)}`;
export const corner = () => `<span class="corner-arrow">${I.arrow('#161616', 14)}</span>`;

export function odo(n) {
  n = Math.max(0, Math.floor(num(n)));
  return `<span class="odo" role="img" aria-label="${n}">${String(n).split('').map(d => `<span class="odo-d"><span class="odo-col" style="--d:${d}">${'0123456789'.split('').map(x => `<span>${x}</span>`).join('')}</span></span>`).join('')}</span>`;
}

export function odoSet(el, n) {
  const digits = String(n).split('');
  const cols = el.querySelectorAll('.odo-col');
  if (cols.length !== digits.length) { el.outerHTML = odo(n); return; }
  el.setAttribute('aria-label', n);
  cols.forEach((c, i) => c.style.setProperty('--d', digits[i]));
}

export function linkIcon(t) {
  const ic = t.icon;
  if (ic && ic.src && safeSrc(ic.src)) return `<div class="fav-wrap">${linkIcon({ ...t, icon: null })}<div class="icon-sq fav"><img src="${safeSrc(ic.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div></div>`;
  if (ic === 'mail') return `<div class="icon-sq">${I.mail()}</div>`;
  if (ic && ic.glyph) return `<div class="icon-sq dark glyph-sq">${esc(ic.glyph)}</div>`;
  const p = (ic && ic.platform) || platformOf(t.url);
  if (p && PLATFORM_ICONS[p]) return `<div class="icon-sq dark">${PLATFORM_ICONS[p]}</div>`;
  const letter = (hostOf(t.url)[0] || '•').toUpperCase();
  return `<div class="icon-sq dark glyph-sq">${esc(letter)}</div>`;
}

export function previewHtml(p) {
  if (p.kind === 'image') return `<div class="preview img"><img src="${safeSrc(p.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const fg = cssColor(p.fg, '#161616');
  return `<div class="preview" style="background:${cssColor(p.bg, '#F4F4F2')};color:${fg}"><div class="pv-label" style="color:${cssColor(p.sub, fg)}">${esc(p.label)}</div><div class="pv-big">${esc(p.big)}</div></div>`;
}

export function quoteHtml(html) {
  const lines = html.split(/<br\s*\/?>/i);
  let out = lines;
  let cite = '';
  if (lines.length > 1 && /^\s*(<[^>]+>)*\s*[—–-]/.test(lines[lines.length - 1])) {
    cite = `<cite>${lines[lines.length - 1]}</cite>`;
    out = lines.slice(0, -1);
  }
  return out.join('<br>').replace(/^(\s*(?:<[^>]+>)*\s*)(["“„«])/, '$1<span class="qm">$2</span>') + cite;
}

export function mapSvg(seed) {
  const flip = seed % 2 ? 'translate(376 0) scale(-1 1)' : '';
  const rot = (seed >> 1) % 2 ? 'rotate(90 188 188)' : '';
  return `<svg class="map-svg" viewBox="0 0 376 376" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="376" height="376" fill="#EFEFEB"/>
    <g transform="${flip} ${rot}">
      <path d="M0 250 C60 236 110 262 170 286 C230 310 300 300 376 270 V376 H0 Z" fill="#D5DFE2"/>
      <path d="M250 0 C262 40 300 70 376 76 V0 Z" fill="#DDE5DA"/>
      <path d="M-10 92 C80 110 170 100 240 140 C300 174 340 214 390 222" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>
      <path d="M120 -10 C126 70 150 150 176 220 C190 258 196 280 200 300" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
      <path d="M-10 170 L200 190 M40 30 L90 240 M230 20 L300 160 M260 200 L320 30 M10 210 L150 150" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
      <path d="M60 330 C120 344 180 350 250 336" fill="none" stroke="#C4D1D5" stroke-width="2" stroke-dasharray="4 6"/>
    </g>
  </svg>`;
}

export function vinylSvg(cover, id) {
  const label = cover
    ? `<clipPath id="lbl-${id}"><circle cx="62" cy="62" r="22"/></clipPath><image href="${esc(cover)}" x="40" y="40" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#lbl-${id})"/><circle cx="62" cy="62" r="22" fill="none" stroke="#F2C14E" stroke-width="3"/>`
    : '<circle cx="62" cy="62" r="20" fill="#F2C14E"/>';
  return `<svg viewBox="0 0 124 124" aria-hidden="true"><circle cx="62" cy="62" r="62" fill="#1C1C1C"/><circle cx="62" cy="62" r="54" fill="none" stroke="#2E2E2E"/><circle cx="62" cy="62" r="46" fill="none" stroke="#2E2E2E"/><circle cx="62" cy="62" r="38" fill="none" stroke="#2E2E2E"/>${label}<circle cx="62" cy="62" r="2.5" fill="#1C1C1C"/></svg>`;
}

/* ---------- renderers ---------- */

export const R = {};

const draftHtml = (icon, placeholder) => `<div class="link-draft" data-nodrag>
      <div class="icon-sq">${icon}</div>
      <form class="draft-form" data-form="link"><input name="url" placeholder="${placeholder}" aria-label="Link" autocomplete="off" spellcheck="false"><button class="btn btn-dark sm">Add</button></form>
    </div>`;

R.link = (t, c) => {
  const s = c.size;
  if (t.draft) return draftHtml(I.link(), 'Paste a link');
  const pv = t.preview && s !== 'curl' ? previewHtml(t.preview) : '';
  const text = `<div class="link-text"><div class="t-title ed" ${ce(c, 'title')} data-ph="Title">${esc(t.title)}</div><div class="t-meta">${esc(hostOf(t.url))}</div></div>`;
  const top = `<div class="link-top">${linkIcon(t)}${pv && s === 'loaf' ? '' : `<span class="arr">${I.arrow('#9A9A9A', 16, 1.5)}</span>`}</div>`;
  if (s === 'loaf') return `<div class="link-main">${top}${text}</div>${pv}`;
  return `${top}${pv}${text}`;
};

R.note = (t, c) => {
  const html = sanitize(t.html || '');
  const plain = htmlText(html).trim();
  if (isEmojiOnly(plain)) return `<div class="emoji ed" ${ce(c, 'html', true)}>${html}</div>`;
  const quote = isQuote(plain);
  const meta = !quote && c.size !== 'curl' && t.updatedAt ? `<div class="t-meta note-meta">Updated ${relTime(t.updatedAt, c.now)}</div>` : '';
  return `<div class="note-text ed" ${ce(c, 'html', true)} data-ph="Write something…">${quote ? quoteHtml(html) : html}</div>${meta}`;
};

R.purr = (t, c) => {
  const did = c.interactive !== false && Visitor.get('purr', c.key(t));
  return `<button class="paw-btn ${did ? 'on' : ''}" data-act="purr" aria-label="Leave a purr" ${c.interactive === false ? 'disabled' : ''}>${I.paw(did ? '#FFFFFF' : '#C2566B', 20)}</button>
    <div class="purr-bottom"><div class="purr-count tnum">${odo(t.count)}</div><div class="t-sub purr-sub">${did ? 'You purred' : 'purrs. Tap to leave yours.'}</div></div>`;
};

R.photo = (t, c) => `<div class="ph-img" style="${bg(t.src, t.pos)}"></div>
  ${t.url ? corner() : ''}
  ${t.caption || c.edit ? `<div class="caption ed ${t.caption ? '' : 'empty'}" ${ce(c, 'caption')} data-ph="Add a caption">${esc(t.caption || '')}</div>` : ''}`;

R.video = (t, c) => `${t.video
    ? `<video class="ph-img" src="${safeSrc(t.video)}" autoplay muted loop playsinline></video>`
    : `<div class="ph-img loop" style="${bg(t.src, t.pos || '50% 40%')}"></div>`}
  <div class="vid-shade"></div>
  ${t.url ? corner() : ''}
  <div class="vid-text"><div class="t-title ed" ${ce(c, 'title')} data-ph="Title">${esc(t.title || '')}</div><div class="vid-meta">${esc(t.meta || 'Plays muted on a loop')}</div></div>`;

R.map = (t, c) => `${hasCoords(t)
    ? `<div class="map-view">${c.interactive === false ? mapSvg(num(t.seed, 1)) : ''}</div>
  ${c.mode === 'static' ? '<span class="map-attr">© OpenStreetMap</span>' : '<a class="map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" data-nodrag>© OpenStreetMap</a>'}`
    : `<div class="map-zoom" style="--z:${num(t.zoom, 1)}">${mapSvg(num(t.seed, 1))}</div>
  <div class="cloud c1"></div><div class="cloud c2"></div>
  <svg class="bird" width="14" height="6" viewBox="0 0 14 6"><path d="M1 4 Q4 0 7 4 Q10 0 13 4" fill="none" stroke="#6F7C80" stroke-width="1.4" stroke-linecap="round"/></svg>`}
  <div class="pin"><div class="pin-disc">${catLogo(22)}</div></div>
  <div class="map-label">
    <div class="t-title ${t.place ? '' : 'empty'}" ${c.edit ? 'data-edact="place" data-nodrag' : ''}>${esc(t.place || (c.edit ? 'Pick a place' : ''))}</div>
    ${t.caption || c.edit ? `<div class="t-meta ed" ${ce(c, 'caption')} data-ph="Add a caption">${esc(t.caption || '')}</div>` : ''}
  </div>
  ${c.edit ? `<div class="map-ctrls" data-nodrag><button data-edact="zoom" data-d="1" aria-label="Zoom in">${I.plus()}</button><button data-edact="zoom" data-d="-1" aria-label="Zoom out">${I.minus()}</button></div>` : ''}`;

R.feed = (t, c) => {
  const n = { curl: 1, loaf: 3, tower: 2, sprawl: 6 }[c.size];
  return `<div class="feed-head"><div class="feed-who"><div class="t-title">@${esc(t.handle)}</div><div class="t-meta tnum">${fmtK(num(t.followers))} followers</div></div></div>
    <div class="feed-grid g-${c.size}">${(t.photos || []).slice(0, n).map(p => `<div style="${bg(p.src, p.pos)}"></div>`).join('')}</div>`;
};

// Music tiles only take Spotify links.
export const serviceOf = url => hostOf(url) === 'open.spotify.com' ? 'Spotify' : '';

const spotifyGlyph = (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 Q8 4.4 12.6 6.6 M4.2 8.6 Q8 7.4 11.8 9.2 M5 11 Q8 10.1 10.9 11.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

R.music = (t, c) => {
  if (t.draft) return draftHtml(I.music(), 'Paste a Spotify link');
  const service = serviceOf(t.url);
  if (c.size === 'curl') return `<div class="vinyl solo">${vinylSvg(safeSrc(t.cover), t.id)}</div>${t.url ? (service ? `<span class="sp-badge">${spotifyGlyph(18)}</span>` : corner()) : ''}`;
  const play = c.mode === 'view' ? `button data-act="spotify" aria-label="Play here" ${c.interactive === false ? 'disabled' : ''}` : 'span';
  const go = !t.url ? '' : service
    ? `<${play} class="listen"><span class="sp-dot">${spotifyGlyph()}</span>Play</${play.split(' ')[0]}>`
    : `<span class="listen plain">Listen ${I.arrow('currentColor', 12)}</span>`;
  return `<div class="rec"><div class="vinyl">${vinylSvg(null, t.id)}</div><div class="cover" style="${bg(t.cover, '60%')}"></div></div>
    <div class="music-info"><div class="music-text"><div class="t-title ed" ${ce(c, 'title')} data-ph="Title">${esc(t.title)}</div><div class="t-sub">${esc(t.sub || service)}</div></div>${go}</div>`;
};

const GH_SHADES = ['#EDEDEA', '#D6D6D2', '#A3A3A0', '#5A5A5A', '#161616'];

R.github = (t, c) => {
  const levels = typeof t.levels === 'string' ? t.levels.replace(/[^0-4]/g, '') : '';
  const head = (count, meta) => `<div class="gh-head"><div><div class="t-title">${esc(t.user)}</div><div class="t-meta">${meta}</div></div>${count}</div>`;
  if (!levels) {
    return `${head('', 'GitHub')}<div class="gh-empty t-meta">${t.loading ? 'Reading the contribution graph…' : 'Couldn’t read the contribution graph. It opens on GitHub.'}</div>`;
  }
  const weeks = Math.ceil(levels.length / 7);
  const start = new Date(String(t.start || '') + 'T12:00:00Z');
  const counts = Array.isArray(t.counts) ? t.counts : [];
  let cells = '';
  for (let i = 0; i < levels.length; i++) {
    const w = Math.floor(i / 7), d = i % 7, l = +levels[i], last = i === levels.length - 1;
    const n = num(counts[i]);
    const date = isNaN(start) ? '' : ` on ${fmtDate(new Date(start.getTime() + i * DAY))}`;
    cells += `<rect x="${w * 12}" y="${d * 12}" width="9" height="9" rx="2.4" fill="${last ? '#F2C14E' : GH_SHADES[l]}" data-tip="${n ? plural(n, 'contribution') : 'No contributions'}${date}"/>`;
  }
  const total = num(t.total, counts.reduce((a, b) => a + num(b), 0));
  return `${head(`<div class="t-count tnum">${plural(total, 'contribution')}</div>`, `GitHub, last ${Math.round(weeks / 4.35)} months`)}
    <svg class="gh" viewBox="0 0 ${weeks * 12 - 3} ${7 * 12 - 3}">${cells}</svg>
    ${c.size === 'sprawl' ? `<div class="gh-foot"><span class="t-meta">The latest day is in honey. Hover a day.</span></div>` : ''}`;
};

R.status = (t, c) => `<div class="t-clock tnum"><span data-clock="${esc(t.tz)}">${timeIn(t.tz, c.now === undefined ? undefined : new Date(c.now))}</span> in ${esc(t.city)}</div>
  <div class="status-body"><div class="status-text ed" ${ce(c, 'text')} data-ph="What are you up to?">${esc(t.text)}</div><div class="t-meta ed" ${ce(c, 'meta')} data-ph="A small detail">${esc(t.meta || '')}</div></div>`;

R.section = (t, c) => `<div class="sec-title ed" ${ce(c, 'text')} data-ph="Section title">${esc(t.text)}</div>`;

R.sayname = (t, c) => `<div><div class="say-name ed" ${ce(c, 'name')} data-ph="Your name">${esc(t.name)}</div><div class="t-meta ed" ${ce(c, 'phon')} data-ph="How it sounds">${esc(t.phon)}</div></div>
  <div class="say-row"><button class="play-btn dark" data-act="say" data-edit-ok aria-label="Hear it" ${c.interactive === false ? 'disabled' : ''}>${I.play('#fff')}</button>
  <svg class="wave" viewBox="0 0 230 32" preserveAspectRatio="none">${WAVE.map((hh, i) => `<line x1="${2 + i * 7}" x2="${2 + i * 7}" y1="${16 - hh / 2}" y2="${16 + hh / 2}"/>`).join('')}</svg>
  <span class="time tnum">${sayIdle(t)}</span></div>`;

// A recording shows its length; the reading voice starts from nothing.
const sayIdle = t => (t.audio ? fmtSec(Math.ceil(num(t.dur))) : '0:00');

R.hours = (t, c) => `<div><div class="t-title lg ed" ${ce(c, 'title')} data-ph="Good time to write">${esc(t.title || (c.edit ? '' : 'Good time to write'))}</div><div class="t-meta hrs-sub"></div></div>
  <div class="hrs" data-nodrag>
    <div class="hrs-bar"><div class="hrs-track"></div>${rangeHtml(t)}<div class="hrs-now"></div><div class="hrs-hover"><span class="hrs-tip"></span></div>${c.edit ? ['from', 'to'].map(end => `<button class="hrs-h" data-end="${end}" style="left:${num(t[end], end === 'to' ? 24 : 0) / 24 * 100}%" aria-label="${end === 'from' ? 'Starts' : 'Ends'} at ${fmtHour(num(t[end], end === 'to' ? 24 : 0))}"></button>`).join('') : ''}</div>
    <div class="hrs-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
  </div>`;

// The honey part of the day. Hours that run past midnight wrap round, so they come in two pieces.
function rangeHtml(t) {
  const from = num(t.from), to = num(t.to, 24);
  const seg = ([a, b], cls) => `<div class="hrs-range ${cls}" style="left:${a / 24 * 100}%;width:${(b - a) / 24 * 100}%"></div>`;
  return to > from ? seg([from, to], '') : seg([from, 24], 'wrap-a') + seg([0, to], 'wrap-b');
}

// Redraws the range while its ends are being dragged, without rebuilding the tile.
export function paintRange(el, t) {
  el.querySelectorAll('.hrs-range').forEach(x => x.remove());
  el.querySelector('.hrs-track').insertAdjacentHTML('afterend', rangeHtml(t));
  for (const h of el.querySelectorAll('.hrs-h')) h.style.left = num(t[h.dataset.end], h.dataset.end === 'to' ? 24 : 0) / 24 * 100 + '%';
}

R.guestbook = (t, c) => {
  const total = (Number(t.count) || 0) + (c.box.scribbles?.[t.id]?.total || 0);
  return `<div class="gb-head"><div class="t-title lg">Guestbook</div><div class="t-meta gb-count tnum">${plural(total, 'scribble')}</div></div>
  <div class="gb-pad" ${c.edit ? '' : 'data-nodrag'}><canvas></canvas><span class="gb-by"></span>${c.edit ? '' : '<span class="gb-hint">Draw something small</span>'}</div>
  <form class="gb-form" data-form="guestbook" ${c.edit ? '' : 'data-nodrag'}><input name="name" placeholder="Your name" aria-label="Your name" maxlength="24" autocomplete="off" ${c.edit || c.interactive === false ? 'disabled' : ''}><button class="btn btn-dark sm" ${c.edit || c.interactive === false ? 'disabled' : ''}>Pin it</button></form>`;
};

// Older tiles held a single photo. Without a second one there's nothing to compare, so it shows as a plain photo.
R.beforeafter = (t, c) => !t.before ? `<div class="ba-img" style="${bg(t.src, t.pos)}"></div>` : `<div class="ba" style="--p:50%">
    <div class="ba-img" style="${bg(t.src, t.pos)}"></div>
    <div class="ba-img ba-before" style="${bg(t.before, t.pos)}"></div>
    <div class="ba-line"></div>
    <button class="ba-handle" data-nodrag aria-label="Drag to compare">${I.chevrons()}</button>
    <span class="ba-tag l">Before</span><span class="ba-tag r">After</span>
  </div>`;

R.subscribe = (t, c) => {
  const done = c.interactive !== false && Visitor.get('sub', c.key(t));
  return `<div><div class="t-title lg ed" ${ce(c, 'title')} data-ph="Newsletter name">${esc(t.title)}</div><div class="t-meta ed" ${ce(c, 'sub')} data-ph="What it’s about">${esc(t.sub)}</div></div>
  <form class="sub-form ${done ? 'done' : ''}" data-form="subscribe" ${c.edit ? '' : 'data-nodrag'} novalidate>
    <input type="email" name="email" placeholder="you@example.com" aria-label="Email address" autocomplete="email" ${c.edit || c.interactive === false ? 'disabled' : ''}>
    <button class="sub-btn" ${c.edit ? 'type="button"' : ''} ${c.interactive === false ? 'disabled' : ''}><span class="sub-label">Subscribe</span><span class="sub-done"><i>${I.check('#161616', 12)}</i>You’re on the list.</span></button>
  </form>`;
};

export const Tiles = {
  render(t, c) {
    return (R[t.type] || (() => `<div class="t-meta">Unknown tile</div>`))(t, c);
  },

  classes(t, c) {
    const cl = ['tile', 't-' + t.type, 's-' + c.size];
    if (t.type === 'note') {
      const p = htmlText(t.html).trim();
      cl.push('tint-' + tintOf(t));
      if (isEmojiOnly(p)) cl.push('is-emoji');
      else if (isQuote(p)) cl.push('is-quote');
      if (['left', 'center', 'right'].includes(t.align)) cl.push('al-' + t.align);
    }
    if (t.type === 'purr') cl.push('tint-' + tintOf(t));
    if (t.type === 'purr' && c.interactive !== false && Visitor.get('purr', c.key(t))) cl.push('purred');
    if (c.mode === 'view' && ((t.url && !t.draft) || (t.type === 'map' && t.place))) cl.push('clickable');
    return cl.join(' ');
  },

  // Live data that lives next to a tile rather than in it, so a change still redraws it.
  liveKey(t, box) {
    if (t.type === 'guestbook') return JSON.stringify(box.scribbles?.[t.id] || null);
    return '';
  },

  hydrate(root) {
    for (const el of root.querySelectorAll('.tile[data-id]')) {
      if (el._hyd) continue;
      el._hyd = true;
      const t = root._box.tiles.find(x => x.id === el.dataset.id);
      if (t && Hydrate[t.type]) Hydrate[t.type](el, t, root);
    }
  },
};

/* ---------- things that need a live element ---------- */

export const Hydrate = {
  link(el) {
    const img = el.querySelector('.fav img');
    if (!img) return;
    const fail = () => img.closest('.fav').remove();
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.currentSrc && img.naturalWidth === 0) fail();
    return () => img.removeEventListener('error', fail);
  },
  hours(el, t) { updateHours(el, t); },

  map(el, t, root) { mountMap(el, t, root._mode); },

  guestbook(el, t, root) {
    const pad = el.querySelector('.gb-pad'), cv = pad.querySelector('canvas'), ctx = cv.getContext('2d');
    const key = tileKey(root._box, t);
    let strokes = [], cur = null, fit = { s: 1, ox: 0, oy: 0 };
    const draw = () => {
      const w = pad.clientWidth, hgt = pad.clientHeight, dpr = devicePixelRatio || 1;
      if (!w || !hgt) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
      const s = Math.min(w / 340, hgt / 230);
      fit = { s, ox: (w - 340 * s) / 2, oy: (hgt - 230 * s) / 2 };
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * fit.ox, dpr * fit.oy);
      ctx.clearRect(-fit.ox / s, -fit.oy / s, w / s, hgt / s);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const box = root._box;
      const real = box.scribbles?.[t.id]?.recent || [];
      const pinned = [...(box.demo ? [GB_HI] : []), ...real, ...(el._pending || [])];
      if (box.demo) for (const d of GB_OLD) { ctx.strokeStyle = '#C4C4BF'; ctx.lineWidth = 2.2; ctx.stroke(new Path2D(d)); }
      pinned.forEach((p, i) => {
        const latest = i === pinned.length - 1 && !strokes.length;
        ctx.strokeStyle = latest ? '#161616' : '#C4C4BF';
        ctx.lineWidth = latest ? 2.8 : 2.2;
        ctx.stroke(new Path2D(p.d));
      });
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 2.8;
      for (const st of strokes) {
        ctx.beginPath();
        st.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        if (st.length === 1) ctx.lineTo(st[0].x + 0.1, st[0].y);
        ctx.stroke();
      }
      const latest = pinned[pinned.length - 1];
      el.querySelector('.gb-by').textContent = strokes.length || !latest ? '' : `— ${latest.name}`;
    };
    el._gb = { draw, clear() { strokes = []; draw(); }, strokes: () => strokes };
    const observer = new ResizeObserver(draw);
    observer.observe(pad);
    draw();
    if (root._mode !== 'view') return () => observer.disconnect();
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - fit.ox) / fit.s, y: (e.clientY - r.top - fit.oy) / fit.s }; };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      pad.classList.add('drawing');
      cur = [pt(e)]; strokes.push(cur); draw();
    });
    cv.addEventListener('pointermove', e => { if (!cur) return; cur.push(pt(e)); draw(); });
    const end = () => { cur = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    return () => observer.disconnect();
  },
};

export function updateHours(el, t) {
  const her = hoursIn(t.tz), off = tzOffset(t.tz);
  const who = (el.closest('.box-root')?._box?.name || '').split(' ')[0] || 'them';
  el.querySelector('.hrs-now').style.left = (her / 24 * 100) + '%';
  const sub = el.querySelector('.hrs-sub');
  sub.textContent = off === 0
    ? `It’s ${fmtHour(her)} in ${t.city}, same as where you are`
    : `It’s ${fmtHour(her)} in ${t.city}, ${fmtHour(her - off)} where you are`;
  el._who = who;
}

/* ---------- visitor actions ---------- */

export function openTileUrl(t) {
  if (t.type === 'map') return t.place && window.open(osmUrl(t), '_blank', 'noopener');
  if (!t.url || t.draft) return;
  if (t.demo) toast(`This is an example box, so <b>${esc(hostOf(t.url))}</b> doesn’t go anywhere.`, { mood: 'open' });
  else window.open(normUrl(t.url), '_blank', 'noopener');
}

// Spotify's own player. Their widget terms say it has to be shown as they make it,
// so it takes over the tile rather than hiding behind our controls.
let spotifyApi = null;
const loadSpotify = () => spotifyApi ||= new Promise((resolve, reject) => {
  window.onSpotifyIframeApiReady = resolve;
  const s = document.createElement('script');
  s.src = 'https://open.spotify.com/embed/iframe-api/v1';
  s.async = true;
  s.onerror = () => { spotifyApi = null; s.remove(); reject(new Error('Spotify didn’t load.')); };
  document.head.append(s);
});

const SPOTIFY_KINDS = ['track', 'album', 'playlist', 'artist', 'show', 'episode'];
function spotifyUri(url) {
  let parts = [];
  try { parts = new URL(normUrl(url)).pathname.split('/').filter(Boolean); } catch { return ''; }
  const i = parts.findIndex(p => SPOTIFY_KINDS.includes(p));
  return i >= 0 && /^[A-Za-z0-9]+$/.test(parts[i + 1] || '') ? `spotify:${parts[i]}:${parts[i + 1]}` : '';
}

export function specks(el, anchor) {
  const a = anchor.getBoundingClientRect(), r = el.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('i');
    s.className = 'speck';
    const size = 3 + Math.random() * 4;
    Object.assign(s.style, { width: size + 'px', height: size + 'px', left: (a.left - r.left + a.width / 2) + 'px', top: (a.top - r.top + a.height / 2) + 'px' });
    el.append(s);
    s.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(${-50 + (Math.random() * 120 + 20)}%, ${-50 - (Math.random() * 500 + 300)}%) scale(1)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => s.remove();
  }
}

export const Acts = {
  spotify(el, t) {
    const uri = spotifyUri(t.url);
    if (!uri) return openTileUrl(t);
    if (el.querySelector('.sp-embed')) return;
    const before = el.innerHTML;
    el.innerHTML = '<div class="sp-embed"><div></div></div>';
    const height = el.classList.contains('s-sprawl') ? Math.min(352, el.clientHeight) : 152;
    loadSpotify()
      .then(api => api.createController(el.querySelector('.sp-embed > div'), { uri, width: '100%', height }, ctl => {
        // Browsers may refuse to start it from here; then the player's own button does it.
        ctl.addListener('ready', () => ctl.play());
      }))
      .catch(() => {
        el.innerHTML = before;
        toast('Spotify’s player didn’t load. Tap the tile to open it on Spotify.');
      });
  },

  purr(el, t, root) {
    const key = tileKey(root._box, t);
    const btn = el.querySelector('.paw-btn');
    btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.76)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 440, easing: 'ease-out' });
    specks(el, btn);
    Sound.purr();
    if (Visitor.get('purr', key)) return;
    Visitor.set('purr', key, true, { persist: false });
    const before = t.count;
    t.count++;
    // Count it here straight away; Convex has the final word on the number.
    if (root._box._id) {
      mutation('interactions:purr', { boxId: root._box._id, tileId: t.id, visitorKey: Visitor.key })
        .then(r => {
          Visitor.set('purr', key, true);
          if (r?.count != null && el.isConnected) odoSet(el.querySelector('.odo'), r.count);
        })
        .catch(() => {
          Visitor.set('purr', key, false, { persist: false });
          t.count = before;
          if (!el.isConnected || Visitor.get('purr', key)) return;
          el.classList.remove('purred');
          btn.classList.remove('on');
          btn.innerHTML = I.paw('#C2566B', 20);
          odoSet(el.querySelector('.odo'), before);
          el.querySelector('.purr-sub').textContent = 'purrs. Tap to leave yours.';
          toast('Your purr couldn’t be saved. Try again.');
        });
    }
    el.classList.add('purred');
    btn.classList.add('on');
    btn.innerHTML = I.paw('#FFFFFF', 20);
    odoSet(el.querySelector('.odo'), t.count);
    el.querySelector('.purr-sub').textContent = 'You purred';
  },

  // Plays the owner's own recording when there is one, the reading voice otherwise. A second press stops it.
  say(el, t) {
    if (el._saying) { el._stopSay?.(); return; }
    el._saying = true;
    const lines = el.querySelectorAll('.wave line'), time = el.querySelector('.time'), btn = el.querySelector('.play-btn');
    btn.innerHTML = I.pause('#fff');
    let audio = null, start = performance.now(), raf = 0, linger = 0;
    const speak = () => { audio = null; start = performance.now(); Sound.speak(t.speak || t.name); };
    if (t.audio) {
      // A recording that won't play falls back to the reading voice.
      const fail = () => { if (audio) speak(); };
      audio = new Audio(t.audio);
      audio.onerror = fail;
      audio.play().catch(fail);
    } else speak();
    const reset = () => {
      cancelAnimationFrame(raf); clearTimeout(linger);
      lines.forEach(l => l.classList.remove('on'));
      time.textContent = sayIdle(t);
      btn.innerHTML = I.play('#fff');
      el._saying = false; el._stopSay = null;
    };
    el._stopSay = () => {
      if (audio) audio.pause(); else window.speechSynthesis?.cancel();
      reset();
    };
    const step = now => {
      const s = audio ? audio.currentTime : (now - start) / 1000;
      const dur = audio ? num(t.dur) || audio.duration || 3 : 3;
      lines.forEach((l, i) => l.classList.toggle('on', i / lines.length < s / dur));
      time.textContent = fmtSec(Math.min(s, dur));
      if (audio ? !audio.ended : s < dur) { raf = requestAnimationFrame(step); return; }
      lines.forEach(l => l.classList.add('on'));
      linger = setTimeout(reset, 700);
    };
    raf = requestAnimationFrame(step);
  },
};

export const Forms = {
  subscribe(form, el, t, root) {
    const input = form.querySelector('input');
    const v = input.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      input.focus();
      input.placeholder = 'An email address, please';
      return;
    }
    form.classList.add('done');
    input.blur();
    mutation('interactions:subscribe', { boxId: root._box._id, tileId: t.id, email: v, visitorKey: Visitor.key })
      .then(() => Visitor.set('sub', tileKey(root._box, t), true))
      .catch(err => {
        form.classList.remove('done');
        input.placeholder = reason(err);
        input.value = '';
      });
  },

  guestbook(form, el, t, root) {
    const gb = el._gb;
    const strokes = gb?.strokes() || [];
    const name = form.querySelector('input').value.trim() || 'A visitor';
    if (!strokes.length) {
      const hint = el.querySelector('.gb-hint');
      hint.textContent = 'Draw something first';
      hint.animate([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.08)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 300 });
      return;
    }
    const d = strokes.map(st => 'M' + st.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L') + (st.length === 1 ? ' l0.1 0' : '')).join(' ');
    // Show it pinned right away; the live query replaces this with the stored copy.
    el._pending = [{ d, name }];
    gb.clear();
    const total = (Number(t.count) || 0) + (root._box.scribbles?.[t.id]?.total || 0) + 1;
    el.querySelector('.gb-count').textContent = plural(total, 'scribble');
    el.querySelector('.gb-hint').textContent = `Pinned. Thanks, ${name}.`;
    el.querySelector('.gb-pad').classList.remove('drawing');
    form.reset();
    mutation('interactions:scribble', { boxId: root._box._id, tileId: t.id, d, name, visitorKey: Visitor.key })
      .catch(err => { el._pending = []; gb.clear(); toast(esc(reason(err))); });
  },
};

/* Listeners for every box on the page, set up once. */
export function bindTileEvents() {
  document.addEventListener('click', e => {
    const root = e.target.closest('.box-root');
    if (!root || root._mode === 'static') return;
    const el = e.target.closest('.tile[data-id]');
    if (!el) return;
    const t = root._box.tiles.find(x => x.id === el.dataset.id);
    if (!t) return;
    if (e.target.closest('.tile-link')) {
      if (t.demo || el.querySelector('.sp-embed')) { e.preventDefault(); if (t.demo) openTileUrl(t); }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && el.contains(act)) {
      if (root._mode === 'edit' && !act.hasAttribute('data-edit-ok')) return;
      e.preventDefault();
      Acts[act.dataset.act]?.(el, t, root, act, e);
      return;
    }
    if (root._mode !== 'view' || el.querySelector('.sp-embed')) return;
    if (e.target.closest('input, button, form, a, .gb-pad, .ba, .hrs')) return;
    openTileUrl(t);
  });

  // Run before SvelteKit intercepts GET forms for navigation. These forms submit
  // through Convex after hydration and must never turn into profile query URLs.
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    const root = form?.closest('.box-root');
    if (!form || !root || root._mode !== 'view') return;
    e.preventDefault();
    const el = form.closest('.tile[data-id]');
    const t = root._box.tiles.find(x => x.id === el.dataset.id);
    Forms[form.dataset.form]?.(form, el, t, root);
  }, true);

  // Before / after wipe.
  document.addEventListener('pointerdown', e => {
    const ba = e.target.closest('.ba');
    const root = ba?.closest('.box-root');
    if (!ba || !root || root._mode === 'static') return;
    if (root._mode === 'edit' && !e.target.closest('.ba-handle')) return;
    e.preventDefault();
    ba.classList.add('dragging');
    const move = ev => {
      const r = ba.getBoundingClientRect();
      ba.style.setProperty('--p', clamp((ev.clientX - r.left) / r.width * 100, 2, 98) + '%');
    };
    move(e);
    const up = () => { ba.classList.remove('dragging'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  // Hover anywhere on the day to read it in your own time.
  document.addEventListener('pointermove', e => {
    const bar = e.target.closest?.('.hrs-bar');
    const prev = document.querySelector('.hrs-bar.hovering');
    if (prev && prev !== bar) prev.classList.remove('hovering');
    if (!bar || bar.classList.contains('setting')) return;
    const el = bar.closest('.tile');
    const root = el.closest('.box-root');
    const t = root?._box.tiles.find(x => x.id === el.dataset.id);
    if (!t) return;
    const r = bar.getBoundingClientRect();
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    const hr = Math.round(p * 24 * 2) / 2;
    bar.classList.add('hovering');
    bar.querySelector('.hrs-hover').style.left = (hr / 24 * 100) + '%';
    const tip = bar.querySelector('.hrs-tip');
    tip.textContent = `${fmtHour(hr)} for ${el._who || 'them'}, ${fmtHour(hr - tzOffset(t.tz))} for you`;
    tip.classList.toggle('flip', p > 0.62);
  });

  // Tooltips.
  document.addEventListener('pointerover', e => {
    const t = e.target.closest?.('[data-tip]');
    if (t) Tip.show(t); else Tip.hide();
  });
  document.addEventListener('pointerdown', () => Tip.hide(), true);
}

// Clocks, "updated 2 days ago", the time-window tile.
export function tickClocks() {
  for (const el of document.querySelectorAll('[data-clock]')) el.textContent = timeIn(el.dataset.clock);
  for (const el of document.querySelectorAll('.t-hours')) {
    const root = el.closest('.box-root');
    const t = root?._box.tiles.find(x => x.id === el.dataset.id);
    if (t) updateHours(el, t);
  }
}
