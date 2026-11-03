import { describe, expect, it } from 'vitest';
import { PrivacyGuard, TranscriptCheckCache } from '../../src/privacy/PrivacyGuard';
import type { FieldySyncSettings } from '../../src/settings/settings';
import { SyncEngine } from '../../src/sync/SyncEngine';
import { emptySyncState, SyncState } from '../../src/sync/SyncState';
import { formatSyncSummary } from '../../src/ui/summary';
import { FakeFieldyApi } from '../helpers/fakeApi';
import { formatUtc, makeConversation, makeSegment, makeTask, testSettings } from '../helpers/fixtures';
import { MemoryNoteStore } from '../helpers/memoryStore';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function setup(overrides: Partial<FieldySyncSettings> = {}) {
	const api = new FakeFieldyApi();
	const store = new MemoryNoteStore();
	const state = new SyncState(emptySyncState(), async () => undefined);
	let settings = testSettings(overrides);
	const privacy = new PrivacyGuard({ settings: () => settings, client: api, cache: new TranscriptCheckCache(), now: () => NOW });
	const engine = new SyncEngine({ client: api, store, state, settings: () => settings, formatDate: formatUtc, now: () => NOW, privacy });
	const update = (changes: Partial<FieldySyncSettings>) => {
		settings = { ...settings, ...changes };
	};
	return { api, store, state, engine, update };
}

function seed(api: FakeFieldyApi) {
	api.conversations = [
		makeConversation('c1', { title: 'Kickoff with Acme', startTime: '2026-10-01T14:00:00.000Z' }),
		makeConversation('c2', { title: 'Visit to the doctor', startTime: '2026-10-02T09:00:00.000Z' }),
	];
	api.tasks = [makeTask('t1', 'c1'), makeTask('t2', 'c2', 'new', { title: 'Book the blood test' })];
}

describe('SyncEngine: privacy filters', () => {
	it('creates no note for a private conversation', async () => {
		const { api, store, engine } = setup({ privateKeywords: 'doctor' });
		seed(api);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ scanned: 2, created: 1, skippedPrivate: 1 });
		expect(store.paths()).toEqual(['Fieldy/2026-10-01 - Kickoff with Acme.md']);
		expect(store.paths().some((p) => store.note(p).body.includes('blood test'))).toBe(false);
		expect(formatSyncSummary(summary)).toContain('1 private');
	});

	it('keeps an earlier note as it is, no longer updated, and resumes when the filter goes', async () => {
		const { api, store, state, engine, update } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-02 - Visit to the doctor.md';
		const before = store.note(path).body;

		update({ privateKeywords: 'doctor' });
		api.conversations[1] = { ...api.conversations[1]!, summary: 'New summary from Fieldy.', updatedAt: '2026-10-03T00:00:00.000Z' };
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ skippedPrivate: 1, updated: 0 });
		expect(store.note(path).body).toBe(before);
		expect(state.get('c2')).toMatchObject({ status: 'private', privateReason: 'keyword "doctor"' });
		expect(state.privateNotes().map(([id]) => id)).toEqual(['c2']);

		update({ privateKeywords: '' });
		const again = await engine.run({ trigger: 'manual' });
		expect(again.counts.updated).toBe(1);
		expect(store.note(path).body).toContain('New summary from Fieldy.');
		expect(state.get('c2')?.status).toBe('synced');
	});

	it('moves the notes of private conversations to the trash when asked, and imports them again without the filter', async () => {
		const { api, store, state, engine, update } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-02 - Visit to the doctor.md';
		update({ privateKeywords: 'doctor', deletePrivateNotes: true });
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ skippedPrivate: 1, privateTrashed: 1 });
		expect(store.trashed).toEqual([path]);
		expect(state.get('c2')).toBeUndefined();
		expect(formatSyncSummary(summary)).toContain('1 note of private conversations moved to the trash');

		update({ privateKeywords: '' });
		const again = await engine.run({ trigger: 'manual' });
		expect(again.counts.created).toBe(1);
		expect(store.paths()).toContain(path);
	});

	it('checks transcripts only when asked, and reuses the transcript for the note', async () => {
		const { api, store, engine } = setup({ privateKeywords: 'salary', privacySearchTranscript: true });
		seed(api);
		api.transcripts.set('c1', [makeSegment('s1', '2026-10-01T14:00:05.000Z', 'Alex', 'Hello everyone.')]);
		api.transcripts.set('c2', [makeSegment('s2', '2026-10-02T09:00:05.000Z', 'Alex', 'Let us talk about your salary.')]);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, skippedPrivate: 1 });
		expect(store.paths()).toEqual(['Fieldy/2026-10-01 - Kickoff with Acme.md']);
		// One transcript request each: the one read for the check is written into the note.
		expect(api.calls.transcripts).toBe(2);
		expect(store.note('Fieldy/2026-10-01 - Kickoff with Acme.md').body).toContain('Hello everyone.');
		// Remembered: the next sync reads no transcript for unchanged conversations.
		await engine.run({ trigger: 'manual' });
		expect(api.calls.transcripts).toBe(2);
	});

	it('spends no request on conversations that would not be imported anyway', async () => {
		const { api, engine } = setup({ privateKeywords: 'salary', privacySearchTranscript: true, importNewOnSync: false });
		seed(api);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 0, skippedNew: 2 });
		expect(api.calls.transcripts).toBe(0);
	});

	it('writes nothing when the privacy check fails', async () => {
		const { api, store, engine } = setup({ privateKeywords: 'salary', privacySearchTranscript: true });
		seed(api);
		api.failTranscriptFor.add('c2');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, failed: 1 });
		expect(store.paths()).toEqual(['Fieldy/2026-10-01 - Kickoff with Acme.md']);
	});

	it('syncs a conversation made not private by hand, and freezes it again without the exception', async () => {
		const { api, store, state, engine, update } = setup({ privateKeywords: 'doctor', privacyExceptions: [{ id: 'c2', title: 'Visit to the doctor', startTime: '' }] });
		seed(api);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 2, skippedPrivate: 0 });
		expect(store.paths()).toContain('Fieldy/2026-10-02 - Visit to the doctor.md');
		update({ privacyExceptions: [] });
		await engine.run({ trigger: 'manual' });
		expect(state.get('c2')?.status).toBe('private');
	});

	it('refuses to restore the Fieldy version of a private conversation', async () => {
		const { api, engine, update, state } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		update({ privateSpeakers: 'Sam' });
		await expect(engine.restoreFieldyVersion('c1', 'overwrite')).rejects.toMatchObject({ kind: 'private' });
		expect(state.get('c1')?.status).toBe('private');
	});
});

