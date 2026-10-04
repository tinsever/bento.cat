<script>
	import { SITE_IMAGE, schemaScript } from '#lib/seo.js';
	let { title, description, image = '', imageAlt = '', schema = null } = $props();
	const preview = $derived(image || SITE_IMAGE);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta name="twitter:card" content={image ? 'summary' : 'summary_large_image'} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta property="og:image" content={preview} />
	<meta property="og:image:alt" content={image ? imageAlt : 'bento.cat — A little box. A whole lot of you.'} />
	<meta name="twitter:image" content={preview} />
	<meta name="twitter:image:alt" content={image ? imageAlt : 'bento.cat — A little box. A whole lot of you.'} />
	{#if !image}
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:type" content="image/png" />
	{/if}
	{#if schema}{@html schemaScript(schema)}{/if}
</svelte:head>
