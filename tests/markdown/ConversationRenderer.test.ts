import { describe, expect, it } from 'vitest';
import {
	applyManagedFrontmatter,
	withoutTranscript,
	buildCreationFrontmatter,
	buildManagedFrontmatter,
	locationText,
	renderConversationBody,
	renderKey,
	renderSnippet,
	sameManagedFrontmatter,
	type ConversationRenderInput,
} from '../../src/markdown/ConversationRenderer';
import { sourceFingerprint } from '../../src/sync/fingerprint';
import { formatUtc, makeConversation, makeSegment, makeTask, testSettings } from '../helpers/fixtures';

function input(overrides: Partial<ConversationRenderInput> = {}): ConversationRenderInput {
	return {
		conversation: makeConversation('c1', {
			title: 'Pricing call',
			summary: 'We agreed on **annual** pricing.',
			keywords: ['pricing', 'Project Apollo'],
			quotes: [{ text: 'Ship it by Friday.', context: 'Alex on the deadline' }],
			location: {
				address: null,
				street: 'Main St',
				streetNumber: '1',
				city: 'Montréal',
				zip: null,
				country: 'Canada',
				placeId: null,
				coordinates: { latitude: 45.5, longitude: -73.6 },
			},
			templateId: 'tpl-1',
		}),
		tasks: [
			makeTask('t2', 'c1', 'completed', { title: 'Book the room' }),
			makeTask('t1', 'c1', 'new', { title: 'Send the quote', date: '2026-10-03T00:00:00.000Z' }),
			makeTask('t3', 'c1', 'cancelled', { title: 'Old idea' }),
		],
		transcript: [makeSegment('s1', '2026-10-01T14:00:05.000Z', 'Alex', 'Hello.')],
		speakerNames: new Map(),
		templateName: 'Sales call',
		shareLinks: [],
		...overrides,
	};
}

