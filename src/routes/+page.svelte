<script>
	import { onMount } from 'svelte';
	import Nav from '#lib/components/Nav.svelte';
	import Footer from '#lib/components/Footer.svelte';
	import ClaimForm from '#lib/components/ClaimForm.svelte';
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { SITE_DESCRIPTION, siteSchema } from '#lib/seo.js';
	import { watch } from '#lib/api.js';
	import PublicBox from '#lib/components/PublicBox.svelte';
	import { sz } from '#lib/engine/data.js';
	import { Visitor } from '#lib/engine/state.js';
	import { ALL_POSES, POSES, Tiles } from '#lib/engine/tiles.js';
	import { I } from '#lib/engine/util.js';

	const HERO = ['kola', 'note1', 'kn', 'purr1', 'music1'];
	const DEMO = { id: 'demo-kn', type: 'link', size: sz('loaf'), title: 'Kerning Notes', url: 'https://kerningnotes.co', icon: 'mail', preview: { kind: 'type', bg: '#DCE3D8', fg: '#1E2A1D', sub: '#3E4A3C', label: 'Issue 31', big: 'Ìyá' } };
	const ORDER = ['loaf', 'sprawl', 'tower', 'curl'];

	let { data } = $props();
	let liveMia = $state.raw(undefined);
	const mia = $derived(liveMia ?? data.mia);
	const heroBox = $derived(mia ? { ...mia, tiles: HERO.map(id => mia.tiles.find(t => t.id === id)).filter(Boolean) } : null);
	let pose = $state('loaf');
	let cycle;

	const ctxFor = size => ({ mode: 'static', edit: false, device: 'd', size, box: { handle: 'demo' }, key: () => 'demo' });
	const poseHtml = $derived(`<div class="${Tiles.classes(DEMO, ctxFor(pose))}">${Tiles.render(DEMO, ctxFor(pose))}</div>`);

	function pickPose(p) {
		clearInterval(cycle);
		pose = p;
	}

	onMount(() => {
		let i = 0;
		cycle = setInterval(() => (pose = ORDER[++i % ORDER.length]), 2600);
		const stop = watch('boxes:get', { handle: 'mia', visitorKey: Visitor.key }, box => {
			if (!box) return;
			Visitor.absorb(box);
			liveMia = box;
		}, () => {});
		return () => { clearInterval(cycle); stop(); };
	});
</script>

<PageMeta title="bento.cat — A little box. A whole lot of you." description={SITE_DESCRIPTION} schema={siteSchema} />

<div class="land">
	<Nav />
	<section class="hero">
		<div class="hero-l">
			<h1>A little box.<br />A whole lot<br />of you.</h1>
			<p class="lede">Your work, your links, your little obsessions. One personal page that feels like you.</p>
			<ClaimForm idle="Free to make. Yours to rearrange. No coding needed." />
		</div>
		<div class="hero-r">
			{#if mia}
				<a class="hero-link" href="/mia">bento.cat/mia {@html I.arrow('#161616', 12)}</a>
				<div class="hero-box"><PublicBox box={heroBox} now={data.renderedAt} cols={3} noBio responsive={false} /></div>
			{/if}
		</div>
	</section>
	<section class="home">
		<div class="home-l">
			<h2>Make yourself<br />at home.</h2>
			<p class="lede">Drop in a link. Add a photo. Give your favourite things a little more room. Just grab a tile and find its spot.</p>
			<div class="home-notes"><span>Looks good on mobile.</span><span>Saves as you go.</span></div>
		</div>
		<div class="pose-stage">
			<div class="pose-col">
				<div class="tb-pill demo">
					{#each ALL_POSES as p (p)}
						<button class="tb-b pose" class:on={pose === p} data-tip="{POSES[p].name}, {POSES[p].w} × {POSES[p].h}" aria-label={POSES[p].name} onclick={() => pickPose(p)}>{@html I[p](pose === p ? '#161616' : '#BDBDB8')}</button>
					{/each}
					<i class="tb-div"></i>
					<button class="tb-b" tabindex="-1" aria-hidden="true">{@html I.link('#fff', 16, 1.5)}</button>
					<button class="tb-b" tabindex="-1" aria-hidden="true">{@html I.crop()}</button>
					<i class="tb-div"></i>
					<span class="knock">{@html I.paw('#F4C9CF', 16)}<span>Knock off</span></span>
				</div>
				<div class="pose-card box-root static" data-pose={pose}>{@html poseHtml}</div>
			</div>
			<div class="pose-foot"><span>Small, tall, wide. Pick a pose.</span>{@html I.sleepyLoaf(40)}</div>
		</div>
	</section>
	<section class="cta">
		<div class="cta-l"><h2>The internet’s big.<br />Find your little spot.</h2><p class="lede sm">For what you make, love, and keep coming back to.</p></div>
		<div class="cta-r"><ClaimForm idle="An empty box. A fresh start. Make it yours." /></div>
	</section>
	<Footer />
</div>
