import { redactSecrets } from './redact';

export type FieldyErrorKind =
	| 'missing-api-key'
	| 'unauthorized'
	| 'forbidden'
	| 'not-found'
	| 'bad-request'
	| 'rate-limited'
	| 'network'
	| 'timeout'
	| 'server'
	| 'malformed-response'
	| 'cancelled'
	| 'vault-write'
	| 'filename-conflict'
	| 'locked'
	| 'busy'
	| 'unknown';

interface FieldyErrorOptions {
	status?: number;
	code?: string;
	requestId?: string;
	retryAfterMs?: number;
	timeoutMs?: number;
	path?: string;
	cause?: unknown;
}

/**
 * The single error type surfaced by the plugin. `message` is a technical,
 * redacted description for diagnostics; `userMessage` is safe to show in a
 * Notice or modal.
 */
export class FieldyError extends Error {
	readonly kind: FieldyErrorKind;
	readonly status?: number;
	readonly code?: string;
	readonly requestId?: string;
	readonly retryAfterMs?: number;
	readonly timeoutMs?: number;
	readonly path?: string;

	constructor(kind: FieldyErrorKind, message: string, options: FieldyErrorOptions = {}) {
		super(redactSecrets(message));
		this.name = 'FieldyError';
		this.kind = kind;
		this.status = options.status;
		this.code = options.code;
		this.requestId = options.requestId;
		this.retryAfterMs = options.retryAfterMs;
		this.timeoutMs = options.timeoutMs;
		this.path = options.path;
	}

	get userMessage(): string {
		return userMessageFor(this);
	}
}

function withRequestId(text: string, err: FieldyError): string {
	return err.requestId ? `${text} (request ID: ${err.requestId})` : text;
}

function userMessageFor(err: FieldyError): string {
	switch (err.kind) {
		case 'missing-api-key':
			return 'No Fieldy API key is configured. Open the Fieldy Sync settings and choose or create the secret that holds your API key.';
		case 'unauthorized':
			return withRequestId('Fieldy rejected the API key. Check that the key is correct and has not been revoked in the Fieldy app (Settings → Developer Settings).', err);
		case 'forbidden':
			return withRequestId('Fieldy refused access to this resource with the current API key.', err);
		case 'not-found':
			return withRequestId('The requested item no longer exists in Fieldy.', err);
		case 'bad-request':
			return withRequestId(`Fieldy rejected the request as invalid${err.status ? ` (HTTP ${err.status})` : ''}.`, err);
		case 'rate-limited':
			return 'Fieldy\'s rate limit was reached (100 requests per minute). Wait a minute and try again; scheduled syncs back off automatically.';
		case 'network':
			return 'Could not reach Fieldy. Check your internet connection and try again.';
		case 'timeout':
			return `Fieldy did not respond within ${Math.round((err.timeoutMs ?? 0) / 1000)} seconds. Try again later or increase the request timeout in the advanced settings.`;
		case 'server':
			return withRequestId(`Fieldy is temporarily unavailable${err.status ? ` (HTTP ${err.status})` : ''}. Try again later.`, err);
		case 'malformed-response':
			return withRequestId('Fieldy returned a response the plugin could not understand. The API may have changed; please report this issue.', err);
		case 'cancelled':
			return 'The operation was cancelled.';
		case 'vault-write':
			return `Could not write "${err.path ?? 'a note'}" in your vault: ${err.message}`;
		case 'filename-conflict':
			return `Could not find a free file name for "${err.path ?? 'a note'}".`;
		case 'locked':
			return 'This conversation is locked by your Fieldy plan\'s history window, so its content is not available. Your note was left unchanged.';
		case 'busy':
			return 'A Fieldy sync is already running. Try again when it finishes.';
		case 'unknown':
		default:
			return `Unexpected error: ${err.message}`;
	}
}

export function isCancellation(err: unknown): boolean {
	if (err instanceof FieldyError) return err.kind === 'cancelled';
	return err instanceof Error && err.name === 'AbortError';
}

export function toFieldyError(err: unknown): FieldyError {
	if (err instanceof FieldyError) return err;
	if (isCancellation(err)) return new FieldyError('cancelled', 'Cancelled');
	const message = err instanceof Error ? err.message : String(err);
	return new FieldyError('unknown', message);
}

/** A safe, user-facing message for any thrown value. */
export function describeError(err: unknown): string {
	return toFieldyError(err).userMessage;
}
