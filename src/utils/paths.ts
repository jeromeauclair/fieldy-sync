import { FieldyError } from './errors';
import type { DateFormatter } from './dates';
import type { SubfolderMode } from '../settings/settings';

export const MAX_BASENAME_LENGTH = 100;
export const UNTITLED = 'Untitled conversation';

// Windows reserves these device names even with an extension ("CON.txt") or trailing spaces before it.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\s*(\.|$))/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const SEPARATORS = /[\\/:|]/g; // become " - "
const REMOVED = /[*?"<>#^]/g; // illegal on Windows or break Obsidian links/headings/blocks
const BRACKETS_OPEN = /\[/g;
const BRACKETS_CLOSE = /\]/g;

function truncateCodePoints(value: string, max: number): string {
	const chars = Array.from(value);
	return chars.length <= max ? value : chars.slice(0, max).join('');
}

function trimEdges(value: string): string {
	// Leading dots hide files on Unix; trailing dots/spaces are invalid on Windows.
	// Dashes left over from replaced separators are trimmed too.
	return value.replace(/^[\s.\-–—]+/, '').replace(/[\s.\-–—]+$/, '');
}

/**
 * Turns arbitrary (untrusted) text into a file name that is valid on
 * Windows, macOS, Linux, iOS and Android, and that does not break Obsidian
 * wikilinks. The result never contains a path separator.
 */
export function sanitizeFilename(input: string | null | undefined, maxLength: number = MAX_BASENAME_LENGTH): string {
	let name = (input ?? '').normalize('NFC');
	name = name.replace(CONTROL_CHARS, ' ');
	name = name.replace(SEPARATORS, ' - ');
	name = name.replace(REMOVED, '');
	name = name.replace(BRACKETS_OPEN, '(').replace(BRACKETS_CLOSE, ')');
	name = name.replace(/\s+/g, ' ');
	name = name.replace(/(\s-){2,}\s/g, ' - ').replace(/-{3,}/g, '--');
	name = trimEdges(name);
	name = trimEdges(truncateCodePoints(name, maxLength));
	if (name === '') name = UNTITLED;
	return name.replace(WINDOWS_RESERVED, '$1_');
}

/**
 * Normalises a user-supplied vault folder ("Fieldy/Conversations"): forward
 * slashes only, no leading/trailing slash, every segment sanitised, and no
 * `.`/`..` segments so the path can never escape the vault. Returns '' for
 * the vault root.
 */
export function sanitizeFolderPath(input: string | null | undefined): string {
	const segments = (input ?? '')
		.normalize('NFC')
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
	return segments.map((segment) => sanitizeFilename(segment, 120)).join('/');
}

/** Whether `path` is `folder` itself or inside it (case-insensitive, like the vault on Windows and macOS). */
export function isInFolder(path: string, folder: string): boolean {
	if (folder === '') return true;
	const p = path.toLowerCase();
	const f = folder.toLowerCase();
	return p === f || p.startsWith(`${f}/`);
}

export function joinVaultPath(...parts: string[]): string {
	return parts
		.flatMap((part) => part.split('/'))
		.filter((segment) => segment !== '')
		.join('/');
}

interface FilenameValues {
	title: string | null;
	startTime: string;
	id: string;
}

/**
 * Expands `{date}`, `{time}`, `{title}` and `{id}` in a filename pattern.
 * Each value is sanitised separately so a title can never inject a path.
 */
export function applyFilenamePattern(pattern: string, values: FilenameValues, dateFormat: string, formatDate: DateFormatter): string {
	const title = values.title?.replace(/\s+/g, ' ').trim() ?? '';
	const replacements: Record<string, string> = {
		date: sanitizeFilename(formatDate(values.startTime, dateFormat)),
		time: sanitizeFilename(formatDate(values.startTime, 'HH-mm')),
		title: title ? sanitizeFilename(title, 80) : UNTITLED,
		id: sanitizeFilename(values.id.slice(0, 8)),
	};
	const expanded = pattern.replace(/\{(date|time|title|id)\}/gi, (_m, token: string) => replacements[token.toLowerCase()] ?? '');
	return sanitizeFilename(expanded);
}

/** Date subfolders for a new note; `customFormat` is a Moment format where "/" separates folders. */
export function subfolderFor(mode: SubfolderMode, startTime: string, formatDate: DateFormatter, customFormat = ''): string {
	const f = (format: string) => formatDate(startTime, format);
	switch (mode) {
		case 'year':
			return f('YYYY');
		case 'year-month':
			return f('YYYY-MM');
		case 'month':
			return `${f('YYYY')}/${f('YYYY-MM')}`;
		case 'week':
			// ISO week-numbering year, so the last days of December can belong to week 1 of the next year.
			return `${f('GGGG')}/${f('GGGG-[W]WW')}`;
		case 'day':
			return `${f('YYYY')}/${f('YYYY-MM')}/${f('YYYY-MM-DD')}`;
		case 'custom':
			return customFormat.trim() ? sanitizeFolderPath(f(customFormat.trim())) : '';
		default:
			return '';
	}
}

/**
 * Finds a free `.md` path by appending " (2)", " (3)"... to the base name.
 * `isTaken` must treat paths case-insensitively on case-insensitive file
 * systems; callers pass a lower-cased lookup.
 */
export function uniqueNotePath(folder: string, basename: string, isTaken: (path: string) => boolean, maxAttempts = 999): string {
	const make = (suffix: string) => joinVaultPath(folder, `${basename}${suffix}.md`);
	const first = make('');
	if (!isTaken(first)) return first;
	for (let n = 2; n <= maxAttempts; n++) {
		const candidate = make(` (${n})`);
		if (!isTaken(candidate)) return candidate;
	}
	throw new FieldyError('filename-conflict', `No free file name for ${first}`, { path: first });
}

export function parentFolder(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}
