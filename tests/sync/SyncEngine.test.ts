import { describe, expect, it } from 'vitest';
import { parseManagedBlock } from '../../src/markdown/managedBlock';
import type { FieldySyncSettings } from '../../src/settings/settings';
import { isSyncPaused, SyncAlreadyRunningError, SyncEngine } from '../../src/sync/SyncEngine';
import { emptySyncState, SyncState } from '../../src/sync/SyncState';
import { shouldNotify } from '../../src/ui/summary';
import { FakeFieldyApi } from '../helpers/fakeApi';
import { formatUtc, makeConversation, makeSegment, makeTask, testSettings } from '../helpers/fixtures';
import { MemoryNoteStore } from '../helpers/memoryStore';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function setup(overrides: Partial<FieldySyncSettings> = {}) {
	const api = new FakeFieldyApi();
	const store = new MemoryNoteStore();
	let saves = 0;
	const state = new SyncState(emptySyncState(), async () => {
		saves++;
	});
	const settings = testSettings(overrides);
	const engine = new SyncEngine({ client: api, store, state, settings: () => settings, formatDate: formatUtc, now: () => NOW });
	return { api, store, state, settings, engine, saves: () => saves };
}

function seed(api: FakeFieldyApi) {
	api.conversations = [
		makeConversation('c1', { title: 'Kickoff with Acme', startTime: '2026-10-01T14:00:00.000Z' }),
		makeConversation('c2', { title: 'Design review', startTime: '2026-10-02T09:00:00.000Z', endTime: '2026-10-02T09:30:00.000Z' }),
	];
	api.transcripts.set('c1', [
		makeSegment('s1', '2026-10-01T14:00:05.000Z', 'Alex', 'Hello everyone.'),
		makeSegment('s2', '2026-10-01T14:00:09.000Z', 'Sam', 'Hi Alex.'),
	]);
	api.tasks = [makeTask('t1', 'c1', 'new', { title: 'Send the proposal' })];
}

function editInsideBlock(store: MemoryNoteStore, path: string, from: string, to: string) {
	const note = store.note(path);
	expect(note.body).toContain(from);
	note.body = note.body.replace(from, to);
}

describe('SyncEngine: creating notes', () => {
	it('creates one note per new conversation with identity frontmatter and a managed block', async () => {
		const { api, store, engine } = setup();
		seed(api);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ scanned: 2, created: 2, updated: 0, failed: 0 });
		expect(store.paths()).toEqual(['Fieldy/2026-10-01 - Kickoff with Acme.md', 'Fieldy/2026-10-02 - Design review.md']);
		const note = store.note('Fieldy/2026-10-01 - Kickoff with Acme.md');
		expect(note.frontmatter).toMatchObject({ fieldy_id: 'c1', fieldy_type: 'conversation', tags: ['fieldy'] });
		const parsed = parseManagedBlock(note.body);
		expect(parsed.status).toBe('ok');
		expect(note.body).toContain('# Kickoff with Acme');
		expect(note.body).toContain('- [ ] Send the proposal %%fieldy-task:t1%%');
		expect(note.body).toContain('**Alex:** Hello everyone.');
		expect(note.body.endsWith('%% fieldy:end %%\n\n')).toBe(true);
	});

	it('requests the configured window and recording source', async () => {
		const { api, engine } = setup({ syncWindowDays: 7, recordingSource: 'wearable' });
		await engine.run({ trigger: 'manual' });
		expect(api.lastListParams).toEqual({
			startTime: '2026-10-22T12:00:00.000Z',
			endTime: '2026-10-29T12:00:00.000Z',
			recordingSource: 'wearable',
		});
	});

	it('gives conversations with identical titles distinct file names', async () => {
		const { api, store, engine } = setup();
		api.conversations = [
			makeConversation('a', { title: 'Standup', startTime: '2026-10-05T09:00:00.000Z' }),
			makeConversation('b', { title: 'Standup', startTime: '2026-10-05T15:00:00.000Z' }),
		];
		await engine.run({ trigger: 'manual' });
		expect(store.paths()).toEqual(['Fieldy/2026-10-05 - Standup (2).md', 'Fieldy/2026-10-05 - Standup.md']);
	});

	it('never overwrites an unrelated file that already has the target name', async () => {
		const { api, store, engine } = setup();
		api.conversations = [makeConversation('a', { title: 'Notes', startTime: '2026-10-05T09:00:00.000Z' })];
		store.addNote('Fieldy/2026-10-05 - Notes.md', { tags: ['mine'] }, 'My own note');
		await engine.run({ trigger: 'manual' });
		expect(store.note('Fieldy/2026-10-05 - Notes.md').body).toBe('My own note');
		expect(store.notes.has('Fieldy/2026-10-05 - Notes (2).md')).toBe(true);
	});

	it('honours the subfolder setting and destination override', async () => {
		const { api, store, engine } = setup({ subfolders: 'month' });
		api.conversations = [makeConversation('a', { title: 'One', startTime: '2026-10-05T09:00:00.000Z' })];
		await engine.run({ trigger: 'import', folder: 'Work/Fieldy' });
		expect(store.paths()).toEqual(['Work/Fieldy/2026/2026-10/2026-10-05 - One.md']);
	});

	it('skips new conversations when importing new ones is disabled', async () => {
		const { api, store, engine } = setup({ importNewOnSync: false });
		seed(api);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedNew).toBe(2);
		expect(store.paths()).toEqual([]);
	});

	it('skips brief conversations when configured, unless explicitly selected', async () => {
		const { api, store, engine } = setup({ includeBrief: false });
		api.conversations = [makeConversation('a', { type: 'BRIEF' }), makeConversation('b', { title: 'Full one' })];
		await engine.run({ trigger: 'manual' });
		expect(store.paths()).toHaveLength(1);
		await engine.run({ trigger: 'import', onlyIds: new Set(['a']) });
		expect(store.paths()).toHaveLength(2);
	});

	it('does not import conversations locked by the Fieldy plan', async () => {
		const { api, store, engine } = setup();
		api.conversations = [makeConversation('a', { locked: true, summary: null })];
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedLocked).toBe(1);
		expect(store.paths()).toEqual([]);
	});
});

