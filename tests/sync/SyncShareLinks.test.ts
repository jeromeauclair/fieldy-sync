import { describe, expect, it } from 'vitest';
import { PrivacyGuard, TranscriptCheckCache } from '../../src/privacy/PrivacyGuard';
import type { FieldySyncSettings } from '../../src/settings/settings';
import { SyncEngine } from '../../src/sync/SyncEngine';
import { emptySyncState, SyncState } from '../../src/sync/SyncState';
import { formatSyncSummary } from '../../src/ui/summary';
import { FakeFieldyApi } from '../helpers/fakeApi';
import { formatUtc, makeConversation, testSettings } from '../helpers/fixtures';
import { MemoryNoteStore } from '../helpers/memoryStore';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function setup(overrides: Partial<FieldySyncSettings> = {}, fallback?: () => Promise<string | null>) {
	const api = new FakeFieldyApi();
	const store = new MemoryNoteStore();
	const state = new SyncState(emptySyncState(), async () => undefined);
	const settings = testSettings({ shareLinkAuthor: 'Alex Martin', ...overrides });
	const authors: string[] = [];
	const privacy = new PrivacyGuard({ settings: () => settings, client: api, cache: new TranscriptCheckCache(), now: () => NOW });
	const engine = new SyncEngine({ client: api, store, state, settings: () => settings, formatDate: formatUtc, now: () => NOW, privacy, onShareAuthor: (n) => authors.push(n), shareAuthorFallback: fallback });
	api.conversations = [makeConversation('c1', { title: 'Kickoff', startTime: '2026-10-20T10:00:00.000Z' })];
	return { api, store, engine, authors };
}

const ALL_FIELDS = ['title', 'startTime', 'endTime', 'summary', 'quotes', 'keywords', 'transcriptions'];

describe('SyncEngine: share links for new notes', () => {
	it('creates a share link, with the transcript, for each new note', async () => {
		const { api, engine } = setup();
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, shareLinksCreated: 1 });
		expect(api.createdSharables).toEqual([{ conversationId: 'c1', authorName: 'Alex Martin', sharedFields: ALL_FIELDS }]);
		expect(formatSyncSummary(summary)).toContain('1 share link created in Fieldy');
	});

	it('leaves the transcript out when asked', async () => {
		const { api, engine } = setup({ shareLinkTranscript: false });
		await engine.run({ trigger: 'manual' });
		expect(api.createdSharables[0]?.sharedFields).not.toContain('transcriptions');
	});

	it('keeps an existing link, even a turned-off one, and learns its author', async () => {
		const { api, engine, authors } = setup();
		api.sharables.set('c1', [{ id: 's0', url: 'https://fieldy.ai/s/old', enabled: false, authorName: 'J. Doe', sharedFields: ['title'] }]);
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.shareLinksCreated).toBe(0);
		expect(api.calls.createSharable).toBe(0);
		expect(authors).toEqual(['J. Doe']);
	});

	it('writes the new link into the note without asking Fieldy again', async () => {
		const { api, store, engine } = setup({ includeShareLinks: true });
		await engine.run({ trigger: 'manual' });
		expect(api.calls.sharables).toBe(1);
		expect(store.note(store.paths()[0]!).body).toContain('https://share.example/c1');
	});

	it('creates nothing without an author name, and says so', async () => {
		const { api, engine } = setup({ shareLinkAuthor: '' });
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, shareLinksNoAuthor: 1 });
		expect(api.calls.sharables + api.calls.createSharable).toBe(0);
		expect(formatSyncSummary(summary)).toContain('set an author name');
	});

	it('uses the account email name when no author name is set', async () => {
		const { api, engine } = setup({ shareLinkAuthor: '' }, async () => 'alex.martin');
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ shareLinksCreated: 1, shareLinksNoAuthor: 0 });
		expect(api.createdSharables[0]?.authorName).toBe('alex.martin');
	});

	it('still creates the note when the link fails', async () => {
		const { api, store, engine } = setup();
		api.failShareCreation = true;
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts).toMatchObject({ created: 1, failed: 0, shareLinksFailed: 1 });
		expect(store.paths()).toHaveLength(1);
	});

	it('only for new notes, never for private conversations or when off', async () => {
		const first = setup();
		await first.engine.run({ trigger: 'manual' });
		first.api.sharables.clear();
		await first.engine.run({ trigger: 'manual', force: true });
		expect(first.api.calls.createSharable).toBe(1);

		const privateOne = setup({ privateKeywords: 'kickoff' });
		await privateOne.engine.run({ trigger: 'manual' });
		expect(privateOne.api.calls.createSharable).toBe(0);

		const off = setup({ createShareLinks: false });
		await off.engine.run({ trigger: 'manual' });
		expect(off.api.calls.sharables + off.api.calls.createSharable).toBe(0);
	});
});

describe('SyncEngine: share links turned off', () => {
	it('never asks Fieldy about share links, even with listing and creation on', async () => {
		const { api, store, engine } = setup({ useShareLinks: false, includeShareLinks: true, createShareLinks: true });
		const summary = await engine.run({ trigger: 'manual' });
		expect(summary.counts.created).toBe(1);
		expect(api.calls.sharables + api.calls.createSharable).toBe(0);
		expect(store.note(store.paths()[0]!).body).not.toContain('Share links');
	});
});
