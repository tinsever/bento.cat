import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { clearOptInLeftovers } from '../src/lib/visit-consent.js';
import { Visitor } from '../src/lib/engine/state.js';

const CHOICE = 'bento.cat/visit-consent.v1', KEY = 'bento.cat/statistics-key.v1';
const OLD_KEY = 'a'.repeat(32);
let values, local;
beforeEach(() => {
  values = new Map();
  local = {
    get length() { return values.size; },
    key: vi.fn(i => [...values.keys()][i] ?? null),
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn(key => values.delete(key)),
  };
  vi.stubGlobal('localStorage', local);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('browser storage', () => {
  it('keeps no visitor key between page loads', () => {
    values.set('bento.cat/visitor-key', 'old-automatic-key');
    Visitor.load();
    const first = Visitor.key;
    Visitor.set('purr', 'mia/purr1', true);
    expect(first).toHaveLength(32);
    expect(Visitor.get('purr', 'mia/purr1')).toBe(true);
    // Only the list of purred tiles is written, after the tap. It holds no identifier.
    expect(local.setItem.mock.calls).toEqual([['bento.cat/purred.v1/mia%2Fpurr1', expect.any(String)]]);
    expect(values.has('bento.cat/visitor-key')).toBe(false);
    Visitor.load();
    expect(Visitor.key).not.toBe(first);
  });
});

describe('purred tiles', () => {
  it('remembers purred tiles across a reload so a purr counts once', () => {
    Visitor.load();
    Visitor.set('purr', 'mia/purr1', true);
    const key = Visitor.key;
    Visitor.load();
    expect(Visitor.get('purr', 'mia/purr1')).toBe(true);
    expect(Visitor.get('purr', 'mia/purr2')).toBeUndefined();
    expect(Visitor.key).not.toBe(key);
  });
});

describe('leftovers from opt-in visit records', () => {
  it('does nothing in a browser that never opted in', async () => {
    const forget = vi.fn();
    await clearOptInLeftovers(forget);
    expect(forget).not.toHaveBeenCalled();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.removeItem).not.toHaveBeenCalled();
  });

  it('erases visits under an old key, then forgets the key and the choice', async () => {
    values.set(CHOICE, JSON.stringify({ allowed: true, expiresAt: Date.now() + 1000 }));
    values.set(KEY, OLD_KEY);
    const forget = vi.fn(async () => {});
    await clearOptInLeftovers(forget);
    expect(forget).toHaveBeenCalledWith(OLD_KEY);
    expect(values.has(KEY)).toBe(false);
    expect(values.has(CHOICE)).toBe(false);
  });

  it('keeps the key for another try when the erase fails', async () => {
    values.set(CHOICE, JSON.stringify({ allowed: true, expiresAt: Date.now() + 1000 }));
    values.set(KEY, OLD_KEY);
    await clearOptInLeftovers(async () => { throw new Error('offline'); });
    expect(values.get(KEY)).toBe(OLD_KEY);
  });

  it('drops a declined choice or a malformed key without calling the server', async () => {
    values.set(CHOICE, JSON.stringify({ allowed: false, expiresAt: Date.now() + 1000 }));
    values.set(KEY, 'not-a-key');
    const forget = vi.fn();
    await clearOptInLeftovers(forget);
    expect(forget).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });

  it('works when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    await expect(clearOptInLeftovers(vi.fn())).resolves.toBeUndefined();
    Visitor.load();
    Visitor.set('purr', 'mia/purr1', true);
    expect(Visitor.get('purr', 'mia/purr1')).toBe(true);
  });
});
