import type { FieldyConversation, FieldyTask, FieldyTranscriptSegment } from '../api/types';
import { displayTitle, locationText, renderSnippet, type RenderSettings } from '../markdown/ConversationRenderer';
import { speakerName } from '../markdown/TranscriptRenderer';
import { durationMinutes, isValidIso, type DateFormatter } from '../utils/dates';

export type ExportFormat = 'json' | 'markdown' | 'text' | 'csv';

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; extension: string }> = {
	markdown: { label: 'Markdown (one note)', extension: 'md' },
	json: { label: 'JSON (complete data)', extension: 'json' },
	csv: { label: 'CSV (one row per conversation)', extension: 'csv' },
	text: { label: 'Plain text', extension: 'txt' },
};

/** One conversation and what was fetched with it. */
export interface ExportItem {
	conversation: FieldyConversation;
	tasks: readonly FieldyTask[];
	/** Null when transcripts were not included. */
	transcript: readonly FieldyTranscriptSegment[] | null;
}

interface ExportInfo {
	exportedAt: string;
	/** Null for the whole history. */
	range: { startTime: string; endTime: string } | null;
	includeBrief: boolean;
	includeTranscripts: boolean;
}

export interface ExportContext {
	info: ExportInfo;
	settings: RenderSettings;
	formatDate: DateFormatter;
	speakerNames: ReadonlyMap<string, string>;
}

export function renderExport(format: ExportFormat, items: readonly ExportItem[], context: ExportContext): string {
	switch (format) {
		case 'json':
			return toJson(items, context);
		case 'markdown':
			return toMarkdown(items, context);
		case 'text':
			return toText(items, context);
		case 'csv':
			return toCsv(items, context);
	}
}

// ------------------------------------------------------------------ JSON

function toJson(items: readonly ExportItem[], { info, speakerNames }: ExportContext): string {
	const data = {
		...info,
		count: items.length,
		conversations: items.map(({ conversation, tasks, transcript }) => ({
			...conversation,
			tasks,
			...(transcript ? { transcript: transcript.map((s) => ({ ...s, speakerName: speakerName(s, speakerNames) })) } : {}),
		})),
	};
	return `${JSON.stringify(data, null, 2)}\n`;
}

// -------------------------------------------------------------- Markdown

function rangeText({ info, formatDate }: ExportContext): string {
	if (!info.range) return 'entire history';
	return `${formatDate(info.range.startTime, 'YYYY-MM-DD')} to ${formatDate(info.range.endTime, 'YYYY-MM-DD')}`;
}

function toMarkdown(items: readonly ExportItem[], context: ExportContext): string {
	const { info, settings, formatDate, speakerNames } = context;
	const parts = [
		`# Fieldy export`,
		'',
		`${items.length} conversation${items.length === 1 ? '' : 's'}, ${rangeText(context)}. Exported ${formatDate(info.exportedAt, 'YYYY-MM-DD HH:mm')}.`,
	];
	for (const { conversation, tasks, transcript } of items) {
		// Each conversation as its "whole conversation" snippet, one heading level down.
		const body = renderSnippet(
			'full',
			{ conversation, tasks, transcript, speakerNames, templateName: null, shareLinks: [] },
			{ ...settings, includeTranscript: transcript !== null },
			formatDate,
		);
		// The snippet starts with the title, the date and, for locked conversations, a notice.
		parts.push('', '---', '', demote(body).trim());
	}
	return `${parts.join('\n')}\n`;
}

/** Headings one level lower, outside code blocks, so each conversation nests under its own heading. */
function demote(markdown: string): string {
	let fenced = false;
	return markdown
		.split('\n')
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
			if (fenced || !/^#{1,5} /.test(line)) return line;
			return `#${line}`;
		})
		.join('\n');
}

// ------------------------------------------------------------ plain text

