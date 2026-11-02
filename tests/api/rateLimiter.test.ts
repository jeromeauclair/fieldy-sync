import { describe, expect, it } from 'vitest';
import { MAX_REQUESTS_PER_MINUTE, RateLimiter } from '../../src/api/rateLimiter';
import { FakeClock } from '../helpers/fakes';

describe('RateLimiter', () => {
	it('lets the configured number of requests through, then waits for the window', async () => {
		const clock = new FakeClock();
		const limiter = new RateLimiter(3, clock);
		const start = clock.now();
		for (let i = 0; i < 3; i++) await limiter.acquire();
		expect(clock.now()).toBe(start);
		await limiter.acquire();
		expect(clock.now() - start).toBe(60_000);
	});

	it('never allows more than the budget within any 60 s window', async () => {
		const clock = new FakeClock();
		const limiter = new RateLimiter(10, clock);
		const sentAt: number[] = [];
		for (let i = 0; i < 45; i++) {
			await limiter.acquire();
			sentAt.push(clock.now());
			clock.time += 700; // requests take time too
		}
		for (const t of sentAt) {
			const inWindow = sentAt.filter((s) => s >= t && s < t + 60_000).length;
			expect(inWindow).toBeLessThanOrEqual(10);
		}
	});

	it('blocks every caller during a cooldown', async () => {
		const clock = new FakeClock();
		const limiter = new RateLimiter(50, clock);
		await limiter.acquire();
		limiter.cooldown(60_000);
		expect(limiter.waitTimeMs).toBe(60_000);
		const before = clock.now();
		await limiter.acquire();
		expect(clock.now() - before).toBe(60_000);
	});

	it('clamps the budget below Fieldy\'s hard limit', () => {
		const clock = new FakeClock();
		expect(new RateLimiter(500, clock).limit).toBe(MAX_REQUESTS_PER_MINUTE);
		expect(new RateLimiter(0, clock).limit).toBe(1);
		expect(new RateLimiter(Number.NaN, clock).limit).toBe(60);
	});

	it('rejects with a cancellation error when aborted while waiting', async () => {
		const clock = new FakeClock();
		const limiter = new RateLimiter(1, clock);
		await limiter.acquire();
		const controller = new AbortController();
		controller.abort();
		await expect(limiter.acquire(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
	});

	it('counts the requests of the last minute', async () => {
		const clock = new FakeClock();
		const limiter = new RateLimiter(50, clock);
		await limiter.acquire();
		await limiter.acquire();
		expect(limiter.recentCount).toBe(2);
		clock.time += 30_000;
		await limiter.acquire();
		expect(limiter.recentCount).toBe(3);
		clock.time += 30_000;
		expect(limiter.recentCount).toBe(1);
	});
});
