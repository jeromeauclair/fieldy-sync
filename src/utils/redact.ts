/**
 * Defence-in-depth redaction for anything that may reach logs, notices,
 * diagnostics or error messages. The plugin never intentionally includes the
 * API key in such text; this guards against accidental leaks (for example an
 * upstream error message that echoes a header).
 */

const SECRET_PATTERNS: RegExp[] = [
	// Fieldy keys: documented prefix `sk-fieldy-`, also issued as `sk-f-`.
	/\bsk-f(?:ieldy)?-[A-Za-z0-9_-]{6,}/g,
	// Generic `sk-` style keys.
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	// Authorization header values.
	/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const REDACTED = '[redacted]';

export function redactSecrets(text: string, knownSecrets: readonly (string | null | undefined)[] = []): string {
	let result = text;
	for (const secret of knownSecrets) {
		if (secret && secret.length >= 4) {
			result = result.split(secret).join(REDACTED);
		}
	}
	for (const pattern of SECRET_PATTERNS) {
		result = result.replace(pattern, (_match: string, bearer?: string) =>
			typeof bearer === 'string' && /^bearer$/i.test(bearer) ? `${bearer} ${REDACTED}` : REDACTED,
		);
	}
	return result;
}
