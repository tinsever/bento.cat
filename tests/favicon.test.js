import { describe, expect, it, vi } from 'vite-plus/test';
import { Hydrate, R, linkIcon } from '../src/lib/engine/tiles.js';
import { mutation } from '../src/lib/api.js';

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
    const img = { style: {}, complete, currentSrc: 'https://example.com/icon.png', naturalWidth: 0, getAttribute: () => 'https://example.com/icon.png', closest: () => ({ remove }), addEventListener: (_, listener) => { error = listener; }, removeEventListener: vi.fn() };
    const cleanup = Hydrate.link({ querySelectorAll: () => [img] });
    if (!complete) error();
    expect(remove).toHaveBeenCalledTimes(1);
    cleanup();
    expect(img.removeEventListener).toHaveBeenCalledWith('error', error);
  });

  it('does not mistake a lazy image that has not started loading for a failed image', () => {
    const remove = vi.fn();
    const img = { complete: true, currentSrc: '', naturalWidth: 0, getAttribute: () => 'https://example.com/icon.png', closest: () => ({ remove }), addEventListener() {}, removeEventListener() {} };
    Hydrate.link({ querySelectorAll: () => [img] });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['link', 'music'])('requests one preview recovery per %s tile and cleans up listeners', type => {
    mutation.mockResolvedValue(undefined);
    mutation.mockClear();
    const listeners = [];
    const imgs = Array.from({ length: 2 }, () => ({
      style: {},
      getAttribute: () => 'https://example.com/image.png', closest: () => null,
      addEventListener: (_, listener) => listeners.push(listener), removeEventListener: vi.fn(),
    }));
    const cleanup = Hydrate[type]({ querySelectorAll: () => imgs }, { id: 'tile' }, { _box: { _id: 'box' }, _mode: 'view' });
    listeners.forEach(listener => listener());
    imgs.forEach(img => expect(img.style.visibility).toBe('hidden'));
    expect(mutation).toHaveBeenCalledExactlyOnceWith('links:retryPreview', { boxId: 'box', tileId: 'tile', src: 'https://example.com/image.png' });
    cleanup();
    imgs.forEach((img, i) => expect(img.removeEventListener).toHaveBeenCalledWith('error', listeners[i]));
  });

  it('renders a music cover as an image so failed requests can recover', () => {
    expect(R.music({ id: 'music', cover: 'https://example.com/cover.jpg' }, { size: 'loaf' })).toContain('<img src="https://example.com/cover.jpg"');
  });
});
