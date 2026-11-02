import { FieldyClient } from '../../src/api/FieldyClient';
import { RateLimiter } from '../../src/api/rateLimiter';
import type { RetryPolicy } from '../../src/api/retry';
import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/api/transport';
import { cancelledError, type Clock } from '../../src/utils/async';

/** Deterministic clock: `sleep` advances virtual time instantly. */
export class FakeClock implements Clock {
	time = 1_700_000_000_000;
	readonly sleeps: number[] = [];

	now(): number {
		return this.time;
	}

	async sleep(ms: number, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw cancelledError();
		this.sleeps.push(ms);
		this.time += ms;
		await Promise.resolve();
		if (signal?.aborted) throw cancelledError();
	}
}

export const TEST_API_KEY = 'sk-fieldy-TEST0000000000000000000000';

export function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
	return { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req-123', ...headers }, text: JSON.stringify(body) };
}

type Responder = (request: HttpRequest, index: number) => HttpResponse | Promise<HttpResponse>;

/** Records every request and answers with the given responder. */
export function mockTransport(responder: Responder): HttpTransport & { calls: HttpRequest[] } {
	const calls: HttpRequest[] = [];
	const transport = (async (request: HttpRequest) => {
		calls.push(request);
		return responder(request, calls.length - 1);
	}) as HttpTransport & { calls: HttpRequest[] };
	transport.calls = calls;
	return transport;
}

/** Answers a fixed sequence of responses (or thrown errors). */
export function sequenceTransport(steps: (HttpResponse | Error)[]): HttpTransport & { calls: HttpRequest[] } {
	return mockTransport((_req, index) => {
		const step = steps[Math.min(index, steps.length - 1)];
		if (step instanceof Error) throw step;
		if (!step) throw new Error('no response configured');
		return step;
	});
}

interface TestClientOptions {
	apiKey?: string | null;
	retry?: Partial<RetryPolicy>;
	timeoutMs?: number;
	limit?: number;
}

export function createTestClient(transport: HttpTransport, opts: TestClientOptions = {}) {
	const clock = new FakeClock();
	const limiter = new RateLimiter(opts.limit ?? 95, clock);
	const client = new FieldyClient({
		getApiKey: () => (opts.apiKey === undefined ? TEST_API_KEY : opts.apiKey),
		transport,
		limiter,
		clock,
		timeoutMs: () => opts.timeoutMs ?? 5_000,
		retryPolicy: () => ({ maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, ...opts.retry }),
		random: () => 0.5,
	});
	return { client, clock, limiter };
}

export function queryOf(request: HttpRequest): URLSearchParams {
	return new URL(request.url).searchParams;
}
