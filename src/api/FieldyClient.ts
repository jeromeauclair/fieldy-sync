import { systemClock, throwIfAborted, withTimeout, type Clock } from '../utils/async';
import { FieldyError, isCancellation } from '../utils/errors';
import { silentLogger, type Logger } from '../utils/logger';
import { redactSecrets } from '../utils/redact';
import { RateLimiter } from './rateLimiter';
import { backoffDelay, DEFAULT_RETRY_POLICY, parseRetryAfter, RATE_LIMIT_COOLDOWN_MS, retryBudgetFor, type RetryPolicy } from './retry';
import { getHeader, type HttpMethod, type HttpResponse, type HttpTransport } from './transport';
import {
	FIELDY_API_BASE_URL,
	type FieldyConversation,
	type FieldyMemoryTemplate,
	type FieldySharable,
	type FieldySpeakerProfile,
	type TaskChanges,
	type FieldyTask,
	type FieldyTranscriptSegment,
	type FieldyUser,
	type ListConversationsParams,
	type ListTranscriptionsParams,
	type Page,
	type TaskStatus,
} from './types';
import {
	malformed,
	parseConversation,
	parseMemoryTemplate,
	parsePage,
	parseSharable,
	parseSpeakerProfile,
	parseTask,
	parseTranscriptSegment,
	parseUser,
} from './validate';

const CONVERSATION_PAGE_SIZE = 50;
const TRANSCRIPT_PAGE_SIZE = 1000;
const MAX_CONVERSATION_PAGES = 2_000;
const MAX_TRANSCRIPT_PAGES = 500;
const MAX_LIST_PAGES = 200;

interface FieldyClientOptions {
	/** Reads the key from secret storage. Called for every request; never cached. */
	getApiKey: () => string | null;
	transport: HttpTransport;
	limiter: RateLimiter;
	clock?: Clock;
	baseUrl?: string;
	timeoutMs?: () => number;
	retryPolicy?: () => RetryPolicy;
	logger?: Logger;
	random?: () => number;
}

interface RequestOptions {
	signal?: AbortSignal;
	/** Overrides the retry policy's `maxRetries` for this call. */
	retries?: number;
}

type Query = Record<string, string | number | undefined>;

interface RequestSpec<T> {
	method: HttpMethod;
	path: string;
	query?: Query;
	body?: unknown;
	parse: (json: unknown) => T;
}

/**
 * Typed client for the Fieldy Public API v2. Every call goes through one
 * request pipeline that adds authentication, enforces the shared rate limit,
 * applies timeouts, retries transient failures with backoff and validates
 * the response shape.
 */
export class FieldyClient {
	private readonly baseUrl: string;
	private readonly clock: Clock;
	private readonly logger: Logger;
	private readonly random: () => number;

	constructor(private readonly options: FieldyClientOptions) {
		this.baseUrl = (options.baseUrl ?? FIELDY_API_BASE_URL).replace(/\/+$/, '');
		this.clock = options.clock ?? systemClock;
		this.logger = options.logger ?? silentLogger;
		this.random = options.random ?? Math.random;
	}

	// ---------------------------------------------------------------- user

	/** `GET /user/me`, the cheapest authenticated call. */
	getCurrentUser(options: RequestOptions = {}): Promise<FieldyUser> {
		return this.request({ method: 'GET', path: '/user/me', parse: parseUser }, options);
	}

	// ------------------------------------------------------- conversations

	listConversationsPage(params: ListConversationsParams, options: RequestOptions = {}): Promise<Page<FieldyConversation>> {
		return this.request(
			{
				method: 'GET',
				path: '/conversations',
				query: {
					startTime: params.startTime,
					endTime: params.endTime,
					mode: params.mode,
					cursor: params.cursor,
					pageSize: params.pageSize ?? CONVERSATION_PAGE_SIZE,
					recordingSource: params.recordingSource,
				},
				parse: (json) => parsePage(json, parseConversation, 'conversations'),
			},
			options,
		);
	}

