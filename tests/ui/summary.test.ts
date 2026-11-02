import { describe, expect, it } from 'vitest';
import { buildDiagnostics } from '../../src/diagnostics';
import { emptyCounts, emptySyncState, SyncState, type SyncRunSummary } from '../../src/sync/SyncState';
import { formatSyncSummary, shouldNotify, statusBarText } from '../../src/ui/summary';
import { testSettings } from '../helpers/fixtures';

function summary(overrides: Partial<SyncRunSummary['counts']> = {}, extra: Partial<SyncRunSummary> = {}): SyncRunSummary {
	return {
		trigger: 'manual',
		startedAt: '2026-10-29T12:00:00.000Z',
		finishedAt: '2026-10-29T12:01:00.000Z',
		counts: { ...emptyCounts(), ...overrides },
		cancelled: false,
		fatal: null,
		fatalKind: null,
		errors: [],
		createdIds: [],
		updatedIds: [],
		...extra,
	};
}

describe('formatSyncSummary', () => {
	it('reports real counts', () => {
		expect(formatSyncSummary(summary({ scanned: 10, created: 3, updated: 1, unchanged: 6 }))).toBe(
			'Fieldy sync complete: 3 new, 1 updated, 6 unchanged.',
		);
	});

	it('mentions edited notes, skips and failures', () => {
		const text = formatSyncSummary(
			summary(
				{ scanned: 5, unchanged: 1, skippedLocked: 2, edited: 1, failed: 1 },
				{ errors: [{ id: 'c', title: 'Standup', kind: 'server', message: 'Fieldy is temporarily unavailable.' }] },
			),
		);
		expect(text).toContain('Skipped: 2 locked by your Fieldy plan.');
		expect(text).toContain('1 edited note kept as you wrote it.');
		expect(text).not.toMatch(/conflict/i);
		expect(text).toContain('1 failed (first: Standup: Fieldy is temporarily unavailable.)');
	});

	it('handles empty, cancelled and fatal runs', () => {
		expect(formatSyncSummary(summary())).toBe('Fieldy sync complete: no conversations found in the sync window.');
		expect(formatSyncSummary(summary({ scanned: 4, unchanged: 2 }, { cancelled: true }))).toBe('Fieldy sync cancelled: 2 unchanged.');
		expect(formatSyncSummary(summary({}, { fatal: 'Could not reach Fieldy.' }))).toBe('Fieldy sync failed: Could not reach Fieldy.');
	});
});

describe('shouldNotify', () => {
	const quiet = summary({ scanned: 5, unchanged: 5 });
	const changed = summary({ scanned: 5, created: 1 });
	const broken = summary({ scanned: 5, failed: 1 });

	it('always notifies for manual runs', () => {
		expect(shouldNotify(quiet, false, 'errors')).toBe(true);
	});

	it('keeps automatic syncs quiet unless they matter', () => {
		expect(shouldNotify(quiet, true, 'changes')).toBe(false);
		expect(shouldNotify(changed, true, 'changes')).toBe(true);
		expect(shouldNotify(changed, true, 'errors')).toBe(false);
		expect(shouldNotify(broken, true, 'errors')).toBe(true);
		expect(shouldNotify(quiet, true, 'all')).toBe(true);
	});

	it('never notifies about edited notes on automatic syncs', () => {
		expect(shouldNotify(summary({ edited: 1, newlyEdited: 1 }), true, 'errors')).toBe(false);
		expect(shouldNotify(summary({ edited: 1, newlyEdited: 1 }), true, 'changes')).toBe(false);
		expect(formatSyncSummary(summary({ scanned: 3, unchanged: 1, edited: 2 }))).toBe('Fieldy sync complete: 1 unchanged. 2 edited notes kept as you wrote them.');
	});
});

describe('statusBarText', () => {
	it('summarises the last run', () => {
		expect(statusBarText(null, () => '')).toBe('Fieldy');
		expect(statusBarText(summary({ unchanged: 1 }), () => '12:01')).toBe('Fieldy: synced 12:01');
		expect(statusBarText(summary({ edited: 2 }), () => '12:01')).toBe('Fieldy: synced 12:01');
	});
});

describe('buildDiagnostics', () => {
	it('never contains the API key, the secret name, titles or note paths', () => {
		const key = 'sk-f-SECRETSECRETSECRETSECRET';
		const state = new SyncState(emptySyncState(), async () => undefined);
		state.lastRun = summary(
			{ failed: 2 },
			{
				fatal: 'Could not write "Fieldy/Private fatal.md"',
				fatalKind: 'vault-write',
				errors: [
					{ id: 'x', title: 'Divorce lawyer consult', kind: 'vault-write', message: `Could not write "Fieldy/2026-01-02 - Divorce lawyer consult.md": ${key}` },
					{ id: 'y', title: 'Other', kind: 'server', message: 'Fieldy is temporarily unavailable.' },
				],
			},
		);
		const text = buildDiagnostics({
			pluginVersion: '1.0.0',
			obsidianVersion: '1.14.4',
			platform: 'desktop',
			settings: testSettings({ apiKeySecretId: 'my-fieldy-secret' }),
			apiKeyConfigured: true,
			state,
			syncRunning: false,
			rateLimitPerMinute: 60,
			knownSecrets: [key],
		});
		expect(text).not.toContain(key);
		expect(text).not.toContain('my-fieldy-secret');
		expect(text).not.toContain('Divorce');
		expect(text).not.toContain('Private fatal');
		expect(text).toContain('error kinds: {"vault-write":1,"server":1}');
		expect(text).toContain('fatal: vault-write');
		expect(text).toContain('API key configured: yes');
		expect(text).toContain('"transcriptFormat"');
	});
});