describe('SyncEngine: idempotency and duplicate prevention', () => {
	it('makes no writes and no transcript requests when nothing changed', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const writes = store.totalWrites();
		const transcriptCalls = api.calls.transcripts;
		const before = new Map([...store.notes].map(([p, n]) => [p, JSON.stringify(n)]));

		const second = await engine.run({ trigger: 'manual' });
		const third = await engine.run({ trigger: 'interval' });
		expect(second.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2, edited: 0 });
		expect(third.counts.unchanged).toBe(2);
		expect(store.totalWrites()).toBe(writes);
		expect(api.calls.transcripts).toBe(transcriptCalls);
		expect(new Map([...store.notes].map(([p, n]) => [p, JSON.stringify(n)]))).toEqual(before);
	});

	it('stays duplicate-free and write-free after the sync index is reset', async () => {
		const { api, store, state, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const writes = store.totalWrites();
		state.clear();
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
		expect(store.paths()).toHaveLength(2);
		expect(store.totalWrites()).toBe(writes);
		expect(state.get('c1')?.status).toBe('synced');
	});

	it('finds renamed and moved notes by fieldy_id and updates them in place', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		store.rename('Fieldy/2026-10-01 - Kickoff with Acme.md', 'Clients/Acme/Kickoff.md');
		api.conversations[0]!.summary = 'A revised summary.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 0, updated: 1 });
		expect(store.paths()).toEqual(['Clients/Acme/Kickoff.md', 'Fieldy/2026-10-02 - Design review.md']);
		expect(store.note('Clients/Acme/Kickoff.md').body).toContain('A revised summary.');
	});

	it('never creates another note when several notes share a fieldy_id', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const original = store.note('Fieldy/2026-10-01 - Kickoff with Acme.md');
		store.addNote('Copies/Kickoff copy.md', original.frontmatter, original.body);
		const summary = await engine.run({ trigger: 'manual', force: true });
		expect(summary.counts.duplicates).toBe(1);
		expect(summary.counts.created).toBe(0);
		expect(store.paths()).toHaveLength(3);
	});

	it('does not re-create notes the user deleted, unless asked to', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		store.notes.delete('Fieldy/2026-10-01 - Kickoff with Acme.md');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedDeleted).toBe(1);
		expect(store.paths()).toHaveLength(1);

		const reimport = await engine.run({ trigger: 'import', onlyIds: new Set(['c1']), recreateDeleted: true });
		expect(reimport.counts.created).toBe(1);
		expect(store.paths()).toHaveLength(2);
	});
});

