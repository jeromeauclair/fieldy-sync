import { describe, expect, it } from 'vitest';
import { describeError, FieldyError, isCancellation, toFieldyError, type FieldyErrorKind } from '../../src/utils/errors';
import { redactSecrets, REDACTED } from '../../src/utils/redact';

describe('redactSecrets', () => {
	it('removes Fieldy keys in both documented and issued formats', () => {
		const text = 'key sk-fieldy-abcdef1234567890 and sk-f-ZYXWVUTSRQPONMLKJIHG';
		const out = redactSecrets(text);
		expect(out).not.toMatch(/sk-f/);
		expect(out.split(REDACTED)).toHaveLength(3);
	});

	it('removes bearer tokens but keeps the scheme for context', () => {
		expect(redactSecrets('Authorization: Bearer abc.def-ghi_jkl')).toBe(`Authorization: Bearer ${REDACTED}`);
	});

	it('removes explicitly known secrets of any shape', () => {
		expect(redactSecrets('value=hunter2-secret!', ['hunter2-secret!'])).toBe(`value=${REDACTED}`);
	});

	it('leaves ordinary text alone', () => {
		expect(redactSecrets('Imported 3 conversations from sk-skiing trip')).toBe('Imported 3 conversations from sk-skiing trip');
	});
});

describe('FieldyError', () => {
	it('redacts secrets from technical messages', () => {
		const err = new FieldyError('unknown', 'boom sk-fieldy-0123456789abcdef');
		expect(err.message).not.toContain('sk-fieldy-0123');
	});

	it('has a clear user message for every kind', () => {
		const kinds: FieldyErrorKind[] = [
			'missing-api-key',
			'unauthorized',
			'forbidden',
			'not-found',
			'bad-request',
			'rate-limited',
			'network',
			'timeout',
			'server',
			'malformed-response',
			'cancelled',
			'vault-write',
			'filename-conflict',
			'locked',
			'busy',
			'unknown',
		];
		const messages = kinds.map((kind) => new FieldyError(kind, 'detail', { status: 503, timeoutMs: 30_000, path: 'Fieldy/a.md' }).userMessage);
		expect(new Set(messages).size).toBe(kinds.length);
		for (const message of messages) expect(message.length).toBeGreaterThan(10);
		expect(new FieldyError('timeout', 'x', { timeoutMs: 30_000 }).userMessage).toContain('30 seconds');
		expect(new FieldyError('server', 'x', { status: 503, requestId: 'r1' }).userMessage).toContain('request ID: r1');
	});

	it('converts arbitrary values', () => {
		expect(toFieldyError(new Error('x')).kind).toBe('unknown');
		const abort = new Error('aborted');
		abort.name = 'AbortError';
		expect(isCancellation(abort)).toBe(true);
		expect(toFieldyError(abort).kind).toBe('cancelled');
		expect(describeError('plain')).toContain('plain');
	});
});