describe('renderConversationBody', () => {
	it('renders the expected sections in order', () => {
		const body = renderConversationBody(input(), testSettings(), formatUtc);
		expect(body).toBe(
			[
				'# Pricing call',
				'',
				'- **When:** 2026-10-01 14:00 – 14:45 (45 min)',
				'- **Speakers:** Alex, Sam',
				'- **Location:** 1 Main St, Montréal, Canada',
				'- **Template:** Sales call',
				'- **Keywords:** pricing, Project Apollo',
				'',
				'## Summary',
				'',
				'We agreed on **annual** pricing.',
				'',
				'## Tasks',
				'',
				'- [ ] Send the quote (due 2026-10-03) %%fieldy-task:t1%%',
				'- [x] Book the room %%fieldy-task:t2%%',
				'',
				'## Quotes',
				'',
				'> Ship it by Friday.',
				'> — *Alex on the deadline*',
				'',
				'## Transcript',
				'',
				'`14:00:05` **Alex:** Hello.',
			].join('\n'),
		);
	});

	it('omits sections without data and honours include settings', () => {
		const sparse = input({
			conversation: makeConversation('c2', { summary: null, speakers: [], quotes: [] }),
			tasks: [],
			transcript: [],
			templateName: null,
		});
		const body = renderConversationBody(sparse, testSettings(), formatUtc);
		for (const heading of ['## Summary', '## Details', '## Tasks', '## Quotes', '## Transcript', '**Speakers:**']) {
			expect(body).not.toContain(heading);
		}
		const minimal = renderConversationBody(
			input(),
			testSettings({ includeSummary: false, includeTasks: false, includeQuotes: false, includeTranscript: false }),
			formatUtc,
		);
		expect(minimal).not.toMatch(/## (Summary|Tasks|Quotes|Transcript)/);
	});

	it('shows dismissed tasks only when asked, and keeps local checkbox state for open tasks', () => {
		const body = renderConversationBody(
			input({ localTaskStates: new Map([['t1', 'x']]) }),
			testSettings({ includeDismissedTasks: true }),
			formatUtc,
		);
		expect(body).toContain('- [x] Send the quote (due 2026-10-03) %%fieldy-task:t1%%');
		expect(body).toContain('- [-] Old idea (cancelled) %%fieldy-task:t3%%');
	});

	it('writes due dates as Dataview fields when asked, re-rendering only then', () => {
		const body = renderConversationBody(input(), testSettings({ dataviewTaskFields: true }), formatUtc);
		expect(body).toContain('- [ ] Send the quote [due:: 2026-10-03] %%fieldy-task:t1%%');
		expect(renderKey(testSettings({ dataviewTaskFields: false }))).toBe(renderKey(testSettings()));
		expect(renderKey(testSettings({ dataviewTaskFields: true }))).not.toBe(renderKey(testSettings()));
	});

	it('renders details only when they differ from the summary', () => {
		const same = input({ conversation: makeConversation('c', { summary: 'Same', content: 'Same' }) });
		expect(renderConversationBody(same, testSettings(), formatUtc)).not.toContain('## Details');
		const different = input({ conversation: makeConversation('c', { summary: 'Short', content: '# Notes\nLonger text' }) });
		expect(renderConversationBody(different, testSettings(), formatUtc)).toContain('## Details\n\n### Notes\nLonger text');
	});

	it('marks in-progress and locked conversations', () => {
		const body = renderConversationBody(
			input({ conversation: makeConversation('c', { endTime: null, locked: true }) }),
			testSettings(),
			formatUtc,
		);
		expect(body).toContain('- **When:** 2026-10-01 14:00 (in progress)');
		expect(body).toContain('> [!warning] Locked by Fieldy');
	});

	it('can collapse the transcript into a callout', () => {
		const body = renderConversationBody(input(), testSettings({ collapseTranscript: true }), formatUtc);
		expect(body).toContain('## Transcript\n\n> [!quote]- Show transcript\n> `14:00:05` **Alex:** Hello.');
	});

	it('sanitises untrusted titles', () => {
		const body = renderConversationBody(
			input({ conversation: makeConversation('c', { title: '<script>x</script> %% [[evil]]' }) }),
			testSettings(),
			formatUtc,
		);
		const firstLine = body.split('\n')[0]!;
		expect(firstLine).not.toMatch(/<script|%%|\[\[/);
	});

	it('renders enabled https share links only', () => {
		const body = renderConversationBody(
			input({
				shareLinks: [
					{ id: 's1', url: 'https://share.fieldy.ai/c/abc', enabled: true, authorName: 'A', sharedFields: [] },
					{ id: 's2', url: 'https://share.fieldy.ai/c/off', enabled: false, authorName: 'A', sharedFields: [] },
				],
			}),
			testSettings({ includeShareLinks: true }),
			formatUtc,
		);
		expect(body).toContain('## Share links\n\n- <https://share.fieldy.ai/c/abc>');
		expect(body).not.toContain('/c/off');
	});
});

describe('renderSnippet', () => {
	const settings = testSettings();

	it('renders single pieces as plain Markdown without hidden task ids', () => {
		expect(renderSnippet('summary', input(), settings, formatUtc)).toBe('We agreed on **annual** pricing.');
		expect(renderSnippet('tasks', input(), settings, formatUtc)).toBe(
			'- [ ] Send the quote (due 2026-10-03)\n- [x] Book the room',
		);
		expect(renderSnippet('quotes', input(), settings, formatUtc)).toBe('> Ship it by Friday.\n> — *Alex on the deadline*');
		expect(renderSnippet('transcript', input(), settings, formatUtc)).toBe('`14:00:05` **Alex:** Hello.');
		expect(renderSnippet('overview', input(), settings, formatUtc)).toMatch(/^# Pricing call\n\n- \*\*When:\*\* 2026-10-01 14:00/);
	});

	it('ignores the include settings, since the user picked the piece explicitly', () => {
		const off = testSettings({ includeSummary: false, includeTasks: false, includeCompletedTasks: false, includeTranscript: false });
		expect(renderSnippet('summary', input(), off, formatUtc)).not.toBe('');
		expect(renderSnippet('tasks', input(), off, formatUtc)).toContain('- [x] Book the room');
		const full = renderSnippet('full', input(), off, formatUtc);
		expect(full).toContain('## Summary');
		expect(full).toContain('## Tasks');
		expect(full).toContain('## Transcript');
		expect(full).not.toContain('%%');
	});

	it('returns the memory content even when it equals the summary, and empty strings when there is no data', () => {
		const same = input({ conversation: makeConversation('c', { summary: 'Same', content: 'Same', quotes: [] }), tasks: [], transcript: null });
		expect(renderSnippet('details', same, settings, formatUtc)).toBe('Same');
		expect(renderSnippet('quotes', same, settings, formatUtc)).toBe('');
		expect(renderSnippet('tasks', same, settings, formatUtc)).toBe('');
		expect(renderSnippet('transcript', same, settings, formatUtc)).toBe('');
		expect(renderSnippet('full', same, settings, formatUtc)).not.toContain('## Transcript');
	});
});

describe('frontmatter', () => {
	it('builds managed properties from the available data', () => {
		const fm = buildManagedFrontmatter(input(), testSettings(), formatUtc, '2026-10-29T12:00:00.000Z');
		expect(fm).toEqual({
			fieldy_id: 'c1',
			fieldy_type: 'conversation',
			fieldy_start: '2026-10-01T14:00:00',
			fieldy_end: '2026-10-01T14:45:00',
			fieldy_duration_minutes: 45,
			fieldy_kind: 'full',
			fieldy_updated: '2026-10-01T15:00:00',
			fieldy_synced: '2026-10-29T12:00:00',
			fieldy_speakers: ['Alex', 'Sam'],
			fieldy_keywords: ['pricing', 'Project Apollo'],
			fieldy_location: '1 Main St, Montréal, Canada',
			fieldy_template: 'Sales call',
		});
	});

	it('can keep ISO timestamps and drop optional properties', () => {
		const fm = buildManagedFrontmatter(
			input({ conversation: makeConversation('c', { endTime: null, updatedAt: null }) }),
			testSettings({ frontmatterDates: 'iso', fmSpeakers: false, fmKeywords: false, fmLocation: false, fmTemplate: false }),
			formatUtc,
			'2026-10-29T12:00:00.000Z',
		);
		expect(fm).toEqual({
			fieldy_id: 'c',
			fieldy_type: 'conversation',
			fieldy_start: '2026-10-01T14:00:00.000Z',
			fieldy_kind: 'full',
			fieldy_synced: '2026-10-29T12:00:00.000Z',
		});
	});

	it('adds tags and aliases only at creation', () => {
		const conversation = makeConversation('c', { title: 'Pricing: call', keywords: ['Project Apollo', '2026'] });
		expect(buildCreationFrontmatter(conversation, testSettings({ tags: 'fieldy, meetings', keywordTags: true, titleAlias: true }))).toEqual({
			tags: ['fieldy', 'meetings', 'project-apollo'],
			aliases: ['Pricing: call'],
		});
		expect(buildCreationFrontmatter(conversation, testSettings({ tags: '' }))).toEqual({});
	});

	it('updates managed keys while preserving user properties', () => {
		const target: Record<string, unknown> = {
			fieldy_id: 'c1',
			fieldy_template: 'Old',
			fieldy_sync: true,
			tags: ['mine'],
			rating: 4,
		};
		applyManagedFrontmatter(target, { fieldy_id: 'c1', fieldy_start: 'x' });
		expect(target).toEqual({ fieldy_id: 'c1', fieldy_start: 'x', fieldy_sync: true, tags: ['mine'], rating: 4 });
	});

	it('compares managed properties ignoring the sync timestamp and user keys', () => {
		expect(sameManagedFrontmatter({ fieldy_id: 'a', fieldy_synced: '1', tags: ['x'] }, { fieldy_id: 'a', fieldy_synced: '2' })).toBe(true);
		expect(sameManagedFrontmatter({ fieldy_id: 'a' }, { fieldy_id: 'a', fieldy_end: 'x' })).toBe(false);
	});

	it('formats locations from parts or the full address', () => {
		expect(locationText(null)).toBeNull();
		expect(locationText({ address: '10 Downing St, London', street: null, streetNumber: null, city: null, zip: null, country: null, placeId: null, coordinates: null })).toBe(
			'10 Downing St, London',
		);
	});
});

describe('source fingerprint', () => {
	const settingsKey = renderKey(testSettings());

	it('changes with content, tasks and render settings but not with updatedAt', () => {
		const base = makeConversation('c');
		const tasks = [makeTask('t', 'c')];
		const fp = sourceFingerprint(base, tasks, settingsKey);
		expect(sourceFingerprint({ ...base, updatedAt: '2030-01-01T00:00:00Z' }, tasks, settingsKey)).toBe(fp);
		expect(sourceFingerprint({ ...base, summary: 'changed' }, tasks, settingsKey)).not.toBe(fp);
		expect(sourceFingerprint(base, [makeTask('t', 'c', 'completed')], settingsKey)).not.toBe(fp);
		expect(sourceFingerprint(base, tasks, renderKey(testSettings({ transcriptFormat: 'paragraphs' })))).not.toBe(fp);
		// The recording-source filter changes which transcript segments are rendered.
		expect(sourceFingerprint(base, tasks, renderKey(testSettings({ recordingSource: 'phone' })))).not.toBe(fp);
	});

	it('does not depend on task order', () => {
		const base = makeConversation('c');
		const a = makeTask('a', 'c');
		const b = makeTask('b', 'c');
		expect(sourceFingerprint(base, [a, b], settingsKey)).toBe(sourceFingerprint(base, [b, a], settingsKey));
	});
});

describe('withoutTranscript', () => {
	it('drops the Transcript section up to the next main heading', () => {
		const inner = ['# Title', '', '## Summary', '', 'Text.', '', '## Transcript', '', '> [!quote]- Show transcript', '> Hi', '', '## Notes', '', 'Mine'].join('\n');
		expect(withoutTranscript(inner)).toBe(['# Title', '', '## Summary', '', 'Text.', '', '## Notes', '', 'Mine'].join('\n'));
		expect(withoutTranscript('# Title\n\n## Transcript\n\n**A:** hi')).toBe('# Title');
		expect(withoutTranscript('# Title\n\n## Summary\n\nText.')).toBe('# Title\n\n## Summary\n\nText.');
	});
});