describe('SyncEngine: marker format', () => {
	const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';

	it('writes short markers and keeps the block hash and fingerprint in properties', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const note = store.note(path);
		expect(note.body.startsWith('%% fieldy:begin %%\n')).toBe(true);
		expect(note.frontmatter?.fieldy_hash).toMatch(/^[0-9a-f]{14}$/);
		expect(note.frontmatter?.fieldy_src).toMatch(/^[0-9a-f]+$/);
		const firstHash = note.frontmatter?.fieldy_hash;

		// Updating the managed properties never drops them.
		api.conversations[0]!.title = 'Renamed in Fieldy';
		await engine.run({ trigger: 'manual' });
		const updated = store.note(path);
		expect(updated.frontmatter?.fieldy_hash).toMatch(/^[0-9a-f]{14}$/);
		expect(updated.frontmatter?.fieldy_hash).not.toBe(firstHash);
	});
});

describe('SyncEngine: updates and protection of user edits', () => {
	it('updates the managed block when Fieldy changes, keeping user text and properties', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		const note = store.note(path);
		note.body = `Intro written by me.\n\n${note.body}## My notes\n\nFollow up next week.\n`;
		note.frontmatter = { ...note.frontmatter, tags: ['fieldy', 'client/acme'], rating: 5 };

		api.conversations[0]!.summary = 'Updated summary from Fieldy.';
		api.conversations[0]!.title = 'Kickoff with Acme Corp';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ updated: 1, unchanged: 1, edited: 0 });
		const updated = store.note(path);
		expect(updated.body.startsWith('Intro written by me.\n\n%% fieldy:begin')).toBe(true);
		expect(updated.body).toContain('Updated summary from Fieldy.');
		expect(updated.body).toContain('# Kickoff with Acme Corp');
		expect(updated.body.endsWith('## My notes\n\nFollow up next week.\n')).toBe(true);
		expect(updated.frontmatter).toMatchObject({ tags: ['fieldy', 'client/acme'], rating: 5, fieldy_id: 'c1' });
		// The file keeps its original name even though the title changed.
		expect(store.notes.has(path)).toBe(true);
	});

	it('turns a note edited inside the managed block into the user version and never updates it', async () => {
		const { api, store, state, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, 'Summary of c1.', 'Summary of c1, corrected by me.');
		const before = JSON.stringify(store.note(path));

		api.conversations[0]!.summary = 'Fieldy rewrote the summary.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ edited: 1, newlyEdited: 1, updated: 0 });
		expect(JSON.stringify(store.note(path))).toBe(before);
		expect(state.get('c1')).toMatchObject({ status: 'edited' });
		expect(state.edited()).toHaveLength(1);

		// Later syncs leave it alone, without even reading it again, and do not report it as new.
		const reads = store.reads;
		api.conversations[0]!.summary = 'Fieldy changed it again.';
		const again = await engine.run({ trigger: 'manual' });
		expect(again.counts).toMatchObject({ edited: 1, newlyEdited: 0, updated: 0 });
		expect(store.reads).toBe(reads);
		expect(JSON.stringify(store.note(path))).toBe(before);
	});

	it('recognises an edit even when Fieldy has nothing new, without writing anything', async () => {
		const { api, store, state, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, 'Summary of c1.', 'My better summary.');
		const writes = store.totalWrites();
		const summary = await engine.run({ trigger: 'manual', force: false });
		expect(summary.counts).toMatchObject({ edited: 1, newlyEdited: 1 });
		expect(state.get('c1')?.status).toBe('edited');
		expect(store.totalWrites()).toBe(writes);
		expect(store.note(path).body).toContain('My better summary.');
	});

	it('resumes updates when the user undoes their edits', async () => {
		const { api, store, state, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, 'Summary of c1.', 'Temporary edit.');
		await engine.run({ trigger: 'manual' });
		expect(state.get('c1')?.status).toBe('edited');

		editInsideBlock(store, path, 'Temporary edit.', 'Summary of c1.');
		api.conversations[0]!.summary = 'Fresh from Fieldy.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ updated: 1, edited: 0 });
		expect(state.get('c1')?.status).toBe('synced');
		expect(store.note(path).body).toContain('Fresh from Fieldy.');
	});

	it('does not treat ticking a task as an edit, and keeps the tick on update', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, '- [ ] Send the proposal', '- [x] Send the proposal');
		api.conversations[0]!.summary = 'New summary.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ updated: 1, edited: 0 });
		expect(store.note(path).body).toContain('- [x] Send the proposal %%fieldy-task:t1%%');
		expect(store.note(path).body).toContain('New summary.');
	});

	it('treats removed markers as an edited note instead of rewriting it', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		const note = store.note(path);
		note.body = note.body.replace(/^%% fieldy:(begin|end).*$/gm, '');
		const before = note.body;
		api.conversations[0]!.summary = 'Changed.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.edited).toBe(1);
		expect(store.note(path).body).toBe(before);
	});

	it('aborts the write if the note is edited while the sync is running', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		api.conversations[0]!.summary = 'Remote change.';
		store.beforeProcessBody = (p, note) => {
			if (p === path) note.body = note.body.replace('Summary of c1.', 'Typed during sync.');
		};
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.edited).toBe(1);
		expect(store.note(path).body).toContain('Typed during sync.');
		expect(store.note(path).body).not.toContain('Remote change.');
	});

	it('skips notes the user paused with fieldy_sync: false', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		store.note(path).frontmatter!.fieldy_sync = false;
		api.conversations[0]!.summary = 'Changed.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedPaused).toBe(1);
		expect(store.note(path).body).not.toContain('Changed.');
	});

	it('never replaces content with a plan-locked version', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		const before = store.note(path).body;
		api.conversations[0]!.locked = true;
		api.conversations[0]!.summary = null;
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedLocked).toBe(1);
		expect(store.note(path).body).toBe(before);
	});

	it('re-renders unedited notes when render settings change', async () => {
		const { api, store, settings, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		settings.transcriptFormat = 'paragraphs';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.updated).toBe(2);
		expect(summary.updatedIds.sort()).toEqual(['c1', 'c2']);
		expect(summary.createdIds).toEqual([]);
		expect(store.note('Fieldy/2026-10-01 - Kickoff with Acme.md').body).toContain('**Alex**\n\nHello everyone.');
	});

	it('is idempotent even when forced', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const writes = store.totalWrites();
		const summary = await engine.run({ trigger: 'refresh', force: true });
		expect(summary.counts.unchanged).toBe(2);
		expect(store.totalWrites()).toBe(writes);
	});
});

