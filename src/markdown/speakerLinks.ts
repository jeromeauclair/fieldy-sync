import { inlineText } from './sanitize';

/** A note that may stand for a person: its vault path and the `aliases` in its frontmatter. */
export interface PersonNote {
	path: string;
	aliases: readonly string[];
}

/**
 * Speaker names that match a people note. Names are matched by note name or
 * alias, ignoring case and extra spaces. A name that matches several notes
 * is never linked, since a wrong person would be worse than no link.
 */
export interface PeopleIndex {
	/** Link target by name key (see `personKey`). */
	readonly targets: ReadonlyMap<string, string>;
	/** Names matching several notes, with those notes' paths. */
	readonly ambiguous: ReadonlyMap<string, readonly string[]>;
	readonly noteCount: number;
}

/** Link targets for one conversation's speakers, by name key. */
export type SpeakerLinks = ReadonlyMap<string, string>;

/** Where new people notes go when no people folder is set. */
export const DEFAULT_PEOPLE_FOLDER = 'People';

export const EMPTY_PEOPLE_INDEX: PeopleIndex = { targets: new Map(), ambiguous: new Map(), noteCount: 0 };

/** Characters that would break a wikilink or change its meaning (heading, block, alias). */
const UNSAFE = /[[\]|#^\\\n\r]/;
/** Diarisation labels and placeholders that never stand for a real person. */
const GENERIC = /^(?:unknown(?: speaker)?|(?:speaker[ _-]?)?(?:[a-z]|\d{1,2}))$/i;

export function personKey(name: string): string {
	return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf('/') + 1);
	return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

/** Whether a name can be written as link text unchanged (and so can get a people note). */
export function linkable(name: string): boolean {
	return name !== '' && !UNSAFE.test(name) && !GENERIC.test(name) && inlineText(name) === name;
}

/**
 * Builds the index from candidate people notes. `allMarkdownPaths` (every note
 * in the vault) decides the link target: the bare note name when it is unique
 * in the vault, otherwise the path without `.md`, so the link always opens
 * the intended note.
 */
export function buildPeopleIndex(notes: readonly PersonNote[], allMarkdownPaths: readonly string[]): PeopleIndex {
	const nameCounts = new Map<string, number>();
	for (const path of allMarkdownPaths) {
		const key = basename(path).toLowerCase();
		nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
	}
	const matches = new Map<string, Set<string>>();
	const targetOf = new Map<string, string>();
	for (const note of notes) {
		const name = basename(note.path);
		const target = (nameCounts.get(name.toLowerCase()) ?? 0) > 1 ? note.path.slice(0, -3) : name;
		if (!linkable(target) || target.includes('[[')) continue;
		targetOf.set(note.path, target);
		for (const label of [name, ...note.aliases]) {
			const key = personKey(label);
			if (!key) continue;
			const set = matches.get(key) ?? new Set<string>();
			set.add(note.path);
			matches.set(key, set);
		}
	}
	const targets = new Map<string, string>();
	const ambiguous = new Map<string, string[]>();
	for (const [key, paths] of matches) {
		if (paths.size === 1) targets.set(key, targetOf.get([...paths][0] ?? '') ?? '');
		else ambiguous.set(key, [...paths].sort());
	}
	return { targets, ambiguous, noteCount: targetOf.size };
}

/** The links for a set of speaker names; names without a safe, unique match are left out. */
export function resolveSpeakerLinks(names: readonly string[], index: PeopleIndex): Map<string, string> {
	const links = new Map<string, string>();
	for (const name of names) {
		const display = name.replace(/\s+/g, ' ').trim();
		if (!linkable(display)) continue;
		const key = personKey(display);
		const target = index.targets.get(key);
		if (target) links.set(key, target);
	}
	return links;
}

/** A speaker name as Markdown: a wikilink when it has a link, otherwise sanitised text. */
export function speakerMarkdown(name: string, links: SpeakerLinks | undefined): string {
	const display = name.replace(/\s+/g, ' ').trim();
	const target = links?.get(personKey(display));
	if (!target || !linkable(display)) return inlineText(name);
	return target === display ? `[[${target}]]` : `[[${target}|${display}]]`;
}
