import { describe, expect, it } from 'vitest';
import { backoffDelay, parseRetryAfter, retryBudgetFor, type RetryPolicy } from '../../src/api/retry';
import { FieldyError } from '../../src/utils/errors';

const policy: RetryPolicy = { maxRetries: 4, baseDelayMs: 1_000, maxDelayMs: 8_000 };

describe('backoffDelay', () => {
	it('grows exponentially and stays within [50%, 100%] of the cap', () => {
		expect(backoffDelay(0, policy, () => 0)).toBe(500);
		expect(backoffDelay(0, policy, () => 1)).toBe(1_000);
		expect(backoffDelay(2, policy, () => 0)).toBe(2_000);
		expect(backoffDelay(2, policy, () => 1)).toBe(4_000);
	});

	it('never exceeds the maximum delay', () => {
		for (let attempt = 0; attempt < 20; attempt++) {
			expect(backoffDelay(attempt, policy, () => 0.999)).toBeLessThanOrEqual(policy.maxDelayMs);
		}
	});
});

describe('parseRetryAfter', () => {
	const now = Date.parse('2026-10-29T12:00:00Z');

	it('accepts delta seconds', () => {
		expect(parseRetryAfter('30', now)).toBe(30_000);
		expect(parseRetryAfter(' 1.5 ', now)).toBe(1_500);
	});

	it('accepts HTTP dates and never returns negative waits', () => {
		expect(parseRetryAfter('Thu, 29 Oct 2026 12:00:10 GMT', now)).toBe(10_000);
		expect(parseRetryAfter('Thu, 29 Oct 2026 11:00:00 GMT', now)).toBe(0);
	});

	it('ignores missing or invalid values', () => {
		expect(parseRetryAfter(undefined, now)).toBeUndefined();
		expect(parseRetryAfter('', now)).toBeUndefined();
		expect(parseRetryAfter('soon', now)).toBeUndefined();
	});
});

describe('retryBudgetFor', () => {
	it('retries transient failures and nothing else', () => {
		expect(retryBudgetFor(new FieldyError('network', 'x'), policy)).toBe(4);
		expect(retryBudgetFor(new FieldyError('timeout', 'x'), policy)).toBe(4);
		expect(retryBudgetFor(new FieldyError('rate-limited', 'x'), policy)).toBe(4);
		expect(retryBudgetFor(new FieldyError('server', 'x', { status: 503 }), policy)).toBe(4);
		expect(retryBudgetFor(new FieldyError('server', 'x', { status: 500 }), policy)).toBe(1);
		expect(retryBudgetFor(new FieldyError('unauthorized', 'x'), policy)).toBe(0);
		expect(retryBudgetFor(new FieldyError('malformed-response', 'x'), policy)).toBe(0);
	});
});
