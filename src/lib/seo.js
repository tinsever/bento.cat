export const SITE_ORIGIN = 'https://bento.cat';
export const SITE_DESCRIPTION = 'Your work, your links, your little obsessions. One personal page that feels like you.';
export const SITE_IMAGE = `${SITE_ORIGIN}/og-image.png`;

export { hasPublicContent } from './public-content.js';

export function profileMetadata(box) {
  return {
    title: box.seoTitle?.trim() || `${box.name || box.handle} — bento.cat/${box.handle}`,
    description: box.seoDescription?.trim() || box.bio?.trim().slice(0, 160) || `${box.name || box.handle} on bento.cat`,
    image: /^https?:\/\//i.test(box.avatar || '') ? box.avatar : '',
  };
}

export const canonicalUrl = path => new URL(path, SITE_ORIGIN).href;

// JSON-LD lives in a script element; escaping '<' keeps user text from closing it.
export const structuredJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
export const schemaScript = value => `<script type="application/ld+json">${structuredJson(value)}</script>`;

export const siteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'bento.cat',
  url: SITE_ORIGIN,
  description: SITE_DESCRIPTION,
};

export function profileSchema(box) {
  const url = canonicalUrl(`/${encodeURIComponent(box.handle)}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    ...(Number.isFinite(box.updatedAt) ? { dateModified: new Date(box.updatedAt).toISOString() } : {}),
    mainEntity: {
      '@type': 'Person',
      name: box.name || box.handle,
      alternateName: box.handle,
      description: box.bio || profileMetadata(box).description,
      url,
      ...(profileMetadata(box).image ? { image: profileMetadata(box).image } : {}),
    },
  };
}
