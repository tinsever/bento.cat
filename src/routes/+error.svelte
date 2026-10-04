<script>
	import { page } from '$app/state';
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';

	const lost = $derived(page.status === 404);
	const claimable = $derived(lost && page.error?.claimable && typeof page.error.handle === 'string');
</script>

<svelte:head><title>{lost ? 'Nothing here' : 'Something broke'} — bento.cat</title></svelte:head>

<div class="land">
	<Nav />
	<section class="empty-box">
		<svg class="ears" viewBox="0 0 280 196"><path d="M10 50 L26 6 L78 38 H202 L254 6 L270 50 V172 Q270 190 252 190 H28 Q10 190 10 172 Z" fill="none" stroke="#BDBDBD" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="6 6" /></svg>
		<h1>{claimable ? `bento.cat/${page.error.handle}` : lost ? 'Nothing in this box' : 'The cat knocked something over'}</h1>
		<p class="lede">{claimable ? 'An empty box. Nobody’s curled up in it yet.' : lost ? 'This page doesn’t exist. Maybe it never did.' : 'Something went wrong on our side. Try again in a moment.'}</p>
		{#if claimable}
			<a class="btn btn-dark lg" href="/login?claim={encodeURIComponent(page.error.handle)}">Claim it <span class="arr-up">↗</span></a>
		{:else}
			<a class="btn btn-dark lg" href="/">Back to bento.cat</a>
		{/if}
	</section>
	<Footer />
</div>
