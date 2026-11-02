import type { FieldyError } from '../utils/errors';

export interface RetryPolicy {
	/** Retries after the first attempt (0 disables retrying). */
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 3,
	baseDelayMs: 1_000,
	maxDelayMs: 30_000,
};

/** Fieldy documents a 60 second cooldown after the rate limit is hit. */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

/**
 * Exponential backoff with "equal jitter": half the exponential delay is
 * fixed, half is random, so retries spread out without collapsing to zero.
 */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
	const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt));
	const half = exponential / 2;
	return Math.round(half + random() * half);
}

/** Parses a `Retry-After` header (delta seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed === '') return undefined;
	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		return Math.round(Number(trimmed) * 1000);
	}
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, date - nowMs);
}

/**
 * How many retries an error deserves. HTTP 500 is retried at most once
 * because Fieldy also uses it for some invalid inputs; gateway errors,
 * timeouts, network failures and 429s use the full policy.
 */
export function retryBudgetFor(err: FieldyError, policy: RetryPolicy): number {
	switch (err.kind) {
		case 'network':
		case 'timeout':
		case 'rate-limited':
			return policy.maxRetries;
		case 'server':
			return err.status === 500 ? Math.min(1, policy.maxRetries) : policy.maxRetries;
		default:
			return 0;
	}
}
