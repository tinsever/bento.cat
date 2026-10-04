<script>
	import { onMount } from 'svelte';
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import { watch } from '#lib/api.js';
	import PublicBox from '#lib/components/PublicBox.svelte';
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { bg } from '#lib/engine/tiles.js';
	import { plural } from '#lib/engine/util.js';

	let { data } = $props();
	let live = $state.raw(undefined);
	const boxes = $derived(live ?? data.boxes);

	// Miniatures: each card is the real box drawn at desktop size, then scaled to fit.
	const fit = el => {
		const ro = new ResizeObserver(() => el.style.setProperty('--s', el.clientWidth / 1240));
		ro.observe(el);
		return () => ro.disconnect();
	};

	onMount(() => watch('boxes:explore', {}, b => (live = b), () => {}));
</script>

<PageMeta title="Explore boxes — bento.cat" description="Discover personal pages filled with links, photos, music, and little obsessions. Find a box worth a sniff and borrow an idea or two." />

<div class="land">
	<Nav />
	<header class="xp-head"><h1>Boxes worth a sniff</h1><p class="lede">The most visited pages people made. Borrow an idea or two.</p></header>
	<div class="xp-grid">
		{#each boxes || [] as b (b.handle)}
			<a class="xp-card" href="/{b.handle}">
				<div class="xp-shot" aria-hidden="true" {@attach fit}><div class="xp-frame"><div class="xp-root"><PublicBox box={b} now={data.renderedAt} mode="static" responsive={false} /></div></div></div>
				<div class="xp-meta">
					{#if b.avatar}<span class="xp-av av-{b.avatarShape || 'circle'}" style={bg(b.avatar, b.avatarPos)}></span>{:else}<span class="xp-av empty">{(b.name || b.handle)[0].toUpperCase()}</span>{/if}
					<span class="xp-who"><b>{b.name || b.handle}</b><small>bento.cat/{b.handle}{#if b.demo}<span class="example-chip">Example</span>{/if}</small></span>
					<span class="xp-n tnum">{plural(b.tiles.filter(t => t.type !== 'section').length, 'tile')}</span>
				</div>
			</a>
		{/each}
	</div>
	<Footer />
</div>
