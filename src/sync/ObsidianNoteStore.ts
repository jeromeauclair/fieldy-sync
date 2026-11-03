import { getFrontMatterInfo, normalizePath, parseYaml, stringifyYaml, TFile, TFolder, type App } from 'obsidian';
import { ID_KEY } from '../markdown/ConversationRenderer';
import { metaFromYaml, setMetaInYaml, type BlockMeta, type NoteContent, type WrittenNote } from '../markdown/managedBlock';
import { buildPeopleIndex, type PersonNote, type PeopleIndex } from '../markdown/speakerLinks';
import { FieldyError } from '../utils/errors';
import type { NoteRef, NoteStore } from './NoteStore';

/**
 * NoteStore backed by the Obsidian Vault, FileManager and MetadataCache APIs.
 * All paths are vault-relative and normalised; nothing outside the vault is
 * ever touched.
 */
export class ObsidianNoteStore implements NoteStore {
	private taken = new Set<string>();

	constructor(private readonly app: App) {}

	private file(path: string): TFile {
		const file = this.app.vault.getFileByPath(normalizePath(path));
		if (!file) throw new FieldyError('vault-write', 'The note no longer exists.', { path });
		return file;
	}

	private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
		// Used only for files the metadata cache has not indexed yet (e.g. right after startup).
		const content = await this.app.vault.cachedRead(file);
		const info = getFrontMatterInfo(content);
		if (!info.exists) return null;
		try {
			const parsed: unknown = parseYaml(info.frontmatter);
			return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}

	async indexByFieldyId(): Promise<Map<string, NoteRef[]>> {
		this.taken = new Set(this.app.vault.getAllLoadedFiles().map((f) => f.path.toLowerCase()));
		const index = new Map<string, NoteRef[]>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter: Record<string, unknown> | null = cache ? (cache.frontmatter ?? null) : await this.readFrontmatter(file);
			const rawId = frontmatter?.[ID_KEY];
			if (typeof rawId !== 'string' && typeof rawId !== 'number') continue;
			const id = String(rawId).trim();
			if (id === '') continue;
			const refs = index.get(id) ?? [];
			refs.push({ path: file.path, frontmatter, mtime: file.stat.mtime });
			index.set(id, refs);
		}
		return index;
	}

	peopleIndex(folder: string): PeopleIndex {
		const files = this.app.vault.getMarkdownFiles();
		const prefix = folder ? `${normalizePath(folder)}/`.toLowerCase() : '';
		const people: PersonNote[] = [];
		for (const file of files) {
			if (prefix && !file.path.toLowerCase().startsWith(prefix)) continue;
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (frontmatter?.[ID_KEY] !== undefined) continue;
			people.push({ path: file.path, aliases: aliasList(frontmatter?.aliases ?? frontmatter?.alias) });
		}
		return buildPeopleIndex(people, files.map((f) => f.path));
	}

	isTaken(path: string): boolean {
		const normalized = normalizePath(path);
		return this.taken.has(normalized.toLowerCase()) || this.app.vault.getAbstractFileByPath(normalized) !== null;
	}

	mtime(path: string): number | null {
		return this.app.vault.getFileByPath(normalizePath(path))?.stat.mtime ?? null;
	}

	async readNote(path: string): Promise<NoteContent> {
		return splitNote(await this.app.vault.read(this.file(path)));
	}

	async create(path: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
		const normalized = normalizePath(path);
		await this.app.vault.create(normalized, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
		this.taken.add(normalized.toLowerCase());
	}

	async trash(path: string): Promise<void> {
		await this.app.fileManager.trashFile(this.file(path));
		this.taken.delete(normalizePath(path).toLowerCase());
	}

	async ensureFolder(path: string): Promise<string> {
		const segments = normalizePath(path).split('/').filter((s) => s !== '' && s !== '/');
		let current = '';
		for (const segment of segments) {
			const wanted = current ? `${current}/${segment}` : segment;
			const exact = this.app.vault.getAbstractFileByPath(wanted);
			// Vault lookups are case-sensitive, but Windows and macOS file systems are not:
			// reuse an existing sibling that differs only in case instead of failing to create it.
			const parent = current ? this.app.vault.getFolderByPath(current) : this.app.vault.getRoot();
			const sibling = exact ?? parent?.children.find((child) => child.name.toLowerCase() === segment.toLowerCase()) ?? null;
			if (sibling instanceof TFolder) {
				current = sibling.path;
				continue;
			}
			if (sibling instanceof TFile) {
				throw new FieldyError('vault-write', `"${sibling.path}" is a file, so it cannot be used as a folder.`, { path: sibling.path });
			}
			try {
				await this.app.vault.createFolder(wanted);
			} catch (err) {
				// A concurrent create is fine as long as a folder now exists.
				if (!(this.app.vault.getAbstractFileByPath(wanted) instanceof TFolder)) throw err;
			}
			this.taken.add(wanted.toLowerCase());
			current = wanted;
		}
		return current;
	}

	async processNote(path: string, fn: (note: NoteContent) => WrittenNote | null): Promise<boolean> {
		let accepted = false;
		await this.app.vault.process(this.file(path), (content) => {
			const next = fn(splitNote(content));
			if (next === null) return content;
			accepted = true;
			return joinNote(content, next.body, next.meta);
		});
		return accepted;
	}

	async processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.file(path), fn);
	}
}

function splitNote(content: string): NoteContent {
	const info = getFrontMatterInfo(content);
	return { body: content.slice(info.contentStart), meta: info.exists ? metaFromYaml(info.frontmatter) : null };
}

/** The file with a new body and block properties; only those two property lines change in the YAML. */
function joinNote(content: string, body: string, meta: BlockMeta): string {
	const info = getFrontMatterInfo(content);
	if (!info.exists) return `---\n${setMetaInYaml('', meta)}---\n${body}`;
	return `${content.slice(0, info.from)}${setMetaInYaml(content.slice(info.from, info.to), meta)}${content.slice(info.to, info.contentStart)}${body}`;
}

/** `aliases` may be a list or a single comma-separated string. */
function aliasList(raw: unknown): string[] {
	if (typeof raw === 'string') return raw.split(',').map((a) => a.trim()).filter(Boolean);
	if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim());
	return [];
}