describe('SyncEngine: failures, cancellation and concurrency', () => {
	it('isolates a failing conversation and retries it on the next run', async () => {
		const { api, store, engine } = setup();
		seed(api);
		api.failTranscriptFor.add('c1');
		const first = await engine.run({ trigger: 'manual' });
		expect(first.counts).toMatchObject({ created: 1, failed: 1 });
		expect(first.errors[0]).toMatchObject({ id: 'c1', title: 'Kickoff with Acme' });
		expect(first.errors[0]!.message).toMatch(/temporarily unavailable/);

		api.failTranscriptFor.clear();
		const second = await engine.run({ trigger: 'manual' });
		expect(second.counts).toMatchObject({ created: 1, failed: 0, unchanged: 1 });
		expect(store.paths()).toHaveLength(2);
	});

	it('reports vault write failures per note', async () => {
		const { api, store, engine } = setup();
		seed(api);
		store.failCreate = (path) => path.includes('Design review');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, failed: 1 });
		expect(summary.errors[0]!.message).toContain('Could not write');
	});

	it('reports a fatal error when the conversation list cannot be loaded', async () => {
		const { api, engine } = setup();
		api.listConversations = async () => {
			throw new (await import('../../src/utils/errors')).FieldyError('unauthorized', 'HTTP 401');
		};
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.fatal).toMatch(/rejected the API key/);
		expect(summary.counts.created).toBe(0);
	});

	it('stops cleanly when cancelled', async () => {
		const { api, store, engine } = setup();
		seed(api);
		const controller = new AbortController();
		controller.abort();
		const summary = await engine.run({ trigger: 'manual', signal: controller.signal });
		expect(summary.cancelled).toBe(true);
		expect(store.paths()).toEqual([]);
	});

	it('refuses to start a second sync while one is running', async () => {
		const { api, engine } = setup();
		seed(api);
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const original = api.listConversations.bind(api);
		api.listConversations = async (...args) => {
			await gate;
			return original(...args);
		};
		const first = engine.run({ trigger: 'manual' });
		expect(engine.isRunning).toBe(true);
		await expect(engine.run({ trigger: 'interval' })).rejects.toBeInstanceOf(SyncAlreadyRunningError);
		release();
		await first;
		expect(engine.isRunning).toBe(false);
	});

	it('persists the index and a run summary', async () => {
		const { api, state, engine, saves } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		expect(saves()).toBeGreaterThan(0);
		expect(state.lastRun?.counts.created).toBe(2);
		expect(state.lastRun?.createdIds.sort()).toEqual(['c1', 'c2']);
		expect(state.get('c1')).toMatchObject({ path: 'Fieldy/2026-10-01 - Kickoff with Acme.md', status: 'synced' });
	});
});

