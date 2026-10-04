import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mutation } from '../src/lib/api.js';
import { Visitor } from '../src/lib/engine/state.js';
import { Acts } from '../src/lib/engine/tiles.js';

vi.mock('../src/lib/api.js', () => ({ mutation: vi.fn(), query: vi.fn(), reason: String }));
vi.mock('../src/lib/engine/util.js', async importOriginal => ({
  ...await importOriginal(), Sound: { purr: vi.fn() }, toast: vi.fn(),
}));

let values, local;
beforeEach(() => {
  values = new Map();
  local = {
    get length() { return values.size; },
    key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('document', { createElement: () => ({ style: {}, animate: () => ({}) }) });
  mutation.mockReset();
  Visitor.load();
});
afterEach(() => vi.unstubAllGlobals());

function tile(id = 'paw') {
  const classes = () => {
    const names = new Set();
    return { add: name => names.add(name), remove: name => names.delete(name), contains: name => names.has(name) };
  };
  const btn = { classList: classes(), animate() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 40 }) };
  const odo = { setAttribute() {}, querySelectorAll: () => [{ style: { setProperty() {} } }] };
  const sub = { textContent: 'purrs. Tap to leave yours.' };
  const el = {
    isConnected: true, classList: classes(), append() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: selector => ({ '.paw-btn': btn, '.odo': odo, '.purr-sub': sub })[selector],
  };
  return { el, btn, sub, t: { id, count: 0 }, root: { _box: { _id: 'box', handle: 'owner' } } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('confirmed purrs', () => {
  it('rolls back a failed request and permits retrying now and after a reload', async () => {
    mutation.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ count: 1 });
    const { el, btn, sub, t, root } = tile();
    Acts.purr(el, t, root);
    expect(el.classList.contains('purred')).toBe(true);
    await settle();
    expect(Visitor.get('purr', 'owner/paw')).toBeUndefined();
    expect(t.count).toBe(0);
    expect(btn.classList.contains('on')).toBe(false);
    expect(sub.textContent).toBe('purrs. Tap to leave yours.');
    Visitor.load();
    expect(Visitor.get('purr', 'owner/paw')).toBeUndefined();
    Acts.purr(el, t, root);
    await settle();
    expect(mutation).toHaveBeenCalledTimes(2);
    Visitor.load();
    expect(Visitor.get('purr', 'owner/paw')).toBe(true);
  });

  it('does not persist another tile whose request is still pending', async () => {
    let reject;
    mutation.mockImplementationOnce(() => new Promise((_, no) => { reject = no; })).mockResolvedValue({ count: 1 });
    const a = tile('a'), b = tile('b');
    Acts.purr(a.el, a.t, a.root);
    Acts.purr(a.el, a.t, a.root);
    Acts.purr(b.el, b.t, b.root);
    await settle();
    expect(mutation).toHaveBeenCalledTimes(2);
    Visitor.load();
    expect(Visitor.get('purr', 'owner/a')).toBeUndefined();
    expect(Visitor.get('purr', 'owner/b')).toBe(true);
    reject(new Error('offline'));
    await settle();
  });

  it('preserves writes from tabs that loaded the same history and notices them without reloading', () => {
    const a = { ...Visitor, d: {} }, b = { ...Visitor, d: {} };
    a.load(); b.load();
    a.set('purr', 'owner/a', true);
    b.set('purr', 'owner/b', true);
    expect(a.get('purr', 'owner/b')).toBe(true);
    a.set('purr', 'owner/c', true);
    Visitor.load();
    for (const id of ['a', 'b', 'c']) expect(Visitor.get('purr', 'owner/' + id)).toBe(true);
  });

  it('retains purrs even when two storage writes interleave', () => {
    const a = { ...Visitor, d: {} }, b = { ...Visitor, d: {} };
    a.load(); b.load();
    const write = local.setItem;
    local.setItem = (key, value) => {
      local.setItem = write;
      b.set('purr', 'owner/b', true);
      write(key, value);
    };
    a.set('purr', 'owner/a', true);
    Visitor.load();
    expect(Visitor.get('purr', 'owner/a')).toBe(true);
    expect(Visitor.get('purr', 'owner/b')).toBe(true);
  });

  it('migrates the old list and keeps storage bounded to the newest 500 tiles', () => {
    values.set('bento.cat/purred.v1', JSON.stringify(['owner/old']));
    Visitor.load();
    expect(Visitor.get('purr', 'owner/old')).toBe(true);
    Visitor.set('purr', 'owner/new', true);
    expect(values.has('bento.cat/purred.v1')).toBe(false);
    Visitor.load();
    expect(Visitor.get('purr', 'owner/old')).toBe(true);
    for (let i = 0; i < 500; i++) values.set('bento.cat/purred.v1/' + encodeURIComponent('owner/tile' + i), String(i + 1));
    Visitor.set('purr', 'owner/latest', true);
    expect(values.size).toBe(500);
    Visitor.load();
    expect(Visitor.get('purr', 'owner/old')).toBeUndefined();
    expect(Visitor.get('purr', 'owner/latest')).toBe(true);
  });
});
