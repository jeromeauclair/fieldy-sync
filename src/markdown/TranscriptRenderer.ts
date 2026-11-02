import type { FieldyTranscriptSegment } from '../api/types';
import type { TimestampStyle, TranscriptFormat } from '../settings/settings';
import { formatElapsed, isValidIso, type DateFormatter } from '../utils/dates';
import { inlineText, lineText } from './sanitize';
import { speakerMarkdown, type SpeakerLinks } from './speakerLinks';

export interface TranscriptRenderOptions {
	format: TranscriptFormat;
	timestampStyle: TimestampStyle;
	/** Conversation start, the origin for elapsed timestamps. */
	conversationStart: string;
	formatDate: DateFormatter;
	/** Speaker profile names by profile id. */
	speakerNames: ReadonlyMap<string, string>;
	/** People notes to link speaker names to. */
	speakerLinks?: SpeakerLinks;
}

interface Turn {
	speaker: string;
	timestamp: string;
	texts: string[];
}

/**
 * Display name of a segment's speaker: the speaker profile name when the
 * segment is linked to one, otherwise Fieldy's label. Bare diarisation labels
 * such as "A" or "SPEAKER_1" are shown as "Speaker A" / "Speaker 1".
 */
export function speakerName(segment: FieldyTranscriptSegment, speakerNames: ReadonlyMap<string, string>): string {
	const profile = segment.speakerProfileId ? speakerNames.get(segment.speakerProfileId) : undefined;
	const raw = (profile ?? segment.speaker).trim();
	if (raw === '') return 'Unknown speaker';
	const diarised = /^(?:speaker[ _-]?)?([A-Z]|\d{1,2})$/i.exec(raw);
	if (diarised?.[1]) return `Speaker ${diarised[1].toUpperCase()}`;
	return raw;
}

function toTurns(segments: readonly FieldyTranscriptSegment[], names: ReadonlyMap<string, string>): Turn[] {
	const turns: Turn[] = [];
	for (const segment of segments) {
		const text = segment.text.trim();
		if (text === '') continue;
		const speaker = speakerName(segment, names);
		const last = turns[turns.length - 1];
		if (last && last.speaker === speaker) last.texts.push(text);
		else turns.push({ speaker, timestamp: segment.timestamp, texts: [text] });
	}
	return turns;
}

function stamp(timestamp: string, options: TranscriptRenderOptions): string {
	if (!isValidIso(timestamp)) return '';
	if (options.timestampStyle === 'elapsed' && isValidIso(options.conversationStart)) {
		return formatElapsed(Date.parse(timestamp) - Date.parse(options.conversationStart));
	}
	return options.formatDate(timestamp, 'HH:mm:ss');
}

/**
 * Renders transcript segments as Markdown lines (no heading). Consecutive
 * segments by the same speaker are merged into one turn, except in the
 * per-segment `timestamped` format. Order follows the segments' timestamps.
 */
export function renderTranscript(segments: readonly FieldyTranscriptSegment[], options: TranscriptRenderOptions): string[] {
	const lines: string[] = [];
	const push = (line: string) => {
		if (lines.length > 0) lines.push('');
		lines.push(line);
	};

	if (options.format === 'timestamped') {
		for (const segment of segments) {
			const text = inlineText(segment.text);
			if (text === '') continue;
			const time = stamp(segment.timestamp, options);
			push(time ? `\`${time}\` ${text}` : lineText(segment.text));
		}
		return lines;
	}

	const turns = toTurns(segments, options.speakerNames);
	const multipleSpeakers = new Set(turns.map((t) => t.speaker)).size > 1;
	for (const turn of turns) {
		const speaker = speakerMarkdown(turn.speaker, options.speakerLinks);
		const text = inlineText(turn.texts.join(' '));
		if (options.format === 'paragraphs') {
			if (multipleSpeakers || turn.speaker !== 'Unknown speaker') push(`**${speaker}**`);
			push(lineText(turn.texts.join(' ')));
		} else {
			const time = stamp(turn.timestamp, options);
			push(`${time ? `\`${time}\` ` : ''}**${speaker}:** ${text}`);
		}
	}
	return lines;
}
