import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'coverage',
		'docs',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'vitest.config.ts',
		'vitest.live.config.ts',
		'.claude',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			// Same options as the recommended config, plus the product names this plugin uses.
			'obsidianmd/ui/sentence-case': [
				'warn',
				{ enforceCamelCaseLower: true, brands: [...DEFAULT_BRANDS, 'Fieldy', 'Moment.js', 'Dataview', 'Google Maps', 'OpenStreetMap'] },
			],
		},
	},
	{
		// Tests run in Node with mocked Obsidian APIs.
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Test helpers run in Node, not in an Obsidian window.
			'obsidianmd/no-global-this': 'off',
			'@typescript-eslint/no-restricted-imports': 'off',
			'no-restricted-globals': 'off',
			// Fixture strings are test data, not UI text or config paths.
			'obsidianmd/ui/sentence-case': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
);
