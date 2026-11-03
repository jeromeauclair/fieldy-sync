import { describe, expect, it } from 'vitest';
import { PrivacyGuard, sanitizeTranscriptChecks, TranscriptCheckCache } from '../../src/privacy/PrivacyGuard';
import { conversationMatches, describeMatches, normalizeText, privacyRules, transcriptMatches } from '../../src/privacy/privacy';
import type { FieldySyncSettings } from '../../src/settings/settings';
import { FakeFieldyApi } from '../helpers/fakeApi';
import { makeConversation, makeSegment, testSettings } from '../helpers/fixtures';

function rules(overrides: Partial<FieldySyncSettings>) {
	return privacyRules(testSettings(overrides));
}

describe('privacy rules', () => {
	it('reads one entry per line or comma, dropping blanks and repeats', () => {
		const r = rules({ privateKeywords: 'doctor, Doctor\n\n  salary  ,', privateSpeakers: 'Dr Martin' });
		expect(r.keywords.map((k) => k.value)).toEqual(['doctor', 'salary']);
		expect(r.speakers.map((k) => k.key)).toEqual(['dr martin']);
	});

	it('ignores case and accents', () => {
		expect(normalizeText('  Rendez-vous  CHEZ le Médecin ')).toBe('rendez-vous chez le medecin');
		const c = makeConversation('c', { summary: 'Rendez-vous chez le MÉDECIN demain.' });
		expect(conversationMatches(c, rules({ privateKeywords: 'medecin' }), null)).toEqual([{ kind: 'keyword', value: 'medecin' }]);
	});

	it('matches whole words, and word starts with a trailing *', () => {
		const c = makeConversation('c', { title: 'Therapist follow-up', summary: 'Next steps.' });
		expect(conversationMatches(c, rules({ privateKeywords: 'therapy' }), null)).toEqual([]);
		expect(conversationMatches(c, rules({ privateKeywords: 'therap*' }), null)).toEqual([{ kind: 'keyword', value: 'therap*' }]);
		expect(conversationMatches(c, rules({ privateKeywords: 'step' }), null)).toEqual([]);
		expect(conversationMatches(c, rules({ privateKeywords: 'next  steps' }), null)).toHaveLength(1);
	});

	it('looks at the title, summary, memory content, keywords and quotes', () => {
		const r = rules({ privateKeywords: 'alpha, beta, gamma, delta, epsilon' });
		const c = makeConversation('c', {
			title: 'Alpha',
			summary: 'beta',
			content: 'gamma',
			keywords: ['delta'],
			quotes: [{ text: 'quoted', context: 'about epsilon' }],
		});
		expect(conversationMatches(c, r, null).map((m) => m.value)).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
	});

	it('matches speakers by name, places by address words, templates by name or id', () => {
		const c = makeConversation('c', {
			speakers: ['Dr. Martin', 'Alex'],
			templateId: 'tpl-9',
			location: { address: '12 Rue de la Paix, Paris', street: null, streetNumber: null, city: 'Paris', zip: '75002', country: 'France', placeId: null, coordinates: null },
		});
		const r = rules({ privateSpeakers: 'dr. martin', privatePlaces: 'rue de la paix\n75002', privateTemplates: 'Medical visit\ntpl-9' });
		expect(conversationMatches(c, r, 'Medical Visit')).toEqual([
			{ kind: 'speaker', value: 'dr. martin' },
			{ kind: 'place', value: 'rue de la paix' },
			{ kind: 'place', value: '75002' },
			{ kind: 'template', value: 'Medical visit' },
			{ kind: 'template', value: 'tpl-9' },
		]);
		expect(conversationMatches(c, rules({ privateSpeakers: 'Martin' }), null)).toEqual([]);
	});

	it('finds keywords and speakers in a transcript', () => {
		const segments = [makeSegment('s1', '2026-10-01T14:00:00Z', 'Dr Martin', 'Your blood pressure is fine.')];
		expect(transcriptMatches(segments, rules({ privateKeywords: 'blood pressure', privateSpeakers: 'dr martin' }))).toEqual([
			{ kind: 'keyword', value: 'blood pressure', inTranscript: true },
			{ kind: 'speaker', value: 'dr martin', inTranscript: true },
		]);
	});

	it('describes matches for cards and banners', () => {
		expect(describeMatches([{ kind: 'keyword', value: 'doctor' }, { kind: 'speaker', value: 'Dr Martin', inTranscript: true }])).toBe(
			'keyword "doctor", speaker "Dr Martin" (in the transcript)',
		);
	});
});

function guardFor(overrides: Partial<FieldySyncSettings>, api = new FakeFieldyApi(), cache = new TranscriptCheckCache()) {
	const settings = testSettings(overrides);
	return { api, cache, guard: new PrivacyGuard({ settings: () => settings, client: api, cache, now: () => Date.parse('2026-10-29T12:00:00Z') }) };
}