	/**
	 * Iterates every conversation in a time range, page by page. Guards
	 * against cursor loops and duplicate items across pages.
	 */
	async *iterateConversations(
		params: Omit<ListConversationsParams, 'cursor'>,
		options: RequestOptions = {},
	): AsyncGenerator<Page<FieldyConversation>> {
		const seenIds = new Set<string>();
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		for (let pages = 1; pages <= MAX_CONVERSATION_PAGES; pages++) {
			const page = await this.listConversationsPage({ ...params, cursor }, options);
			const fresh = page.items.filter((c) => !seenIds.has(c.id));
			for (const c of fresh) seenIds.add(c.id);
			yield { ...page, items: fresh };
			const next = page.nextCursor;
			if (!next || seenCursors.has(next)) return;
			if (page.items.length > 0 && fresh.length === 0) {
				this.logger.warn('Conversation pagination made no progress; stopping.');
				return;
			}
			seenCursors.add(next);
			cursor = next;
		}
		this.logger.warn(`Stopped conversation pagination after ${MAX_CONVERSATION_PAGES} pages.`);
	}

	async listConversations(
		params: Omit<ListConversationsParams, 'cursor'>,
		options: RequestOptions & { onPage?: (loaded: number) => void } = {},
	): Promise<{ items: FieldyConversation[]; skipped: number }> {
		const items: FieldyConversation[] = [];
		let skipped = 0;
		for await (const page of this.iterateConversations(params, options)) {
			items.push(...page.items);
			skipped += page.skipped;
			options.onPage?.(items.length);
		}
		return { items, skipped };
	}

	/** `GET /conversations/{id}`; resolves to `null` when Fieldy has no such conversation. */
	getConversation(id: string, options: RequestOptions = {}): Promise<FieldyConversation | null> {
		return this.request(
			{
				method: 'GET',
				path: `/conversations/${encodeURIComponent(id)}`,
				parse: (json) => {
					if (json === null) return null;
					const conversation = parseConversation(json);
					if (!conversation) throw malformed('conversation is missing required fields');
					return conversation;
				},
			},
			options,
		);
	}

	// ------------------------------------------------------ transcriptions

	/**
	 * All transcript segments of a time range, ordered by timestamp. Passing
	 * the conversation id lets Fieldy resolve the conversation's recording
	 * source; if Fieldy rejects it, the range alone is used.
	 */
	async listTranscriptions(params: ListTranscriptionsParams, options: RequestOptions = {}): Promise<FieldyTranscriptSegment[]> {
		try {
			return await this.collectTranscriptions(params, options);
		} catch (err) {
			if (params.conversationId && err instanceof FieldyError && (err.kind === 'bad-request' || err.kind === 'not-found')) {
				this.logger.debug('Transcription lookup by conversation id was rejected; retrying by time range only.');
				return this.collectTranscriptions({ ...params, conversationId: undefined }, options);
			}
			throw err;
		}
	}

	private async collectTranscriptions(params: ListTranscriptionsParams, options: RequestOptions): Promise<FieldyTranscriptSegment[]> {
		const byId = new Map<string, FieldyTranscriptSegment>();
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		for (let pages = 1; pages <= MAX_TRANSCRIPT_PAGES; pages++) {
			const page = await this.request(
				{
					method: 'GET',
					path: '/transcriptions',
					query: {
						startTime: params.startTime,
						endTime: params.endTime,
						conversationId: params.conversationId,
						recordingSource: params.recordingSource,
						pageSize: TRANSCRIPT_PAGE_SIZE,
						order: 'asc',
						cursor,
					},
					parse: (json) => parsePage(json, parseTranscriptSegment, 'transcriptions'),
				},
				options,
			);
			let added = 0;
			for (const segment of page.items) {
				if (!byId.has(segment.id)) {
					byId.set(segment.id, segment);
					added++;
				}
			}
			const next = page.nextCursor;
			if (!next || seenCursors.has(next) || added === 0) break;
			seenCursors.add(next);
			cursor = next;
		}
		return [...byId.values()].sort(compareSegments);
	}

	// --------------------------------------------------------------- tasks

