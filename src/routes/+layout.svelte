<script>
	// Served from our own domain so no page load reaches Google.
	import '@fontsource-variable/instrument-sans/wght.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { startAuth } from '#lib/auth.svelte.js';
	import { mutation, watch } from '#lib/api.js';
	import { initEngine, leavePage } from '#lib/engine/init.js';
	import { setAssets } from '#lib/engine/data.js';
	import { clearOptInLeftovers } from '#lib/visit-consent.js';
	import { canonicalUrl, hasPublicContent } from '#lib/seo.js';

	let { children } = $props();
	const noindex = $derived(page.status >= 400 || page.route.id === '/edit' || page.route.id?.startsWith('/login') || (page.route.id === '/[handle]' && !hasPublicContent(page.data.box)));

	// Before any page mounts: pages read the visitor key and auth state straight away.
	if (browser) {
		initEngine();
		startAuth();
	}

	onMount(() => {
		void clearOptInLeftovers(key => mutation('interactions:forgetVisits', { visitorKey: key }));
		return watch('files:assets', {}, setAssets, () => {});
	});

	beforeNavigate(() => leavePage());

	// A few pages restyle the whole body (editor toasts, the curb-coloured sign-in page).
	$effect(() => {
		const id = page.route.id || '';
		document.body.className = id === '/edit' ? 'pg-edit' : id.startsWith('/login') ? 'pg-auth' : id === '/[handle]' ? 'pg-profile' : '';
	});
</script>

<svelte:head>
	<meta property="og:site_name" content="bento.cat" />
	<meta name="robots" content={noindex ? 'noindex' : 'index, follow, max-image-preview:large'} />
	{#if !noindex}
		<link rel="canonical" href={canonicalUrl(page.url.pathname)} />
		<meta property="og:url" content={canonicalUrl(page.url.pathname)} />
	{/if}
</svelte:head>

{@render children()}
<div id="layer"></div>
<div id="toasts" aria-live="polite"></div>
