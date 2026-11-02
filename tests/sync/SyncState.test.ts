import { describe, expect, it } from 'vitest';
import { emptyCounts, mergeSyncState, sanitizeSyncState, type SyncRecord, type SyncStateData } from '../../src/sync/SyncState';

function record(path: string, syncedAt: string, overrides: Partial<SyncRecord> = {}): SyncRecord {
	return { path, title: path, startTime: '', sourceHash: 'a', contentHash: 'b', remoteUpdatedAt: null, syncedAt, status: 'synced', ...overrides };
}

function state(records: Record<string, SyncRecord>, finishedAt?: string): SyncStateData {
	return {
		version: 1,
		records,
		lastRun: finishedAt
			? { trigger: 'manual', startedAt: finishedAt, finishedAt, counts: emptyCounts(), cancelled: false, fatal: null, fatalKind: null, errors: [], createdIds: [], updatedIds: [] }
			: null,
	};
}

describe('mergeSyncState', () => {
	it('keeps records from both devices', () => {
		const merged = mergeSyncState(state({ a: record('A.md', '2026-10-01') }), state({ b: record('B.md', '2026-10-02') }));
		expect(Object.keys(merged.records).sort()).toEqual(['a', 'b']);
	});

	it('prefers the more recently synced record, and the local one on ties', () => {
		const local = state({ x: record('local.md', '2026-10-05'), y: record('local-y.md', '2026-10-01'), z: record('local-z.md', '2026-10-03') });
		const external = state({ x: record('ext.md', '2026-10-04'), y: record('ext-y.md', '2026-10-02'), z: record('ext-z.md', '2026-10-03') });
		const merged = mergeSyncState(local, external);
		expect(merged.records.x?.path).toBe('local.md');
		expect(merged.records.y?.path).toBe('ext-y.md');
		expect(merged.records.z?.path).toBe('local-z.md');
	});

	it('keeps the most recent run summary', () => {
		expect(mergeSyncState(state({}, '2026-10-01'), state({}, '2026-10-02')).lastRun?.finishedAt).toBe('2026-10-02');
		expect(mergeSyncState(state({}, '2026-10-03'), state({})).lastRun?.finishedAt).toBe('2026-10-03');
		expect(mergeSyncState(state({}), state({})).lastRun).toBeNull();
	});
});

describe('sanitizeSyncState run summary', () => {
	it('drops a malformed last run and fills missing counts', () => {
		expect(sanitizeSyncState({ lastRun: { finishedAt: 5 } }).lastRun).toBeNull();
		const run = sanitizeSyncState({ lastRun: { finishedAt: '2026-10-01', counts: { created: 2, bogus: 'x' }, errors: [{ message: 'm' }, 7] } }).lastRun;
		expect(run?.counts.created).toBe(2);
		expect(run?.counts.newlyEdited).toBe(0);
		expect(run?.errors).toEqual([{ id: '', title: '', kind: 'unknown', message: 'm' }]);
		expect(run?.fatalKind).toBeNull();
	});

	it('keeps a valid local modification time', () => {
		const s = sanitizeSyncState({ records: { a: { ...record('a.md', 't'), localMtime: 123 }, b: { ...record('b.md', 't'), localMtime: 'x' } } });
		expect(s.records.a?.localMtime).toBe(123);
		expect(s.records.b?.localMtime).toBeUndefined();
	});
});