describe('SyncEngine: restoring the Fieldy version of an edited note', () => {
	async function editedNote() {
		const ctx = setup();
		seed(ctx.api);
		await ctx.engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(ctx.store, path, 'Summary of c1.', 'My edited summary.');
		ctx.api.conversations[0]!.summary = 'Newest Fieldy summary.';
		await ctx.engine.run({ trigger: 'manual' });
		expect(ctx.state.get('c1')?.status).toBe('edited');
		return { ...ctx, path };
	}

	it('keep-both: writes the Fieldy version and keeps the edited copy outside the block', async () => {
		const { engine, store, state, path } = await editedNote();
		await engine.restoreFieldyVersion('c1', 'keep-both');
		const body = store.note(path).body;
		const parsed = parseManagedBlock(body);
		expect(parsed.status).toBe('ok');
		if (parsed.status !== 'ok') return;
		expect(parsed.block.inner).toContain('Newest Fieldy summary.');
		expect(parsed.block.after).toContain('## Your edited version (kept 2026-10-29 12:00)');
		expect(parsed.block.after).toContain('My edited summary.');
		expect(state.get('c1')?.status).toBe('synced');
	});

	it('keep-both can leave the transcript out of the kept copy', async () => {
		const { engine, store, settings, path } = await editedNote();
		expect(store.note(path).body.match(/^## Transcript$/gm)).toHaveLength(1);
		settings.keepTranscriptInEditedCopy = false;
		await engine.restoreFieldyVersion('c1', 'keep-both');
		const parsed = parseManagedBlock(store.note(path).body);
		if (parsed.status !== 'ok') throw new Error('expected a block');
		expect(parsed.block.inner).toContain('## Transcript');
		expect(parsed.block.after).toContain('My edited summary.');
		expect(parsed.block.after).not.toContain('## Transcript');
	});

	it('overwrite: replaces the managed block only', async () => {
		const { engine, store, path } = await editedNote();
		await engine.restoreFieldyVersion('c1', 'overwrite');
		const body = store.note(path).body;
		expect(body).toContain('Newest Fieldy summary.');
		expect(body).not.toContain('My edited summary.');
	});

	it('stop-syncing: pauses the note so later syncs leave it alone', async () => {
		const { api, engine, store, state, path } = await editedNote();
		await engine.restoreFieldyVersion('c1', 'stop-syncing');
		expect(store.note(path).frontmatter?.fieldy_sync).toBe(false);
		expect(state.get('c1')?.status).toBe('paused');
		api.conversations[0]!.summary = 'Even newer.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedPaused).toBe(1);
		expect(store.note(path).body).toContain('My edited summary.');
	});
});

describe('SyncEngine: robustness regressions', () => {
	it('refuses to restore plan-locked content and leaves the note untouched', async () => {
		const { api, store, state, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, 'Summary of c1.', 'My edited summary.');
		api.conversations[0]!.summary = 'Newer.';
		await engine.run({ trigger: 'manual' });
		const before = JSON.stringify(store.note(path));
		api.conversations[0]!.locked = true;
		api.conversations[0]!.summary = null;
		for (const resolution of ['keep-both', 'overwrite'] as const) {
			await expect(engine.restoreFieldyVersion('c1', resolution)).rejects.toMatchObject({ kind: 'locked' });
		}
		expect(JSON.stringify(store.note(path))).toBe(before);
		expect(state.get('c1')?.status).toBe('edited');
	});

	it('reuses an existing folder that differs only in letter case', async () => {
		const { api, store, engine } = setup({ folder: 'Fieldy' });
		store.folders.add('fieldy');
		api.conversations = [makeConversation('a', { title: 'One', startTime: '2026-10-05T09:00:00.000Z' })];
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, failed: 0 });
		expect(store.paths()).toEqual(['fieldy/2026-10-05 - One.md']);
		expect([...store.folders]).toEqual(['fieldy']);
	});

	it('never treats edited notes as a problem worth a notice', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		editInsideBlock(store, 'Fieldy/2026-10-01 - Kickoff with Acme.md', 'Summary of c1.', 'Mine.');
		api.conversations[0]!.summary = 'Newer.';
		const first = await engine.run({ trigger: 'interval' });
		const second = await engine.run({ trigger: 'interval' });
		expect(first.counts).toMatchObject({ edited: 1, newlyEdited: 1 });
		expect(second.counts).toMatchObject({ edited: 1, newlyEdited: 0 });
		expect(shouldNotify(first, true, 'changes')).toBe(false);
		expect(shouldNotify(first, true, 'errors')).toBe(false);
		expect(shouldNotify(second, true, 'changes')).toBe(false);
		expect(shouldNotify(second, true, 'errors')).toBe(false);
		expect(shouldNotify(second, false, 'errors')).toBe(true);
	});

	it('records the error kind of each failure', async () => {
		const { api, engine } = setup();
		seed(api);
		api.failTranscriptFor.add('c2');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.errors).toEqual([expect.objectContaining({ id: 'c2', kind: 'server' })]);
	});

	it('treats a hand-typed fieldy_sync: "false" as paused', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		store.note(path).frontmatter!.fieldy_sync = 'False';
		api.conversations[0]!.summary = 'Changed.';
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.skippedPaused).toBe(1);
		expect(isSyncPaused({ fieldy_sync: false })).toBe(true);
		expect(isSyncPaused({ fieldy_sync: true })).toBe(false);
		expect(isSyncPaused({ fieldy_sync: 'no' })).toBe(false);
		expect(isSyncPaused(null)).toBe(false);
	});

	it('reports a busy error with a clear message', async () => {
		const error = new SyncAlreadyRunningError();
		expect(error.kind).toBe('busy');
		expect(error.userMessage).toMatch(/already running/);
	});

	it('with task push on, does not re-read notes that have not changed', async () => {
		const { api, store, engine } = setup({ pushTaskCompletion: true });
		seed(api);
		await engine.run({ trigger: 'manual' });
		await engine.run({ trigger: 'manual' });
		const reads = store.reads;
		const summary = await engine.run({ trigger: 'interval' });
		expect(summary.counts.unchanged).toBe(2);
		expect(store.reads).toBe(reads);

		// A local edit (a tick) changes the file, so that note is read and the task pushed.
		editInsideBlock(store, 'Fieldy/2026-10-01 - Kickoff with Acme.md', '- [ ] Send', '- [x] Send');
		const after = await engine.run({ trigger: 'interval' });
		expect(store.reads).toBe(reads + 1);
		expect(after.counts.tasksPushed).toBe(1);
	});
});

