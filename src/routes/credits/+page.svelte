<script>
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { CREDITS, IMG } from '#lib/engine/data.js';
	import { bg } from '#lib/engine/tiles.js';
	import { I } from '#lib/engine/util.js';
	import { watch } from '#lib/api.js';
	import { onMount } from 'svelte';

	// Photos live in Convex storage; the map arrives after the page draws.
	let imgs = $state({ ...IMG });
	onMount(() => watch('files:assets', {}, m => (imgs = m), () => {}));
</script>

<PageMeta title="Cat photo credits — bento.cat" description="Meet the cats behind bento.cat. Photo credits, sources, and licenses for the images used in our example boxes." />

<div class="land">
	<Nav />
	<section class="credits">
		<h1>Cat photo credits</h1>
		<p class="lede">Every cat in the example boxes comes from Wikimedia Commons. Thank you to the people who photographed them.</p>
		<div class="cr-list">
			{#each CREDITS as [key, title, author, lic, url] (key)}
				<a class="cr" href={url} target="_blank" rel="noopener">
					<span class="cr-img" style={imgs[key] ? bg(imgs[key]) : ''}></span>
					<span class="cr-txt"><b>{title}</b><small>{author} — {lic}</small></span>{@html I.arrow('#9A9A9A', 14)}
				</a>
			{/each}
		</div>
	</section>
	<Footer />
</div>
