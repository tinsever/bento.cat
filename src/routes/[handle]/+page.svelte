<script>
	import { onMount } from 'svelte';
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import { mutation, watch } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import PublicBox from '#lib/components/PublicBox.svelte';
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { profileMetadata, profileSchema } from '#lib/seo.js';
	import { Visitor } from '#lib/engine/state.js';
	import { Cat, I, catLogo } from '#lib/engine/util.js';

	let { data } = $props();

	let live = $state.raw(undefined);
	const box = $derived(live === undefined ? data.box : live);
	const own = $derived(!!box?.isOwner || (auth.me?.box && auth.me.box.handle === data.handle));
	const empty = $derived(box && !box.tiles.length);
	const metadata = $derived(profileMetadata(box || data.box));

	// Follow this box live. Runs again when you hop from one box to another.
	$effect(() => {
		const handle = data.handle;
		live = undefined;
		return watch('boxes:get', { handle, visitorKey: Visitor.key }, b => {
			Visitor.absorb(b);
			live = b;
		}, () => {});
	});

	// Public content refresh does not depend on optional statistics.
	let refreshed = '';
	$effect(() => {
		const id = box?._id;
		if (!id || refreshed === id) return;
		refreshed = id;
		mutation('interactions:refreshBox', { boxId: id }).catch(() => {});
	});

	// Signed-in people with a box show up in the owner's visitors unless they turned it
	// off in their page settings; the server checks that. Anonymous visitors send nothing.
	let counted = '';
	$effect(() => {
		const id = box?._id;
		if (!id || !auth.signedIn || own || counted === id) return;
		counted = id;
		mutation('interactions:visit', { boxId: id }).catch(() => {});
	});

	onMount(() => {
		const t = setTimeout(() => Cat.flash('wide', 1300), 500);
		return () => clearTimeout(t);
	});
</script>

<PageMeta {...metadata} imageAlt={box?.name || data.handle} schema={box ? profileSchema(box) : null} />

{#if box}
	<div class="pf">
		<header class="pf-top">
			<a class="pf-handle" href="/">{@html catLogo(26, { live: true })}<span>bento.cat/{box.handle}</span>{#if box.demo}<span class="example-chip" title="A made-up person, to show what a box can hold">Example box</span>{/if}</a>
			{#if own}<a class="btn btn-line" href="/edit">Back to editing</a>{:else}<a class="btn btn-line" href="/">Make your own box</a>{/if}
		</header>
		<main class="pf-main">
			<PublicBox {box} now={data.renderedAt} />
			{#if empty}
				<p class="pf-empty">Nothing in the box yet. {#if own}<a href="/edit">Put something in it.</a>{:else}Check back soon.{/if}</p>
			{/if}
		</main>
		<footer class="pf-foot">
			<div>{@html I.sleepyLoaf(38)}<span>{box.footer || 'That’s the whole box.'}</span></div>
			<nav class="pf-foot-links" aria-label="Site links">
				<a href="/privacy">Privacy</a>
				<a href="/terms">Terms</a>
				<a href="/imprint">Imprint</a>
				<a href="/">bento.cat</a>
			</nav>
		</footer>
	</div>
{:else}
	{@const state = data.status?.state}
	<div class="land">
		<Nav />
		<section class="empty-box">
			<svg class="ears" viewBox="0 0 280 196"><path d="M10 50 L26 6 L78 38 H202 L254 6 L270 50 V172 Q270 190 252 190 H28 Q10 190 10 172 Z" fill="none" stroke="#BDBDBD" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="6 6" /></svg>
			<h1>bento.cat/{data.handle}</h1>
			<p class="lede">
				{#if state === 'free'}An empty box. Nobody’s curled up in it yet.{:else if state === 'bad'}This one’s reserved for the cats who run the place, or it isn’t an address at all.{:else}Someone’s napping here, but they haven’t put anything out.{/if}
			</p>
			{#if state === 'free'}
				<a class="btn btn-dark lg" href="/login?claim={encodeURIComponent(data.handle)}">Claim it <span class="arr-up">↗</span></a>
			{:else}
				<a class="btn btn-line lg" href="/">Find your own spot</a>
			{/if}
		</section>
		<Footer />
	</div>
{/if}
