import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { render } from 'svelte/server';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { parseFragment } from 'parse5';
import PublicBox from '../src/lib/components/PublicBox.svelte';
import PageMeta from '../src/lib/components/PageMeta.svelte';
import { httpQuery } from '../src/lib/api.js';
import { htmlText, sanitize } from '../src/lib/rich-text.js';
import { hasPublicContent, profileMetadata, profileSchema, structuredJson } from '../src/lib/seo.js';
import { buildSitemap } from '../src/lib/sitemap.js';
import { load } from '../src/routes/[handle]/+page.server.js';
import { load as explore } from '../src/routes/explore/+page.server.js';

vi.mock('../src/lib/api.js', () => ({ httpQuery: vi.fn(), query: vi.fn(), mutation: vi.fn(), reason: vi.fn() }));
vi.mock('../src/lib/server/page-views.js', () => ({ countPageView: vi.fn() }));

const now = Date.UTC(2026, 9, 4, 10);
const box = {
  handle: 'artist', name: 'Mia & friends', bio: 'Letters, cats, and notes.', updatedAt: now,
  tiles: [
    { id: 'link', type: 'link', title: 'My portfolio', url: 'https://example.com/work?a=1&b=2', size: { d: 'loaf', m: 'curl' } },
    { id: 'note', type: 'note', html: '<b>Handmade letters</b><br>Made in Köln<img src=x onerror=alert(1)>', size: { d: 'loaf' } },
    { id: 'section', type: 'section', text: 'More about me' },
    { id: 'map', type: 'map', place: 'Köln', lat: 50.9, lon: 6.9, size: { d: 'sprawl' } },
    { id: 'newsletter', type: 'subscribe', title: 'Letters by mail' },
    { id: 'draft', type: 'link', draft: true, title: 'Unfinished link' },
  ],
};
const nodes = root => [root, ...(root.childNodes || []).flatMap(nodes)];
const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
const event = handle => ({ params: { handle }, url: new URL(`https://bento.cat/${handle}?ref=share`), request: new Request(`https://bento.cat/${handle}?ref=share`), fetch: vi.fn(), setHeaders: vi.fn() });
beforeEach(() => vi.clearAllMocks());

describe('public profile HTML without a browser', () => {
  it('renders identity, safe notes, headings, destinations and map fallbacks before JavaScript', () => {
    const { body } = render(PublicBox, { props: { box, now } });
    const dom = nodes(parseFragment(body));
    expect(dom.find(n => n.tagName === 'h1')?.childNodes[0].value).toBe('Mia & friends');
    expect(htmlText(body)).toContain('Handmade letters\nMade in Köln');
    expect(body).toContain('<b>Handmade letters</b>');
    expect(body).not.toMatch(/onerror|<script|Unfinished link/);
    expect(dom.filter(n => n.tagName === 'h2')).toHaveLength(1);
    expect(dom.some(n => n.tagName === 'svg' && attrs(n).class === 'map-svg')).toBe(true);
    const portfolio = dom.find(n => n.tagName === 'a' && attrs(n).href?.startsWith('https://example.com'));
    expect(attrs(portfolio).href).toBe('https://example.com/work?a=1&b=2');
    const email = dom.find(n => n.tagName === 'input' && attrs(n).type === 'email');
    expect(attrs(email)).toHaveProperty('disabled');
  });

  it('keeps Explore previews valid inside a profile link', () => {
    const { body } = render(PublicBox, { props: { box, now, mode: 'static', responsive: false } });
    const dom = nodes(parseFragment(`<a href="/artist">${body}</a>`));
    expect(dom.filter(n => n.tagName === 'a')).toHaveLength(1);
    expect(dom.filter(n => n.tagName === 'h1')).toHaveLength(0);
    expect(htmlText(body)).toContain('Mia & friends');
  });

  it('rejects executable tile destinations', () => {
    const { body } = render(PublicBox, { props: { box: { ...box, tiles: [{ id: 'bad', type: 'link', title: 'Bad URL', url: 'javascript:alert(1)' }] }, now } });
    expect(nodes(parseFragment(body)).filter(n => n.tagName === 'a')).toHaveLength(0);
  });

  it('handles entities, malformed markup and rich text consistently without a DOM', () => {
    expect(sanitize('<p>Hello &amp; <strong>world</strong></p><p><em>again</em></p><svg onload=alert(1)><script>x</script></svg>')).toBe('Hello &amp; <b>world</b><br><i>again</i>x');
    expect(sanitize('<b onclick="evil()">Text<img src=x></b>')).toBe('<b>Text</b>');
    expect(htmlText('<div>A &lt; B</div><p>Next<br>line</p>')).toBe('A < B\nNext\nline\n');
  });
});

