import { describe, expect, it } from 'vitest';
import { connectionLabel, nextConnectionState, type ConnectionState } from '../../src/connection';

const NOW = '2026-10-30T10:00:00.000Z';

describe('nextConnectionState', () => {
	it('marks a successful request as connected and keeps the known email', () => {
		const current: ConnectionState = { status: 'error', email: 'a@b.c', message: 'x' };
		expect(nextConnectionState(current, { ok: true }, NOW)).toEqual({ status: 'connected', email: 'a@b.c', checkedAt: NOW });
		expect(nextConnectionState(current, { ok: true, email: 'new@b.c' }, NOW).email).toBe('new@b.c');
	});

	it('distinguishes a missing key from a failing connection', () => {
		const current: ConnectionState = { status: 'connected', email: 'a@b.c' };
		expect(nextConnectionState(current, { ok: false, kind: 'missing-api-key', message: 'No key' }, NOW).status).toBe('not-configured');
		expect(nextConnectionState(current, { ok: false, kind: 'unauthorized', message: 'Rejected' }, NOW)).toMatchObject({
			status: 'error',
			message: 'Rejected',
		});
		expect(nextConnectionState(current, { ok: false, kind: 'network', message: 'Offline' }, NOW).status).toBe('error');
	});

	it('ignores failures that concern a single item', () => {
		const current: ConnectionState = { status: 'connected', email: 'a@b.c' };
		expect(nextConnectionState(current, { ok: false, kind: 'not-found', message: 'Gone' }, NOW)).toBe(current);
		expect(nextConnectionState(current, { ok: false, kind: 'vault-write', message: 'Disk' }, NOW)).toBe(current);
	});
});

describe('connectionLabel', () => {
	it('describes every state in plain words', () => {
		expect(connectionLabel({ status: 'connected', email: 'a@b.c' })).toBe('Connected as a@b.c');
		expect(connectionLabel({ status: 'connected' })).toBe('Connected to Fieldy');
		expect(connectionLabel({ status: 'not-configured' })).toMatch(/add your Fieldy API key/);
		expect(connectionLabel({ status: 'error', message: 'Rejected' })).toBe('Rejected');
		expect(connectionLabel({ status: 'unknown' })).toMatch(/not checked/);
		expect(connectionLabel({ status: 'checking' })).toMatch(/Checking/);
	});
});
