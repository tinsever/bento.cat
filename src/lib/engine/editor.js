import { action, clerk, mutation, posterOf, query, reason, upload, watch } from '../api.js';
import { Box } from './box.js';
import { createSaveQueue, draftJournal } from '../save-queue.js';
import { mergePreview, previewSource } from '../link-previews.js';
import { hasCoords, zoomOf } from './map.js';
import { AVATAR_SHAPES, DAY, sz } from './data.js';
import { ALL_POSES, POSES, TINTS, TYPES, bg, corner, num, paintRange, serviceOf, sizeOf, tilesFor, tintOf, titleOf } from './tiles.js';
import { $, $$, Cat, I, Pop, applyMarks, catLogo, clamp, esc, fmtHour, fmtSec, h, handleCheck, hash, hostOf, htmlText, looksLikeUrl, normUrl, pickFiles, platformOf, plural, poseForRatio, relTime, sanitize, toast, tzOffset, uid } from './util.js';

/* The editor. Edit right on the page; controls appear beside the thing you touch. */

export const ADD = [
  { kind: 'link', label: 'Link', icon: I.link },
  { kind: 'photo', label: 'Photo or video', icon: I.image },
  { kind: 'text', label: 'Note', icon: I.text },
  { kind: 'map', label: 'Map', icon: I.pin },
  { kind: 'music', label: 'Music', icon: I.music },
  { kind: 'section', label: 'Section title', icon: I.section },
  { kind: 'more', label: 'More tiles', icon: I.pawLine },
];

// The tiles that react. The paw swaps the dock over to these.
export const MORE = [
  { kind: 'purr', label: 'Purr', icon: I.heart },
  { kind: 'status', label: 'Status', icon: I.clock },
  { kind: 'sayname', label: 'Say my name', icon: I.wave },
  { kind: 'hours', label: 'Good time to write', icon: I.sunrise },
  { kind: 'guestbook', label: 'Guestbook', icon: I.pen },
  { kind: 'beforeafter', label: 'Before and after', icon: I.split },
  { kind: 'subscribe', label: 'Subscribe', icon: I.mail },
];

// Where the visitor's clock is, so time tiles start out right.
const myZone = () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return { tz, city: tz.split('/').pop().replace(/_/g, ' ') };
};

export const STEPS = [
  { k: 'claim', label: b => `Claim bento.cat/${b.handle}`, done: () => true },
  { k: 'photo', label: () => 'Add a photo', done: b => !!b.avatar || b.tiles.some(t => t.type === 'photo') },
  { k: 'three', label: () => 'Put three things in the box', done: b => b.tiles.filter(t => t.type !== 'section' && !t.draft).length >= 3 },
  { k: 'line', label: () => 'Write a line about yourself', done: b => !!(b.bio || '').trim() },
  { k: 'share', label: () => 'Share the link somewhere', done: b => !!b.shared },
];

// Ready-made first lines for the share card. "Another line" walks through them.
export const SHARE_LINES = [
  (b, n) => n > 2 ? `Made myself a small corner of the internet. ${plural(n, 'thing')} in the box, and the cat signed off on all of them.` : 'Made myself a small corner of the internet. The cat signed off on it.',
  () => 'If it fits, it sits. Everything I’m into right now, in one small box.',
  () => 'New home on the internet. It’s small, it’s mine, and there’s a cat.',
  () => 'My box is open. Come sniff around.',
];