function toText(items: readonly ExportItem[], context: ExportContext): string {
	const { formatDate, speakerNames } = context;
	const out = [`Fieldy export: ${items.length} conversation${items.length === 1 ? '' : 's'}, ${rangeText(context)}.`];
	const rule = '='.repeat(60);
	for (const { conversation: c, tasks, transcript } of items) {
		out.push('', rule, displayTitle(c) + (c.locked ? ' (locked)' : ''), rule);
		const minutes = durationMinutes(c.startTime, c.endTime);
		out.push(`Date: ${formatDate(c.startTime, 'YYYY-MM-DD HH:mm')}${minutes !== null ? ` (${minutes} min)` : ''}`);
		if (c.speakers.length > 0) out.push(`Speakers: ${c.speakers.join(', ')}`);
		const place = locationText(c.location);
		if (place) out.push(`Location: ${place}`);
		if (c.keywords.length > 0) out.push(`Keywords: ${c.keywords.join(', ')}`);
		if (c.summary?.trim()) out.push('', 'Summary', plain(c.summary));
		if (c.content?.trim() && c.content.trim() !== c.summary?.trim()) out.push('', 'Details', plain(c.content));
		if (tasks.length > 0) {
			out.push('', 'Tasks');
			for (const t of tasks) out.push(`[${t.status === 'completed' ? 'x' : ' '}] ${t.title.trim()}${t.date ? ` (due ${formatDate(t.date, 'YYYY-MM-DD')})` : ''}`);
		}
		if (c.quotes.length > 0) {
			out.push('', 'Quotes');
			for (const q of c.quotes) out.push(`"${q.text.trim()}"${q.context ? ` (${q.context.trim()})` : ''}`);
		}
		if (transcript && transcript.length > 0) {
			out.push('', 'Transcript');
			for (const s of transcript) {
				const text = s.text.trim();
				if (!text) continue;
				const time = isValidIso(s.timestamp) ? `${formatDate(s.timestamp, 'HH:mm:ss')} ` : '';
				out.push(`${time}${speakerName(s, speakerNames)}: ${text}`);
			}
		}
	}
	return `${out.join('\n')}\n`;
}

/** Markdown emphasis and heading marks removed; line breaks kept. */
function plain(markdown: string): string {
	return markdown
		.trim()
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/__(.+?)__/g, '$1');
}

// ------------------------------------------------------------------- CSV

const CSV_COLUMNS = [
	'id',
	'title',
	'type',
	'start',
	'end',
	'duration_minutes',
	'speakers',
	'location',
	'keywords',
	'summary',
	'details',
	'quotes',
	'open_tasks',
	'completed_tasks',
	'tasks',
	'calendar_event_id',
	'locked',
] as const;

function toCsv(items: readonly ExportItem[], { speakerNames, formatDate }: ExportContext): string {
	const withTranscript = items.some((i) => i.transcript !== null);
	const header: string[] = [...CSV_COLUMNS, ...(withTranscript ? ['transcript'] : [])];
	const rows = items.map(({ conversation: c, tasks, transcript }) => {
		const row: (string | number | boolean | null)[] = [
			c.id,
			displayTitle(c),
			c.type,
			c.startTime,
			c.endTime,
			durationMinutes(c.startTime, c.endTime),
			c.speakers.join('; '),
			locationText(c.location),
			c.keywords.join('; '),
			c.summary,
			c.content,
			c.quotes.map((q) => q.text.trim()).join('\n'),
			tasks.filter((t) => t.status === 'new' || t.status === 'approved').length,
			tasks.filter((t) => t.status === 'completed').length,
			tasks.map((t) => `[${t.status}] ${t.title.trim()}`).join('\n'),
			c.calendarEventId,
			c.locked,
		];
		if (withTranscript) {
			row.push(
				(transcript ?? [])
					.filter((s) => s.text.trim() !== '')
					.map((s) => `${isValidIso(s.timestamp) ? `${formatDate(s.timestamp, 'HH:mm:ss')} ` : ''}${speakerName(s, speakerNames)}: ${s.text.trim()}`)
					.join('\n'),
			);
		}
		return row;
	});
	// A byte-order mark so spreadsheet apps read the file as UTF-8 (accents, emoji).
	return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function csvCell(value: string | number | boolean | null): string {
	if (value === null) return '';
	let text = String(value);
	// Text a spreadsheet would run as a formula is kept as text.
	if (typeof value === 'string' && /^[=+@\t\r]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}