describe('SyncEngine: sync times', () => {
	it('only syncs conversations that started in the sync times; imports are not limited', async () => {
		const { api, store, engine } = setup({ syncTimeRules: [{ op: 'or', days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' }] });
		api.conversations = [
			makeConversation('work', { title: 'Work', startTime: new Date(2026, 9, 26, 10, 0).toISOString(), endTime: new Date(2026, 9, 26, 10, 30).toISOString() }),
			makeConversation('evening', { title: 'Evening', startTime: new Date(2026, 9, 26, 20, 0).toISOString(), endTime: new Date(2026, 9, 26, 20, 30).toISOString() }),
			makeConversation('sunday', { title: 'Sunday', startTime: new Date(2026, 9, 25, 10, 0).toISOString(), endTime: new Date(2026, 9, 25, 10, 30).toISOString() }),
		];
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ scanned: 1, created: 1, skippedSchedule: 2 });
		expect(formatSyncSummary(summary)).toContain('2 outside your sync times');
		expect(store.paths()).toHaveLength(1);

		const sunday = api.conversations[2]!;
		await engine.run({ trigger: 'import', conversations: [sunday], onlyIds: new Set([sunday.id]), createNew: true });
		expect(store.paths()).toHaveLength(2);
	});

	it('uses private times like the other privacy filters', async () => {
		const { api, store, engine } = setup({ privateTimeRules: [{ op: 'or', days: [], from: '12:00', to: '13:00' }] });
		api.conversations = [
			makeConversation('lunch', { title: 'Lunch', startTime: new Date(2026, 9, 26, 12, 15).toISOString(), endTime: new Date(2026, 9, 26, 12, 45).toISOString() }),
			makeConversation('meeting', { title: 'Meeting', startTime: new Date(2026, 9, 26, 10, 0).toISOString(), endTime: new Date(2026, 9, 26, 10, 30).toISOString() }),
		];
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, skippedPrivate: 1 });
		expect(store.paths()[0]).toContain('Meeting');
	});
});
