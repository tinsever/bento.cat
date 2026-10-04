import { httpQuery } from '#lib/api.js';

// Mia's box fills the hero; the page follows it live once it's up.
export async function load({ fetch }) {
	return { mia: await httpQuery('boxes:get', { handle: 'mia' }, fetch).catch(() => null), renderedAt: Date.now() };
}
