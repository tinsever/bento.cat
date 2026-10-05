import { describe, expect, it, vi } from 'vite-plus/test';
import { Hydrate, linkIcon } from '../src/lib/engine/tiles.js';

vi.mock('../src/lib/api.js', () => ({ mutation: vi.fn(), query: vi.fn(), reason: String }));

describe('favicon fallbacks', () => {
  it.each(['https://example.com', 'https://github.com/owner'])('keeps a fallback underneath the image for %s', url => {
    const markup = linkIcon({ url, icon: { src: 'https://example.com/icon.png' } });
    expect(markup).toContain('fav-wrap');
    expect(markup).toContain('icon-sq dark');
    expect(markup).toContain('<img');
    expect(markup).not.toContain('onerror=');
  });

  it.each([false, true])('reveals the fallback when an image fails (already failed: %s)', complete => {
    const remove = vi.fn();
    let error;
    const img = { complete, currentSrc: 'https://example.com/icon.png', naturalWidth: 0, closest: () => ({ remove }), addEventListener: (_, listener) => { error = listener; }, removeEventListener: vi.fn() };
    const cleanup = Hydrate.link({ querySelector: () => img });
    if (!complete) error();
    expect(remove).toHaveBeenCalledTimes(1);
    cleanup();
    expect(img.removeEventListener).toHaveBeenCalledWith('error', error);
  });

  it('does not mistake a lazy image that has not started loading for a failed image', () => {
    const remove = vi.fn();
    const img = { complete: true, currentSrc: '', naturalWidth: 0, closest: () => ({ remove }), addEventListener() {}, removeEventListener() {} };
    Hydrate.link({ querySelector: () => img });
    expect(remove).not.toHaveBeenCalled();
  });
});