describe('SyncEngine: opt-in task completion push', () => {
	it('marks ticked open tasks completed in Fieldy once', async () => {
		const { api, store, engine } = setup({ pushTaskCompletion: true });
		seed(api);
		await engine.run({ trigger: 'manual' });
		const path = 'Fieldy/2026-10-01 - Kickoff with Acme.md';
		editInsideBlock(store, path, '- [ ] Send the proposal', '- [x] Send the proposal');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.tasksPushed).toBe(1);
		expect(api.completed).toEqual(['t1']);
		expect(store.note(path).body).toContain('- [x] Send the proposal');

		const again = await engine.run({ trigger: 'manual' });
		expect(again.counts.tasksPushed).toBe(0);
		expect(api.completed).toEqual(['t1']);
	});

	it('never pushes anything when the option is off', async () => {
		const { api, store, engine } = setup();
		seed(api);
		await engine.run({ trigger: 'manual' });
		editInsideBlock(store, 'Fieldy/2026-10-01 - Kickoff with Acme.md', '- [ ] Send', '- [x] Send');
		await engine.run({ trigger: 'manual' });
		expect(api.calls.complete).toBe(0);
	});
});

describe('SyncEngine: speaker links', () => {
	const KICKOFF = 'Fieldy/2026-10-01 - Kickoff with Acme.md';

	it('links speakers to people notes and updates notes when a people note appears', async () => {
		const { api, store, engine } = setup({ linkSpeakers: true, peopleFolder: 'People', linkTranscriptSpeakers: true });
		seed(api);
		store.addNote('People/Alex Martin.md', { aliases: ['Alex'] }, '');
		await engine.run({ trigger: 'manual' });
		const note = store.note(KICKOFF);
		expect(note.body).toContain('- **Speakers:** [[Alex Martin|Alex]], Sam');
		expect(note.body).toContain('**[[Alex Martin|Alex]]:** Hello everyone.');
		expect(note.frontmatter?.fieldy_speakers).toEqual(['[[Alex Martin|Alex]]', 'Sam']);

		const unchanged = await engine.run({ trigger: 'manual' });
		expect(unchanged.counts.updated).toBe(0);

		store.addNote('People/Sam.md', null, '');
		const after = await engine.run({ trigger: 'manual' });
		expect(after.counts).toMatchObject({ updated: 2, edited: 0 });
		expect(store.note(KICKOFF).body).toContain('- **Speakers:** [[Alex Martin|Alex]], [[Sam]]');
	});

	it('ignores notes outside the people folder and conversation notes', async () => {
		const { api, store, engine } = setup({ linkSpeakers: true, peopleFolder: 'People' });
		seed(api);
		store.addNote('Elsewhere/Alex.md', null, '');
		await engine.run({ trigger: 'manual' });
		store.addNote('People/Sam.md', { fieldy_id: 'other' }, '');
		await engine.run({ trigger: 'manual' });
		expect(store.note(KICKOFF).body).toContain('- **Speakers:** Alex, Sam');
	});
});

