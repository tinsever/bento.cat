<script>
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import { UPDATED } from '#lib/legal.js';
	import PageMeta from './PageMeta.svelte';

	let { title, lede = '', children } = $props();
</script>

<PageMeta title="{title} — bento.cat" description={lede || 'Operator and contact information for bento.cat.'} />

<div class="land">
	<Nav />
	<article class="legal">
		<h1>{title}</h1>
		{#if lede}<p class="lede">{lede}</p>{/if}
		<p class="legal-date">Last updated {UPDATED}</p>
		{@render children()}
	</article>
	<Footer />
</div>
