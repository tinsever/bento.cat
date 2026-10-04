// Plain-sense headers for every page. The editor and sign-in should never be framed.
export async function handle({ event, resolve }) {
	const res = await resolve(event);
	res.headers.set('X-Content-Type-Options', 'nosniff');
	res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.headers.set('X-Frame-Options', 'DENY');
	res.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(self)');
	if (res.status >= 400 || event.route.id === '/edit' || event.route.id?.startsWith('/login'))
		res.headers.set('X-Robots-Tag', 'noindex');
	return res;
}

// A stable receipt in host logs, without exposing provider errors to visitors.
export function handleError({ error, event, status }) {
	const errorId = crypto.randomUUID();
	console.error('Unhandled server error', { errorId, status, route: event.route.id, path: event.url.pathname, error });
	return { message: 'Something went wrong. Please try again.', errorId };
}
