import { describe, expect, it } from 'vitest';
import { renderTranscript, speakerName, type TranscriptRenderOptions } from '../../src/markdown/TranscriptRenderer';
import { formatUtc, makeSegment } from '../helpers/fixtures';

const segments = [
	makeSegment('1', '2026-10-01T14:00:05.000Z', 'Alex', 'Hello.'),
	makeSegment('2', '2026-10-01T14:00:07.000Z', 'Alex', 'Shall we start?'),
	makeSegment('3', '2026-10-01T14:01:10.000Z', 'B', 'Yes, <b>let us</b>.', { speakerProfileId: 'p-sam' }),
	makeSegment('4', '2026-10-01T15:02:00.000Z', 'C', '# Not a heading'),
];

function options(overrides: Partial<TranscriptRenderOptions> = {}): TranscriptRenderOptions {
	return {
		format: 'timestamped-speaker',
		timestampStyle: 'clock',
		conversationStart: '2026-10-01T14:00:00.000Z',
		formatDate: formatUtc,
		speakerNames: new Map([['p-sam', 'Sam']]),
		...overrides,
	};
}

describe('speakerName', () => {
	it('prefers speaker profile names, then labels, and expands diarisation labels', () => {
		const names = new Map([['p1', 'Jordan']]);
		expect(speakerName(makeSegment('x', 't', 'A', '', { speakerProfileId: 'p1' }), names)).toBe('Jordan');
		expect(speakerName(makeSegment('x', 't', 'Alex', ''), names)).toBe('Alex');
		expect(speakerName(makeSegment('x', 't', 'B', ''), names)).toBe('Speaker B');
		expect(speakerName(makeSegment('x', 't', 'SPEAKER_2', ''), names)).toBe('Speaker 2');
		expect(speakerName(makeSegment('x', 't', '  ', ''), names)).toBe('Unknown speaker');
		expect(speakerName(makeSegment('x', 't', 'A', '', { speakerProfileId: 'unknown' }), names)).toBe('Speaker A');
	});
});

describe('renderTranscript', () => {
	it('timestamped-speaker merges consecutive segments into turns', () => {
		expect(renderTranscript(segments, options())).toEqual([
			'`14:00:05` **Alex:** Hello. Shall we start?',
			'',
			'`14:01:10` **Sam:** Yes, &lt;b>let us&lt;/b>.',
			'',
			'`15:02:00` **Speaker C:** # Not a heading',
		]);
	});

	it('timestamped lists every segment with its time', () => {
		const lines = renderTranscript(segments, options({ format: 'timestamped' }));
		expect(lines.filter((l) => l !== '')).toEqual([
			'`14:00:05` Hello.',
			'`14:00:07` Shall we start?',
			'`14:01:10` Yes, &lt;b>let us&lt;/b>.',
			'`15:02:00` # Not a heading',
		]);
	});

	it('paragraphs shows speakers and readable text without timestamps', () => {
		expect(renderTranscript(segments, options({ format: 'paragraphs' }))).toEqual([
			'**Alex**',
			'',
			'Hello. Shall we start?',
			'',
			'**Sam**',
			'',
			'Yes, &lt;b>let us&lt;/b>.',
			'',
			'**Speaker C**',
			'',
			'\\# Not a heading',
		]);
	});

	it('can show time elapsed since the start of the conversation', () => {
		const lines = renderTranscript(segments, options({ timestampStyle: 'elapsed' }));
		expect(lines[0]).toBe('`00:05` **Alex:** Hello. Shall we start?');
		expect(lines[4]).toBe('`1:02:00` **Speaker C:** # Not a heading');
	});

	it('skips empty segments and renders nothing for an empty transcript', () => {
		expect(renderTranscript([], options())).toEqual([]);
		expect(renderTranscript([makeSegment('1', '2026-10-01T14:00:05Z', 'A', '   ')], options())).toEqual([]);
	});
});
