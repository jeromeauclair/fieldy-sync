import type { FieldyErrorKind } from './utils/errors';

type ConnectionStatus = 'unknown' | 'not-configured' | 'checking' | 'connected' | 'error';

/** What the plugin currently knows about its connection to Fieldy. */
export interface ConnectionState {
	status: ConnectionStatus;
	/** Account email, once a connection test succeeded. */
	email?: string;
	/** User-facing explanation for errors. */
	message?: string;
	/** ISO time of the last check or request that informed this state. */
	checkedAt?: string;
}

/** Error kinds that say something about the connection itself (not about one item). */
const CONNECTION_ERRORS: ReadonlySet<FieldyErrorKind> = new Set(['missing-api-key', 'unauthorized', 'forbidden', 'network', 'timeout', 'server', 'rate-limited']);

/**
 * Updates the connection state after any request outcome: success marks the
 * connection as working (keeping the known email); connection-level failures
 * mark it as failing; item-level failures (not found, malformed item...) say
 * nothing about the connection and leave it unchanged.
 */
export function nextConnectionState(
	current: ConnectionState,
	outcome: { ok: true; email?: string } | { ok: false; kind: string; message: string },
	nowIso: string,
): ConnectionState {
	if (outcome.ok) {
		return { status: 'connected', email: outcome.email ?? current.email, checkedAt: nowIso };
	}
	if (outcome.kind === 'missing-api-key') return { status: 'not-configured', message: outcome.message, checkedAt: nowIso };
	if (CONNECTION_ERRORS.has(outcome.kind as FieldyErrorKind)) {
		return { status: 'error', email: current.email, message: outcome.message, checkedAt: nowIso };
	}
	return current;
}

export function connectionLabel(state: ConnectionState): string {
	switch (state.status) {
		case 'connected':
			return state.email ? `Connected as ${state.email}` : 'Connected to Fieldy';
		case 'checking':
			return 'Checking the connection…';
		case 'not-configured':
			return 'Not connected: add your Fieldy API key in the settings';
		case 'error':
			return state.message ?? 'The connection to Fieldy failed';
		case 'unknown':
		default:
			return 'Connection not checked yet';
	}
}
