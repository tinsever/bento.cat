import { SITE_ORIGIN, canonicalUrl } from './seo.js';

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export async function buildSitemap(query) {
  const urls = ['/', '/explore', '/credits', '/privacy', '/terms', '/imprint'].map(path => ({ url: canonicalUrl(path) }));
  let cursor = null;
  const seen = new Set();
  do {
    const result = await query({ paginationOpts: { cursor, numItems: 25 } });
    for (const box of result.page) {
      urls.push({ url: `${SITE_ORIGIN}/${encodeURIComponent(box.handle)}`, lastmod: new Date(box.updatedAt).toISOString() });
      if (urls.length > 50_000) throw new Error('The sitemap needs to be split into multiple files.');
    }
    if (result.isDone) break;
    if (!result.continueCursor || seen.has(result.continueCursor)) throw new Error('Sitemap pagination did not advance.');
    cursor = result.continueCursor;
    seen.add(cursor);
  } while (cursor);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(({ url, lastmod }) =>
    `  <url><loc>${escapeXml(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
  ).join('\n') + '\n</urlset>\n';
}
