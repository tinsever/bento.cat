import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';

export default defineConfig({
	// Keep the existing formatting while adopting Vite+ lint checks.
	check: { fmt: false },
	fmt: { useTabs: true, singleQuote: true },
	lint: {
		jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
		rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
		ignorePatterns: ['convex/_generated/**']
	},
	plugins: lazyPlugins(() => [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter()
		})
	]),
	test: { include: ['tests/**/*.test.js'], environment: 'node', restoreMocks: true },
	// MapLibre's worker is an ES module.
	worker: { format: 'es' }
});