describe('SyncEngine: notes for new speakers', () => {
	it('creates a people note for each new speaker and links it, only when asked', async () => {
		const { api, store, engine } = setup({ linkSpeakers: true, peopleFolder: 'People', createSpeakerNotes: true });
		seed(api);
		api.conversations[0]!.speakers = ['Alex', 'Speaker A', 'Dr: Who'];
		store.addNote('People/Sam.md', null, '');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.peopleCreated).toBe(2);
		expect(store.note('People/Alex.md').frontmatter).toEqual({ fieldy_speaker: 'Alex' });
		expect(store.note('People/Dr - Who.md').frontmatter).toEqual({ fieldy_speaker: 'Dr: Who', aliases: ['Dr: Who'] });
		expect(store.paths().some((p) => p.includes('Speaker A'))).toBe(false);
		expect(store.note('Fieldy/2026-10-01 - Kickoff with Acme.md').body).toContain('- **Speakers:** [[Alex]], Speaker A, [[Dr - Who|Dr: Who]]');

		const again = await engine.run({ trigger: 'manual' });
		expect(again.counts).toMatchObject({ peopleCreated: 0, updated: 0 });
	});

	it('creates nothing when the option is off or the conversation gets no note', async () => {
		const off = setup({ linkSpeakers: true, peopleFolder: 'People' });
		seed(off.api);
		await off.engine.run({ trigger: 'manual' });
		expect(off.store.paths().filter((p) => p.startsWith('People/'))).toEqual([]);

		const skipped = setup({ linkSpeakers: true, createSpeakerNotes: true, importNewOnSync: false });
		seed(skipped.api);
		await skipped.engine.run({ trigger: 'manual' });
		expect(skipped.store.paths()).toEqual([]);
	});
});
