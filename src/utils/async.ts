import { FieldyError } from './errors';

export function cancelledError(): FieldyError {
	return new FieldyError('cancelled', 'Cancelled');
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw cancelledError();
}

/** Resolves after `ms`, or rejects with a cancellation error when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(cancelledError());
			return;
		}
		const onAbort = () => {
			window.clearTimeout(timer);
			reject(cancelledError());
		};
		const timer = window.setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, Math.max(0, ms));
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Races `promise` against a timeout and an abort signal. Obsidian's
 * `requestUrl` cannot be aborted, so on timeout or cancellation the underlying
 * request keeps running and its result is discarded.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(cancelledError());
			return;
		}
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			fn();
		};
		const onAbort = () => finish(() => reject(cancelledError()));
		const timer = window.setTimeout(
			() => finish(() => reject(new FieldyError('timeout', `Request timed out after ${timeoutMs} ms`, { timeoutMs }))),
			timeoutMs,
		);
		signal?.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => finish(() => resolve(value)),
			(err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
		);
	});
}

export interface Clock {
	now(): number;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	sleep,
};
