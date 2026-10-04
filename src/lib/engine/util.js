import { query } from '../api.js';
export { htmlText, sanitize } from '../rich-text.js';
/* ---------- tiny helpers ---------- */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => 't' + Math.random().toString(36).slice(2, 9);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const EASE = 'cubic-bezier(.2,.9,.25,1)';

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}


export function hash(str) {
  let x = 2166136261;
  for (const c of String(str)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

export const plural = (n, one, many) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : (many || one + 's')}`;

export function fmtK(n) {
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toLocaleString('en-GB');
}

export function fmtSec(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function timeIn(tz, d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
  } catch { return '--:--'; }
}

export function hoursIn(tz, d = new Date()) {
  const [hh, mm] = timeIn(tz, d).split(':').map(Number);
  return hh + mm / 60;
}

export const localHours = (d = new Date()) => d.getHours() + d.getMinutes() / 60;

// Their clock minus yours, in hours.
export function tzOffset(tz, d = new Date()) {
  let diff = hoursIn(tz, d) - localHours(d);
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return Math.round(diff * 4) / 4;
}

export function fmtHour(hd) {
  hd = ((hd % 24) + 24) % 24;
  let hh = Math.floor(hd), mm = Math.round((hd - hh) * 60);
  if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

export const fmtDate = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });


export function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

export function hostOf(url) {
  if (!url) return '';
  try { return new URL(normUrl(url)).hostname.replace(/^www\./, ''); } catch { return String(url); }
}

export const looksLikeUrl = s => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(String(s).trim());

export function relTime(ts, now = Date.now()) {
  const s = (now - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return plural(Math.floor(s / 3600), 'hour') + ' ago';
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// *bold* and _italic_ typed by hand become real formatting.
export function applyMarks(html) {
  return html
    .replace(/\*([^*<>\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s>])_([^_<>\n]+)_/g, '$1<i>$2</i>');
}

export const isQuote = plain => /^\s*["“„«]/.test(plain);
export const isEmojiOnly = plain => {
  const s = plain.trim();
  return !!s && [...s].length <= 8 && /\p{Extended_Pictographic}/u.test(s) && /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u.test(s);
};

/* ---------- icons ---------- */

export const I = {
  link: (c = '#161616', s = 18, w = 1.4) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M6.6 9.4 L9.4 6.6 M7.2 4.4 L8.4 3.2 A2.9 2.9 0 0 1 12.8 7.6 L11.6 8.8 M8.8 11.6 L7.6 12.8 A2.9 2.9 0 0 1 3.2 8.4 L4.4 7.2" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  image: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><rect x="2" y="3" width="14" height="12" rx="2.5" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M2.5 12.5 L6.5 8.5 L10 12 L12 10 L15.5 13.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="6.5" r="1.3" fill="${c}"/></svg>`,
  text: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M4 4 H14 M9 4 V15" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  pin: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M9 16 C9 16 14 11 14 7.5 A5 5 0 0 0 4 7.5 C4 11 9 16 9 16 Z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9" cy="7.5" r="1.8" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`,
  music: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="9" cy="9" r="2" fill="${c}"/></svg>`,
  section: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M3 6 H15 M3 12 H10" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  heart: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M9 15 C9 15 2.5 11 2.5 6.6 A3.1 3.1 0 0 1 9 5 A3.1 3.1 0 0 1 15.5 6.6 C15.5 11 9 15 9 15 Z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  pawLine: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M9 9.6 C11.3 9.6 13.2 11.4 13.2 13.2 C13.2 14.8 11.8 15.4 9 15.4 C6.2 15.4 4.8 14.8 4.8 13.2 C4.8 11.4 6.7 9.6 9 9.6 Z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="3.6" cy="8" r="1.5" fill="${c}"/><circle cx="6.8" cy="4.4" r="1.5" fill="${c}"/><circle cx="11.2" cy="4.4" r="1.5" fill="${c}"/><circle cx="14.4" cy="8" r="1.5" fill="${c}"/></svg>`,
  back: (c = '#707070', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 14 14"><path d="M8.5 3 L4.5 7 L8.5 11" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clock: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M9 5 V9 L11.5 10.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  wave: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M3 7 V11 M6 4.5 V13.5 M9 2.5 V15.5 M12 5.5 V12.5 M15 7.5 V10.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  sunrise: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M2 12 H16 M9 3.5 V5.5 M3.8 5.8 L5.2 7.2 M14.2 5.8 L12.8 7.2" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/><path d="M5 12 A4 4 0 0 1 13 12" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`,
  pen: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><path d="M11.5 3 L15 6.5 L7 14.5 L3 15 L3.5 11 Z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  split: (c = '#161616', s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18"><rect x="2" y="3" width="14" height="12" rx="2.5" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M9 1.5 V16.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  mail: (c = '#161616', s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M3.5 5 L10 10.5 L16.5 5" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  arrow: (c = '#161616', s = 14, w = 1.6) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M5 11 L11 5 M6 5 H11 V10" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  crop: (c = '#fff', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M4 1 V12 H15 M1 4 H12 V15" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  mic: (c = '#fff', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M3 7.5 A5 5 0 0 0 13 7.5 M8 12.5 V14.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  upload: (c = '#fff', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M8 11 V3 M4.5 6.5 L8 3 L11.5 6.5 M3 13.5 H13" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  align: (c = '#fff', s = 16, a = 'left') => {
    const d = { left: 'M2.5 4H13.5 M2.5 8H9 M2.5 12H11', center: 'M2.5 4H13.5 M4.5 8H11.5 M3.5 12H12.5', right: 'M2.5 4H13.5 M7 8H13.5 M5 12H13.5' }[a];
    return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  },
  check: (c = '#161616', s = 16, w = 2.2) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: (c = '#161616', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M10.5 3.5 V3 A1.5 1.5 0 0 0 9 1.5 H4 A1.5 1.5 0 0 0 2.5 3 V8 A1.5 1.5 0 0 0 4 9.5 H4.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  again: (c = '#707070', s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M13.5 8 A5.5 5.5 0 1 1 11.9 4.1 M13.5 2.5 V5.5 H10.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  play: (c = '#161616', s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 12 12"><path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/></svg>`,
  pause: (c = '#161616', s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" rx="1" fill="${c}"/><rect x="7" y="1" width="3" height="10" rx="1" fill="${c}"/></svg>`,
  search: (c = '#8A8A8A', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M11 11 L14 14" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  close: (c = '#707070', s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 12 12"><path d="M2 2 L10 10 M10 2 L2 10" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  monitor: (c = '#161616', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="${c}" stroke-width="1.3"/><path d="M5.5 14 H10.5" fill="none" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  phone: (c = '#161616', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" fill="none" stroke="${c}" stroke-width="1.3"/></svg>`,
  paw: (c = '#C2566B', s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><ellipse cx="12" cy="16" rx="5" ry="4" fill="${c}"/><circle cx="5" cy="10" r="2.2" fill="${c}"/><circle cx="9.5" cy="6" r="2.2" fill="${c}"/><circle cx="14.5" cy="6" r="2.2" fill="${c}"/><circle cx="19" cy="10" r="2.2" fill="${c}"/></svg>`,
  chevrons: (c = '#161616') => `<svg width="16" height="12" viewBox="0 0 16 12"><path d="M5 2 L1 6 L5 10 M11 2 L15 6 L11 10" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  undo: (c = '#161616', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M5.5 3 L2.5 6 L5.5 9 M3 6 H10 A3.5 3.5 0 0 1 10 13 H7" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  redo: (c = '#161616', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M10.5 3 L13.5 6 L10.5 9 M13 6 H6 A3.5 3.5 0 0 0 6 13 H9" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plus: (c = '#161616', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 14 14"><path d="M7 2 V12 M2 7 H12" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  minus: (c = '#161616', s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 14 14"><path d="M2 7 H12" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  locate: (c = '#161616', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="8" cy="8" r="1.5" fill="${c}"/><path d="M8 1 V3 M8 13 V15 M1 8 H3 M13 8 H15" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  download: (c = '#161616', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M8 2.5 V10.5 M4.5 7 L8 10.5 L11.5 7 M3 13.5 H13" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  google: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`,

  // Tile poses, named after how a cat lies down.
  curl: (c = '#BDBDB8', s = 18) => `<svg width="${s}" height="${s * 22 / 26}" viewBox="0 0 26 22"><path d="M4 8 L6 1 L10 5 Q13 4 16 5 L20 1 L22 8 Q25 12 23 16 Q20 21 13 21 Q5 21 3 16 Q1 12 4 8 Z" fill="${c}"/></svg>`,
  loaf: (c = '#BDBDB8', s = 26) => `<svg width="${s}" height="${s * 30 / 56}" viewBox="0 0 56 30"><path d="M4 12 L7 2 L12 8 H17 L22 2 L24 10 H44 Q54 10 54 19 Q54 28 44 28 H12 Q2 28 2 20 Z" fill="${c}"/></svg>`,
  tower: (c = '#BDBDB8', s = 20) => `<svg width="${s * 24 / 40}" height="${s}" viewBox="0 0 24 40"><path d="M2 12 L4 1 L10 7 H14 L20 1 L22 12 V34 Q22 39 17 39 H7 Q2 39 2 34 Z" fill="${c}"/></svg>`,
  sprawl: (c = '#BDBDB8', s = 26) => `<svg width="${s}" height="${s * 30 / 64}" viewBox="0 0 64 30"><path d="M2 12 L5 2 L10 8 H15 L20 2 L22 12 V14 H54 Q62 14 62 20 Q62 24 56 24 H10 Q2 24 2 16 Z" fill="${c}"/><path d="M8 24 L3 29 M18 24 L16 29 M46 24 L48 29 M56 24 L62 29" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/></svg>`,
  sleepyLoaf: (s = 40) => `<svg width="${s}" height="${s * 22 / 40}" viewBox="0 0 56 30"><path d="M4 12 L7 2 L12 8 H17 L22 2 L24 10 H44 Q54 10 54 19 Q54 28 44 28 H12 Q2 28 2 20 Z" fill="#161616"/><path d="M8 17 Q10 19 12 17 M15 17 Q17 19 19 17" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/></svg>`,
};

export const PLATFORM_ICONS = {
  github: `<svg width="18" height="18" viewBox="0 0 16 16"><path fill="#fff" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  instagram: `<svg width="18" height="18" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3.5" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="8" cy="8" r="2.8" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="11.5" cy="4.5" r=".9" fill="#fff"/></svg>`,
  youtube: `<svg width="18" height="18" viewBox="0 0 16 16"><rect x="1" y="3.5" width="14" height="9" rx="3" fill="#fff"/><path d="M6.5 6 L10.5 8 L6.5 10 Z" fill="#161616"/></svg>`,
  spotify: `<svg width="18" height="18" viewBox="0 0 16 16"><path d="M3.5 6 Q8 4.4 12.6 6.6 M4.2 8.6 Q8 7.4 11.8 9.2 M5 11 Q8 10.1 10.9 11.6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  dribbble: `<svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M2.6 5.6 Q8 8.2 13.6 6.2 M2 9.4 Q8 7.4 11.8 13 M5.4 2.4 Q10.2 7 10.6 14.2" fill="none" stroke="#fff" stroke-width="1.2"/></svg>`,
  x: `<span class="glyph">𝕏</span>`,
  linkedin: `<span class="glyph">in</span>`,
  behance: `<span class="glyph">Bē</span>`,
  figma: `<svg width="18" height="18" viewBox="0 0 16 16"><path d="M5.5 1.5h2.5v4.3H5.5a2.15 2.15 0 0 1 0-4.3zM8 1.5h2.5a2.15 2.15 0 0 1 0 4.3H8zM5.5 5.8H8v4.3H5.5a2.15 2.15 0 0 1 0-4.3zM5.5 10.1H8v2.15A2.15 2.15 0 1 1 5.5 10.1z" fill="#fff"/><circle cx="10.5" cy="7.95" r="2.15" fill="#fff"/></svg>`,
  tiktok: `<span class="glyph">♪</span>`,
  substack: `<svg width="18" height="18" viewBox="0 0 16 16"><path d="M3 3h10v1.6H3zM3 6h10v1.6H3zM3 9h10v5l-5-2.6L3 14z" fill="#fff"/></svg>`,
  twitch: `<span class="glyph">◧</span>`,
};

export function platformOf(url) {
  const host = hostOf(url);
  const map = {
    'github.com': 'github', 'instagram.com': 'instagram', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
    'open.spotify.com': 'spotify', 'spotify.com': 'spotify', 'dribbble.com': 'dribbble', 'x.com': 'x', 'twitter.com': 'x',
    'linkedin.com': 'linkedin', 'behance.net': 'behance', 'figma.com': 'figma', 'tiktok.com': 'tiktok', 'twitch.tv': 'twitch',
  };
  if (map[host]) return map[host];
  if (host.endsWith('.substack.com')) return 'substack';
  return null;
}

/* ---------- the cat ---------- */

export function catLogo(size = 30, o = {}) {
  const fur = o.fur || '#161616';
  const mouth = o.mouth || '#FFFFFF';
  return `<svg class="cat${o.live ? ' cat-live' : ''}" data-mood="${o.mood || 'open'}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M8 26 L12 5 L26 18 H38 L52 5 L56 26 V50 Q56 58 48 58 H16 Q8 58 8 50 Z" fill="${fur}"/>
    <g class="eyes-open">
      <rect x="15" y="27" width="14" height="11" rx="3" fill="#F2C14E"/>
      <rect x="35" y="27" width="14" height="11" rx="3" fill="#F2C14E"/>
      <g class="pupils"><rect class="pupil" x="20.8" y="28.5" width="2.4" height="8" rx="1.2" fill="${o.pupil || fur}"/><rect class="pupil" x="40.8" y="28.5" width="2.4" height="8" rx="1.2" fill="${o.pupil || fur}"/></g>
    </g>
    <path class="eyes-closed" d="M16 33 Q22 37 28 33 M36 33 Q42 37 48 33" fill="none" stroke="#F2C14E" stroke-width="2.6" stroke-linecap="round"/>
    <path class="eyes-happy" d="M16 35 Q22 28 28 35 M36 35 Q42 28 48 35" fill="none" stroke="#F2C14E" stroke-width="2.6" stroke-linecap="round"/>
    <rect class="mouth" x="15" y="42" width="34" height="9" rx="3" fill="${mouth}"/>
  </svg>`;
}

export const Cat = {
  mood(m, scope = document) {
    $$('.cat-live', scope).forEach(c => { c.dataset.mood = m; });
  },
  // Show a mood for a moment, then go back to watching.
  flash(m, ms = 1600, scope = document) {
    this.mood(m, scope);
    clearTimeout(this._t);
    this._t = setTimeout(() => this.mood('open', scope), ms);
  },
  track(x, y) {
    for (const c of document.querySelectorAll('.cat-live')) {
      const r = c.getBoundingClientRect();
      if (!r.width) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.5;
      const dx = clamp((x - cx) / 220, -1, 1) * 4.6;
      const dy = clamp((y - cy) / 220, -1, 1) * 1.3;
      const p = c.querySelector('.pupils');
      if (p) p.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
    }
  },
  blinkLoop() {
    setTimeout(() => {
      const open = $$('.cat-live').filter(c => c.dataset.mood === 'open');
      open.forEach(c => { c.dataset.mood = 'closed'; });
      setTimeout(() => open.forEach(c => { if (c.dataset.mood === 'closed') c.dataset.mood = 'open'; }), 140);
      this.blinkLoop();
    }, 3500 + Math.random() * 4000);
  },
};

/* ---------- toasts & tooltips ---------- */

export function toast(msg, o = {}) {
  const host = $('#toasts');
  const t = h(`<div class="toast">${o.icon === false ? '' : `<span class="toast-cat">${catLogo(18, { fur: '#fff', mouth: '#161616', mood: o.mood || 'closed' })}</span>`}<span class="toast-msg">${msg}</span>${o.action ? `<button class="toast-act">${esc(o.action)}${o.kbd ? `<kbd>${o.kbd}</kbd>` : ''}</button>` : ''}</div>`);
  host.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
  let done = false;
  const close = () => {
    if (done) return; done = true;
    t.classList.remove('in');
    setTimeout(() => t.remove(), 320);
  };
  if (o.action) t.querySelector('.toast-act').addEventListener('click', () => { o.onAction?.(); close(); });
  setTimeout(close, o.timeout || 4200);
  return close;
}

export const Tip = {
  el: null,
  show(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    if (!this.el) { this.el = h('<div class="tip"></div>'); document.body.append(this.el); }
    const el = this.el;
    el.textContent = text;
    const r = target.getBoundingClientRect();
    const w = el.offsetWidth, ht = el.offsetHeight;
    const x = clamp(r.left + r.width / 2, w / 2 + 8, innerWidth - w / 2 - 8);
    // Above by default, below when there's no room up top.
    const below = r.top - ht - 10 < 8;
    el.style.left = x + 'px';
    el.style.top = (below ? r.bottom + 8 : r.top - 8) + 'px';
    el.classList.toggle('below', below);
    el.classList.add('in');
  },
  hide() { this.el?.classList.remove('in'); },
};

/* ---------- sound ---------- */

export const Sound = {
  ctx: null,
  ac() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  // A short, low rumble. Brown noise wobbling at about 23 Hz.
  purr() {
    const ac = this.ac();
    if (!ac) return;
    const dur = 0.9, n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ac.createBufferSource(); src.buffer = buf;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 360;
    const am = ac.createGain(); am.gain.value = 0.5;
    const lfo = ac.createOscillator(); lfo.frequency.value = 23;
    const depth = ac.createGain(); depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    const env = ac.createGain(), t = ac.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.12);
    env.gain.setValueAtTime(0.32, t + dur - 0.3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(am).connect(env).connect(ac.destination);
    src.start(t); lfo.start(t); src.stop(t + dur); lfo.stop(t + dur);
  },

  speak(text) {
    if (!('speechSynthesis' in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.82; u.pitch = 1.05;
    speechSynthesis.speak(u);
    return true;
  },
};

/* ---------- files ---------- */

// Downscale photos so a handful still fit in localStorage.
export function readImage(file, max = 1200) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ar = img.width / img.height;
        if (file.type === 'image/gif' && file.size < 1.5e6) return resolve({ src: fr.result, ar });
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ src: c.toDataURL('image/jpeg', 0.84), ar });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export function pickFiles(accept = 'image/*,video/*', multiple = true) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.addEventListener('change', () => resolve([...inp.files]));
    inp.click();
  });
}

export const poseForRatio = ar => ar > 1.45 ? 'loaf' : ar < 0.72 ? 'tower' : 'curl';

/* ---------- popovers ---------- */

// One small floating panel at a time, anchored to whatever opened it.
// It flips above or below to fit, never leaves the viewport, and follows its anchor while you scroll.
export const Pop = {
  cur: null,
  open(html, anchor, o = {}) {
    this.close();
    const ar = anchor.getBoundingClientRect();
    if (ar.bottom < 0 || ar.top > innerHeight) anchor.scrollIntoView({ block: 'nearest' });
    const el = h(`<div class="pop ${o.cls || ''}" role="dialog">${html}</div>`);
    $('#layer').append(el);
    const out = ev => { if (!el.contains(ev.target) && !anchor.contains(ev.target)) this.close(); };
    const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); this.close(); } };
    const follow = () => this.place();
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    setTimeout(() => document.addEventListener('pointerdown', out, true));
    document.addEventListener('keydown', key, true);
    addEventListener('scroll', follow, { passive: true, capture: true });
    addEventListener('resize', follow);
    this.cur = {
      el, anchor, o, onClose: o.onClose,
      off: () => {
        ro.disconnect();
        document.removeEventListener('pointerdown', out, true);
        document.removeEventListener('keydown', key, true);
        removeEventListener('scroll', follow, { capture: true });
        removeEventListener('resize', follow);
      },
    };
    this.place();
    requestAnimationFrame(() => el.classList.add('in'));
    return el;
  },

  place() {
    if (!this.cur) return;
    const { el, anchor, o } = this.cur;
    if (!anchor.isConnected) { this.close(); return; }
    const r = anchor.getBoundingClientRect();
    // The anchor scrolled away: nothing left to point at.
    if (r.bottom < 0 || r.top > innerHeight) { this.close(); return; }
    const m = 8, gap = 8, vw = innerWidth, vh = innerHeight;
    el.style.maxHeight = (vh - m * 2) + 'px';
    const w = el.offsetWidth, full = el.scrollHeight;
    const below = vh - r.bottom - gap - m, above = r.top - gap - m;
    let top, ht = Math.min(full, vh - m * 2);
    if (ht <= below) top = r.bottom + gap;
    else if (ht <= above) top = r.top - gap - ht;
    else if (Math.max(below, above) >= 220) {
      // Fits on neither side: take the roomier one and scroll inside.
      ht = Math.max(below, above);
      el.style.maxHeight = ht + 'px';
      top = below >= above ? r.bottom + gap : m;
    } else top = below >= above ? vh - m - ht : m;
    let left = o.align === 'right' ? r.right - w : r.left;
    left = clamp(left, m, Math.max(m, vw - w - m));
    el.style.left = left + 'px';
    el.style.top = Math.max(m, top) + 'px';
  },

  close() {
    if (!this.cur) return;
    const { el, onClose, off } = this.cur;
    this.cur = null;
    off();
    el.classList.remove('in');
    setTimeout(() => el.remove(), 180);
    onClose?.();
  },
};

// Ask Convex whether an address is free. Same shape as before, just async.
export async function handleCheck(raw, current) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return { state: 'empty', msg: '' };
  if (v === current) return { state: 'same', msg: 'That’s your address now.' };
  try {
    return await query('boxes:handleStatus', { handle: v });
  } catch {
    return { state: 'bad', msg: 'Couldn’t check that just now. Try again in a moment.' };
  }
}
