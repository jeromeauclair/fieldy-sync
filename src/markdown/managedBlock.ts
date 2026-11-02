import { hashString } from '../utils/hash';

/*
 * A note owns exactly one managed block:
 *
 *   %% fieldy:begin %%
 *   ...content written by the plugin...
 *   %% fieldy:end %%
 *
 * Everything outside the markers belongs to the user and is never modified.
 * Two properties describe the block:
 * - `fieldy_hash`: the hash of the block content as last written by the
 *   plugin; if the current content hashes differently, the user edited it.
 * - `fieldy_src`: the remote data and render options the block was built
 *   from; if it matches the freshly computed fingerprint, nothing changed
 *   remotely.
 * Both live in the note itself, so detection keeps working after the sync
 * index is reset or on another device. The body and these two properties are
 * always written together, in one write.
 */

export const BEGIN_TAG = '%% fieldy:begin';
export const BEGIN_MARKER = '%% fieldy:begin %%';
export const END_MARKER = '%% fieldy:end %%';
export const HASH_KEY = 'fieldy_hash';
export const SOURCE_KEY = 'fieldy_src';

// `$` with the `m` flag stops before `\r` too, so CRLF line endings stay outside the match.
const BEGIN_LINE = /^%% fieldy:begin\b[^\r\n]*%%[ \t]*$/gm;
const END_LINE = /^%% fieldy:end %%[ \t]*$/gm;
/** Whether one line (without its line break) is a begin or an end marker. */
export function isBeginLine(line: string): boolean {
	return /^%% fieldy:begin\b.*%%[ \t]*\r?$/.test(line);
}

export function isEndLine(line: string): boolean {
	return /^%% fieldy:end %%[ \t]*\r?$/.test(line);
}

const TASK_LINE =/^(\s*[-*+] )\[([^\]])\](.*)$/;
const TASK_ID = /%%fieldy-task:([A-Za-z0-9_-]+)%%/;

export interface BlockMeta {
	hash: string;
	source: string;
}

/** A note's body together with the block properties stored in its frontmatter. */
export interface NoteContent {
	body: string;
	meta: BlockMeta | null;
}

/** What gets written: a body and the properties describing its block. */
export interface WrittenNote {
	body: string;
	meta: BlockMeta;
}

export interface ManagedBlock {
	/** Text before the begin marker (user-owned). */
	before: string;
	/** Content between the markers, without the marker lines. */
	inner: string;
	/** Text after the end marker (user-owned), starting with the newline after it. */
	after: string;
	meta: BlockMeta | null;
	/**
	 * No blank line before the end marker (after a callout, the marker would
	 * be read as part of it): the next write puts it back.
	 */
	outdated: boolean;
}

type ParseResult =
	| { status: 'ok'; block: ManagedBlock }
	| { status: 'missing' }
	| { status: 'malformed'; reason: string };

const yamlValue = (key: string) => new RegExp(`^${key}[ \\t]*:[ \\t]*(["']?)([0-9a-f]{6,32})\\1[ \\t]*$`, 'm');
const yamlLine = (key: string) => new RegExp(`^${key}[ \\t]*:.*$`, 'm');

/** Block properties read from raw frontmatter text (quoted or not). */
export function metaFromYaml(yaml: string): BlockMeta | null {
	const hash = yamlValue(HASH_KEY).exec(yaml)?.[2];
	const source = yamlValue(SOURCE_KEY).exec(yaml)?.[2];
	return hash && source ? { hash, source } : null;
}

/**
 * Sets the block properties in raw frontmatter text, changing only their own
 * lines so the rest of the user's YAML stays exactly as written. Values are
 * quoted: an all-digit hash would otherwise be read back as a number.
 */
export function setMetaInYaml(yaml: string, meta: BlockMeta): string {
	let out = yaml;
	for (const [key, value] of [
		[HASH_KEY, meta.hash],
		[SOURCE_KEY, meta.source],
	] as const) {
		const line = `${key}: "${value}"`;
		if (yamlLine(key).test(out)) out = out.replace(yamlLine(key), line);
		// Keep the text's own convention: a trailing newline stays, a missing one stays missing.
		else if (out === '' || out.endsWith('\n')) out = `${out}${line}\n`;
		else out = `${out}\n${line}`;
	}
	return out;
}