describe('metadata and discovery', () => {
  it('uses defaults or custom metadata and escapes social preview values', () => {
    expect(profileMetadata(box)).toMatchObject({ title: 'Mia & friends — bento.cat/artist', description: box.bio });
    const metadata = profileMetadata({ ...box, seoTitle: ' Custom "title" ', seoDescription: '<A description>', avatar: 'https://example.com/photo.jpg' });
    expect(metadata.title).toBe('Custom "title"');
    const { head } = render(PageMeta, { props: { ...metadata, imageAlt: box.name } });
    expect(head).toContain('name="twitter:card" content="summary"');
    expect(head).toContain('property="og:image" content="https://example.com/photo.jpg"');
    expect(head).toContain('&lt;A description>');
    expect(head).not.toContain('content="<A description>"');
  });

  it('excludes blank claims and unfinished tiles, and includes a filled-out bio', () => {
    expect(hasPublicContent({ name: '', bio: '', tiles: [{ type: 'section' }, { type: 'link', draft: true }] })).toBe(false);
    expect(hasPublicContent({ name: 'Mia', tiles: [] })).toBe(true);
    expect(hasPublicContent(box)).toBe(true);
  });

  it('provides a branded preview when a page has no avatar', () => {
    const { head } = render(PageMeta, { props: { title: 'Explore boxes', description: 'Public boxes' } });
    expect(head).toContain('property="og:image" content="https://bento.cat/og-image.png"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain('property="og:image:width" content="1200"');
  });

  it('keeps structured profile data valid and prevents user text from closing the script', () => {
    const malicious = { ...box, name: '</script><script>alert(1)</script>' };
    const schema = profileSchema(malicious);
    const { head } = render(PageMeta, { props: { ...profileMetadata(malicious), schema } });
    expect(schema).toMatchObject({ '@type': 'ProfilePage', url: 'https://bento.cat/artist', mainEntity: { name: malicious.name } });
    expect(JSON.parse(structuredJson(schema))).toEqual(schema);
    expect(head.match(/<script /g)).toHaveLength(1);
    expect(head).toContain('\\u003c/script>');
  });

  it('rejects stalled sitemap pagination', async () => {
    const query = vi.fn().mockResolvedValue({ page: [], isDone: false, continueCursor: 'same' });
    await expect(buildSitemap(query)).rejects.toThrow('Sitemap pagination did not advance.');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('follows pagination even when an entire page is empty and emits canonical URLs and dates', async () => {
    const query = vi.fn().mockResolvedValueOnce({ page: [], isDone: false, continueCursor: 'next' })
      .mockResolvedValueOnce({ page: [{ handle: 'artist', updatedAt: now }], isDone: true, continueCursor: '' });
    const xml = await buildSitemap(query);
    expect(query.mock.calls[1][0].paginationOpts.cursor).toBe('next');
    expect(xml).toContain('<loc>https://bento.cat/artist</loc><lastmod>2026-10-04T10:00:00.000Z</lastmod>');
    expect(xml).not.toMatch(/\/login|\/edit/);
    await expect(buildSitemap(vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline');
  });
});

describe('public route status codes', () => {
  it('redirects mixed-case handles permanently and preserves query parameters', async () => {
    try { await load(event('ArTiSt')); expect.fail('Expected a redirect'); }
    catch (err) { expect(isRedirect(err)).toBe(true); expect(err).toMatchObject({ status: 308, location: '/artist?ref=share' }); }
    expect(httpQuery).not.toHaveBeenCalled();
  });

  it('returns a 404 with a claim link for a free handle', async () => {
    httpQuery.mockResolvedValueOnce(null).mockResolvedValueOnce({ state: 'free' });
    try { await load(event('free')); expect.fail('Expected a 404'); }
    catch (err) { expect(isHttpError(err)).toBe(true); expect(err).toMatchObject({ status: 404, body: { handle: 'free', claimable: true } }); }
  });

  it('marks empty existing profiles noindex and serves filled profiles normally', async () => {
    const blank = event('blank');
    httpQuery.mockResolvedValueOnce({ handle: 'blank', name: '', bio: '', tiles: [] });
    await load(blank);
    expect(blank.setHeaders).toHaveBeenCalledWith({ 'X-Robots-Tag': 'noindex' });
    httpQuery.mockResolvedValueOnce(box);
    const filled = event('artist');
    expect((await load(filled)).box).toEqual(box);
    expect(filled.setHeaders).not.toHaveBeenCalled();
  });

  it('returns a 503 for backend failures, preserving the distinction from missing profiles', async () => {
    httpQuery.mockRejectedValue(new Error('offline'));
    for (const loader of [load, explore]) {
      try { await loader(event('artist')); expect.fail('Expected a 503'); }
      catch (err) { expect(isHttpError(err)).toBe(true); expect(err.status).toBe(503); }
    }
  });
});
