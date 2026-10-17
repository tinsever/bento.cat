import { Tiles, bg, ce, cssPos, safeSrc, sizeOf, tileKey, tilesFor } from './tiles.js';
import { EASE, I, clamp, esc, h } from './util.js';

export const CAT_FRAME = 'M 18 58.5 L 27.1 11.3 L 58.5 40.5 H 85.5 L 117.1 11.3 L 126 58.5 V 112.5 Q 126 130.5 108 130.5 H 36 Q 18 130.5 18 112.5 Z';

// Photo plus an empty-state outline for every frame; CSS shows the one that matches.
export function avatarInner(box) {
  const pos = box.avatarPos || '50% 40%';
  if (box.avatarVideo) return `<div class="avatar-img" style="${bg(box.avatar, pos)}"><video src="${safeSrc(box.avatarVideo)}" style="object-position:${cssPos(pos)}" autoplay muted loop playsinline></video></div>`;
  if (box.avatar) return `<div class="avatar-img" style="${bg(box.avatar, pos)}"></div>`;
  return `<svg class="avatar-empty cat-only" viewBox="0 0 144 144"><path d="${CAT_FRAME}" fill="none" stroke="#BDBDBD" stroke-width="1.5" stroke-dasharray="5 5"/></svg>
    <span class="avatar-empty-box"></span><span class="avatar-add">${I.plus('#8A8A8A', 12)} Photo</span>`;
}

/* Lays a box out on the grid. Elements are kept per tile id so moves can animate. */

export const Box = {
  // Created on first use so this module can load during server rendering.
  get ro() {
    return (this._ro ||= new ResizeObserver(entries => { for (const e of entries) Box.setUnit(e.target); }));
  },

  setUnit(root) {
    const m = root._device === 'm';
    const gap = m ? 14 : 16;
    const w = root.clientWidth;
    if (!w) return;
    // Desktop drops to 5 or 4 columns on narrower screens so a unit never gets cramped.
    const cols = root._cols || (m ? 2 : clamp(Math.floor((w + gap) / (150 + gap)), 4, 6));
    root.style.setProperty('--cols', cols);
    root.style.setProperty('--gap', gap + 'px');
    root.style.setProperty('--unit', ((w - gap * (cols - 1)) / cols) + 'px');
  },

  render(root, box, o = {}) {
    const mode = o.mode || 'view', dev = o.device || 'd';
    root._box = box; root._mode = mode; root._device = dev; root._cols = o.cols || 0;
    root.classList.add('box-root');
    root.classList.toggle('dev-m', dev === 'm');
    root.classList.toggle('edit', mode === 'edit');
    root.classList.toggle('view', mode === 'view');
    root.classList.toggle('static', mode === 'static');
    // Miniatures are pictures: no tabbing into their buttons.
    root.inert = mode === 'static';
    if (!root._observed) { Box.ro.observe(root); root._observed = true; }
    Box.setUnit(root);

    const els = root._els || (root._els = new Map());
    const first = o.animate ? Box.rects(root) : null;
    const ctx = { mode, edit: mode === 'edit', device: dev, box, key: t => tileKey(box, t) };

    const frag = document.createDocumentFragment();
    const newGrid = () => { const g = document.createElement('div'); g.className = 'grid'; frag.append(g); return g; };
    let grid = newGrid();
    if (!o.noBio) grid.append(Box.bioEl(els, box, ctx));

    const seen = new Set(['__bio']);
    for (const t of tilesFor(box, dev)) {
      seen.add(t.id);
      const el = Box.tileEl(els, t, ctx);
      if (t.type === 'section') { frag.append(el); grid = newGrid(); }
      else grid.append(el);
    }

    if (mode === 'edit') {
      for (const sg of box.suggestions || []) {
        grid.append(h(`<div class="tile sug s-${sg.size}" data-sug="${sg.kind}" role="button" tabindex="0">
          <button class="sug-x" data-sugx="${sg.kind}" aria-label="Dismiss">${I.close('#8A8A8A', 10)}</button>
          <span class="sug-ic">${({ photo: I.image, music: I.music, map: I.pin, text: I.text, link: I.link })[sg.kind]('#8A8A8A', 20)}</span>
          <span class="sug-label">${esc(sg.label)}</span></div>`));
      }
      grid.append(h(`<div class="tile addslot s-curl" data-addslot role="button" tabindex="0" aria-label="Add a tile">${I.paw('#BDBDBD', 22)}<span>it fits here</span></div>`));
    }

    for (const [id, el] of els) if (!seen.has(id)) { el._cleanup?.(); els.delete(id); }
    root.replaceChildren(frag);
    if (o.selectedId) els.get(o.selectedId)?.classList.add('selected');
    if (first) Box.flip(root, first);
    Tiles.hydrate(root);
  },

  bioEl(els, box, c) {
    const key = JSON.stringify([box.name, box.bio, box.avatar, box.avatarVideo, box.avatarPos, c.mode, c.device]);
    let el = els.get('__bio');
    if (!el) { el = document.createElement('div'); el.dataset.key = '__bio'; els.set('__bio', el); }
    el.className = 'bio';
    if (el._key !== key) {
      el._key = key;
      el.innerHTML = `
        <div class="avatar" ${c.edit ? 'data-edact="avatar" role="button" tabindex="0" aria-label="Profile photo" aria-haspopup="dialog"' : ''}>${avatarInner(box)}</div>
        <div class="bio-text">
          <h1 class="bio-name ed" ${ce(c, 'name')} data-ph="Your name">${esc(box.name)}</h1>
          ${box.bio || c.edit ? `<p class="bio-line ed" ${ce(c, 'bio')} data-ph="A line about yourself">${esc(box.bio)}</p>` : ''}
        </div>`;
    }
    // The frame is only a class, so switching it never rebuilds the block.
    el.querySelector('.avatar').className = `avatar shape-${box.avatarShape || 'circle'}${box.avatar ? '' : ' empty'}`;
    return el;
  },

  tileEl(els, t, c) {
    const size = sizeOf(t, c.device);
    const tc = { ...c, size };
    let el = els.get(t.id);
    if (!el) { el = document.createElement('div'); el.dataset.id = t.id; el.dataset.key = t.id; els.set(t.id, el); }
    if (t.type === 'section') {
      el.className = 'section' + (c.edit ? ' sec-edit' : '');
    } else {
      el.className = Tiles.classes(t, tc);
    }
    const key = JSON.stringify(t) + size + c.mode + Tiles.liveKey(t, c.box);
    if (el._key !== key) {
      el._cleanup?.();
      el._cleanup = null;
      el.innerHTML = Tiles.render(t, tc);
      el._key = key;
      el._hyd = false;
    }
    return el;
  },

  rects(root, extra) {
    const m = new Map();
    for (const el of root.querySelectorAll('[data-key]')) if (!el.classList.contains('lifted')) m.set(el, el.getBoundingClientRect());
    if (extra) m.set(extra, extra.getBoundingClientRect());
    return m;
  },

  // First, Last, Invert, Play.
  flip(root, first, extra) {
    const els = [...root.querySelectorAll('[data-key]')];
    if (extra) els.push(extra);
    for (const el of els) {
      if (el.classList.contains('lifted')) continue;
      const a = first.get(el), b = el.getBoundingClientRect();
      if (!b.width || !b.height || (a && (!a.width || !a.height))) continue;
      if (!a) {
        if (el.dataset.id) el.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
        continue;
      }
      const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      el.animate([
        { transformOrigin: 'top left', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
        { transformOrigin: 'top left', transform: 'none' },
      ], { duration: 460, easing: EASE });
    }
  },
};