/** The block properties as frontmatter entries, for notes being created. */
export function metaFrontmatter(meta: BlockMeta): Record<string, string> {
	return { [HASH_KEY]: meta.hash, [SOURCE_KEY]: meta.source };
}

/**
 * Locates the managed block in a note body (frontmatter already removed).
 * `stored` are the block properties from the note's frontmatter.
 */
export function parseManagedBlock(body: string, stored: BlockMeta | null = null): ParseResult {
	const begins = [...body.matchAll(BEGIN_LINE)];
	const ends = [...body.matchAll(END_LINE)];
	if (begins.length === 0 && ends.length === 0) return { status: 'missing' };
	if (begins.length !== 1 || ends.length !== 1) {
		return { status: 'malformed', reason: `expected one begin and one end marker, found ${begins.length} and ${ends.length}` };
	}
	const begin = begins[0]!;
	const end = ends[0]!;
	const beginStart = begin.index;
	const beginEnd = beginStart + begin[0].length;
	const endStart = end.index;
	const endEnd = endStart + end[0].length;
	if (endStart < beginEnd) return { status: 'malformed', reason: 'end marker precedes begin marker' };

	let innerStart = beginEnd;
	if (body.startsWith('\r\n', innerStart)) innerStart += 2;
	else if (body[innerStart] === '\n') innerStart++;
	// The line break before the end marker, then the blank line the plugin leaves there.
	let innerEnd = endStart;
	const stripLineBreak = () => {
		if (innerEnd <= innerStart || body[innerEnd - 1] !== '\n') return false;
		innerEnd--;
		if (innerEnd > innerStart && body[innerEnd - 1] === '\r') innerEnd--;
		return true;
	};
	stripLineBreak();
	const spaced = stripLineBreak() || innerEnd <= innerStart;

	return {
		status: 'ok',
		block: {
			before: body.slice(0, beginStart),
			inner: body.slice(innerStart, Math.max(innerStart, innerEnd)),
			after: body.slice(endEnd),
			meta: stored,
			outdated: !spaced,
		},
	};
}

/**
 * Canonical form used for hashing: line endings, trailing whitespace and
 * surrounding blank lines are ignored (editors and formatters change them),
 * and so is the state of task checkboxes (ticking a task is not an edit).
 */
export function normaliseForHash(inner: string): string {
	return inner
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, '').replace(TASK_LINE, '$1[ ]$3'))
		.join('\n')
		.replace(/^\n+|\n+$/g, '');
}

/** The last hash, reused while a long note is being typed in elsewhere (the banner checks it on every change). */
let lastHashed: { inner: string; hash: string } | null = null;

export function hashBlock(inner: string): string {
	if (lastHashed?.inner === inner) return lastHashed.hash;
	const hash = hashString(normaliseForHash(inner));
	lastHashed = { inner, hash };
	return hash;
}

export function isModified(block: ManagedBlock): boolean {
	return block.meta === null || hashBlock(block.inner) !== block.meta.hash;
}

/** The properties describing freshly written block content. */
export function blockMeta(inner: string, source: string): BlockMeta {
	return { hash: hashBlock(inner), source };
}

/** The block as written: a blank line before the end marker keeps it out of a closing callout or list. */
export function composeBlock(inner: string): string {
	return `${BEGIN_MARKER}\n${inner.replace(/\n+$/, '')}\n\n${END_MARKER}`;
}

/** Body for a newly created note: the managed block plus room for the user's notes. */
export function initialBody(inner: string): string {
	return `${composeBlock(inner)}\n\n`;
}

/** Replaces only the managed block; user text before and after is kept byte for byte. */
export function replaceBlock(block: ManagedBlock, inner: string): string {
	return `${block.before}${composeBlock(inner)}${block.after}`;
}

/** Checkbox characters of tasks inside the block, keyed by Fieldy task id. */
export function taskStates(inner: string): Map<string, string> {
	const states = new Map<string, string>();
	for (const line of inner.split(/\r?\n/)) {
		const task = TASK_LINE.exec(line);
		if (!task) continue;
		const id = TASK_ID.exec(task[3] ?? '')?.[1];
		if (id) states.set(id, task[2] ?? ' ');
	}
	return states;
}
