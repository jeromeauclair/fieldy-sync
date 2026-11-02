import type { Clock } from '../utils/async';
import { throwIfAborted } from '../utils/async';

/** Fieldy allows 100 requests per 60 seconds per API key. */
const FIELDY_RATE_LIMIT = 100;
const FIELDY_RATE_WINDOW_MS = 60_000;
/** Never schedule more than this, leaving headroom for clock skew. */
export const MAX_REQUESTS_PER_MINUTE = FIELDY_RATE_LIMIT - 5;

/**
 * Sliding-window limiter shared by every request made with one API key. A
 * window of N requests per 60 s never exceeds Fieldy's limit, whether Fieldy
 * counts with a fixed or a sliding window. After a 429 the limiter blocks all
 * callers until the cooldown has elapsed.
 */
export class RateLimiter {
	private readonly sent: number[] = [];
	private blockedUntil = 0;
	private maxRequests: number;

	constructor(
		maxRequests: number,
		private readonly clock: Clock,
		private readonly windowMs: number = FIELDY_RATE_WINDOW_MS,
	) {
		this.maxRequests = RateLimiter.clampLimit(maxRequests);
	}

	static clampLimit(value: number): number {
		if (!Number.isFinite(value)) return 60;
		return Math.min(MAX_REQUESTS_PER_MINUTE, Math.max(1, Math.floor(value)));
	}

	setLimit(maxRequests: number): void {
		this.maxRequests = RateLimiter.clampLimit(maxRequests);
	}

	get limit(): number {
		return this.maxRequests;
	}

	/** Waits until a request may be sent, then records it. */
	async acquire(signal?: AbortSignal): Promise<void> {
		for (;;) {
			throwIfAborted(signal);
			const now = this.clock.now();
			while (this.sent.length > 0 && (this.sent[0] ?? 0) <= now - this.windowMs) {
				this.sent.shift();
			}
			if (this.blockedUntil > now) {
				await this.clock.sleep(this.blockedUntil - now, signal);
				continue;
			}
			if (this.sent.length < this.maxRequests) {
				this.sent.push(now);
				return;
			}
			const oldest = this.sent[0] ?? now;
			await this.clock.sleep(Math.max(1, oldest + this.windowMs - now), signal);
		}
	}

	/** Blocks all requests for `ms` (used after a 429 response). */
	cooldown(ms: number): void {
		this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + Math.max(0, ms));
	}

	/** Requests sent in the last 60 seconds. */
	get recentCount(): number {
		const now = this.clock.now();
		return this.sent.filter((t) => t > now - this.windowMs).length;
	}

	/** Milliseconds until the next request could be sent without waiting. */
	get waitTimeMs(): number {
		const now = this.clock.now();
		if (this.blockedUntil > now) return this.blockedUntil - now;
		const recent = this.sent.filter((t) => t > now - this.windowMs);
		if (recent.length < this.maxRequests) return 0;
		return (recent[0] ?? now) + this.windowMs - now;
	}
}
