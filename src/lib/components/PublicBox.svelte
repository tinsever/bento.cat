<script>
	import { onMount } from 'svelte';
	import { avatarInner } from '#lib/engine/box.js';
	import { tileKey, tilesFor } from '#lib/engine/tiles.js';
	import PublicTile from './PublicTile.svelte';

	let { box, mode = 'view', now, cols = 0, noBio = false, responsive = true } = $props();
	let device = $state('d');
	let interactive = $state(false);
	let mounted = $state(false);
	const context = $derived({ mode, edit: false, device, box, now, interactive, mounted, key: tile => tileKey(box, tile) });
	const groups = $derived.by(() => {
		const groups = [{ id: '__first', heading: null, tiles: [] }];
		for (const tile of tilesFor(box, device)) {
			if (tile.draft) continue;
			if (tile.type === 'section') groups.push({ id: tile.id, heading: tile.text, tiles: [] });
			else groups.at(-1).tiles.push(tile);
		}
		return groups;
	});

	function enhance(root) {
		$effect(() => {
			root._box = box;
			root._mode = mode;
			root._device = device;
			root._cols = cols;
		});
	}

	onMount(() => {
		mounted = true;
		interactive = mode === 'view';
		if (!responsive) return;
		const media = matchMedia('(max-width: 759px)');
		const update = () => { device = media.matches ? 'm' : 'd'; };
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});
</script>

<div class="box-root public-box" class:view={mode === 'view'} class:static={mode === 'static'} class:dev-m={device === 'm'} class:responsive inert={mode === 'static'} style={cols ? `--fixed-cols:${cols}` : undefined} {@attach enhance}>
	{#each groups as group, index (group.id)}
		{#if group.heading !== null}
			<div class="section" data-id={group.id} data-key={group.id}><h2 class="sec-title">{group.heading}</h2></div>
		{/if}
		<div class="grid">
			{#if index === 0 && !noBio}
				<div class="bio" data-key="__bio">
					<div class="avatar shape-{box.avatarShape || 'circle'}" class:empty={!box.avatar}>{@html avatarInner(box)}</div>
					<div class="bio-text"><svelte:element this={mode === 'static' ? 'h2' : 'h1'} class="bio-name">{box.name || box.handle}</svelte:element>{#if box.bio}<p class="bio-line">{box.bio}</p>{/if}</div>
				</div>
			{/if}
			{#each group.tiles as tile (tile.id)}<PublicTile {tile} {context} />{/each}
		</div>
	{/each}
</div>
