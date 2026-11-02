import { describe, expect, it } from 'vitest';
import { csvCell, renderExport, type ExportContext, type ExportItem } from '../../src/export/exportFormats';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { formatUtc, makeConversation, makeSegment, makeTask } from '../helpers/fixtures';

const context: ExportContext = {
	info: { exportedAt: '2026-11-02T12:00:00.000Z', range: null, includeBrief: true, includeTranscripts: true },
	settings: DEFAULT_SETTINGS,
	formatDate: formatUtc,
	speakerNames: new Map([['p1', 'Alex']]),
};

const items: ExportItem[] = [
	{
		conversation: makeConversation('c1', { title: 'Budget, "Q4"', summary: '## Points\n**Agreed** on cost', speakers: ['Alex', 'Sam'] }),
		tasks: [makeTask('t1', 'c1', 'new', { title: 'Send offer' }), makeTask('t2', 'c1', 'completed', { title: 'Book room' })],
		transcript: [makeSegment('s1', '2026-10-01T09:00:05.000Z', 'A', 'Hello', { speakerProfileId: 'p1' })],
	},
	{ conversation: makeConversation('c2', { title: '=SUM(A1)', summary: null }), tasks: [], transcript: null },
];

describe('exports', () => {
	it('writes JSON with tasks, named transcript speakers and the export info', () => {
		const data = JSON.parse(renderExport('json', items, context)) as {
			count: number;
			includeBrief: boolean;
			conversations: { id: string; tasks: unknown[]; transcript?: { speakerName: string }[] }[];
		};
		expect(data.count).toBe(2);
		expect(data.includeBrief).toBe(true);
		expect(data.conversations[0]?.tasks).toHaveLength(2);
		expect(data.conversations[0]?.transcript?.[0]?.speakerName).toBe('Alex');
		expect(data.conversations[1]).not.toHaveProperty('transcript');
	});

	it('writes CSV with quoting, a UTF-8 mark, task counts and formula-safe cells', () => {
		const csv = renderExport('csv', items, context);
		expect(csv.startsWith('﻿id,title,')).toBe(true);
		const lines = csv.split('\r\n');
		expect(lines[0]?.endsWith(',locked,transcript')).toBe(true);
		expect(csv).toContain('"Budget, ""Q4"""');
		expect(csv).toContain("'=SUM(A1)");
		expect(csv).toContain('Alex: Hello');
		expect(csvCell(null)).toBe('');
		expect(csvCell(3)).toBe('3');
		expect(csvCell('a\nb')).toBe('"a\nb"');
	});

	it('writes one Markdown note with a heading per conversation, headings nested below it', () => {
		const md = renderExport('markdown', items, context);
		expect(md.startsWith('# Fieldy export')).toBe(true);
		expect(md.match(/^## Budget, "Q4"$/gm)).toHaveLength(1);
		expect(md).not.toMatch(/^## Summary/m);
		expect(md).toContain('2 conversations, entire history');
	});

	it('writes plain text without Markdown marks', () => {
		const text = renderExport('text', items, context);
		expect(text).toContain('Speakers: Alex, Sam');
		expect(text).toContain('Agreed on cost');
		expect(text).not.toContain('**');
		expect(text).toContain('[ ] Send offer');
		expect(text).toContain('[x] Book room');
		expect(text).toContain('09:00:05 Alex: Hello');
	});
});
