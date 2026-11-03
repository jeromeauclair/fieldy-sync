import { describe, expect, it } from 'vitest';
import { FieldyError } from '../../src/utils/errors';
import { createTestClient, json, mockTransport, queryOf, sequenceTransport, TEST_API_KEY } from '../helpers/fakes';

const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	title: `Conversation ${id}`,
	summary: 'A summary',
	content: null,
	startTime: '2026-10-01T10:00:00.000Z',
	endTime: '2026-10-01T10:30:00.000Z',
	type: 'FULL',
	keywords: [],
	speakers: ['Alex'],
	memorySpeakers: ['Alex'],
	quotes: [],
	location: null,
	locationId: null,
	templateId: null,
	memoryTemplateId: null,
	recommendedTemplateIds: null,
	calendarEventId: null,
	updatedAt: '2026-10-01T11:00:00.000Z',
	...extra,
});

const segment = (id: string, timestamp: string, extra: Record<string, unknown> = {}) => ({
	id,
	text: `text ${id}`,
	timestamp,
	speaker: 'A',
	speakerProfileId: null,
	start: 0,
	end: 1,
	createdAt: null,
	source: 'live',
	recordingSource: 'wearable',
	...extra,
});

describe('FieldyClient request pipeline', () => {
	it('authenticates with a bearer token and sends JSON accept headers', async () => {
		const transport = sequenceTransport([json(200, { email: 'user@example.com' })]);
		const { client } = createTestClient(transport);
		await expect(client.getCurrentUser()).resolves.toEqual({ email: 'user@example.com' });
		expect(transport.calls).toHaveLength(1);
		const call = transport.calls[0]!;
		expect(call.url).toBe('https://api.fieldy.ai/api/public/v2/user/me');
		expect(call.method).toBe('GET');
		expect(call.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
		expect(call.headers.Accept).toBe('application/json');
	});

	it('fails fast without calling the API when no key is configured', async () => {
		const transport = sequenceTransport([json(200, { email: 'x' })]);
		const { client } = createTestClient(transport, { apiKey: null });
		await expect(client.getCurrentUser()).rejects.toMatchObject({ kind: 'missing-api-key' });
		expect(transport.calls).toHaveLength(0);
	});

	it('maps 401 to an unauthorized error without retrying and without leaking the key', async () => {
		const transport = sequenceTransport([
			json(401, { defined: false, code: 'UNAUTHORIZED', status: 401, message: `Bad key ${TEST_API_KEY} / Bearer ${TEST_API_KEY}` }),
		]);
		const { client } = createTestClient(transport);
		const error = (await client.getCurrentUser().catch((e: unknown) => e)) as FieldyError;
		expect(error).toBeInstanceOf(FieldyError);
		expect(error.kind).toBe('unauthorized');
		expect(error.status).toBe(401);
		expect(error.requestId).toBe('req-123');
		expect(transport.calls).toHaveLength(1);
		for (const text of [error.message, error.userMessage, String(error), JSON.stringify(error)]) {
			expect(text).not.toContain(TEST_API_KEY);
		}
		expect(error.userMessage).toMatch(/rejected the API key/);
	});

	it('maps 403, 404 and 400 to non-retryable errors', async () => {
		for (const [status, kind] of [
			[403, 'forbidden'],
			[404, 'not-found'],
			[400, 'bad-request'],
		] as const) {
			const transport = sequenceTransport([json(status, { code: 'X', message: 'nope' })]);
			const { client } = createTestClient(transport);
			await expect(client.getCurrentUser()).rejects.toMatchObject({ kind, status });
			expect(transport.calls).toHaveLength(1);
		}
	});

	it('retries 503 with exponential backoff and then succeeds', async () => {
		const transport = sequenceTransport([json(503, {}), json(503, {}), json(200, { email: 'ok@example.com' })]);
		const { client, clock } = createTestClient(transport);
		await expect(client.getCurrentUser()).resolves.toEqual({ email: 'ok@example.com' });
		expect(transport.calls).toHaveLength(3);
		// random() = 0.5 → 75% of the exponential delay (1 s, then 2 s).
		expect(clock.sleeps).toEqual([750, 1500]);
	});

	it('gives up on persistent server errors after the retry budget', async () => {
		const transport = sequenceTransport([json(502, {})]);
		const { client } = createTestClient(transport, { retry: { maxRetries: 2 } });
		await expect(client.getCurrentUser()).rejects.toMatchObject({ kind: 'server', status: 502 });
		expect(transport.calls).toHaveLength(3);
	});

	it('retries HTTP 500 only once, since Fieldy also uses it for invalid input', async () => {
		const transport = sequenceTransport([json(500, { code: 'INTERNAL_SERVER_ERROR' })]);
		const { client } = createTestClient(transport);
		await expect(client.getCurrentUser()).rejects.toMatchObject({ kind: 'server', status: 500 });
		expect(transport.calls).toHaveLength(2);
	});

	it('retries network failures and reports a network error when they persist', async () => {
		const transport = sequenceTransport([new Error('net::ERR_INTERNET_DISCONNECTED')]);
		const { client } = createTestClient(transport, { retry: { maxRetries: 1 } });
		const error = (await client.getCurrentUser().catch((e: unknown) => e)) as FieldyError;
		expect(error.kind).toBe('network');
		expect(error.userMessage).toMatch(/Could not reach Fieldy/);
		expect(transport.calls).toHaveLength(2);
	});

	it('honours Retry-After on 429 by cooling down the shared limiter', async () => {
		const transport = sequenceTransport([json(429, { code: 'TOO_MANY_REQUESTS' }, { 'Retry-After': '7' }), json(200, { email: 'a@b.c' })]);
		const { client, clock } = createTestClient(transport);
		const before = clock.now();
		await client.getCurrentUser();
		expect(transport.calls).toHaveLength(2);
		expect(clock.now() - before).toBeGreaterThanOrEqual(7_000);
	});

	it('waits the documented 60 s cooldown when a 429 has no Retry-After', async () => {
		const transport = sequenceTransport([json(429, {}), json(200, { email: 'a@b.c' })]);
		const { client, clock } = createTestClient(transport);
		const before = clock.now();
		await client.getCurrentUser();
		expect(clock.now() - before).toBeGreaterThanOrEqual(60_000);
	});

	it('reports rate limiting when 429 persists beyond the retry budget', async () => {
		const transport = sequenceTransport([json(429, {})]);
		const { client } = createTestClient(transport, { retry: { maxRetries: 1 } });
		await expect(client.getCurrentUser()).rejects.toMatchObject({ kind: 'rate-limited' });
	});

	it('treats invalid JSON and wrong envelopes as malformed responses without retrying', async () => {
		const bad = sequenceTransport([{ status: 200, headers: {}, text: '<html>oops</html>' }]);
		await expect(createTestClient(bad).client.getCurrentUser()).rejects.toMatchObject({ kind: 'malformed-response' });
		expect(bad.calls).toHaveLength(1);

		const envelope = sequenceTransport([json(200, { data: [] })]);
		await expect(createTestClient(envelope).client.listSpeakerProfiles()).rejects.toMatchObject({ kind: 'malformed-response' });
	});

	it('times out a hanging request', async () => {
		const transport = mockTransport(() => new Promise(() => undefined));
		const { client } = createTestClient(transport, { timeoutMs: 100, retry: { maxRetries: 0 } });
		await expect(client.getCurrentUser()).rejects.toMatchObject({ kind: 'timeout' });
	});

	it('does not send requests once cancelled, and stops while backing off', async () => {
		const controller = new AbortController();
		controller.abort();
		const transport = sequenceTransport([json(200, { email: 'x' })]);
		const { client } = createTestClient(transport);
		await expect(client.getCurrentUser({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
		expect(transport.calls).toHaveLength(0);

		const second = new AbortController();
		const failing = mockTransport(() => {
			second.abort();
			return json(503, {});
		});
		await expect(createTestClient(failing).client.getCurrentUser({ signal: second.signal })).rejects.toMatchObject({
			kind: 'cancelled',
		});
		expect(failing.calls).toHaveLength(1);
	});
});

describe('FieldyClient conversations', () => {
	it('follows cursors across pages with the maximum page size', async () => {
		const transport = mockTransport((req) => {
			const cursor = queryOf(req).get('cursor');
			if (!cursor) return json(200, { items: [conversation('c1'), conversation('c2')], nextCursor: 'p2' });
			if (cursor === 'p2') return json(200, { items: [conversation('c3')], nextCursor: 'p3' });
			return json(200, { items: [conversation('c4')], nextCursor: null });
		});
		const { client } = createTestClient(transport);
		const pages: number[] = [];
		const result = await client.listConversations(
			{ startTime: '2026-10-01T00:00:00.000Z', endTime: '2026-10-31T00:00:00.000Z' },
			{ onPage: (n) => pages.push(n) },
		);
		expect(result.items.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
		expect(pages).toEqual([2, 3, 4]);
		const q = queryOf(transport.calls[0]!);
		expect(q.get('pageSize')).toBe('50');
		expect(q.get('startTime')).toBe('2026-10-01T00:00:00.000Z');
		expect(q.has('cursor')).toBe(false);
		expect(q.has('recordingSource')).toBe(false);
	});

	it('stops on a repeated cursor and drops duplicate items', async () => {
		const transport = mockTransport((req) => {
			const cursor = queryOf(req).get('cursor');
			if (!cursor) return json(200, { items: [conversation('c1')], nextCursor: 'loop' });
			return json(200, { items: [conversation('c1'), conversation('c2')], nextCursor: 'loop' });
		});
		const { client } = createTestClient(transport);
		const result = await client.listConversations({ startTime: 'a', endTime: 'b' });
		expect(result.items.map((c) => c.id)).toEqual(['c1', 'c2']);
		expect(transport.calls).toHaveLength(2);
	});

	it('normalises deprecated aliases and skips items without identity fields', async () => {
		const transport = sequenceTransport([
			json(200, {
				items: [
					conversation('c1', { speakers: [], memorySpeakers: ['Old Alias'], templateId: null, memoryTemplateId: 'tpl-1' }),
					{ title: 'no id' },
					conversation('c2', { startTime: 'not a date' }),
				],
				nextCursor: null,
			}),
		]);
		const { client } = createTestClient(transport);
		const result = await client.listConversations({ startTime: 'a', endTime: 'b' });
		expect(result.skipped).toBe(2);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ speakers: ['Old Alias'], templateId: 'tpl-1', locked: false, recommendedTemplateIds: [] });
	});

	it('returns null for a conversation Fieldy does not know', async () => {
		const transport = sequenceTransport([{ status: 200, headers: {}, text: 'null' }]);
		const { client } = createTestClient(transport);
		await expect(client.getConversation('missing')).resolves.toBeNull();
		expect(transport.calls[0]!.url).toMatch(/\/conversations\/missing$/);
	});
});

describe('FieldyClient transcriptions', () => {
	it('collects all pages, deduplicates and orders segments by timestamp', async () => {
		const transport = mockTransport((req) => {
			const cursor = queryOf(req).get('cursor');
			if (!cursor) {
				return json(200, {
					items: [segment('s2', '2026-10-01T10:00:02.000Z'), segment('s1', '2026-10-01T10:00:01.000Z')],
					nextCursor: '2026-10-01T10:00:02.000Z|s2',
				});
			}
			return json(200, { items: [segment('s2', '2026-10-01T10:00:02.000Z'), segment('s3', '2026-10-01T10:00:03.000Z')], nextCursor: null });
		});
		const { client } = createTestClient(transport);
		const segments = await client.listTranscriptions({
			startTime: '2026-10-01T10:00:00.000Z',
			endTime: '2026-10-01T10:30:00.000Z',
			conversationId: 'c1',
		});
		expect(segments.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
		const q = queryOf(transport.calls[0]!);
		expect(q.get('conversationId')).toBe('c1');
		expect(q.get('pageSize')).toBe('1000');
		expect(q.get('order')).toBe('asc');
		expect(queryOf(transport.calls[1]!).get('cursor')).toBe('2026-10-01T10:00:02.000Z|s2');
	});

	it('falls back to the time range when Fieldy rejects the conversation id', async () => {
		const transport = mockTransport((req) =>
			queryOf(req).has('conversationId')
				? json(400, { code: 'BAD_REQUEST' })
				: json(200, { items: [segment('s1', '2026-10-01T10:00:01.000Z')], nextCursor: null }),
		);
		const { client } = createTestClient(transport);
		const segments = await client.listTranscriptions({ startTime: 'a', endTime: 'b', conversationId: 'legacy' });
		expect(segments).toHaveLength(1);
		expect(transport.calls).toHaveLength(2);
	});
});

describe('FieldyClient tasks, profiles and sharables', () => {
	it('requests each task status once and merges the results', async () => {
		const transport = mockTransport((req) => {
			const status = queryOf(req).get('status');
			return json(200, { items: [{ id: `t-${status}`, title: 'Do it', status, memoryId: 'c1', date: null }] });
		});
		const { client } = createTestClient(transport);
		const tasks = await client.listTasksByStatuses(['new', 'completed', 'new']);
		expect(transport.calls).toHaveLength(2);
		expect(tasks.map((t) => t.id).sort()).toEqual(['t-completed', 't-new']);
	});

	it('follows task page cursors and stops on a repeated cursor', async () => {
		const transport = mockTransport((req) => {
			const cursor = queryOf(req).get('cursor');
			if (!cursor) return json(200, { items: [{ id: 't1', title: 'A', status: 'new' }], nextCursor: 'p2' });
			if (cursor === 'p2') return json(200, { items: [{ id: 't2', title: 'B', status: 'new' }], nextCursor: 'p3' });
			return json(200, { items: [{ id: 't3', title: 'C', status: 'new' }], nextCursor: 'p3' });
		});
		const { client } = createTestClient(transport);
		expect((await client.listTasks('new')).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
		expect(transport.calls).toHaveLength(3);
	});

	it('sends only the changed task fields', async () => {
		const transport = sequenceTransport([json(200, { success: true, task: { id: 't1', title: 'New title', status: 'new' } })]);
		const { client } = createTestClient(transport);
		const task = await client.updateTask('t1', { title: 'New title', status: 'new' });
		expect(task?.title).toBe('New title');
		const call = transport.calls[0]!;
		expect(call.method).toBe('PATCH');
		expect(JSON.parse(call.body ?? '{}')).toEqual({ title: 'New title', status: 'new' });
	});

	it('marks a task completed with a JSON PATCH body', async () => {
		const transport = sequenceTransport([json(200, { success: true, task: { id: 't1', title: 'x', status: 'completed' } })]);
		const { client } = createTestClient(transport);
		const task = await client.completeTask('t1', '2026-10-02T00:00:00.000Z');
		expect(task?.status).toBe('completed');
		const call = transport.calls[0]!;
		expect(call.method).toBe('PATCH');
		expect(call.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(call.body ?? '{}')).toEqual({ status: 'completed', completionDate: '2026-10-02T00:00:00.000Z' });
	});

	it('creates a share link with a JSON POST body', async () => {
		const transport = sequenceTransport([json(200, { id: 's1', url: 'https://fieldy.ai/s/abc' })]);
		const { client } = createTestClient(transport);
		const link = await client.createSharable({ conversationId: 'c1', authorName: 'Alex', sharedFields: ['title', 'summary'] });
		expect(link).toEqual({ id: 's1', url: 'https://fieldy.ai/s/abc', enabled: true, authorName: 'Alex', sharedFields: ['title', 'summary'] });
		const call = transport.calls[0]!;
		expect(call.method).toBe('POST');
		expect(call.url).toContain('/sharables');
		expect(JSON.parse(call.body ?? '{}')).toEqual({ authorName: 'Alex', sharedFields: ['title', 'summary'], targetDocId: 'c1' });
	});

	it('turns a share link on or off with a PATCH', async () => {
		const transport = sequenceTransport([json(200, { id: 's1', url: 'https://fieldy.ai/s/abc', enabled: false, authorName: 'Alex', sharedFields: ['title'] })]);
		const { client } = createTestClient(transport);
		const link = await client.setSharableEnabled('s1', false);
		expect(link.enabled).toBe(false);
		const call = transport.calls[0]!;
		expect(call.method).toBe('PATCH');
		expect(call.url).toContain('/sharables/s1');
		expect(JSON.parse(call.body ?? '{}')).toEqual({ enabled: false });
	});

	it('rejects a share link creation without a usable link', async () => {
		const transport = sequenceTransport([json(200, { id: 's1', url: 'http://insecure' })]);
		const { client } = createTestClient(transport);
		await expect(client.createSharable({ conversationId: 'c1', authorName: 'Alex', sharedFields: [] })).rejects.toMatchObject({ kind: 'malformed-response' });
	});

	it('parses speaker profiles, templates and only https share links', async () => {
		const transport = mockTransport((req) => {
			if (req.url.includes('/speaker-profiles')) return json(200, { items: [{ id: 'p1', name: 'Alex', color: '#ff0000' }, { id: 'p2' }] });
			if (req.url.includes('/memory-templates')) {
				return json(200, {
					items: [{ id: 'm1', title: 'Sales call', emoji: null, description: null, prompt: 'Summarise', sections: [{ title: 'Next steps', prompt: 'List them' }, { bad: 1 }] }],
				});
			}
			return json(200, {
				items: [
					{ id: 's1', url: 'https://share.fieldy.ai/c/abc', enabled: true, authorName: 'A', sharedFields: ['summary'] },
					{ id: 's2', url: 'javascript:alert(1)', enabled: true, authorName: 'A', sharedFields: [] },
				],
			});
		});
		const { client } = createTestClient(transport);
		expect(await client.listSpeakerProfiles()).toEqual([{ id: 'p1', name: 'Alex', color: '#ff0000' }]);
		expect((await client.listMemoryTemplates())[0]).toMatchObject({
			title: 'Sales call',
			prompt: 'Summarise',
			sections: [{ title: 'Next steps', prompt: 'List them' }],
			updatedAt: null,
		});
		expect((await client.listSharables('c1')).map((s) => s.id)).toEqual(['s1']);
	});
});
