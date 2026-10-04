import { error } from '@sveltejs/kit';
import { httpQuery } from '#lib/api.js';
import { buildSitemap } from '#lib/sitemap.js';

export async function GET({ fetch }) {
	try {
		const xml = await buildSitemap(args => httpQuery('boxes:sitemap', args, fetch));
		return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
	} catch {
		error(503, 'The sitemap is temporarily unavailable.');
	}
}
