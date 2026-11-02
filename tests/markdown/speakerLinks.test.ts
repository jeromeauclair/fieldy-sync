import { describe, expect, it } from 'vitest';
import {
	buildManagedFrontmatter,
	metadataLines,
	renderKey,
	transcriptLines,
	type ConversationRenderInput,
} from '../../src/markdown/ConversationRenderer';
import { buildPeopleIndex, personKey, resolveSpeakerLinks, speakerMarkdown } from '../../src/markdown/speakerLinks';
import { formatUtc, makeConversation, makeSegment, testSettings } from '../helpers/fixtures';

const note = (path: string, aliases: string[] = []) => ({ path, aliases });

describe('people index', () => {
	it('matches note names and aliases, ignoring case and spacing', () => {
		const index = buildPeopleIndex([note('People/Alex Martin.md', ['Alex']), note('People/Sam.md')], ['People/Alex Martin.md', 'People/Sam.md']);
		const links = resolveSpeakerLinks(['alex', ' SAM ', 'Chris'], index);
		expect(links).toEqual(new Map([['alex', 'Alex Martin'], ['sam', 'Sam']]));
		expect(index.noteCount).toBe(2);
	});

	it('links by path when another note in the vault has the same name', () => {
		const index = buildPeopleIndex([note('People/Sam.md')], ['People/Sam.md', 'Projects/Sam.md']);
		expect(index.targets.get('sam')).toBe('People/Sam');
		expect(speakerMarkdown('Sam', resolveSpeakerLinks(['Sam'], index))).toBe('[[People/Sam|Sam]]');
	});

	it('never links a name that matches several notes', () => {
		const index = buildPeopleIndex([note('People/Alex Martin.md', ['Alex']), note('People/Alex Roy.md', ['alex'])], []);
		expect(resolveSpeakerLinks(['Alex'], index).size).toBe(0);
		expect(index.ambiguous.get('alex')).toEqual(['People/Alex Martin.md', 'People/Alex Roy.md']);
	});

	it('leaves generic and unsafe names as sanitised text', () => {
		const index = buildPeopleIndex([note('Speaker A.md'), note('Unknown speaker.md'), note('Unknown.md'), note('Bob.md')], []);
		// Fieldy labels unrecognised voices "Unknown": never a person, never a people note.
		expect(resolveSpeakerLinks(['Speaker A', 'Unknown speaker', 'Unknown', 'Bob|x', 'Bob]]'], index).size).toBe(0);
		expect(speakerMarkdown('[[Bob]]', resolveSpeakerLinks(['[[Bob]]'], index))).toBe('\\[\\[Bob\\]\\]');
	});

	it('writes the shortest link that opens the right note', () => {
		const links = new Map([[personKey('Sam'), 'Sam'], [personKey('Alex'), 'Alex Martin']]);
		expect(speakerMarkdown('Sam', links)).toBe('[[Sam]]');
		expect(speakerMarkdown('Alex', links)).toBe('[[Alex Martin|Alex]]');
		expect(speakerMarkdown('Chris', links)).toBe('Chris');
	});
});

describe('rendering speaker links', () => {
	const links = new Map([['alex', 'Alex Martin']]);
	const input: ConversationRenderInput = {
		conversation: makeConversation('c1', { speakers: ['Alex', 'Sam'] }),
		tasks: [],
		transcript: [makeSegment('s1', '2026-10-01T14:00:05.000Z', 'Alex', 'Hello.')],
		speakerNames: new Map(),
		templateName: null,
		shareLinks: [],
		speakerLinks: links,
	};

	it('links the Speakers line and property only when the setting is on', () => {
		const on = testSettings({ linkSpeakers: true });
		expect(metadataLines(input, on, formatUtc)).toContain('- **Speakers:** [[Alex Martin|Alex]], Sam');
		expect(buildManagedFrontmatter(input, on, formatUtc, '2026-10-29T12:00:00.000Z').fieldy_speakers).toEqual(['[[Alex Martin|Alex]]', 'Sam']);
		const off = testSettings({ linkSpeakers: false });
		expect(metadataLines(input, off, formatUtc)).toContain('- **Speakers:** Alex, Sam');
	});

	it('links transcript labels only with their own setting', () => {
		expect(transcriptLines(input, testSettings({ linkSpeakers: true }), formatUtc).join('\n')).toContain('**Alex:**');
		expect(transcriptLines(input, testSettings({ linkSpeakers: true, linkTranscriptSpeakers: true }), formatUtc).join('\n')).toContain(
			'**[[Alex Martin|Alex]]:**',
		);
	});

	it('keeps the render key unchanged while the feature is off', () => {
		expect(renderKey(testSettings({ linkTranscriptSpeakers: true }))).toBe(renderKey(testSettings()));
		expect(renderKey(testSettings({ linkSpeakers: true }))).not.toBe(renderKey(testSettings()));
	});
});