	listTasks(status: TaskStatus, options: RequestOptions = {}): Promise<FieldyTask[]> {
		return this.listAll('/tasks', { status }, (json) => parsePage(json, parseTask, 'tasks'), options);
	}

	/** Fetches tasks for several statuses (one request each; the endpoint requires a status). */
	async listTasksByStatuses(statuses: readonly TaskStatus[], options: RequestOptions = {}): Promise<FieldyTask[]> {
		const byId = new Map<string, FieldyTask>();
		for (const status of new Set(statuses)) {
			for (const task of await this.listTasks(status, options)) byId.set(task.id, task);
		}
		return [...byId.values()];
	}

	/** `PATCH /tasks/{id}` marking a task completed (the opt-in task push). */
	completeTask(id: string, completionDate: string, options: RequestOptions = {}): Promise<FieldyTask | null> {
		return this.updateTask(id, { status: 'completed', completionDate }, options);
	}

	/** `PATCH /tasks/{id}`: only the given fields change. Used when the user changes a task in the side panel. */
	updateTask(id: string, changes: TaskChanges, options: RequestOptions = {}): Promise<FieldyTask | null> {
		return this.request(
			{
				method: 'PATCH',
				path: `/tasks/${encodeURIComponent(id)}`,
				body: { ...changes },
				parse: (json) => {
					if (typeof json !== 'object' || json === null || (json as { success?: unknown }).success !== true) {
						throw malformed('task update did not report success');
					}
					return parseTask((json as { task?: unknown }).task);
				},
			},
			options,
		);
	}

	// ---------------------------------------------- profiles and templates

	listSpeakerProfiles(options: RequestOptions = {}): Promise<FieldySpeakerProfile[]> {
		return this.listAll('/speaker-profiles', {}, (json) => parsePage(json, parseSpeakerProfile, 'speaker profiles'), options);
	}

	listMemoryTemplates(options: RequestOptions = {}): Promise<FieldyMemoryTemplate[]> {
		return this.listAll('/memory-templates', {}, (json) => parsePage(json, parseMemoryTemplate, 'memory templates'), options);
	}

	/** Existing share links for a conversation (read-only). */
	listSharables(conversationId: string, options: RequestOptions = {}): Promise<FieldySharable[]> {
		return this.listAll('/sharables', { conversationId }, (json) => parsePage(json, parseSharable, 'sharables'), options);
	}

	/**
	 * Every item of a list endpoint. These answer in one response today; should
	 * Fieldy start paging them, the cursor is followed (with the same loop
	 * guards as conversations) instead of silently dropping later pages.
	 */
	private async listAll<T>(path: string, query: Query, parse: (json: unknown) => Page<T>, options: RequestOptions): Promise<T[]> {
		const items: T[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		for (let pages = 1; pages <= MAX_LIST_PAGES; pages++) {
			const page = await this.request({ method: 'GET', path, query: { ...query, cursor }, parse }, options);
			items.push(...page.items);
			const next = page.nextCursor;
			if (!next || seenCursors.has(next) || page.items.length === 0) return items;
			seenCursors.add(next);
			cursor = next;
		}
		this.logger.warn(`Stopped ${path} pagination after ${MAX_LIST_PAGES} pages.`);
		return items;
	}

	// ------------------------------------------------------------ pipeline

	private buildUrl(path: string, query?: Query): string {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== '') params.set(key, String(value));
		}
		const qs = params.toString();
		return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
	}

	private async request<T>(spec: RequestSpec<T>, options: RequestOptions): Promise<T> {
		const policy = this.options.retryPolicy?.() ?? DEFAULT_RETRY_POLICY;
		const maxRetries = Math.max(0, options.retries ?? policy.maxRetries);
		const effectivePolicy: RetryPolicy = { ...policy, maxRetries };
		const timeoutMs = Math.max(100, this.options.timeoutMs?.() ?? 30_000);
		const url = this.buildUrl(spec.path, spec.query);
		const label = `${spec.method} ${spec.path}`;

		for (let attempt = 0; ; attempt++) {
			throwIfAborted(options.signal);
			const apiKey = this.options.getApiKey();
			if (!apiKey) throw new FieldyError('missing-api-key', 'No API key configured');

			let error: FieldyError;
			try {
				await this.options.limiter.acquire(options.signal);
				const started = this.clock.now();
				const response = await withTimeout(
					this.options.transport({
						url,
						method: spec.method,
						headers: {
							Authorization: `Bearer ${apiKey}`,
							Accept: 'application/json',
							...(spec.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
						},
						body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
					}),
					timeoutMs,
					options.signal,
				);
				this.logger.debug(`${label} → ${response.status} (${this.clock.now() - started} ms)`);
				if (response.status >= 200 && response.status < 300) {
					return spec.parse(parseJson(response));
				}
				error = errorFromResponse(response, this.clock.now(), apiKey);
			} catch (err) {
				error = toTransportError(err, apiKey, timeoutMs);
			}

			if (error.kind === 'cancelled') throw error;
			if (attempt >= retryBudgetFor(error, effectivePolicy)) throw error;

			if (error.kind === 'rate-limited') {
				const wait = error.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS;
				this.logger.debug(`${label} rate limited; cooling down for ${wait} ms`);
				this.options.limiter.cooldown(wait);
			} else {
				const wait = backoffDelay(attempt, effectivePolicy, this.random);
				this.logger.debug(`${label} failed (${error.kind}); retry ${attempt + 1}/${maxRetries} in ${wait} ms`);
				await this.clock.sleep(wait, options.signal);
			}
		}
	}
}

