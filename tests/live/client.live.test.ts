/*
 * Opt-in checks against the real Fieldy API (`npm run test:live`). They only
 * perform read-only GET requests and assert on structure, never on content.
 * Requires FIELDY_API_KEY (environment or git-ignored .env.local).
 */
import { describe, expect, it } from 'vitest';
import { FieldyClient } from '../../src/api/FieldyClient';
import { RateLimiter } from '../../src/api/rateLimiter';
import { systemClock } from '../../src/utils/async';
import { nodeTransport } from '../helpers/nodeTransport';

const apiKey = process.env.FIELDY_API_KEY ?? '';
const live = apiKey ? describe : describe.skip;

function client(key: string = apiKey): FieldyClient {
	return new FieldyClient({
		getApiKey: () => key,
		transport: nodeTransport,
		limiter: new RateLimiter(30, systemClock),
		timeoutMs: () => 30_000,
		retryPolicy: () => ({ maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000 }),
	});
}

const end = new Date();
const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);

live('Fieldy Public API (live, read-only)', () => {
	it('authenticates and returns the account email', async () => {
		const user = await client().getCurrentUser();
		expect(user.email).toMatch(/@/);
	});

	it('rejects an invalid key as unauthorized', async () => {
		await expect(client('sk-fieldy-invalid-live-test').getCurrentUser({ retries: 0 })).rejects.toMatchObject({ kind: 'unauthorized' });
	});

	it('lists conversations with valid identity fields and fetches their transcript', async () => {
		const c = client();
		const { items } = await c.listConversations({ startTime: start.toISOString(), endTime: end.toISOString() });
		for (const conversation of items) {
			expect(conversation.id).toBeTruthy();
			expect(Number.isNaN(Date.parse(conversation.startTime))).toBe(false);
		}
		expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
		const finished = items.find((i) => i.endTime);
		if (!finished) return;
		const segments = await c.listTranscriptions({
			startTime: finished.startTime,
			endTime: finished.endTime ?? end.toISOString(),
			conversationId: finished.id,
		});
		for (let i = 1; i < segments.length; i++) {
			expect(Date.parse(segments[i]!.timestamp)).toBeGreaterThanOrEqual(Date.parse(segments[i - 1]!.timestamp));
		}
		expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
		const again = await c.getConversation(finished.id);
		expect(again?.id).toBe(finished.id);
	});

	it('reads tasks, speaker profiles, templates and share links', async () => {
		const c = client();
		const tasks = await c.listTasksByStatuses(['new', 'completed']);
		for (const task of tasks) expect(['new', 'completed']).toContain(task.status);
		expect(Array.isArray(await c.listSpeakerProfiles())).toBe(true);
		expect(Array.isArray(await c.listMemoryTemplates())).toBe(true);
		await expect(c.getConversation('does-not-exist-fieldy-sync-test')).resolves.toBeNull();
	});
});
