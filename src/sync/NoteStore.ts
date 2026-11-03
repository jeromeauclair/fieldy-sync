import type { NoteContent, WrittenNote } from '../markdown/managedBlock';
import type { PeopleIndex } from '../markdown/speakerLinks';

/**
 * The vault operations the sync engine needs, so the engine can be tested
 * against an in-memory implementation. Paths are vault-relative and
 * normalised. "Body" means the note content after the frontmatter.
 */
export interface NoteRef {
	path: string;
	frontmatter: Record<string, unknown> | null;
	/** Last modification time of the file, if known. */
	mtime: number | null;
}

export interface NoteStore {
	/** Every Markdown note that has a `fieldy_id`, grouped by that id. */
	indexByFieldyId(): Promise<Map<string, NoteRef[]>>;
	/** Whether any file or folder occupies `path` (case-insensitively). */
	isTaken(path: string): boolean;
	/** Current modification time of a note, or null if unknown. */
	mtime(path: string): number | null;
	/** The body and the block properties (`fieldy_hash`, `fieldy_src`) read from the file itself. */
	readNote(path: string): Promise<NoteContent>;
	create(path: string, frontmatter: Record<string, unknown>, body: string): Promise<void>;
	/** Moves a note to the trash the user chose in Obsidian (recoverable). */
	trash(path: string): Promise<void>;
	/**
	 * Makes sure the folder exists and resolves to its actual path. On
	 * case-insensitive file systems an existing folder that differs only in
	 * case is reused, so the returned path may differ in case from `path`.
	 */
	ensureFolder(path: string): Promise<string>;
	/**
	 * Atomically rewrites the body and the block properties in one write. `fn`
	 * receives the current content and returns the new one, or `null` to leave
	 * the file untouched. Other frontmatter is kept as it is. Resolves to
	 * `false` only when `fn` returned `null`.
	 */
	processNote(path: string, fn: (note: NoteContent) => WrittenNote | null): Promise<boolean>;
	/** Atomically mutates the frontmatter object. */
	processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	/** People notes (in `folder` and its subfolders; '' = the whole vault), for speaker links. Conversation notes are never people. */
	peopleIndex(folder: string): PeopleIndex;
}
