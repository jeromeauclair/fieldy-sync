import { redactSecrets } from './redact';

export interface Logger {
	debug(message: string, ...details: unknown[]): void;
	warn(message: string, ...details: unknown[]): void;
	error(message: string, ...details: unknown[]): void;
}

const PREFIX = '[Fieldy Sync]';

function safeDetail(detail: unknown): string {
	if (detail instanceof Error) return redactSecrets(`${detail.name}: ${detail.message}`);
	if (typeof detail === 'string') return redactSecrets(detail);
	try {
		return redactSecrets(JSON.stringify(detail));
	} catch {
		return '[unserializable]';
	}
}

/**
 * Console logger that redacts secrets from every argument. Debug output is
 * only emitted when the user enables debug logging in the advanced settings.
 */
export function createLogger(isDebugEnabled: () => boolean): Logger {
	const format = (message: string, details: unknown[]) =>
		[PREFIX, redactSecrets(message), ...details.map(safeDetail)].join(' ');
	return {
		debug(message, ...details) {
			if (isDebugEnabled()) console.debug(format(message, details));
		},
		warn(message, ...details) {
			console.warn(format(message, details));
		},
		error(message, ...details) {
			console.error(format(message, details));
		},
	};
}

export const silentLogger: Logger = {
	debug: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};
