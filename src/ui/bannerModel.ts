import { isBeginLine, isEndLine, isModified, metaFromYaml, parseManagedBlock } from '../markdown/managedBlock';

/** Where the Fieldy section sits in a note, as 0-based line numbers of the whole file. */
export interface BlockLayout {
	begin: number;
	end: number;
	/** First and last non-blank lines between the markers; null when the section is empty. */
	first: number | null;
	last: number | null;
}

export type BannerStatus = 'synced' | 'edited' | 'paused';

/** Locates the markers; null unless there is exactly one of each, in order (anything else is the user's text). */
export function blockLayout(lines: readonly string[]): BlockLayout | null {
	let begin = -1;
	let end = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (isBeginLine(line)) {
			if (begin !== -1) return null;
			begin = i;
		} else if (isEndLine(line)) {
			if (end !== -1) return null;
			end = i;
		}
	}
	if (begin === -1 || end === -1 || end < begin) return null;
	let first: number | null = null;
	let last: number | null = null;
	for (let i = begin + 1; i < end; i++) {
		if ((lines[i] ?? '').trim() === '') continue;
		first ??= i;
		last = i;
	}
	return { begin, end, first, last };
}

/**
 * The section's state, worked out from the note text itself: `edited` as
 * soon as its content no longer matches the hash it was written with.
 * Null when the markers are missing or broken.
 */
export function blockStatus(body: string, yaml: string, paused: boolean): BannerStatus | null {
	const parsed = parseManagedBlock(body, metaFromYaml(yaml));
	if (parsed.status !== 'ok') return null;
	if (paused) return 'paused';
	return isModified(parsed.block) ? 'edited' : 'synced';
}

export const BANNER_LABELS: Record<BannerStatus, string> = {
	synced: 'Synced',
	edited: 'Edited',
	paused: 'Paused',
};

export const BANNER_HINTS: Record<BannerStatus, string> = {
	synced: 'Kept up to date from Fieldy. Editing inside this section pauses its updates; write your own notes below it.',
	edited: 'You changed this section, so sync leaves it as you wrote it. Restore brings back the Fieldy version.',
	paused: 'This note has fieldy_sync: false, so it is never updated.',
};
