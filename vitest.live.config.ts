import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// Live tests talk to the real Fieldy API with a development key taken from the
// FIELDY_API_KEY environment variable or a git-ignored `.env.local` file.
function loadLocalEnv(): Record<string, string> {
	const path = fileURLToPath(new URL('./.env.local', import.meta.url));
	if (!existsSync(path)) return {};
	const env: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
	}
	return env;
}

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/live/**/*.live.test.ts'],
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
		testTimeout: 120_000,
		env: { ...loadLocalEnv(), ...(process.env.FIELDY_API_KEY ? { FIELDY_API_KEY: process.env.FIELDY_API_KEY } : {}) },
	},
});
