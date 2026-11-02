import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			// The `obsidian` package ships typings only; tests use a small stub.
			obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/live/**', 'node_modules/**'],
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
		// Unit tests must never reach the network or need a real API key.
		env: { FIELDY_API_KEY: '' },
	},
});
