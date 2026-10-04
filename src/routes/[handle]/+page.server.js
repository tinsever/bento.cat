import { error, redirect } from '@sveltejs/kit';
import { httpQuery } from '#lib/api.js';
import { countPageView } from '#lib/server/page-views.js';
import { hasPublicContent } from '#lib/seo.js';

// Server loads cover both document requests and client-side navigation.
export async function load({ params, fetch, request, url, setHeaders }) {
	const handle = params.handle.toLowerCase();
	if (params.handle !== handle) redirect(308, `/${encodeURIComponent(handle)}${url.search}`);
	let box, status;
	try {
		box = await httpQuery('boxes:get', { handle }, fetch);
		if (!box) status = await httpQuery('boxes:handleStatus', { handle }, fetch);
	} catch {
		error(503, 'This box is temporarily unavailable. Please try again in a moment.');
	}
	if (!box) error(404, 'This box does not exist.', { handle, claimable: status?.state === 'free' });
	if (!hasPublicContent(box)) setHeaders({ 'X-Robots-Tag': 'noindex' });
	await countPageView(box._id, request);
	return { handle, box, renderedAt: Date.now() };
}
