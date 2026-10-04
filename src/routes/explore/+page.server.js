import { error } from '@sveltejs/kit';
import { httpQuery } from '#lib/api.js';

export async function load({ fetch }) {
	try {
		return { boxes: await httpQuery('boxes:explore', {}, fetch), renderedAt: Date.now() };
	} catch {
		error(503, 'The boxes are temporarily unavailable. Please try again in a moment.');
	}
}