export const prettyHost = host => {
  const base = hostOf(host).split('.')[0] || host;
  return base.split(/[-_]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
};

const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/;

// A first guess from the address alone, so the tile shows up straight away.
// The server reads the page and fills in the real title, picture or graph.
export function guessLink(raw) {
  const url = normUrl(raw);
  const host = hostOf(url);
  let parts = [];
  try { parts = new URL(url).pathname.split('/').filter(Boolean); } catch { /* not a URL we can split */ }
  if (platformOf(url) === 'github' && parts.length === 1) return { type: 'github', size: sz('loaf'), user: parts[0], levels: '', url, loading: true };
  if (serviceOf(url)) return { type: 'music', size: sz('loaf'), title: '', sub: '', cover: null, url, loading: true };
  if (VIDEO_HOSTS.test(host) && !host.startsWith('music.')) return { type: 'video', size: sz('loaf'), src: '', title: '', meta: '', url, loading: true };
  const p = platformOf(url);
  return { type: 'link', size: sz('curl'), title: prettyHost(host), url, icon: p ? { platform: p } : null, loading: true };
}

// `box` is the signed-in person's box from Convex. The editor works on it locally
// and saves the whole thing back a moment after each change.
export function EditorView(app, box, opts = {}) {
  const Fetching = new Set();
  const S = {
    device: innerWidth < 760 ? 'm' : 'd',
    sel: null, undo: [], redo: [], press: null, drag: null,
    knockAsk: false, crop: null, focusId: null, editing: null, fresh: new Set(),
    pending: 0, palette: null, prevDone: null, clHidden: false, timers: [],
  };
  const firstName = () => (box.name || '').trim().split(' ')[0];

  app.innerHTML = `
  <div class="ed">
    <header class="ed-head">
      <div class="ed-head-l">
        <a href="/" class="ed-logo" aria-label="bento.cat">${catLogo(30, { live: true })}</a>
        <span class="vr"></span>
        <span class="ed-title" id="edTitle"></span>
        <a class="ed-url" id="edUrl"></a>
      </div>
      <div class="ed-head-r">
        <div class="save idle" id="save"></div>
        <button class="ed-link" data-ed="visits">Visits</button>
        <button class="ed-link" data-ed="subs">Subscribers</button>
        <a class="btn btn-line" id="edPreview">Preview ↗</a>
        <button class="btn btn-dark" data-ed="share">Share your box</button>
        <button class="ed-me" data-ed="menu" id="edMe" aria-label="Your account"></button>
      </div>
    </header>
    <div class="ed-page" id="edPage">
      <div class="ed-bar">
        <div class="ed-bar-l"><span class="chip">Editing your page</span><span class="ed-hint">Click to edit. Drag to rearrange. <kbd>⌘K</kbd> adds anything.</span></div>
        <div class="ed-bar-r">
          <button data-ed="undo" id="bUndo">${I.undo('currentColor')} Undo</button>
          <button data-ed="redo" id="bRedo">${I.redo('currentColor')} Redo</button>
          <button data-ed="settings" id="bSettings">Page settings</button>
        </div>
      </div>
      <div class="ed-stage ${S.device === 'm' ? 'm' : ''}" id="edStage"><div id="edCanvas"></div></div>
      <div class="tb" id="tb" hidden></div>
    </div>
    <div class="dock" id="dock">
      <div class="dock-tools" id="dockTools">
        ${ADD.map(a => `<button class="dock-b" data-add="${a.kind}" data-label="${a.label}" aria-label="${a.label}">${a.icon('#161616', 18)}</button>`).join('')}
        <span class="dock-tip" id="dockTip"></span>
      </div>
      <div class="dock-r">
        <span class="dock-save" id="dockSave">Saved</span>
        <div class="seg" role="group" aria-label="Layout">
          <button data-dev="d" class="${S.device === 'd' ? 'on' : ''}" data-tip="Desktop layout">${I.monitor()}</button>
          <button data-dev="m" class="${S.device === 'm' ? 'on' : ''}" data-tip="Mobile layout">${I.phone('#161616')}</button>
        </div>
        <button class="btn btn-dark sm" data-ed="share">Share</button>
      </div>
    </div>
    <div class="checklist" id="checklist" hidden></div>
    <div class="dropzone" id="dropzone" hidden>
      <div class="dz-box">
        <svg viewBox="0 0 280 196"><path d="M10 50 L26 6 L78 38 H202 L254 6 L270 50 V172 Q270 190 252 190 H28 Q10 190 10 172 Z" fill="#FFFFFF" stroke="#F2C14E" stroke-width="2" stroke-linejoin="round" stroke-dasharray="7 6"/></svg>
        <div class="dz-text"><b>Let go to drop it in</b><span id="dzCount"></span></div>
      </div>
    </div>
  </div>`;

  const canvas = $('#edCanvas', app);
  const tb = $('#tb', app);
  const find = id => box.tiles.find(t => t.id === id);
  const findIn = (b, id) => b.tiles.find(t => t.id === id);
  // Ids in the order the current layout shows them.
  const orderIdsOf = (b, dev) => tilesFor(b, dev).map(t => t.id);
  const orderIds = () => orderIdsOf(box, S.device);
  const elOf = id => canvas._els?.get(id);
  canvas._editor = true;

  /* ---------- render, history, saving ---------- */

  function render(animate = false) {
    Box.render(canvas, box, { mode: 'edit', device: S.device, animate, selectedId: S.sel });
    if (S.crop) elOf(S.crop)?.classList.add('cropping');
    for (const id of Fetching) elOf(id)?.classList.add('loading');
    if (S.focusId) { focusTile(S.focusId); S.focusId = null; }
    buildToolbar();
    syncHeader();
    syncChecklist();
  }

  function commit(fn, o = {}) {
    const before = o.before || JSON.stringify(box);
    fn(box);
    if (JSON.stringify(box) === before) { render(false); return; }
    S.undo.push(before);
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    render(o.animate !== false);
    save();
  }

  function restore(json) {
    const b = JSON.parse(json);
    for (const k of Object.keys(box)) delete box[k];
    Object.assign(box, b);
  }

  function afterHistory() {
    if (S.sel && !find(S.sel)) S.sel = null;
    S.knockAsk = false; S.crop = null;
    Pop.close();
    render(true);
    save();
  }

  function undo() {
    if (!S.undo.length) { toast('Nothing to put back.'); return; }
    S.redo.push(JSON.stringify(box));
    restore(S.undo.pop());
    afterHistory();
  }

  function redo() {
    if (!S.redo.length) return;
    S.undo.push(JSON.stringify(box));
    restore(S.redo.pop());
    afterHistory();
  }

  // What Convex stores. Live extras like counts and scribbles stay out of it.
  const payload = () => JSON.parse(JSON.stringify({
    name: box.name, bio: box.bio, avatar: box.avatar ?? null, avatarVideo: box.avatarVideo ?? null, avatarPos: box.avatarPos, avatarShape: box.avatarShape,
    tiles: box.tiles, mobile: box.mobile ? orderIdsOf(box, 'm') : undefined, suggestions: box.suggestions || [], onboarding: !!box.onboarding, shared: !!box.shared,
    showInExplore: box.showInExplore !== false, shareVisits: box.shareVisits !== false, notifySubscribers: box.notifySubscribers !== false,
  }));

  function save(o) {
    clearTimeout(S.idleT);
    saves.changed(o);
  }

  const flush = () => saves.flush();
  let local, session;
  try { local = localStorage; session = sessionStorage; } catch { /* unavailable storage */ }
  let alive = true;
  const saves = createSaveQueue({
    revision: box.revision ?? 0, lastSaveId: box.lastSaveId, getData: payload,
    save: args => mutation('boxes:save', args), journal: draftJournal(box._id, local, session),
    onState(state, pending) {
      S.pending = pending;
      // Mid-word there's nothing to show yet; the pill waits for the save itself.
      if (!alive || state === 'typing') return;
      setSave(state);
      if (state === 'saved') S.idleT = setTimeout(() => { if (alive) setSave('idle'); }, 1500);
    },
    onConflict: () => { if (alive) toast('Your box changed in another tab. Download your data to keep these edits, then refresh.'); },
    onStorageError: () => { if (alive) toast('This browser couldn’t keep a recovery draft. Keep this tab open until your changes are saved.'); },
  });
  if (saves.recovery) Object.assign(box, saves.recovery);

  function setSave(state) {
    const el = $('#save', app);
    if (!el) return;
    // Drawing the same pill again would restart its progress bar.
    const shown = `${state}:${S.pending}`;
    if (el._shown === shown) return;
    el._shown = shown;
    el.className = 'save ' + state;
    if (state === 'idle') el.innerHTML = `${I.check('#707070', 16, 1.5)}<span>All changes saved</span>`;
    if (state === 'saving') el.innerHTML = `<span class="save-pill"><svg width="18" height="18" viewBox="0 0 64 64"><path d="M8 26 L12 5 L26 18 H38 L52 5 L56 26 V50 Q56 58 48 58 H16 Q8 58 8 50 Z" fill="#FFFFFF"/><rect x="15" y="27" width="14" height="11" rx="3" fill="#F2C14E"/><rect x="35" y="27" width="14" height="11" rx="3" fill="#F2C14E"/></svg><span class="tnum">Saving ${plural(S.pending, 'change')}</span><i class="save-bar"><b></b></i></span>`;
    if (state === 'error') el.innerHTML = `<span class="save-pill err"><i class="err-dot"></i><span>Couldn’t save. Trying again…</span></span>`;
    if (state === 'saved') el.innerHTML = `<span class="save-pill"><svg width="16" height="16" viewBox="0 0 64 64"><path d="M8 26 L12 5 L26 18 H38 L52 5 L56 26 V50 Q56 58 48 58 H16 Q8 58 8 50 Z" fill="#FFFFFF"/><path d="M15 33 H29 M35 33 H49" fill="none" stroke="#161616" stroke-width="5" stroke-linecap="round"/></svg><span>Saved</span></span>`;
    $('#dockSave', app).textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved';
  }

  function syncHeader() {
    const fn = firstName();
    $('#edTitle', app).textContent = fn ? `${fn}’s box` : 'Your box';
    const url = $('#edUrl', app);
    url.textContent = `bento.cat/${box.handle}`;
    url.href = `/${box.handle}`;
    $('#edPreview', app).href = `/${box.handle}`;
    const me = $('#edMe', app);
    me.style.backgroundImage = box.avatar ? `url('${box.avatar}')` : '';
    me.textContent = box.avatar ? '' : (fn[0] || box.handle[0] || '?').toUpperCase();
    me.className = `ed-me av-${box.avatarShape || 'circle'}`;
    $('#bUndo', app).disabled = !S.undo.length;
    $('#bRedo', app).disabled = !S.redo.length;
  }

  function focusTile(id) {
    const el = id === '__bio' ? canvas.querySelector('.bio') : elOf(id);
    const f = el?.querySelector('[data-field], .draft-form input');
    if (!f) return;
    f.focus();
    if (f.isContentEditable) {
      const r = document.createRange();
      r.selectNodeContents(f); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  }

  /* ---------- selection & toolbar ---------- */

  function select(id) {
    if (S.sel !== id) { S.knockAsk = false; if (S.crop && S.crop !== id) cropDone(); }
    S.sel = id;
    canvas.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
    if (id) elOf(id)?.classList.add('selected');
    Pop.close();
    buildToolbar();
  }

  function buildToolbar() {
    const t = S.sel && find(S.sel);
    // Clicking away from a tile that's recording ends the take.
    if (S.rec && S.rec.id !== t?.id) S.rec.stop();
    if (!t || S.drag || t.draft) { tb.hidden = true; return; }
    tb.hidden = false;
    tb.innerHTML = S.crop === t.id ? cropBarHtml() : S.rec?.id === t.id ? recBarHtml() : toolbarHtml(t);
    placeToolbar();
  }

  function toolbarHtml(t) {
    const size = sizeOf(t, S.device);
    const poses = TYPES[t.type].poses;
    const poseBtns = poses.length
      ? ALL_POSES.map(p => `<button class="tb-b pose ${p === size ? 'on' : ''}" data-pose="${p}" ${poses.includes(p) ? '' : 'disabled'} data-tip="${POSES[p].name}, ${POSES[p].w} × ${POSES[p].h}" aria-label="${POSES[p].name}">${I[p](p === size ? '#161616' : '#BDBDB8')}</button>`).join('') + '<i class="tb-div"></i>'
      : '';
    const tools = [];
    if (['link', 'photo', 'video', 'note'].includes(t.type)) tools.push(`<button class="tb-b" data-tb="link" data-tip="${t.url ? 'Edit link' : 'Add a link'}" aria-label="Link">${I.link(t.url ? '#F2C14E' : '#FFFFFF', 16, 1.5)}</button>`);
    if (t.type === 'photo' || (t.type === 'video' && !t.video)) tools.push(`<button class="tb-b" data-tb="crop" data-tip="Frame it" aria-label="Frame">${I.crop()}</button>`);
    if (t.type === 'photo') tools.push(`<button class="tb-b" data-tb="replace" data-tip="Replace photo" aria-label="Replace">${I.upload()}</button>`);
    if (t.type === 'beforeafter') {
      tools.push(`<button class="tb-b" data-tb="replace-before" data-tip="${t.before ? 'Replace before photo' : 'Add a before photo'}" aria-label="Replace before photo">${I.upload(t.before ? '#FFFFFF' : '#F2C14E')}</button>`);
      tools.push(`<button class="tb-b" data-tb="replace" data-tip="Replace after photo" aria-label="Replace after photo">${I.upload()}</button>`);
    }
    if (t.type === 'note' || t.type === 'purr') tools.push(`<button class="tb-b" data-tb="tint" data-tip="Colour" aria-label="Colour"><span class="swatch" style="background:${TINTS[tintOf(t)].bg}"></span></button>`);
    if (t.type === 'note') {
      tools.push(`<button class="tb-b" data-tb="align" data-tip="Align" aria-label="Align">${I.align('#fff', 16, t.align || 'left')}</button>`);
    }
    if (t.type === 'sayname') {
      tools.push(`<button class="tb-b" data-tb="record" data-tip="${t.audio ? 'Record it again' : 'Record your name'}" aria-label="Record">${I.mic(t.audio ? '#F2C14E' : '#FFFFFF')}</button>`);
      if (t.audio) tools.push(`<button class="tb-b" data-tb="unrecord" data-tip="Use the reading voice" aria-label="Remove recording">${I.close('#fff', 12)}</button>`);
    }
    if (t.type === 'map') tools.push(`<button class="tb-b" data-tb="place" data-tip="Pick a place" aria-label="Place">${I.pin('#fff', 16)}</button>`);
    const knock = S.knockAsk
      ? `<span class="knock ask"><span>Off the table?</span><button class="knock-yes" data-tb="knock-yes">Knock it</button><button class="knock-no" data-tb="knock-no">Keep</button></span>`
      : `<button class="knock" data-tb="knock">${I.paw('#F4C9CF', 16)}<span>Knock off</span></button>`;
    return `<div class="tb-pill ${S.knockAsk ? 'asking' : ''}">${poseBtns}${tools.join('')}${tools.length ? '<i class="tb-div"></i>' : ''}${knock}</div>`;
  }

  const recBarHtml = () => `<div class="tb-pill"><i class="rec-dot"></i><span class="tb-txt tnum">Recording ${fmtSec((performance.now() - S.rec.start) / 1000)}</span><i class="tb-div"></i><button class="tb-done" data-tb="rec-stop">Done</button></div>`;

  const cropBarHtml = () => `<div class="tb-pill"><span class="tb-txt">Drag the photo to frame it</span><i class="tb-div"></i><button class="tb-txt-b" data-tb="crop-reset">Reset</button><button class="tb-done" data-tb="crop-done">Done</button></div>`;

  function placeToolbar() {
    if (tb.hidden) return;
    const el = elOf(S.sel);
    if (!el || !el.isConnected || el.classList.contains('lifted')) { tb.hidden = true; return; }
    const page = $('#edPage', app).getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const x = cr.left - page.left + el.offsetLeft;
    const y = cr.top - page.top + el.offsetTop;
    const th = tb.offsetHeight || 46, tw = tb.offsetWidth, w = el.offsetWidth;
    const safeTop = $('.ed-head', app).offsetHeight + 10 - page.top;
    const barBottom = $('.ed-bar', app).getBoundingClientRect().bottom - page.top;
    let top = y - th - 14;
    // The first row has the editing bar right above it: hang underneath instead of covering it.
    if (top < barBottom + 6 && y + el.offsetHeight + 14 > safeTop) top = y + el.offsetHeight + 14;
    // Under the sticky header: ride along the top edge until the tile itself leaves.
    else if (top < safeTop) top = Math.min(safeTop, y + el.offsetHeight - th - 10);
    // Share the tile's left edge, or its right edge when there's no room to the right.
    let left = x;
    if (left + tw > page.width - 8) left = x + w - tw;
    left = clamp(left, 8, Math.max(8, page.width - tw - 8));
    tb.style.transform = `translate(${left}px, ${top}px)`;
  }

  // Following the tile while scrolling should be instant, not eased.
  let stillT;
  function placeToolbarNow() {
    tb.classList.add('still');
    placeToolbar();
    clearTimeout(stillT);
    stillT = setTimeout(() => tb.classList.remove('still'), 160);
  }

  tb.addEventListener('click', e => {
    const b = e.target.closest('button');
    const t = S.sel && find(S.sel);
    if (!b || !t || b.disabled) return;
    if (b.dataset.pose) {
      commit(bx => { const x = findIn(bx, t.id); x.size = { ...x.size, [S.device]: b.dataset.pose }; });
      return;
    }
    switch (b.dataset.tb) {
      case 'link': return openLinkPop(t, b);
      case 'crop': return startCrop(t);
      case 'crop-reset': { t.pos = '50% 50%'; const img = elOf(t.id)?.querySelector('.ph-img'); if (img) img.style.backgroundPosition = t.pos; return; }
      case 'crop-done': return cropDone();
      case 'replace': return replacePhoto(t, 'src');
      case 'replace-before': return replacePhoto(t, 'before');
      case 'tint': return openTintPop(t, b);
      case 'align': return commit(bx => { const x = findIn(bx, t.id); x.align = { left: 'center', center: 'right', right: 'left' }[x.align || 'left']; }, { animate: false });
      case 'place': return placeSearch(t);
      case 'record': return record(t);
      case 'rec-stop': return S.rec?.stop();
      case 'unrecord': return commit(bx => { const x = findIn(bx, t.id); delete x.audio; delete x.dur; }, { animate: false });
      case 'knock': S.knockAsk = true; buildToolbar(); tb.querySelector('.knock-yes')?.focus(); return;
      case 'knock-no': S.knockAsk = false; buildToolbar(); return;
      case 'knock-yes': return knockOff(t.id);
    }
  });

  function openLinkPop(t, anchor) {
    const pop = Pop.open(`<form class="pop-form">${I.link('#8A8A8A', 16)}<input name="u" value="${esc(t.url || '')}" placeholder="Paste a link" spellcheck="false" autocomplete="off"><button class="btn btn-dark sm">${t.url ? 'Save' : 'Add'}</button></form>
      ${t.url && t.type !== 'link' ? '<button class="pop-sub" data-clear>Remove the link</button>' : ''}`, anchor, { cls: 'pop-link' });
    const inp = pop.querySelector('input');
    inp.focus(); inp.select();
    pop.querySelector('form').addEventListener('submit', ev => {
      ev.preventDefault();
      const u = inp.value.trim();
      if (u && !looksLikeUrl(u)) { inp.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); return; }
      if (u && t.type === 'music' && !serviceOf(u)) { inp.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); toast('Music tiles take Spotify links.'); return; }
      if (!u && t.type === 'link') return;
      Pop.close();
      const url = u ? normUrl(u) : '';
      if (url === t.url) return;
      const imported = ['link', 'music', 'video'].includes(t.type) && !t.video;
      const baseline = t.previewSource?.values || { icon: t.icon, src: t.src, cover: t.cover, preview: t.preview };
      commit(bx => {
        const x = findIn(bx, t.id);
        x.url = url;
        delete x.demo;
        if (url && imported) {
          x.previewSource = { url, type: x.type, fetchedAt: 0, values: baseline };
          x.loading = true;
        } else delete x.previewSource;
      }, { animate: false });
      if (url && imported) unfurl(t.id, { refresh: true, baseline });
    });
    pop.querySelector('[data-clear]')?.addEventListener('click', () => { Pop.close(); commit(bx => { const x = findIn(bx, t.id); x.url = ''; delete x.demo; }, { animate: false }); });
  }

  function openTintPop(t, anchor) {
    const pop = Pop.open(`<div class="tints">${Object.entries(TINTS).map(([k, v]) => `<button class="tint-b ${tintOf(t) === k ? 'on' : ''}" data-tint="${k}" data-tip="${v.name}" style="background:${v.bg}" aria-label="${v.name}"></button>`).join('')}</div>`, anchor, { cls: 'pop-tints' });
    pop.addEventListener('click', ev => {
      const b = ev.target.closest('[data-tint]');
      if (!b) return;
      Pop.close();
      commit(bx => { findIn(bx, t.id).tint = b.dataset.tint; }, { animate: false });
    });
  }

  function startCrop(t) {
    S.crop = t.id;
    S.cropBefore = JSON.stringify(box);
    elOf(t.id)?.classList.add('cropping');
    buildToolbar();
  }

  function cropDone() {
    if (!S.crop) return;
    const before = S.cropBefore;
    elOf(S.crop)?.classList.remove('cropping');
    S.crop = null;
    commit(() => {}, { before, animate: false });
  }

  function cropDrag(e, el, t) {
    e.preventDefault();
    const img = el.querySelector('.ph-img');
    const [px, py] = (t.pos || '50% 50%').split(' ').map(v => parseFloat(v) || 50);
    const sx = e.clientX, sy = e.clientY, r = el.getBoundingClientRect();
    el.classList.add('grabbing');
    const move = ev => {
      const nx = clamp(px - (ev.clientX - sx) / r.width * 120, 0, 100);
      const ny = clamp(py - (ev.clientY - sy) / r.height * 120, 0, 100);
      t.pos = `${nx.toFixed(1)}% ${ny.toFixed(1)}%`;
      img.style.backgroundPosition = t.pos;
    };
    const up = () => { el.classList.remove('grabbing'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  /* ---------- good time to write: dragging the ends ---------- */

  // Moves one end of the hours, in half hours. Both ends can't land on the same time.
  function setEnd(t, end, v) {
    if (end === 'from' && v === 24) v = 0;
    if (end === 'to' && v === 0) v = 24;
    const other = end === 'from' ? num(t.to, 24) : num(t.from);
    if (v % 24 !== other % 24) t[end] = v;
    return num(t[end], end === 'to' ? 24 : 0);
  }

  const endTip = (t, end, v) => {
    const off = tzOffset(t.tz);
    return `${end === 'from' ? 'From' : 'Until'} ${fmtHour(v)}${off ? `, ${fmtHour(v - off)} for you` : ''}`;
  };

  function hoursDrag(e, el, t, knob) {
    if (!t) return;
    e.preventDefault();
    if (S.sel !== t.id) select(t.id);
    const bar = el.querySelector('.hrs-bar'), hover = bar.querySelector('.hrs-hover'), tip = bar.querySelector('.hrs-tip');
    const end = knob.dataset.end, before = JSON.stringify(box);
    const show = v => {
      hover.style.left = v / 24 * 100 + '%';
      tip.textContent = endTip(t, end, v);
      tip.classList.toggle('flip', v / 24 > 0.62);
    };
    bar.classList.add('setting');
    knob.classList.add('dragging');
    show(num(t[end], end === 'to' ? 24 : 0));
    const move = ev => {
      const r = bar.getBoundingClientRect();
      show(setEnd(t, end, Math.round(clamp((ev.clientX - r.left) / r.width, 0, 1) * 48) / 2));
      paintRange(el, t);
    };
    const up = () => {
      bar.classList.remove('setting');
      knob.classList.remove('dragging');
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      commit(() => {}, { before, animate: false });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  // Arrow keys nudge a focused end by half an hour, wrapping round midnight.
  canvas.addEventListener('keydown', e => {
    const knob = e.target.closest?.('.hrs-h');
    if (!knob || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const id = knob.closest('.tile[data-id]').dataset.id, end = knob.dataset.end;
    commit(bx => {
      const x = findIn(bx, id);
      const v = num(x[end], end === 'to' ? 24 : 0) + (e.key === 'ArrowRight' ? 0.5 : -0.5);
      setEnd(x, end, v < 0 ? v + 24 : v > 24 ? v - 24 : v);
    }, { animate: false });
    elOf(id)?.querySelector(`.hrs-h[data-end="${end}"]`)?.focus();
  });

  async function replacePhoto(t, field) {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    const done = uploading(1);
    try {
      const { src } = await upload(f);
      commit(bx => { const x = findIn(bx, t.id); x[field] = src; x.pos = '50% 50%'; }, { animate: false });
    } catch (err) { toast(esc(reason(err)) || 'That photo wouldn’t upload.'); }
    done();
  }

  // Say my name, in the owner's own voice. Ten seconds is plenty for a name.
  const REC_MAX = 10;
  async function record(t) {
    if (S.rec) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser can’t record sound.'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('Let the page use your microphone to record your name.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const R = S.rec = { id: t.id, start: performance.now(), stop: () => rec.state !== 'inactive' && rec.stop() };
    // The wave fills up as the take runs out of time.
    const paint = () => {
      const s = (performance.now() - R.start) / 1000;
      const el = elOf(t.id);
      el?.classList.add('rec');
      el?.querySelectorAll('.wave line').forEach((l, i, all) => l.classList.toggle('on', i / all.length < s / REC_MAX));
      const time = el?.querySelector('.time');
      if (time) time.textContent = fmtSec(s);
      const txt = tb.querySelector('.tb-txt');
      if (txt && S.sel === t.id) txt.textContent = `Recording ${fmtSec(s)}`;
    };
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const dur = (performance.now() - R.start) / 1000;
      clearInterval(R.tick); clearTimeout(R.cap);
      stream.getTracks().forEach(tr => tr.stop());
      S.rec = null;
      const el = elOf(t.id);
      el?.classList.remove('rec');
      el?.querySelectorAll('.wave line').forEach(l => l.classList.remove('on'));
      const time = el?.querySelector('.time');
      if (time) time.textContent = t.audio ? fmtSec(Math.ceil(t.dur || 0)) : '0:00';
      render(false);
      if (dur < 0.5 || !chunks.length) { toast('That was too short to hear. Try again.'); return; }
      const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
      const file = new File(chunks, `name.${type === 'audio/mp4' ? 'm4a' : 'webm'}`, { type });
      const done = uploading(1);
      try {
        const { src } = await upload(file);
        commit(bx => { const x = findIn(bx, t.id); if (x) { x.audio = src; x.dur = Math.round(dur * 10) / 10; } }, { animate: false });
      } catch (err) { toast(esc(reason(err)) || 'That recording wouldn’t upload.'); }
      done();
    };
    rec.start();
    R.tick = setInterval(paint, 100);
    R.cap = setTimeout(R.stop, REC_MAX * 1000);
    paint();
    buildToolbar();
  }

  function knockOff(id) {
    const el = elOf(id), t = find(id);
    if (!el || !t) return;
    S.knockAsk = false; S.sel = null; tb.hidden = true;
    Pop.close();
    const r = el.getBoundingClientRect();
    const dir = r.left + r.width / 2 > innerWidth / 2 ? 1 : -1;
    el.style.zIndex = 60; el.style.pointerEvents = 'none';
    el.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dir * 18}px,-10px) rotate(${dir * -3}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dir * innerWidth * 0.55}px, ${innerHeight * 0.55}px) rotate(${dir * 40}deg)`, opacity: 0 },
    ], { duration: 640, easing: 'cubic-bezier(.45,0,.8,.45)', fill: 'forwards' }).onfinish = () => {
      el.getAnimations().forEach(a => a.cancel());
      el.style.zIndex = ''; el.style.pointerEvents = '';
      commit(bx => { bx.tiles = bx.tiles.filter(x => x.id !== id); });
      toast(`Knocked “${esc(titleOf(t))}” off the table.`, { action: 'Put it back', kbd: '⌘Z', onAction: undo, timeout: 6000 });
    };
  }

  /* ---------- pointer: select, drag, crop ---------- */

  function onDown(e) {
    if (e.button !== 0 || S.drag) return;
    const el = e.target.closest('.tile[data-id], .section[data-id]');
    if (!el || !canvas.contains(el)) return;
    const hh = e.target.closest('.hrs-h');
    if (hh) return hoursDrag(e, el, find(el.dataset.id), hh);
    if (e.target.closest('[data-nodrag], button, input, a')) return;
    const id = el.dataset.id, t = find(id);
    if (!t) return;
    if (S.crop === id) return cropDrag(e, el, t);
    const ed = e.target.closest('[data-field]');
    if (ed && ed === document.activeElement) return; // let them select text
    S.press = { id, el, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    if (S.press.touch) S.press.timer = setTimeout(() => { if (S.press) { S.press.ready = true; el.classList.add('pressing'); } }, 280);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
  }

  function onMove(e) {
    const p = S.press;
    if (!p) return;
    if (!S.drag) {
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.touch && !p.ready) { if (dist > 8) onCancel(); return; }
      if (dist < 6) return;
      beginDrag(e);
    }
    dragMove(e);
  }

  function onCancel() {
    if (S.press?.timer) clearTimeout(S.press.timer);
    S.press?.el.classList.remove('pressing');
    S.press = null;
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
  }

  function onUp(e) {
    const p = S.press;
    if (S.drag) endDrag();
    else if (p) select(p.id);
    onCancel();
  }

  function beginDrag(e) {
    const p = S.press;
    if (document.activeElement && p.el.contains(document.activeElement)) document.activeElement.blur();
    getSelection().removeAllRanges();
    Pop.close();
    const el = p.el;
    const r = el.getBoundingClientRect();
    const ph = document.createElement('div');
    if (el.classList.contains('section')) ph.className = 'section-ph';
    else {
      ph.className = 'tile-ph ' + [...el.classList].filter(c => c.startsWith('s-')).join(' ');
      ph.innerHTML = `${I.paw('#BDBDBD', 22)}<span>it fits here</span>`;
    }
    el.before(ph);
    el.classList.remove('pressing');
    el.classList.add('lifted');
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    S.drag = { id: p.id, el, ph, r, ox: e.clientX, oy: e.clientY, px: e.clientX, py: e.clientY, lock: 0, isSection: el.classList.contains('section') };
    S.drag.raf = requestAnimationFrame(edgeScroll);
    S.sel = p.id;
    tb.hidden = true;
    document.body.classList.add('is-dragging');
  }

  function dragMove(e) {
    const d = S.drag;
    d.el.style.transform = `translate(${e.clientX - d.ox}px, ${e.clientY - d.oy}px)`;
    d.px = e.clientX; d.py = e.clientY;
    if (performance.now() < d.lock) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || !canvas.contains(under)) return;
    let target = under.closest('.tile[data-id], .section[data-id], .sug, .addslot');
    const first = Box.rects(canvas, d.ph);
    let moved = false;

    if (!target) {
      // Empty space in a grid: drop at its end.
      const g = under.closest('.grid');
      if (g && !d.isSection) {
        const tail = [...g.children].filter(c => c !== d.el && !c.matches('.sug, .addslot')).pop();
        if (tail && tail !== d.ph) {
          const tr = tail.getBoundingClientRect();
          if (e.clientY > tr.bottom || (e.clientY > tr.top && e.clientX > tr.right)) { tail.after(d.ph); moved = true; }
        }
      }
    } else if (target !== d.ph) {
      const forward = !!(d.ph.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (target.matches('.sug, .addslot')) {
        if (!d.isSection) { const g = target.parentElement; const firstExtra = g.querySelector('.sug, .addslot'); if (firstExtra.previousElementSibling !== d.ph) { firstExtra.before(d.ph); moved = true; } }
      } else if (d.isSection) {
        const anchor = target.classList.contains('section') ? target : target.closest('.grid');
        if (anchor) { forward ? anchor.after(d.ph) : anchor.before(d.ph); moved = true; }
      } else if (target.classList.contains('section')) {
        const g = forward ? target.nextElementSibling : target.previousElementSibling;
        if (g?.classList.contains('grid')) {
          if (forward) g.prepend(d.ph);
          else { const extra = g.querySelector('.sug, .addslot'); extra ? extra.before(d.ph) : g.append(d.ph); }
          moved = true;
        }
      } else {
        forward ? target.after(d.ph) : target.before(d.ph);
        moved = true;
      }
    }
    if (moved) {
      Box.flip(canvas, first, d.ph);
      d.lock = performance.now() + 190;
    }
  }

  // Hold a tile near the top or bottom edge and the page scrolls under it.
  function edgeScroll() {
    const d = S.drag;
    if (!d || d.dropping) return;
    const top = $('.ed-head', app).offsetHeight + 40, bottom = innerHeight - 110;
    let v = 0;
    if (d.py < top) v = -Math.min(22, Math.ceil((top - d.py) / 4));
    else if (d.py > bottom) v = Math.min(22, Math.ceil((d.py - bottom) / 4));
    if (v) {
      const before = scrollY;
      scrollBy(0, v);
      if (scrollY !== before) dragMove({ clientX: d.px, clientY: d.py });
    }
    d.raf = requestAnimationFrame(edgeScroll);
  }

  function endDrag() {
    const d = S.drag;
    d.dropping = true;
    cancelAnimationFrame(d.raf);
    const pr = d.ph.getBoundingClientRect();
    d.el.style.transition = 'transform .24s cubic-bezier(.2,.9,.3,1), rotate .24s, box-shadow .24s';
    d.el.style.transform = `translate(${pr.left - d.r.left}px, ${pr.top - d.r.top}px)`;
    d.el.classList.add('dropping');
    setTimeout(() => {
      const order = [...canvas.querySelectorAll('.tile[data-id], .section[data-id], .tile-ph, .section-ph')]
        .filter(n => n !== d.el)
        .map(n => (n === d.ph ? d.id : n.dataset.id));
      d.el.removeAttribute('style');
      d.el.classList.remove('lifted', 'dropping');
      d.ph.replaceWith(d.el);
      S.drag = null;
      document.body.classList.remove('is-dragging');
      if (order.join() !== orderIds().join()) {
        commit(bx => {
          if (S.device === 'm') { bx.mobile = order; return; }
          // Rearranging desktop leaves the phone layout where it was.
          if (!bx.mobile) bx.mobile = orderIdsOf(bx, 'm');
          const m = new Map(bx.tiles.map(t => [t.id, t]));
          bx.tiles = order.map(id => m.get(id)).filter(Boolean);
        }, { animate: false });
      } else render(false);
      select(d.id);
      S.justDragged = performance.now();
    }, 250);
  }

  canvas.addEventListener('pointerdown', onDown);
  addEventListener('touchmove', preventTouch, { passive: false });
  function preventTouch(e) { if (S.drag) e.preventDefault(); }

  /* ---------- clicks on the canvas ---------- */

  canvas.addEventListener('click', e => {
    if (performance.now() - (S.justDragged || 0) < 120) return;
    const ed = e.target.closest('[data-edact]');
    if (ed) {
      e.stopPropagation();
      const tEl = ed.closest('.tile[data-id]');
      const t = tEl && find(tEl.dataset.id);
      switch (ed.dataset.edact) {
        case 'avatar': return openAvatarPop(ed);
        case 'avatar-remove': return commit(bx => { bx.avatar = null; bx.avatarVideo = null; }, { animate: false });
        case 'zoom': return commit(bx => {
          const x = findIn(bx, t.id);
          if (hasCoords(x)) x.z = clamp(zoomOf(x) + +ed.dataset.d, 3, 18);
          else x.zoom = clamp(+((x.zoom || 1) + 0.25 * ed.dataset.d).toFixed(2), 0.75, 2.25);
        }, { animate: false });
        case 'place': return placeSearch(t);
      }
      return;
    }
    const sx = e.target.closest('[data-sugx]');
    if (sx) { commit(bx => { bx.suggestions = (bx.suggestions || []).filter(s => s.kind !== sx.dataset.sugx); }); return; }
    const sg = e.target.closest('[data-sug]');
    if (sg) { const s = (box.suggestions || []).find(x => x.kind === sg.dataset.sug); add(s.kind, box.tiles.length, { sug: s.kind, size: s.size }); return; }
    if (e.target.closest('[data-addslot]')) { openPalette(box.tiles.length); return; }
    if (!e.target.closest('[data-key]')) select(null);
  });

  canvas.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-addslot], [data-sug], [data-edact]')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------- typing in place ---------- */

  canvas.addEventListener('focusin', e => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    const key = f.closest('[data-key]').dataset.key;
    S.editing = { field: f.dataset.field, key, before: JSON.stringify(box), node: f };
    if (key !== '__bio' && S.sel !== key) select(key);
  });

  // Persist while typing too: a reload need not wait for the field to blur.
  canvas.addEventListener('input', e => {
    const f = e.target.closest('[data-field]');
    if (!f || !S.editing || S.editing.node !== f) return;
    const { field, key } = S.editing;
    const obj = key === '__bio' ? box : find(key);
    if (!obj) return;
    obj[field] = field === 'html' ? applyMarks(sanitize(f.innerHTML)) : f.textContent.replace(/\s+/g, ' ').trim();
    if (obj.type === 'note') obj.updatedAt = Date.now();
    save({ typing: true });
  });

  canvas.addEventListener('focusout', e => {
    const f = e.target.closest('[data-field]');
    if (f && S.editing && S.editing.node === f) {
      const { field, key, before } = S.editing;
      S.editing = null;
      const val = field === 'html' ? applyMarks(sanitize(f.innerHTML)) : f.textContent.replace(/\s+/g, ' ').trim();
      const obj = key === '__bio' ? box : find(key);
      if (!obj) return;
      if (S.fresh.has(key) && !htmlText(val).trim()) {
        S.fresh.delete(key);
        box.tiles = box.tiles.filter(t => t.id !== key);
        if (S.sel === key) S.sel = null;
        render(true); save();
        return;
      }
      // Where focus is heading. A re-render may replace that node, so remember it.
      const next = e.relatedTarget?.closest?.('[data-field]');
      const nextRef = next && canvas.contains(next) && { key: next.closest('[data-key]').dataset.key, field: next.dataset.field };
      if ((obj[field] || '') === val && JSON.stringify(box) === before) {
        if (field === 'html') { elOf(key)._key = null; render(false); refocus(next, nextRef); }
        return;
      }
      S.fresh.delete(key);
      commit(bx => {
        const o = key === '__bio' ? bx : findIn(bx, key);
        o[field] = val;
        if (o.type === 'note') o.updatedAt = Date.now();
      }, { before, animate: false });
      refocus(next, nextRef);
      return;
    }
    const inp = e.target.closest('.draft-form input');
    if (inp) {
      const id = inp.closest('[data-id]').dataset.id;
      setTimeout(() => {
        const t = find(id);
        if (!t || !t.draft) return;
        const still = document.activeElement && elOf(id)?.contains(document.activeElement);
        if (still || inp.value.trim()) return;
        box.tiles = box.tiles.filter(x => x.id !== id);
        if (S.sel === id) S.sel = null;
        render(true);
      }, 160);
    }
  });

  function refocus(node, ref) {
    if (!ref || (node && node.isConnected)) return;
    const host = ref.key === '__bio' ? canvas.querySelector('.bio') : elOf(ref.key);
    const f = host?.querySelector(`[data-field="${ref.field}"]`);
    if (!f) return;
    f.focus();
    const r = document.createRange();
    r.selectNodeContents(f); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  canvas.addEventListener('paste', e => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  canvas.addEventListener('submit', e => {
    const form = e.target.closest('[data-form="link"]');
    if (!form) return;
    e.preventDefault();
    const v = form.querySelector('input').value.trim();
    if (!v) return;
    if (!looksLikeUrl(v)) {
      form.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 });
      return;
    }
    const id = form.closest('[data-id]').dataset.id;
    if (find(id)?.type === 'music' && !serviceOf(v)) {
      form.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 });
      toast('Music tiles take Spotify links.');
      return;
    }
    const res = guessLink(v);
    commit(bx => { const i = bx.tiles.findIndex(x => x.id === id); bx.tiles[i] = { id, ...res }; });
    select(id);
    unfurl(id);
  });

  // Ask the server what the link really is, then fold the answer into the tile.
  async function unfurl(id, { refresh = false, baseline } = {}) {
    const t0 = find(id);
    if (!t0?.url || Fetching.has(id)) return;
    const firstSize = JSON.stringify(t0.size);
    const originalUrl = t0.url;
    const original = JSON.parse(JSON.stringify(t0));
    Fetching.add(id);
    elOf(id)?.classList.add('loading');
    let res = null;
    try {
      res = await action('links:unfurl', { url: t0.url, refresh });
    } catch (err) {
      toast(esc(reason(err)));
    }
    Fetching.delete(id);
    if (!alive) return;
    elOf(id)?.classList.remove('loading');
    const t = find(id);
    if (!t || t.url !== originalUrl) {
      if (t?.url) unfurl(id, { refresh: true });
      return;
    }
    const before = JSON.stringify(box);
    const x = t;
    const current = JSON.parse(JSON.stringify(t));
    const prior = baseline || original.previewSource?.values || original;
    delete x.loading;
    if (res) {
      const untouched = JSON.stringify(x.size) === firstSize;
      const poses = TYPES[res.type]?.poses || ALL_POSES;
      if (refresh && res.previewSource && res.type === x.type) {
        // Preserve edits made while the request was in flight. The URL changed,
        // so these original fields are only a baseline for this one response.
        Object.assign(x, mergePreview({ ...x, url: res.url, previewSource: { ...res.previewSource, fetchedAt: 0, values: prior } }, { url: res.url, type: x.type, data: res.previewSource }));
      } else {
        for (const k of ['title', 'sub', 'cover', 'src', 'pos', 'meta', 'preview', 'icon', 'user', 'levels', 'counts', 'start', 'total', 'fetchedAt', 'previewSource']) delete x[k];
        Object.assign(x, res);
        // A title typed while a newly added tile was loading belongs to its owner.
        if ((current.title !== original.title || (refresh && current.title !== prior.title)) && current.title) x.title = current.title;
        if (refresh) {
          x.pos = current.pos || '50% 50%';
          for (const key of ['src', 'cover', 'preview']) if (current[key] && JSON.stringify(current[key]) !== JSON.stringify(prior[key])) x[key] = current[key];
        }
      }
      if (!refresh && untouched && res.type === 'link' && res.preview && sizeOf(x, 'd') === 'curl') x.size = sz('loaf');
      // Each layout only gives up a pose the new type can't take.
      for (const dv of ['d', 'm']) if (!poses.includes(sizeOf(x, dv))) x.size = { ...x.size, [dv]: res.type === 'link' ? 'curl' : 'loaf' };
    } else if (refresh) {
      // A failed replacement URL must not advertise the old destination. Keep
      // custom fields, but clear the old automatic preview until a retry works.
      const empty = previewSource({ ...prior, url: x.url, type: x.type }, 0);
      for (const key of Object.keys(empty.values)) empty.values[key] = null;
      Object.assign(x, mergePreview({ ...x, previewSource: { ...empty, values: prior } }, { url: x.url, type: x.type, data: empty }));
    }
    commit(() => {}, { before });
  }

  /* ---------- adding things ---------- */

  function nearViewIndex() {
    let last = null;
    for (const el of canvas.querySelectorAll('.tile[data-id], .section[data-id]')) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight - 140 && r.bottom > 100) last = el;
    }
    const ids = orderIds();
    return last ? ids.indexOf(last.dataset.id) + 1 : ids.length;
  }

  function indexAt(x, y) {
    let best = null, bd = Infinity;
    for (const el of canvas.querySelectorAll('.tile[data-id], .section[data-id]')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd) { bd = d; best = { el, r, cx }; }
    }
    const ids = orderIds();
    if (!best) return ids.length;
    const i = ids.indexOf(best.el.dataset.id);
    const after = y > best.r.bottom || (y >= best.r.top && x > best.cx);
    return i + (after ? 1 : 0);
  }

  function insert(tiles, index, sug) {
    tiles = [].concat(tiles);
    commit(bx => {
      if (S.device === 'm') {
        // Added on the phone: placed here, and on desktop just before the tile that follows it here.
        const ids = orderIdsOf(bx, 'm');
        const at = clamp(index ?? ids.length, 0, ids.length);
        const next = at < ids.length ? bx.tiles.findIndex(t => t.id === ids[at]) : -1;
        ids.splice(at, 0, ...tiles.map(t => t.id));
        bx.mobile = ids;
        bx.tiles.splice(next < 0 ? bx.tiles.length : next, 0, ...tiles);
      } else bx.tiles.splice(clamp(index ?? bx.tiles.length, 0, bx.tiles.length), 0, ...tiles);
      if (sug) bx.suggestions = (bx.suggestions || []).filter(s => s.kind !== sug);
    });
    select(tiles[0].id);
    reveal(tiles[0].id);
  }

  function reveal(id) {
    const el = elOf(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    // The checklist floats over the bottom-left corner. A tile under it counts as off screen,
    // and one too tall to fit above it tucks the checklist away rather than hide behind it.
    const cl = $('#checklist', app);
    let c = !cl.hidden && cl.getBoundingClientRect();
    if (c && r.left < c.right && r.right > c.left && r.height > c.top - 16 - 90) {
      S.clHidden = true; syncChecklist(); c = null;
      toast('Tucked the checklist away to make room. It’s in your menu.');
    }
    const floor = c && r.left < c.right && r.right > c.left ? c.top - 16 : innerHeight - 100;
    if (r.top >= 90 && r.bottom <= floor) return;
    if (r.height <= floor - 90) scrollBy({ top: r.bottom > floor ? r.bottom - floor : r.top - 90, behavior: 'smooth' });
    else el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function add(kind, index = nearViewIndex(), extra = {}) {
    Pop.close();
    const id = uid();
    const size = sz(extra.size || ({ link: 'curl', text: 'loaf', map: 'loaf', music: 'loaf', section: 'loaf' })[kind] || 'curl');
    let t;
    switch (kind) {
      case 'photo': {
        const files = await pickFiles();
        if (files.length) addFiles(files, index, extra.sug);
        return;
      }
      case 'link': t = { id, type: 'link', size: sz('loaf'), draft: true, title: '', url: '' }; break;
      case 'text': t = { id, type: 'note', size, html: extra.text ? esc(extra.text) : '', tint: 'curb', updatedAt: Date.now() }; S.focusId = id; if (!extra.text) S.fresh.add(id); break;
      case 'map': t = { id, type: 'map', size, place: extra.place || '', caption: '', seed: (Math.random() * 1000) | 0, zoom: 1 }; break;
      case 'music': t = { id, type: 'music', size: sz('loaf'), draft: true, title: '', url: '' }; break;
      case 'section': t = { id, type: 'section', size, text: extra.text || '' }; if (!extra.text) { S.focusId = id; S.fresh.add(id); } break;
      case 'purr': t = { id, type: 'purr', size: sz('curl'), count: 0 }; break;
      case 'status': t = { id, type: 'status', size: sz('curl'), ...myZone(), text: '', meta: '' }; S.focusId = id; S.fresh.add(id); break;
      case 'sayname': t = { id, type: 'sayname', size: sz('loaf'), name: box.name || '', phon: '' }; S.focusId = id; break;
      case 'hours': t = { id, type: 'hours', size: sz('loaf'), ...myZone(), from: 9, to: 18, title: 'Good time to write' }; break;
      case 'guestbook': t = { id, type: 'guestbook', size: sz('sprawl'), count: 0 }; break;
      case 'subscribe': t = { id, type: 'subscribe', size: sz('loaf'), title: '', sub: '' }; S.focusId = id; break;
      case 'beforeafter': {
        const files = (await pickFiles('image/*', true)).filter(f => f.type.startsWith('image/')).slice(0, 2);
        if (!files.length) return;
        if (files.length < 2) { toast('Pick two photos: the before, then the after.'); return; }
        const done = uploading(2);
        try {
          const [before, after] = await Promise.all(files.map(f => upload(f)));
          t = { id, type: 'beforeafter', size: sz(poseForRatio(after.ar)), src: after.src, before: before.src, pos: '50% 50%' };
        } catch (err) { toast(esc(reason(err)) || 'Those photos wouldn’t upload.'); }
        done();
        if (!t) return;
        break;
      }
      default: return;
    }
    insert(t, index, extra.sug);
    if (kind === 'map' && !extra.place) setTimeout(() => placeSearch(find(id)), 480);
  }

  // While files upload, the save pill says so.
  function uploading(n) {
    S.uploads = (S.uploads || 0) + n;
    const el = $('#save', app);
    if (el) {
      el.className = 'save saving';
      el.innerHTML = `<span class="save-pill">${catLogo(18, { fur: '#fff', pupil: '#161616' })}<span class="tnum">Uploading ${plural(S.uploads, 'file')}</span><i class="save-bar"><b></b></i></span>`;
    }
    return () => {
      S.uploads = Math.max(0, S.uploads - n);
      if (!S.uploads && !S.pending) setSave('idle');
    };
  }

  async function addFiles(files, index = nearViewIndex(), sug) {
    const usable = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    for (const f of files) if (!usable.includes(f)) toast(`${esc(f.name)} isn’t a photo or a video.`);
    if (!usable.length) return;
    const done = uploading(usable.length);
    const tiles = [];
    for (const f of usable) {
      try {
        const { src, ar } = await upload(f);
        if (f.type.startsWith('video/')) tiles.push({ id: uid(), type: 'video', size: sz('loaf'), video: src, src: '', title: f.name.replace(/\.[^.]+$/, ''), meta: 'Plays muted on a loop' });
        else tiles.push({ id: uid(), type: 'photo', size: sz(poseForRatio(ar)), src, pos: '50% 50%', caption: '' });
      } catch (err) { toast(`${esc(f.name)}: ${esc(reason(err))}`); }
    }
    done();
    if (tiles.length) insert(tiles, index, sug);
  }

  function insertResolved(url, index = nearViewIndex()) {
    const id = uid();
    insert({ id, ...guessLink(url) }, index);
    unfurl(id);
  }

  // Choose a frame for the profile photo, or change the photo itself.
  function openAvatarPop(anchor) {
    const shape = () => box.avatarShape || 'circle';
    const preview = k => `<span class="av-prev"><span class="avatar shape-${k}${box.avatar ? '' : ' empty'}">${box.avatar
      ? `<span class="avatar-img" style="${bg(box.avatar, box.avatarPos || '50% 40%')}"></span>`
      : '<span class="avatar-img av-blank"></span>'}</span></span>`;
    const pop = Pop.open(`<div class="av-pop">
      <div class="av-head">Photo frame</div>
      <div class="av-shapes" role="radiogroup" aria-label="Photo frame">
        ${AVATAR_SHAPES.map(sh => `<button class="av-shape ${sh.k === shape() ? 'on' : ''}" data-shape="${sh.k}" role="radio" aria-checked="${sh.k === shape()}">${preview(sh.k)}<small>${sh.label}</small></button>`).join('')}
      </div>
      <hr>
      <button class="menu-i" data-av="upload">${I.upload('#161616')}<span>${box.avatar ? 'Replace photo' : 'Upload a photo or video'}</span></button>
      ${box.avatar ? `<button class="menu-i" data-av="remove">${I.close('#161616', 12)}<span>Remove photo</span></button>` : ''}
    </div>`, anchor, { cls: 'pop-avatar' });
    pop.addEventListener('click', e => {
      const sb = e.target.closest('[data-shape]');
      if (sb) {
        if (sb.dataset.shape === shape()) return;
        commit(bx => { bx.avatarShape = sb.dataset.shape; }, { animate: false });
        pop.querySelectorAll('[data-shape]').forEach(b => { const on = b === sb; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
        canvas.querySelector('.bio .avatar')?.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 360, easing: 'ease-out' });
        if (sb.dataset.shape === 'cat') Cat.flash('happy', 1200);
        return;
      }
      const b = e.target.closest('[data-av]');
      if (!b) return;
      Pop.close();
      if (b.dataset.av === 'upload') pickAvatar();
      if (b.dataset.av === 'remove') commit(bx => { bx.avatar = null; bx.avatarVideo = null; }, { animate: false });
    });
  }

  async function pickAvatar() {
    const [f] = await pickFiles('image/*,video/*', false);
    if (!f) return;
    const done = uploading(1);
    try {
      // A clip keeps a still beside it for small faces and link previews.
      const clip = f.type.startsWith('video/');
      const [still, moving] = await Promise.all([
        upload(clip ? await posterOf(f) : f, { max: 800 }),
        clip ? upload(f) : null,
      ]);
      commit(bx => { bx.avatar = still.src; bx.avatarVideo = moving?.src ?? null; bx.avatarPos = '50% 40%'; }, { animate: false });
      Cat.flash('happy', 1400);
    } catch (err) { toast(esc(reason(err)) || 'That photo wouldn’t upload.'); }
    done();
  }

  /* ---------- dock ---------- */

  const dock = $('#dockTools', app);
  const tip = $('#dockTip', app);
  dock.addEventListener('pointerover', e => {
    const b = e.target.closest('.dock-b');
    if (!b) return;
    tip.textContent = b.dataset.label;
    tip.style.left = (b.offsetLeft + b.offsetWidth / 2) + 'px';
    tip.classList.add('in');
  });
  dock.addEventListener('pointerleave', () => tip.classList.remove('in'));
  const dockButtons = (set, from = 0) => set.map((a, i) => `<button class="dock-b" data-add="${a.kind}" data-label="${a.label}" aria-label="${a.label}" style="--i:${from + i}">${a.icon('#161616', 18)}</button>`).join('');
  // The paw swaps the dock over to the tiles that react; the arrow swaps it back.
  // The old set drops away and the new one pops in, so the swap reads as a new set.
  function flipDock(more, keyboard) {
    tip.classList.remove('in');
    clearTimeout(S.dockT);
    dock.classList.remove('swap-in');
    dock.classList.add('swap-out');
    S.dockT = setTimeout(() => {
      dock.querySelectorAll('.dock-b, .dock-div').forEach(b => b.remove());
      tip.insertAdjacentHTML('beforebegin', more
        ? `<button class="dock-b" data-add="back" data-label="Back" aria-label="Back" style="--i:0">${I.back()}</button><i class="dock-div" style="--i:0"></i>${dockButtons(MORE, 1)}`
        : dockButtons(ADD));
      dock.closest('.dock').classList.toggle('more', more);
      dock.classList.remove('swap-out');
      dock.classList.add('swap-in');
      S.dockT = setTimeout(() => dock.classList.remove('swap-in'), 600);
      if (keyboard) dock.querySelector('.dock-b').focus();
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120);
  }
  dock.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const kind = b.dataset.add;
    if (kind === 'more' || kind === 'back') return flipDock(kind === 'more', e.detail === 0);
    if (kind !== 'more' && MORE.some(m => m.kind === kind)) flipDock(false);
    add(kind);
  });

  /* ---------- ⌘K ---------- */

  function paletteItems(q, index) {
    const ql = q.toLowerCase();
    const out = [];
    if (q && looksLikeUrl(q)) {
      const g = guessLink(q);
      out.push({ icon: I.link(), title: `Add ${hostOf(q)}`, sub: g.type === 'link' ? 'A link with its title and picture' : `Becomes a ${TYPES[g.type].label.toLowerCase()} tile`, run: () => insertResolved(q, index) });
    }
    const pool = [
      { icon: I.image(), title: 'Upload a photo or video', sub: 'From your computer', words: 'photo image video upload file picture', run: () => add('photo', index) },
      { icon: I.link(), title: 'Add a link', sub: 'Your work, a shop, anything with an address', words: 'link url website page', run: () => add('link', index) },
      { icon: I.text(), title: 'Write a note', sub: 'A few words, a quote, an emoji', words: 'note text write quote', run: () => add('text', index) },
      { icon: I.music(), title: 'Add a song or playlist', sub: 'Spotify', words: 'music song playlist album podcast spotify', run: () => add('music', index) },
      { icon: I.pin(), title: 'Add a map', sub: 'Where you are, or a place you love', words: 'map place where location city', run: () => add('map', index) },
      { icon: I.section(), title: 'Add a section title', sub: 'A heading between tiles', words: 'section heading title divider', run: () => add('section', index) },
      { icon: I.heart(), title: 'Add a purr', sub: 'Visitors tap to leave a purr', words: 'purr paw like counter react', run: () => add('purr', index) },
      { icon: I.clock(), title: 'Add a status', sub: 'What you’re up to, with your local time', words: 'status now doing time react', run: () => add('status', index) },
      { icon: I.wave(), title: 'Add say my name', sub: 'How your name sounds', words: 'say name pronounce sound audio react', run: () => add('sayname', index) },
      { icon: I.sunrise(), title: 'Add good time to write', sub: 'Your waking hours in their time', words: 'hours time zone available write react', run: () => add('hours', index) },
      { icon: I.pen(), title: 'Add a guestbook', sub: 'Visitors draw something small', words: 'guestbook draw scribble sign react', run: () => add('guestbook', index) },
      { icon: I.split(), title: 'Add before and after', sub: 'Two photos, one handle to wipe', words: 'before after compare photo react', run: () => add('beforeafter', index) },
      { icon: I.mail(), title: 'Add a subscribe box', sub: 'Collect emails for your newsletter', words: 'subscribe newsletter email list react', run: () => add('subscribe', index) },
      { icon: I.arrow('#161616', 16), title: 'Share your box', sub: `bento.cat/${box.handle}`, words: 'share copy link tweet', run: () => openShare($('[data-ed="share"]', app)) },
      { icon: I.search(), title: 'See your visits', sub: 'Who came by, and when', words: 'visits stats views analytics', run: () => openVisits() },
      { icon: I.mail(), title: 'See your subscribers', sub: 'Everyone on your lists', words: 'subscribers newsletter email list export csv', run: () => openSubscribers() },
      { icon: I.section(), title: 'Page settings', sub: 'Your address, discovery, your data', words: 'settings address handle rename explore discovery visibility export delete', run: () => openSettings($('#bSettings', app)) },
    ];
    for (const it of pool) if (!ql || ql.split(/\s+/).every(w => (it.title + ' ' + it.words).toLowerCase().includes(w))) out.push(it);
    if (q) {
      out.push({ icon: I.text(), title: `Note that says “${q}”`, sub: 'Start a text tile with this', run: () => add('text', index, { text: q }) });
      out.push({ icon: I.section(), title: `Section called “${q}”`, sub: 'A heading between tiles', run: () => add('section', index, { text: q }) });
    }
    return out.slice(0, 7);
  }

  function openPalette(index) {
    if (S.palette) return;
    Pop.close();
    const ov = h(`<div class="palette-wrap"><div class="palette">
      <div class="pal-in">${I.search()}<input placeholder="Paste a link or type anything" spellcheck="false" autocomplete="off"><kbd>⌘K</kbd></div>
      <div class="pal-list"></div></div></div>`);
    $('#layer').append(ov);
    requestAnimationFrame(() => ov.classList.add('in'));
    const input = ov.querySelector('input'), list = ov.querySelector('.pal-list');
    let items = [], active = 0;
    const close = () => { ov.classList.remove('in'); setTimeout(() => ov.remove(), 180); S.palette = null; };
    const run = it => { close(); it.run(); };
    const draw = () => {
      items = paletteItems(input.value.trim(), index);
      active = clamp(active, 0, Math.max(0, items.length - 1));
      list.innerHTML = items.map((it, i) => `<button class="pal-item ${i === active ? 'on' : ''}" data-i="${i}">
        ${it.thumb ? `<span class="pal-thumb" style="${bg(it.thumb)}"></span>` : `<span class="pal-ic">${it.icon}</span>`}
        <span class="pal-txt"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${i === active ? '<span class="pal-enter">Enter</span>' : ''}</button>`).join('')
        || '<div class="pal-empty">Keep typing…</div>';
    };
    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) run(items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) run(items[+b.dataset.i]); });
    list.addEventListener('pointermove', e => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== active) { active = +b.dataset.i; draw(); } });
    ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
    S.palette = { close };
    draw();
    input.focus();
  }

  /* ---------- places ---------- */

  // Search real places (OpenStreetMap data via Photon). The name and where it is get kept.
  const placeLabel = ({ properties: p, geometry: g }) => {
    const name = p.name || p.city || p.county || p.state || p.country || '';
    const city = p.city && p.city !== name ? p.city : '';
    const sub = [p.state && p.state !== name ? p.state : '', p.country && p.country !== name ? p.country : ''].filter(Boolean).join(', ');
    const [lon, lat] = g?.coordinates || [];
    return { name: city ? `${name}, ${city}` : name, sub, lat: round(lat, 5), lon: round(lon, 5), z: zoomFor(p) };
  };
  const round = (n, d) => (Number.isFinite(n) ? +n.toFixed(d) : undefined);
  // Close enough to read the streets, far enough to see a whole city.
  const zoomFor = p => ({ country: 5, state: 7, county: 9, city: 12, district: 14, locality: 14 })[p.type] ?? 15;

  async function geocode(q, signal) {
    const lang = (navigator.language || 'en').slice(0, 2);
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=${['de', 'fr', 'it', 'en'].includes(lang) ? lang : 'en'}`, { signal });
    if (!res.ok) throw new Error('search failed');
    const seen = new Set();
    return (await res.json()).features.map(placeLabel).filter(p => p.name && !seen.has(p.name + p.sub) && seen.add(p.name + p.sub)).slice(0, 5);
  }

  async function reverseGeocode(lat, lon) {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const p = (await res.json()).features?.[0]?.properties;
    if (!p) return null;
    // A neighbourhood or city, never a street address. The spot is blurred to about a kilometre.
    const name = [p.district || p.locality, p.city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ') || p.county || p.state;
    return name ? { name, sub: p.country || '', lat: round(+lat, 2), lon: round(+lon, 2), z: 14 } : null;
  }

  function placeSearch(t) {
    if (!t) return;
    const el = elOf(t.id);
    if (!el) return;
    const anchor = el.querySelector('.map-label') || el;
    const pop = Pop.open(`<div class="place-pop"><div class="pal-in sm">${I.search()}<input placeholder="Search a place" spellcheck="false" autocomplete="off"></div><div class="place-list"></div></div>`, anchor, { cls: 'pop-place' });
    const inp = pop.querySelector('input'), list = pop.querySelector('.place-list');
    let found = [];
    const set = (p, caption) => {
      Pop.close();
      commit(bx => {
        const x = findIn(bx, t.id);
        x.place = p.name;
        x.seed = hash(p.name) % 997;
        if (hasCoords(p)) Object.assign(x, { lat: p.lat, lon: p.lon, z: p.z });
        else { delete x.lat; delete x.lon; delete x.z; }
        if (caption !== undefined) x.caption = caption;
      }, { animate: false });
    };
    const geo = `<button class="place-item" data-geo>${I.locate()}<span><b>Use where I am</b><small>Your browser will ask first</small></span></button>`;
    const row = (p, sub, i = -1) => `<button class="place-item" data-name="${esc(p.name)}" data-i="${i}">${I.pin('#707070', 16)}<span><b>${esc(p.name)}</b><small>${esc(sub ?? p.sub)}</small></span></button>`;
    let ctl = null, timer;
    const draw = (results, note) => {
      const q = inp.value.trim();
      list.innerHTML = (q ? '' : geo)
        + (note ? `<div class="place-note t-meta">${esc(note)}</div>` : '')
        + (found = results || []).map((p, i) => row(p, undefined, i)).join('')
        + (q && !(results || []).some(p => p.name.toLowerCase() === q.toLowerCase()) ? row({ name: q }, 'Use this name') : '');
    };
    const search = () => {
      const q = inp.value.trim();
      ctl?.abort();
      if (q.length < 2) { draw([]); return; }
      ctl = new AbortController();
      draw([], 'Searching…');
      geocode(q, ctl.signal).then(r => { if (inp.value.trim() === q) draw(r, r.length ? '' : 'Nothing found. You can still use the name.'); })
        .catch(e => { if (e.name !== 'AbortError') draw([], 'Search is having a nap. You can still use the name.'); });
    };
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); list.querySelector('[data-name]')?.click(); } });
    list.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.name) return set(found[b.dataset.i] || { name: b.dataset.name });
      if (b.hasAttribute('data-geo')) {
        if (!navigator.geolocation) return toast('This browser can’t share a location.');
        b.querySelector('small').textContent = 'Asking…';
        navigator.geolocation.getCurrentPosition(
          async p => {
            const here = await reverseGeocode(p.coords.latitude.toFixed(3), p.coords.longitude.toFixed(3)).catch(() => null);
            if (here) set(here, here.sub);
            else b.querySelector('small').textContent = 'Couldn’t name this spot. Search instead.';
          },
          () => { b.querySelector('small').textContent = 'No luck. Search instead.'; },
          { timeout: 8000, maximumAge: 600000 },
        );
      }
    });
    draw([]);
    inp.focus();
  }

  /* ---------- share, visits, settings, menu ---------- */

  function openShare(anchor) {
    const n = box.tiles.filter(t => t.type !== 'section').length;
    const link = `${location.origin}/${box.handle}`;
    const pop = Pop.open(`<div class="share">
      <div class="unfurl">
        <div class="og"><div class="og-frame" inert><div class="og-root"></div></div></div>
        <div class="unfurl-row"><span class="addr tnum">bento.cat/<b>${esc(box.handle)}</b></span><button class="btn btn-dark sm share-copy" data-share="copy">${I.copy('#fff')}<span>Copy link</span></button></div>
      </div>
      <div class="post">
        <div class="post-head"><b>Post it</b><button class="post-again" data-share="again">${I.again()}Another line</button></div>
        <label class="post-draft"><textarea rows="3" spellcheck="false" aria-label="What to say with your link"></textarea><span class="tnum">bento.cat/${esc(box.handle)}</span></label>
        <div class="post-to"><button class="btn btn-line" data-share="x">X ${I.arrow('#161616', 12)}</button><button class="btn btn-line" data-share="bsky">Bluesky ${I.arrow('#161616', 12)}</button></div>
      </div></div>`, anchor, { align: 'right', cls: 'pop-share' });
    Box.render(pop.querySelector('.og-root'), box, { mode: 'static', device: 'd' });
    const og = pop.querySelector('.og');
    og.style.setProperty('--s', og.clientWidth / 1200);
    const ta = pop.querySelector('textarea');
    let line = 0, copied;
    const write = () => { ta.value = SHARE_LINES[line](box, n); };
    write();
    const post = url => {
      window.open(url + encodeURIComponent(`${ta.value.trim()}\n\n${link}`), '_blank', 'noopener');
      markShared();
    };
    const markShared = () => {
      if (!box.shared) { box.shared = true; save(); syncChecklist(); }
      Cat.flash('happy', 1800);
    };
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-share]');
      if (!b) return;
      const k = b.dataset.share;
      if (k === 'again') { line = (line + 1) % SHARE_LINES.length; write(); }
      if (k === 'x') post('https://x.com/intent/tweet?text=');
      if (k === 'bsky') post('https://bsky.app/intent/compose?text=');
      if (k === 'copy') {
        const label = b.querySelector('span');
        (navigator.clipboard?.writeText(link) || Promise.reject())
          .then(() => { b.classList.add('done'); b.firstElementChild.outerHTML = I.check('#161616', 14, 1.8); label.textContent = 'Copied'; markShared(); })
          .catch(() => { label.textContent = 'Copy failed'; });
        clearTimeout(copied);
        copied = setTimeout(() => { if (!b.isConnected) return; b.classList.remove('done'); b.firstElementChild.outerHTML = I.copy('#fff'); label.textContent = 'Copy link'; }, 2200);
      }
    });
  }

  async function openVisits() {
    const wrap = h(`<div class="drawer-wrap"><aside class="drawer" role="dialog" aria-label="Visits"><div class="dr-head"><b>Visits</b><button class="dr-x" aria-label="Close">${I.close('#161616', 12)}</button></div>
      <section class="dr-empty dr-loading">${catLogo(48, { live: true })}<span>Counting paw prints…</span></section></aside></div>`);
    $('#layer').append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 280); removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', key);
    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('.dr-x') || e.target.closest('a')) close();
      if (e.target.closest('[data-v="share"]')) { close(); openShare($('[data-ed="share"]', app)); }
    });

    let data;
    try { data = await query('stats:visits'); } catch { data = null; }
    const drawer = wrap.querySelector('.drawer');
    const times = data?.times || [];
    const head = drawer.querySelector('.dr-head').outerHTML + (data ? `<section class="sniff"><div class="sniff-top"><span class="big tnum">${(data.pageViews ?? 0).toLocaleString('en-GB')}</span><span>total page views</span></div><p class="t-meta">Counted without identifying visitors. Repeat loads and your own views count too.</p></section>` : '');

    // Page views per hour, counted without knowing who; this browser places them in its time zone.
    const hours = data?.hours || [];
    const views30 = hours.reduce((n, [, c]) => n + c, 0);
    if (!views30 && !times.length) {
      drawer.innerHTML = head + `<section class="dr-empty">${catLogo(64, { live: true })}<b>No visits in the last 30 days.</b><span>Share your box in a bio, a signature or a group chat.</span><button class="btn btn-dark" data-v="share">Share your box</button></section>`;
      return;
    }

    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let yesterday = 0;
    for (const [at, n] of hours) {
      const d = new Date(at);
      grid[(d.getDay() + 6) % 7][d.getHours()] += n;
      if (at >= startToday - DAY && at < startToday) yesterday += n;
    }
    const today = (now.getDay() + 6) % 7, hourNow = now.getHours();
    const max = Math.max(1, ...grid.flat());
    const shades = ['#F4F4F2', '#E2E2DE', '#BDBDB8', '#7A7A76', '#161616'];
    let best = 0, bestH = 19;
    for (let hr = 0; hr < 22; hr++) { const sum = grid.reduce((a, row) => a + row[hr] + row[hr + 1] + row[hr + 2], 0); if (sum > best) { best = sum; bestH = hr; } }
    const part = bestH < 6 ? 'Nights' : bestH < 12 ? 'Mornings' : bestH < 17 ? 'Afternoons' : 'Evenings';
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const viewers = data.viewers || [];
    const who = viewers.length
      ? `${esc(viewers.map(v => v.name.split(' ')[0]).join(', '))} came by while signed in.`
      : `Nobody signed in with a box came by, so your visitors stay a mystery.`;

    drawer.innerHTML = head + `<section class="sniff">
        <div class="sniff-top"><span class="big tnum">${yesterday}</span><span>${yesterday === 1 ? 'view' : 'views'} yesterday</span></div>
        <div class="sniff-who">${viewers.length ? `<div class="faces">${viewers.map(v => `<a href="/${esc(v.handle)}" class="face av-${esc(v.avatarShape)}" style="${v.avatar ? bg(v.avatar) : 'background:#E4E4E0'}" data-tip="bento.cat/${esc(v.handle)}" aria-label="${esc(v.name)}"></a>`).join('')}</div>` : ''}
        <div class="t-meta">${who}</div></div>
      </section>
      <section class="when">
        <div class="when-head"><div><b>When they come by</b><span>Last 30 days, in your time zone</span></div>${views30 >= 5 ? `<div class="busy"><b>${part}, ${fmtHour(bestH)} to ${fmtHour(bestH + 3)}</b><span>Your busiest hours</span></div>` : ''}</div>
        <div class="heat">${grid.map((row, d) => `<span class="heat-d">${days[d]}</span>${row.map((n, hr) => {
          const lv = n === 0 ? 0 : Math.min(4, Math.ceil(n / max * 4));
          const isNow = d === today && hr === hourNow;
          return `<i style="background:${isNow ? '#F2C14E' : shades[lv]}" data-tip="${days[d]} ${fmtHour(hr)}${isNow ? ', right now' : ''}: ${plural(n, 'view')}"></i>`;
        }).join('')}`).join('')}</div>
        <div class="heat-x"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        <p class="t-meta">The honey square is this hour. Post new things just before the dark ones.</p>
      </section>
      <section class="month t-meta tnum">bento.cat/${esc(box.handle)} had ${plural(views30, 'page view')} in the last 30 days. Names and faces show only people signed in with a box who share their visits.</section>`;
    Cat.flash('wide', 1800);
  }

  // Everyone on the box's lists, live, one card per subscribe tile.
  function openSubscribers() {
    const wrap = h(`<div class="drawer-wrap subs"><aside class="drawer" role="dialog" aria-label="Subscribers"><div class="dr-head"><b>Subscribers</b><button class="dr-x" aria-label="Close">${I.close('#161616', 12)}</button></div>
      <section class="dr-empty dr-loading">${catLogo(48, { live: true })}<span>Counting the list…</span></section></aside></div>`);
    $('#layer').append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const drawer = wrap.querySelector('.drawer');
    const head = drawer.querySelector('.dr-head').outerHTML;
    // People who joined since the drawer was last opened get a honey dot.
    const seenKey = `bento:subs-seen:${box._id}`;
    let seen = Date.now() - 7 * DAY;
    try { seen = Number(local?.getItem(seenKey)) || seen; local?.setItem(seenKey, String(Date.now())); } catch { /* storage unavailable */ }
    const open = new Set();
    let lists = null;

    const joined = ts => {
      const d = new Date(ts), now = new Date();
      if (Date.now() - ts < DAY) return relTime(ts);
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      if (ts >= startToday - DAY) return 'Yesterday';
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
    };
    const row = p => `<div class="subs-row" data-id="${esc(p._id)}"><span class="subs-new">${p._creationTime > seen ? '<i></i>' : ''}</span><span class="subs-email">${esc(p.email)}</span><span class="subs-when" title="${esc(new Date(p._creationTime).toLocaleString('en-GB'))}">${esc(joined(p._creationTime))}</span><button class="subs-x" data-s="remove" aria-label="Remove ${esc(p.email)}">${I.close('currentColor', 10)}<span>Remove</span></button></div>`;
    const card = l => {
      const n = l.people.length, all = open.has(l.tileId) || n <= 6;
      return `<section class="subs-list" data-tile="${esc(l.tileId)}">
        <div class="subs-head"><div><b>${esc(l.title.trim() || 'Your list')}</b><span>${n ? `${plural(n, 'person', 'people')}, newest first` : 'Nobody yet'}</span></div>
          ${n ? `<div class="subs-acts"><button class="btn btn-line sm" data-s="copy">${I.copy()}<span>Copy emails</span></button><button class="btn btn-line sm" data-s="csv">${I.download('#161616', 14)}<span>CSV</span></button></div>` : ''}</div>
        ${n ? `<div class="subs-rows">${(all ? l.people : l.people.slice(0, 5)).map(row).join('')}</div>${all ? '' : `<button class="subs-more" data-s="more">Show all ${n.toLocaleString('en-GB')}</button>`}`
          : `<div class="subs-none"><span>Lists grow when people see them.</span><button class="btn btn-line sm" data-s="share">Share</button></div>`}
      </section>`;
    };
    const paint = () => {
      if (!wrap.isConnected) return;
      if (!lists) {
        drawer.innerHTML = head + `<section class="dr-empty">${catLogo(64, { live: true })}<b>Couldn’t load your subscribers.</b><span>Close this and try again in a moment.</span></section>`;
        return;
      }
      if (!lists.length) {
        drawer.innerHTML = head + `<section class="dr-empty">${catLogo(64, { mood: 'closed' })}<b>No list to join yet</b><span>Add a subscribe tile and visitors can leave their email for your newsletter.</span><button class="btn btn-dark" data-s="add">Add a subscribe tile</button></section>`;
        return;
      }
      const people = lists.flatMap(l => l.people);
      const week = people.filter(p => Date.now() - p._creationTime < 7 * DAY).length;
      const focus = document.activeElement?.closest?.('.drawer') === drawer && document.activeElement.dataset.s;
      const scroll = drawer.scrollTop;
      drawer.innerHTML = head + `<section class="sniff subs-sum">
          <div class="sniff-top"><span class="big tnum">${people.length.toLocaleString('en-GB')}</span><span>${people.length === 1 ? 'person on your lists' : 'people on your lists'}</span>${week ? `<span class="subs-week tnum">+${week} this week</span>` : ''}</div>
          <label class="settings-toggle subs-notify"><span><b>Email me when someone joins</b><small>${box.email ? `A short note to ${esc(box.email)}` : 'A short note to the email you sign in with'}</small></span>
            <input type="checkbox" role="switch" data-s="notify" ${box.notifySubscribers !== false ? 'checked' : ''}></label>
        </section>
        ${lists.map(card).join('')}
        <p class="t-meta subs-note">Write to people only about what they signed up for, and take anyone off who asks. Removing someone here takes them off the list for good.</p>`;
      drawer.scrollTop = scroll;
      if (focus) drawer.querySelector(`[data-s="${focus}"]`)?.focus();
    };

    const listOf = el => lists?.find(l => l.tileId === el.closest('[data-tile]')?.dataset.tile);
    const csvCell = s => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    const fileName = l => `bento-${box.handle}-${(l.title.trim() || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list'}.csv`;

    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('.dr-x')) return close();
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const l = listOf(b);
      switch (b.dataset.s) {
        case 'add': close(); add('subscribe', box.tiles.length); return;
        case 'share': close(); openShare($('[data-ed="share"]', app)); return;
        case 'more': open.add(l.tileId); paint(); return;
        case 'copy': {
          const label = b.querySelector('span');
          (navigator.clipboard?.writeText(l.people.map(p => p.email).join(', ')) || Promise.reject())
            .then(() => { label.textContent = 'Copied'; toast(`${plural(l.people.length, 'address', 'addresses')} copied.`, { mood: 'happy' }); })
            .catch(() => { label.textContent = 'Copy failed'; });
          setTimeout(() => { if (label.isConnected) label.textContent = 'Copy emails'; }, 2200);
          return;
        }
        case 'csv': {
          const csv = 'email,joined\n' + l.people.map(p => `${csvCell(p.email)},${new Date(p._creationTime).toISOString()}`).join('\n') + '\n';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = fileName(l);
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          return;
        }
        case 'remove': {
          const r = b.closest('.subs-row');
          // First click asks, second click removes.
          if (!r.classList.contains('ask')) {
            $$('.subs-row.ask', drawer).forEach(x => x.classList.remove('ask'));
            r.classList.add('ask');
            return;
          }
          r.classList.add('going');
          mutation('moderation:removeSubscriber', { id: r.dataset.id })
            .catch(err => { r.classList.remove('going', 'ask'); toast(esc(reason(err))); });
          return;
        }
      }
    });
    wrap.addEventListener('change', e => {
      if (e.target.dataset.s !== 'notify') return;
      commit(b => { b.notifySubscribers = e.target.checked; }, { animate: false });
      toast(e.target.checked ? 'We’ll email you when someone joins.' : 'No more emails about new subscribers.');
    });
    wrap.addEventListener('mouseleave', e => { if (e.target.classList?.contains('subs-row')) e.target.classList.remove('ask'); }, true);

    const stop = watch('moderation:lists', {}, data => { lists = data; paint(); }, () => { lists = null; paint(); });
    const key = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', key);
    S.subsClose?.();
    S.subsClose = close;
    function close() {
      if (S.subsClose === close) S.subsClose = null;
      stop();
      removeEventListener('keydown', key);
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 280);
    }
  }

  function openSettings(anchor) {
    const pop = Pop.open(`<div class="settings">
      <label class="fld"><span>Your address</span>
        <div class="handle-in"><span>bento.cat/</span><input value="${esc(box.handle)}" spellcheck="false" autocomplete="off"><i class="hs"></i></div>
        <small class="hs-msg">&nbsp;</small></label>
      <button class="btn btn-dark sm" data-set="handle" disabled>Change address</button>
      <hr>
      <label class="settings-toggle">
        <span>Show in Explore</span>
        <input type="checkbox" role="switch" data-set="explore" aria-describedby="explore-hint" ${box.showInExplore !== false ? 'checked' : ''}>
      </label>
      <p class="t-meta" id="explore-hint">Help people find your box in Explore. Your link stays public when this is off.</p>
      <label class="settings-toggle">
        <span>Show my box when I visit</span>
        <input type="checkbox" role="switch" data-set="share-visits" aria-describedby="share-visits-hint" ${box.shareVisits !== false ? 'checked' : ''}>
      </label>
      <p class="t-meta" id="share-visits-hint">People whose boxes you open see your name, photo and link under Visits. Turning it off also removes you from their past visitors.</p>
      <hr>
      <button class="menu-i" data-set="export">${I.download()}<span>Download your data</span></button>
      <div class="danger">
        <button class="menu-i danger-i" data-set="delete">${I.close('currentColor', 14)}<span>Delete your box</span></button>
        <div class="danger-ask" hidden>
          <p class="t-meta">This removes bento.cat/${esc(box.handle)}, everything in it, its visits and subscribers, and your account. It can’t be undone.</p>
          <div class="danger-row"><button class="btn btn-line sm" data-set="keep">Keep it</button><button class="btn sm btn-danger" data-set="delete-yes">Delete for good</button></div>
        </div>
      </div>
    </div>`, anchor, { align: 'right', cls: 'pop-settings' });
    const inp = pop.querySelector('.handle-in input'), msg = pop.querySelector('.hs-msg'), dot = pop.querySelector('.hs'), btn = pop.querySelector('[data-set="handle"]');
    pop.querySelector('[data-set="explore"]').addEventListener('change', e => {
      commit(b => { b.showInExplore = e.target.checked; }, { animate: false });
    });
    pop.querySelector('[data-set="share-visits"]').addEventListener('change', e => {
      commit(b => { b.shareVisits = e.target.checked; }, { animate: false });
      toast(e.target.checked ? 'Boxes you visit can see you came by.' : 'You visit quietly now. Your past visits are being removed.');
    });
    let ticket = 0, timer;
    const check = async () => {
      const mine = ++ticket;
      btn.disabled = true;
      const r = await handleCheck(inp.value, box.handle);
      if (mine !== ticket) return;
      dot.className = 'hs ' + r.state;
      msg.innerHTML = r.alt ? `${esc(r.msg)} <button class="chip-btn" data-alt="${esc(r.alt)}">${esc(r.alt)}</button>` : (esc(r.msg) || '&nbsp;');
      btn.disabled = r.state !== 'free';
    };
    inp.addEventListener('input', () => { inp.value = inp.value.toLowerCase().replace(/\s/g, ''); clearTimeout(timer); timer = setTimeout(check, 200); });
    pop.addEventListener('click', e => {
      const alt = e.target.closest('[data-alt]');
      if (alt) { e.preventDefault(); inp.value = alt.dataset.alt; check(); return; }
      const b = e.target.closest('[data-set]');
      if (!b) return;
      if (b.dataset.set === 'handle') {
        const to = inp.value.trim().toLowerCase();
        b.disabled = true;
        mutation('boxes:rename', { to })
          .then(({ handle }) => {
            box.handle = handle;
            S.undo = []; S.redo = [];
            Pop.close();
            syncHeader();
            opts.onRename?.(handle);
            toast(`You live at <b>bento.cat/${esc(handle)}</b> now.`, { mood: 'happy' });
          })
          .catch(err => { msg.textContent = reason(err); dot.className = 'hs bad'; });
      }
      if (b.dataset.set === 'export') exportData();
      if (b.dataset.set === 'delete') { b.hidden = true; pop.querySelector('.danger-ask').hidden = false; }
      if (b.dataset.set === 'keep') { pop.querySelector('.danger-ask').hidden = true; pop.querySelector('[data-set="delete"]').hidden = false; }
      if (b.dataset.set === 'delete-yes') deleteEverything(b);
    });
  }

  async function deleteEverything(btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    let deletionId;
    try {
      ({ deletionId } = await mutation('boxes:remove'));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete for good';
      toast(esc(reason(err)));
      return;
    }
    saves.discard();
    alive = false;
    btn.textContent = 'Closing sign-in account…';
    let status = 'pending';
    for (let i = 0; i < 12; i++) {
      try { status = (await query('accounts:deletionStatus', { id: deletionId }))?.status || 'pending'; }
      catch { break; }
      if (status !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const signOut = async () => {
      try { await (await clerk()).signOut({ redirectUrl: '/' }); }
      catch { location.href = '/'; }
    };
    if (status === 'complete') { await signOut(); return; }
    // Leave an explicit result on screen instead of hiding a failed external deletion.
    const pop = Pop.open(`<div class="settings" role="status">
      <b>Your box has been removed.</b>
      <p class="t-meta">${status === 'retrying' ? 'Closing your sign-in account failed. We’ll retry automatically.' : 'Your sign-in account is still being closed. We’ll keep retrying until it’s done.'} Uploaded files and visitor records are being cleaned up.</p>
      <p class="t-meta">For help, email <a class="link-btn" href="mailto:hello@bento.cat">hello@bento.cat</a> with deletion reference ${esc(deletionId)}.</p>
      <button class="btn btn-line" data-deleted-home>Sign out and go home</button>
    </div>`, app.querySelector('[data-ed="menu"]') || app, { cls: 'pop-settings' });
    pop.querySelector('[data-deleted-home]').addEventListener('click', signOut);
  }

  async function exportData() {
    let subscribers = [];
    try { subscribers = await query('stats:subscribers'); } catch { /* export the box anyway */ }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), box: { handle: box.handle, ...payload() }, subscribers }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bento-data-${box.handle}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openMenu(anchor) {
    const pop = Pop.open(`<div class="menu">
      <div class="menu-who"><b>${esc(box.name || 'You')}</b><span>${esc(box.email || 'bento.cat/' + box.handle)}</span></div>
      <a class="menu-i" href="/${esc(box.handle)}">View your box</a>
      <button class="menu-i" data-m="settings">Page settings</button>
      <button class="menu-i" data-m="visits">Visits</button>
      <button class="menu-i" data-m="subs">Subscribers</button>
      ${box.onboarding && S.clHidden ? '<button class="menu-i" data-m="checklist">Show the checklist</button>' : ''}
      <a class="menu-i" href="/explore">Explore boxes</a>
      <hr>
      <button class="menu-i" data-m="logout">Log out</button>
    </div>`, anchor, { align: 'right', cls: 'pop-menu' });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      if (e.target.closest('a')) { Pop.close(); return; }
      if (!b) return;
      if (b.dataset.m === 'settings') { Pop.close(); openSettings($('#edMe', app)); }
      if (b.dataset.m === 'visits') { Pop.close(); openVisits(); }
      if (b.dataset.m === 'subs') { Pop.close(); openSubscribers(); }
      if (b.dataset.m === 'checklist') { Pop.close(); S.clHidden = false; syncChecklist(); }
      if (b.dataset.m === 'logout') {
        Pop.close();
        flush().finally(async () => { (await clerk()).signOut({ redirectUrl: '/' }); });
      }
    });
  }

  /* ---------- fill your box ---------- */

  function syncChecklist() {
    const card = $('#checklist', app);
    if (!box.onboarding || S.clHidden) { card.hidden = true; return; }
    card.hidden = false;
    const done = STEPS.map(s => s.done(box));
    const n = done.filter(Boolean).length;
    const prev = S.prevDone || done;
    S.prevDone = done;
    if (n === STEPS.length) {
      card.innerHTML = `<div class="cl-done">${catLogo(40, { live: true, mood: 'happy' })}<div><b>Your box is full.</b><span>Nice. The cat approves.</span></div></div>`;
      if (!S.clBye) {
        S.clBye = setTimeout(() => {
          box.onboarding = false; save();
          card.classList.add('bye');
          setTimeout(() => { card.hidden = true; card.classList.remove('bye'); }, 420);
        }, 3600);
      }
      return;
    }
    const ticks = 36, filled = Math.round(n / STEPS.length * ticks), active = done.indexOf(false);
    // Build the frame once. Rewriting it on every render swapped the close button out from
    // under a click whenever pressing it also removed an empty tile.
    if (!card.querySelector('.cl-head')) {
      card.innerHTML = `
      <div class="cl-head"><b>Fill your box</b><span class="tnum"></span><button class="cl-x" data-cl="hide" aria-label="Hide">${I.close()}</button></div>
      <svg class="cl-ticks" viewBox="0 0 ${ticks * 12} 16" preserveAspectRatio="none">${Array.from({ length: ticks }, (_, i) => `<path d="M${i * 12 + 2} 2v12" stroke-width="3" stroke-linecap="round" style="transition-delay:${i * 12}ms"/>`).join('')}</svg>
      <div class="cl-list"></div>`;
    }
    card.querySelector('.cl-head .tnum').textContent = `${n} of ${STEPS.length}`;
    card.querySelectorAll('.cl-ticks path').forEach((t, i) => t.setAttribute('stroke', i < filled - 1 ? '#161616' : i === filled - 1 ? '#F2C14E' : '#E2E2DE'));
    const list = STEPS.map((s, i) => `<div class="cl-item ${done[i] ? 'done' : ''} ${done[i] && !prev[i] ? 'just' : ''} ${i === active ? 'active' : ''}" ${done[i] ? '' : `data-cl="${s.k}" role="button" tabindex="0"`}>
        <span class="cl-box">${done[i] ? I.check('#fff', 10, 2.6) : ''}</span><span class="cl-label">${esc(s.label(box))}</span>${i === active ? '<span class="cl-start">Start</span>' : ''}</div>`).join('');
    const cl = card.querySelector('.cl-list');
    if (cl.innerHTML !== list) cl.innerHTML = list;
  }

  $('#checklist', app).addEventListener('click', e => {
    const b = e.target.closest('[data-cl]');
    if (!b) return;
    switch (b.dataset.cl) {
      case 'hide': S.clHidden = true; syncChecklist(); toast('Tucked away. It’s in your menu if you want it back.'); return;
      case 'photo': return pickAvatar();
      case 'three': return openPalette(box.tiles.length);
      case 'line': canvas.querySelector('.bio-line')?.scrollIntoView({ block: 'center' }); focusTile('__bio'); canvas.querySelector('.bio-line')?.focus(); return;
      case 'share': return openShare($('[data-ed="share"]', app));
    }
  });

  /* ---------- header & dock buttons ---------- */

  app.addEventListener('click', e => {
    const b = e.target.closest('[data-ed]');
    if (b) {
      switch (b.dataset.ed) {
        case 'undo': return undo();
        case 'redo': return redo();
        case 'share': return openShare(b);
        case 'visits': return openVisits();
        case 'subs': return openSubscribers();
        case 'settings': return openSettings(b);
        case 'menu': return openMenu(b);
      }
    }
    const dv = e.target.closest('[data-dev]');
    if (dv && dv.dataset.dev !== S.device) {
      S.device = dv.dataset.dev;
      $$('[data-dev]', app).forEach(x => x.classList.toggle('on', x === dv));
      const first = Box.rects(canvas);
      $('#edStage', app).classList.toggle('m', S.device === 'm');
      Box.render(canvas, box, { mode: 'edit', device: S.device, selectedId: S.sel });
      Box.flip(canvas, first);
      buildToolbar();
      return;
    }
    // Toolbar buttons get rebuilt on click, so a detached target isn't an outside click.
    if (!e.target.isConnected) return;
    if (!e.target.closest('.tile, .section, .tb, .bio, .dock, .ed-head, .ed-bar, .checklist, .pop')) select(null);
  });

  /* ---------- keys, paste, drop ---------- */

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'k') { e.preventDefault(); openPalette(); return; }
    if (S.palette || document.querySelector('.drawer-wrap')) return;
    const typing = e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (typing) {
      if (e.target.isContentEditable && (e.key === 'Escape' || (e.key === 'Enter' && e.target.getAttribute('contenteditable') === 'plaintext-only'))) { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape' && e.target.closest('.draft-form')) { e.target.value = ''; e.target.blur(); }
      return;
    }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') {
      if (S.crop) cropDone();
      else if (S.knockAsk) { S.knockAsk = false; buildToolbar(); }
      else select(null);
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && S.sel) {
      e.preventDefault();
      if (S.knockAsk) knockOff(S.sel); else { S.knockAsk = true; buildToolbar(); }
      return;
    }
    if (e.key === 'Enter' && S.knockAsk && S.sel) { e.preventDefault(); knockOff(S.sel); }
  }

  function onPaste(e) {
    if (e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    const txt = (e.clipboardData?.getData('text') || '').trim();
    if (!txt) return;
    e.preventDefault();
    if (looksLikeUrl(txt)) insertResolved(txt);
    else add('text', undefined, { text: txt.slice(0, 280) });
  }

  let dragDepth = 0;
  const hasPayload = e => { const ty = [...(e.dataTransfer?.types || [])]; return ty.includes('Files') || ty.includes('text/uri-list'); };
  const dz = $('#dropzone', app);
  function onDragEnter(e) {
    if (!hasPayload(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) {
      const n = e.dataTransfer.items?.length || 1;
      const files = [...(e.dataTransfer.types || [])].includes('Files');
      $('#dzCount', app).textContent = files ? (n === 1 ? 'It becomes a tile' : `${n} files become ${n} tiles`) : 'The link becomes a tile';
      dz.hidden = false;
      requestAnimationFrame(() => dz.classList.add('in'));
      Cat.mood('wide');
    }
  }
  function onDragOver(e) { if (hasPayload(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }
  function hideDrop() { dragDepth = 0; dz.classList.remove('in'); setTimeout(() => { if (!dragDepth) dz.hidden = true; }, 200); Cat.mood('open'); }
  function onDragLeave(e) { if (hasPayload(e) && --dragDepth <= 0) hideDrop(); }
  function onDrop(e) {
    if (!hasPayload(e)) return;
    e.preventDefault();
    hideDrop();
    const idx = indexAt(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (files.length) { addFiles(files, idx); return; }
    const u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (u && looksLikeUrl(u)) insertResolved(u, idx);
  }

  const onScroll = () => placeToolbarNow();
  const onResize = () => placeToolbarNow();
  addEventListener('keydown', onKey);
  addEventListener('paste', onPaste);
  addEventListener('dragenter', onDragEnter);
  addEventListener('dragover', onDragOver);
  addEventListener('dragleave', onDragLeave);
  addEventListener('drop', onDrop);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);

  // When a real visitor opens the box, the cat looks up.
  let lastVisit = null;
  const stopVisits = watch('stats:latestVisit', {}, at => {
    if (lastVisit !== null && at && at > lastVisit && !document.hidden) {
      Cat.flash('wide', 2400);
      toast('Someone just opened your box.', { mood: 'wide' });
    }
    lastVisit = at ?? 0;
  }, () => {});

  const stopPreviews = watch('links:previews', { boxId: box._id }, cached => {
    if (!alive) return;
    let changed = false;
    box.tiles = box.tiles.map(tile => {
      const next = mergePreview(tile, cached.find(p => p.tileId === tile.id));
      if (JSON.stringify(next) !== JSON.stringify(tile)) changed = true;
      return next;
    });
    if (changed) render(false);
  }, () => {});
  mutation('interactions:refreshBox', { boxId: box._id }).catch(() => {});

  // Don't lose the last edit when the tab closes mid-save.
  const onLeave = e => { if (saves.pending || saves.inFlight || S.uploads) { void flush(); e.preventDefault(); e.returnValue = ''; } };
  const onHidden = () => { if (document.hidden && saves.pending) void flush(); };
  addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', onHidden);

  setSave('idle');
  render(false);
  saves.resume();
  for (const t of box.tiles) if (t.loading) unfurl(t.id, { refresh: !!t.previewSource, baseline: t.previewSource?.values });
  if (box.onboarding && !box.tiles.length && !box.name) setTimeout(() => focusTile('__bio'), 300);
  if (opts.open === 'subscribers') openSubscribers();

  return () => {
    alive = false;
    clearTimeout(S.saveT); clearTimeout(S.idleT); clearTimeout(S.clBye);
    S.rec?.stop();
    saves.dispose();
    if (saves.pending) void flush();
    stopVisits();
    stopPreviews();
    S.subsClose?.();
    removeEventListener('beforeunload', onLeave);
    document.removeEventListener('visibilitychange', onHidden);
    removeEventListener('keydown', onKey);
    removeEventListener('paste', onPaste);
    removeEventListener('dragenter', onDragEnter);
    removeEventListener('dragover', onDragOver);
    removeEventListener('dragleave', onDragLeave);
    removeEventListener('drop', onDrop);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    removeEventListener('touchmove', preventTouch);
    S.palette?.close();
    $$('.drawer-wrap').forEach(d => d.remove());
  };
}