function compareSegments(a: FieldyTranscriptSegment, b: FieldyTranscriptSegment): number {
	const ta = Date.parse(a.timestamp);
	const tb = Date.parse(b.timestamp);
	if (ta !== tb) return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
	return (a.start ?? 0) - (b.start ?? 0);
}

function parseJson(response: HttpResponse): unknown {
	const text = response.text.trim();
	if (text === '') return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new FieldyError('malformed-response', `Response from Fieldy was not valid JSON (HTTP ${response.status})`, {
			status: response.status,
			requestId: getHeader(response.headers, 'x-request-id'),
		});
	}
}

interface ErrorBody {
	code?: unknown;
	message?: unknown;
}

function errorFromResponse(response: HttpResponse, nowMs: number, apiKey: string): FieldyError {
	const status = response.status;
	const requestId = getHeader(response.headers, 'x-request-id');
	let body: ErrorBody = {};
	try {
		const parsed: unknown = JSON.parse(response.text);
		if (typeof parsed === 'object' && parsed !== null) body = parsed;
	} catch {
		// Non-JSON error bodies are summarised by status only.
	}
	const code = typeof body.code === 'string' ? body.code : undefined;
	const serverMessage = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
	const message = redactSecrets(`HTTP ${status}${code ? ` ${code}` : ''}${serverMessage ? `: ${serverMessage}` : ''}`, [apiKey]);
	const base = { status, code, requestId };

	if (status === 401) return new FieldyError('unauthorized', message, base);
	if (status === 403) return new FieldyError('forbidden', message, base);
	if (status === 404) return new FieldyError('not-found', message, base);
	if (status === 408) return new FieldyError('timeout', message, base);
	if (status === 429) {
		return new FieldyError('rate-limited', message, {
			...base,
			retryAfterMs: parseRetryAfter(getHeader(response.headers, 'retry-after'), nowMs),
		});
	}
	if (status >= 500) return new FieldyError('server', message, base);
	return new FieldyError('bad-request', message, base);
}

function toTransportError(err: unknown, apiKey: string, timeoutMs: number): FieldyError {
	if (err instanceof FieldyError) return err;
	if (isCancellation(err)) return new FieldyError('cancelled', 'Cancelled');
	const message = err instanceof Error ? err.message : String(err);
	if (/timed? ?out|ETIMEDOUT/i.test(message)) {
		return new FieldyError('timeout', redactSecrets(message, [apiKey]), { timeoutMs });
	}
	return new FieldyError('network', redactSecrets(`Network error: ${message}`, [apiKey]));
}
