import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../src/lib/api.js', () => ({ httpQuery: vi.fn() }));
vi.mock('../src/lib/server/page-views.js', () => ({ countPageView: vi.fn() }));

import { httpQuery } from '../src/lib/api.js';
import { countPageView } from '../src/lib/server/page-views.js';
import { load } from '../src/routes/[handle]/+page.server.js';
import { isHttpError, isRedirect } from '@sveltejs/kit';

const event = (handle = 'owner') => ({ params: { handle }, url: new URL(`https://bento.cat/${handle}`), request: new Request(`https://bento.cat/${handle}`), fetch: vi.fn(), setHeaders: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); });

describe('public box server loads', () => {
  it('counts one existing box per load, before returning data for hydration', async () => {
    const box = { _id: 'box-id', handle: 'owner', name: 'Owner', tiles: [] };
    httpQuery.mockResolvedValueOnce(box);
    const request = event();
    expect(await load(request)).toEqual({ handle: 'owner', box, renderedAt: expect.any(Number) });
    expect(httpQuery).toHaveBeenCalledWith('boxes:get', { handle: 'owner' }, request.fetch);
    expect(countPageView.mock.calls).toEqual([['box-id', request.request]]);
  });

  it('does not count missing boxes', async () => {
    httpQuery.mockResolvedValueOnce(null).mockResolvedValueOnce({ state: 'free' });
    await expect(load(event())).rejects.toSatisfy(err => isHttpError(err) && err.status === 404);
    expect(countPageView).not.toHaveBeenCalled();
  });

  it('does not count failed reads', async () => {
    httpQuery.mockRejectedValue(new Error('unavailable'));
    await expect(load(event())).rejects.toSatisfy(err => isHttpError(err) && err.status === 503);
    expect(countPageView).not.toHaveBeenCalled();
  });

  it('does not count requests redirected to the canonical handle', async () => {
    await expect(load(event('Owner'))).rejects.toSatisfy(err => isRedirect(err) && err.status === 308);
    expect(httpQuery).not.toHaveBeenCalled();
    expect(countPageView).not.toHaveBeenCalled();
  });
});
