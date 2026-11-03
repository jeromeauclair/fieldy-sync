import { HASH_KEY, SOURCE_KEY, type BlockMeta, type NoteContent, type WrittenNote } from '../../src/markdown/managedBlock';
import { buildPeopleIndex, type PeopleIndex } from '../../src/markdown/speakerLinks';
import type { NoteRef, NoteStore } from '../../src/sync/NoteStore';
import { hashString, stableStringify } from '../../src/utils/hash';

/** Block properties from parsed frontmatter (the plugin reads them from the YAML text). */
function metaFromFrontmatter(frontmatter: Record<string, unknown> | null | undefined): BlockMeta | null {
	const hash = frontmatter?.[HASH_KEY];
	const source = frontmatter?.[SOURCE_KEY];
	return typeof hash === 'string' && typeof source === 'string' ? { hash, source } : null;
}

interface MemoryNote {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

/** In-memory vault used to test the sync engine without Obsidian. */
export class MemoryNoteStore implements NoteStore {
	readonly notes = new Map<string, MemoryNote>();
	readonly folders = new Set<string>();
	readonly writes = { create: 0, body: 0, frontmatter: 0, folder: 0 };
	reads = 0;
	/** Optional hook to simulate a failing write. */
	failCreate: ((path: string) => boolean) | null = null;
	/** Optional hook run inside processNote before `fn`, to simulate concurrent edits. */
	beforeProcessBody: ((path: string, note: MemoryNote) => void) | null = null;

	addNote(path: string, frontmatter: Record<string, unknown> | null, body: string): void {
		this.notes.set(path, { frontmatter: frontmatter ? structuredClone(frontmatter) : null, body });
	}

	note(path: string): MemoryNote {
		const note = this.notes.get(path);
		if (!note) throw new Error(`No note at ${path}`);
		return note;
	}

	paths(): string[] {
		return [...this.notes.keys()].sort();
	}

	totalWrites(): number {
		return this.writes.create + this.writes.body + this.writes.frontmatter;
	}

	rename(from: string, to: string): void {
		const note = this.note(from);
		this.notes.delete(from);
		this.notes.set(to, note);
	}

	async indexByFieldyId(): Promise<Map<string, NoteRef[]>> {
		const index = new Map<string, NoteRef[]>();
		for (const [path, note] of this.notes) {
			const id = note.frontmatter?.fieldy_id;
			if (typeof id !== 'string') continue;
			const refs = index.get(id) ?? [];
			refs.push({ path, frontmatter: note.frontmatter ? structuredClone(note.frontmatter) : null, mtime: this.mtime(path) });
			index.set(id, refs);
		}
		return index;
	}

	/** Content-derived "modification time": changes whenever the note's content changes. */
	mtime(path: string): number | null {
		const note = this.notes.get(path);
		if (!note) return null;
		return parseInt(hashString(stableStringify(note.frontmatter ?? {}) + note.body).slice(0, 12), 16);
	}

	peopleIndex(folder: string): PeopleIndex {
		const prefix = folder ? `${folder}/`.toLowerCase() : '';
		const people = [...this.notes]
			.filter(([path, note]) => (!prefix || path.toLowerCase().startsWith(prefix)) && note.frontmatter?.fieldy_id === undefined)
			.map(([path, note]) => ({ path, aliases: Array.isArray(note.frontmatter?.aliases) ? (note.frontmatter.aliases as string[]) : [] }));
		return buildPeopleIndex(people, [...this.notes.keys()]);
	}

	isTaken(path: string): boolean {
		const lower = path.toLowerCase();
		for (const existing of [...this.notes.keys(), ...this.folders]) {
			if (existing.toLowerCase() === lower) return true;
		}
		return false;
	}

	async readNote(path: string): Promise<NoteContent> {
		this.reads++;
		const note = this.note(path);
		return { body: note.body, meta: metaFromFrontmatter(note.frontmatter) };
	}

	async create(path: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
		if (this.failCreate?.(path)) throw new Error('Disk full');
		if (this.isTaken(path)) throw new Error('File already exists.');
		this.notes.set(path, { frontmatter: structuredClone(frontmatter), body });
		this.writes.create++;
	}

	/** Behaves like a case-insensitive file system: an existing folder differing in case is reused. */
	readonly trashed: string[] = [];

	async trash(path: string): Promise<void> {
		this.note(path);
		this.notes.delete(path);
		this.trashed.push(path);
	}

	async ensureFolder(path: string): Promise<string> {
		let current = '';
		for (const segment of path.split('/')) {
			const wanted = current ? `${current}/${segment}` : segment;
			const existing = [...this.folders].find((f) => f.toLowerCase() === wanted.toLowerCase());
			if (existing) {
				current = existing;
				continue;
			}
			this.folders.add(wanted);
			this.writes.folder++;
			current = wanted;
		}
		return current;
	}

	async processNote(path: string, fn: (note: NoteContent) => WrittenNote | null): Promise<boolean> {
		const note = this.note(path);
		this.beforeProcessBody?.(path, note);
		const next = fn({ body: note.body, meta: metaFromFrontmatter(note.frontmatter) });
		if (next === null) return false;
		const frontmatter = { ...(note.frontmatter ?? {}), [HASH_KEY]: next.meta.hash, [SOURCE_KEY]: next.meta.source };
		if (next.body !== note.body || stableStringify(frontmatter) !== stableStringify(note.frontmatter ?? {})) {
			note.body = next.body;
			note.frontmatter = frontmatter;
			this.writes.body++;
		}
		return true;
	}

	async processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		const note = this.note(path);
		const before = stableStringify(note.frontmatter ?? {});
		const fm = structuredClone(note.frontmatter ?? {});
		fn(fm);
		if (stableStringify(fm) !== before) this.writes.frontmatter++;
		note.frontmatter = fm;
	}
}
