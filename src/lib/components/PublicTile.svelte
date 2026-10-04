<script>
	import { tick, untrack } from 'svelte';
	import { Hydrate, Tiles, sizeOf, tileHref, titleOf } from '#lib/engine/tiles.js';
	import { unmountMap } from '#lib/engine/map.js';

	let { tile, context } = $props();
	const ctx = $derived({ ...context, size: sizeOf(tile, context.device) });
	const html = $derived(Tiles.render(tile, ctx));
	const classes = $derived(Tiles.classes(tile, ctx));
	const href = $derived(context.mode === 'view' ? tileHref(tile) : '');
	const mounted = $derived(context.mounted);
	const hydrationKey = $derived(html + (tile.type === 'map' ? JSON.stringify([tile.lat, tile.lon, tile.z]) : ''));

	function enhance(element) {
		// Read markup, not the whole box: another tile's update must not reset
		// a guestbook drawing, an audio recording, or a subscription form.
		const markup = hydrationKey;
		if (!mounted) return;
		let disposed = false;
		let cleanup;
		tick().then(() => {
			if (disposed) return;
			if (!markup) return;
			untrack(() => {
				const root = element.closest('.box-root');
				cleanup = Hydrate[tile.type]?.(element, tile, root);
			});
		});
		return () => { disposed = true; cleanup?.(); element._stopSay?.(); };
	}

	function lifecycle(element) {
		return () => unmountMap(element);
	}
</script>

<div class={classes} data-id={tile.id} data-key={tile.id} data-mobile-size={sizeOf(tile, 'm')} {@attach enhance} {@attach lifecycle}>
	{@html html}
	{#if href}<a class="tile-link" {href} target="_blank" rel="noopener noreferrer ugc" aria-label={tile.caption || titleOf(tile)}></a>{/if}
</div>
