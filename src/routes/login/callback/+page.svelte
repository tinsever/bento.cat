<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { finishRedirect } from '#lib/signin.js';
	import { loginUrl } from '#lib/login-return.js';
	import { catLogo } from '#lib/engine/util.js';

	let failed = $state(false);

	// Google sends people back here; Clerk finishes the session and moves on to /login?step=after.
	onMount(() => {
		const open = page.url.searchParams.get('open');
		finishRedirect(open).catch(() => {
			failed = true;
			setTimeout(() => goto(loginUrl(open), { replaceState: true }), 2400);
		});
	});
</script>

<svelte:head><title>Signing in — bento.cat</title></svelte:head>

<div class="auth">
	<a class="auth-brand" href="/">{@html catLogo(26)}<span>bento.cat</span></a>
	<div class="auth-card">
		{@html catLogo(64, { live: true, mood: failed ? 'open' : 'closed' })}
		<div class="auth-h">
			{#if failed}<h2>That didn’t work</h2><p>Taking you back to try again.</p>{:else}<h2>Signing you in</h2><p>Back from Google. One moment.</p>{/if}
		</div>
	</div>
</div>
