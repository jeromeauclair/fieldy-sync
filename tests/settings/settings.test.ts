import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, emailName, exceptionActive, sanitizeSettings, taskStatusesFor } from '../../src/settings/settings';
import { sanitizeSyncState } from '../../src/sync/SyncState';

describe('sanitizeSettings', () => {
	it('returns defaults for missing or invalid data', () => {
		expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
	});

	it('changes nothing in Fieldy by default (no share links, no task updates)', () => {
		expect(DEFAULT_SETTINGS.createShareLinks).toBe(false);
		expect(DEFAULT_SETTINGS.pushTaskCompletion).toBe(false);
	});

	it('clamps numbers and rejects unknown enum values', () => {
		const s = sanitizeSettings({
			syncWindowDays: -5,
			requestsPerMinute: 1000,
			requestTimeoutSeconds: '45',
			maxRetries: 99,
			transcriptFormat: 'karaoke',
			subfolders: 'year',
		});
		expect(s.syncWindowDays).toBe(1);
		expect(s.requestsPerMinute).toBe(95);
		expect(s.requestTimeoutSeconds).toBe(45);
		expect(s.maxRetries).toBe(10);
		expect(s.transcriptFormat).toBe(DEFAULT_SETTINGS.transcriptFormat);
		expect(s.subfolders).toBe('year');
	});

	it('keeps the end of temporary exceptions', () => {
		const s = sanitizeSettings({ privacyExceptions: [{ id: 'a', until: '2026-11-03T14:00:00.000Z' }, { id: 'b', until: 'not a date' }] });
		expect(s.privacyExceptions).toEqual([
			{ id: 'a', title: '', startTime: '', until: '2026-11-03T14:00:00.000Z' },
			{ id: 'b', title: '', startTime: '' },
		]);
		const [a, b] = s.privacyExceptions;
		expect(exceptionActive(a!, Date.parse('2026-11-03T13:59:00Z'))).toBe(true);
		expect(exceptionActive(a!, Date.parse('2026-11-03T14:00:00Z'))).toBe(false);
		expect(exceptionActive(b!, Date.parse('2030-01-01T00:00:00Z'))).toBe(true);
	});

	it('takes the name of an email for share links', () => {
		expect(emailName('alex.martin@example.com')).toBe('alex.martin');
		expect(emailName('alex+fieldy@example.com')).toBe('alex');
		expect(emailName('@example.com')).toBeNull();
	});

	it('validates the privacy and time settings', () => {
		const s = sanitizeSettings({
			privateKeywords: 42,
			privateSpeakers: 'Dr Martin',
			syncTimeRules: [{ op: 'and', days: [1, 2], from: '08:00', to: '18:00' }, 'junk'],
			privateTimeRules: 'not a list',
			deletePrivateNotes: 'yes',
			showPrivateTitles: true,
			privacyExceptions: [{ id: 'c1', title: 'Call', startTime: '2026-10-01T10:00:00Z' }, { id: 'c1' }, { title: 'no id' }, 'junk'],
		});
		expect(s.privacyExceptions).toEqual([{ id: 'c1', title: 'Call', startTime: '2026-10-01T10:00:00Z' }]);
		expect(s.privateKeywords).toBe('');
		expect(s.privateSpeakers).toBe('Dr Martin');
		expect(s.syncTimeRules).toEqual([{ op: 'and', days: [1, 2], from: '08:00', to: '18:00' }]);
		expect(s.privateTimeRules).toEqual([]);
		expect(s.deletePrivateNotes).toBe(false);
		expect(s.showPrivateTitles).toBe(true);
	});

	it('drops unknown keys, so a stray plaintext key is never kept or re-saved', () => {
		const s = sanitizeSettings({ apiKey: 'sk-fieldy-should-not-survive', apiKeySecretId: 'fieldy-api-key' }) as unknown as Record<string, unknown>;
		expect(s.apiKey).toBeUndefined();
		expect(JSON.stringify(s)).not.toContain('sk-fieldy');
		expect(s.apiKeySecretId).toBe('fieldy-api-key');
	});

	it('only accepts valid secret ids', () => {
		expect(sanitizeSettings({ apiKeySecretId: 'sk-fieldy-ABC' }).apiKeySecretId).toBe('');
		expect(sanitizeSettings({ apiKeySecretId: 'my-fieldy-key' }).apiKeySecretId).toBe('my-fieldy-key');
	});

	it('maps task options to API statuses', () => {
		expect(taskStatusesFor(DEFAULT_SETTINGS)).toEqual(['new', 'approved', 'completed']);
		expect(taskStatusesFor({ ...DEFAULT_SETTINGS, includeTasks: false })).toEqual([]);
		expect(taskStatusesFor({ ...DEFAULT_SETTINGS, includeCompletedTasks: false, includeDismissedTasks: true })).toEqual([
			'new',
			'approved',
			'rejected',
			'skipped',
			'cancelled',
			'expired',
		]);
	});
});

describe('sanitizeSyncState', () => {
	it('keeps valid records and drops corrupt ones', () => {
		const state = sanitizeSyncState({
			records: {
				good: { path: 'a.md', sourceHash: 'x', contentHash: 'y', syncedAt: 't', status: 'synced', title: 'A', startTime: 's' },
				bad: { path: 3 },
				weird: { path: 'b.md', sourceHash: 'x', contentHash: 'y', syncedAt: 't', status: 'exploded' },
			},
		});
		expect(Object.keys(state.records)).toEqual(['good']);
		expect(sanitizeSyncState(null).records).toEqual({});
	});
});
