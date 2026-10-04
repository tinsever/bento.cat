<script>
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { query } from '#lib/api.js';
	import { whenAuthed } from '#lib/auth.svelte.js';
	import { loginUrl } from '#lib/login-return.js';
	import { EditorView } from '#lib/engine/editor.js';
	import { catLogo } from '#lib/engine/util.js';

	let host = $state();
	let state = $state('wait');

	onMount(() => {
		let dispose = null, gone = false;
		const open = new URL(location.href).searchParams.get('open');
		whenAuthed().then(async me => {
			if (gone) return;
			if (!me?.signedIn) return goto(loginUrl(open), { replaceState: true });
			if (!me.box) return goto(loginUrl(open, true), { replaceState: true });
			const box = await query('boxes:mine').catch(() => null);
			if (gone) return;
			if (!box) { state = 'error'; return; }
			state = 'ready';
			// The editor owns this subtree; Svelte only hands it a node.
			// ?open=subscribers comes from the email about a new subscriber.
			if (open) replaceState('/edit', {});
			dispose = EditorView(host, box, { open });
		});
		return () => { gone = true; dispose?.(); };
	});
</script>

<svelte:head><title>Your box — bento.cat</title></svelte:head>

{#if state !== 'ready'}
	<div class="ed-wait">
		{@html catLogo(48, { live: true })}
		<p>{state === 'error' ? 'Couldn’t open your box. Refresh to try again.' : 'Opening your box…'}</p>
	</div>
{/if}
<div bind:this={host}></div>