describe('PrivacyGuard', () => {
	it('treats everything as public without filters', () => {
		const { guard } = guardFor({});
		expect(guard.active()).toBe(false);
		expect(guard.check(makeConversation('c'))).toEqual({ state: 'public' });
	});

	it('waits for template names before clearing a conversation with a template', async () => {
		const { api, guard } = guardFor({ privateTemplates: 'Sales call' });
		const c = makeConversation('c', { templateId: 'tpl-1' });
		expect(guard.check(c)).toEqual({ state: 'pending' });
		expect(guard.check(makeConversation('d'))).toEqual({ state: 'public' });
		const { verdict } = await guard.resolve(c);
		expect(verdict).toEqual({ state: 'private', matches: [{ kind: 'template', value: 'Sales call' }] });
		expect(api.calls.templates).toBe(1);
		expect(guard.check(c).state).toBe('private');
	});

	it('reads a transcript once and remembers the result', async () => {
		const { api, guard, cache } = guardFor({ privateKeywords: 'salary', privacySearchTranscript: true });
		api.transcripts.set('c', [makeSegment('s1', '2026-10-01T14:00:00Z', 'Alex', 'About your salary.')]);
		api.transcripts.set('d', [makeSegment('s2', '2026-10-01T14:00:00Z', 'Alex', 'Hello.')]);
		const c = makeConversation('c');
		const d = makeConversation('d');
		expect(guard.check(c)).toEqual({ state: 'pending' });
		const first = await guard.resolve(c);
		expect(first.verdict.state).toBe('private');
		expect(first.transcript).toHaveLength(1);
		expect((await guard.resolve(d)).verdict).toEqual({ state: 'public' });
		expect(api.calls.transcripts).toBe(2);
		// Known now, without a request.
		expect(guard.check(c).state).toBe('private');
		expect(guard.check(d).state).toBe('public');
		await guard.resolve(c);
		expect(api.calls.transcripts).toBe(2);
		// A changed conversation is checked again.
		expect(guard.check({ ...d, updatedAt: '2026-10-05T00:00:00.000Z' }).state).toBe('pending');
		// Stored results survive a reload of data.json.
		expect(sanitizeTranscriptChecks(JSON.parse(JSON.stringify(cache.toJSON())))).toEqual(cache.toJSON());
	});

	it('does not read transcripts when the filters already decide, or when transcripts are not searched', async () => {
		const { api, guard } = guardFor({ privateKeywords: 'acme', privacySearchTranscript: true });
		expect((await guard.resolve(makeConversation('c', { title: 'Acme call' }))).verdict.state).toBe('private');
		const off = guardFor({ privateKeywords: 'acme' }, api);
		expect((await off.guard.resolve(makeConversation('d'))).verdict.state).toBe('public');
		expect(api.calls.transcripts).toBe(0);
	});

	it('drops malformed stored results', () => {
		expect(sanitizeTranscriptChecks({ a: { key: 'k', updatedAt: null, matches: [{ kind: 'nope', value: 'x' }, { kind: 'keyword', value: 'y' }] }, b: 'junk' })).toEqual({
			a: { key: 'k', updatedAt: null, matches: [{ kind: 'keyword', value: 'y' }] },
		});
	});
});

describe('diagnostics', () => {
	it('never contains privacy filter entries', async () => {
		const { buildDiagnostics } = await import('../../src/diagnostics');
		const { emptySyncState, SyncState } = await import('../../src/sync/SyncState');
		const text = buildDiagnostics({
			pluginVersion: '1.0.0',
			obsidianVersion: '1.14.4',
			platform: 'test',
			settings: testSettings({ privateKeywords: 'doctor, salary', privateSpeakers: 'Dr Martin' }),
			apiKeyConfigured: true,
			state: new SyncState(emptySyncState(), async () => undefined),
			syncRunning: false,
			rateLimitPerMinute: 60,
			knownSecrets: [],
		});
		expect(text).not.toMatch(/doctor|salary|Martin/);
		expect(text).toContain('"privateKeywords": "(2 hidden)"');
	});
});

describe('private times', () => {
	it('makes a conversation private when it touches a private time', () => {
		const r = rules({ privateTimeRules: [{ op: 'or', days: [], from: '12:00', to: '13:00' }] });
		const lunch = makeConversation('c', { startTime: new Date(2026, 10, 2, 11, 45).toISOString(), endTime: new Date(2026, 10, 2, 12, 15).toISOString() });
		const morning = makeConversation('d', { startTime: new Date(2026, 10, 2, 9, 0).toISOString(), endTime: new Date(2026, 10, 2, 9, 30).toISOString() });
		expect(conversationMatches(lunch, r, null)).toEqual([{ kind: 'time', value: 'every day 12:00–13:00' }]);
		expect(conversationMatches(morning, r, null)).toEqual([]);
		expect(describeMatches(conversationMatches(lunch, r, null))).toBe('time "every day 12:00–13:00"');
	});
});
