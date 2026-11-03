import type { FieldyClient } from '../api/FieldyClient';
import type { FieldyConversation, FieldySharable, FieldyTask, FieldyTranscriptSegment, TimeRange } from '../api/types';
import type { PrivacyGuard, SettledVerdict } from '../privacy/PrivacyGuard';
import { describeMatches } from '../privacy/privacy';
import {
	applyManagedFrontmatter,
	buildCreationFrontmatter,
	buildManagedFrontmatter,
	displayTitle,
	renderConversationBody,
	renderKey,
	sameManagedFrontmatter,
	SYNC_CONTROL_KEY,
	withoutTranscript,
	type ConversationRenderInput,
} from '../markdown/ConversationRenderer';
import {
	BEGIN_TAG,
	blockMeta,
	composeBlock,
	END_MARKER,
	hashBlock,
	initialBody,
	isModified,
	metaFrontmatter,
	parseManagedBlock,
	replaceBlock,
	taskStates,
	type BlockMeta,
	type ManagedBlock,
	type NoteContent,
} from '../markdown/managedBlock';
import { safeId } from '../markdown/sanitize';
import { DEFAULT_PEOPLE_FOLDER, EMPTY_PEOPLE_INDEX, linkable, personKey, resolveSpeakerLinks, type PeopleIndex } from '../markdown/speakerLinks';
import { speakerName } from '../markdown/TranscriptRenderer';
import { shareLinkFields, taskStatusesFor, type FieldySyncSettings } from '../settings/settings';
import { daysBefore, type DateFormatter } from '../utils/dates';
import { FieldyError, isCancellation, toFieldyError } from '../utils/errors';
import { silentLogger, type Logger } from '../utils/logger';
import { inTimeRules } from '../utils/timeRules';
import { applyFilenamePattern, joinVaultPath, sanitizeFilename, sanitizeFolderPath, subfolderFor, uniqueNotePath } from '../utils/paths';
import { sourceFingerprint } from './fingerprint';
import type { NoteRef, NoteStore } from './NoteStore';
import { emptyCounts, type SyncCounts, type SyncRecord, type SyncRunSummary, type SyncState } from './SyncState';

export type FieldyApi = Pick<
	FieldyClient,
	| 'listConversations'
	| 'getConversation'
	| 'listTranscriptions'
	| 'listTasksByStatuses'
	| 'listSpeakerProfiles'
	| 'listMemoryTemplates'
	| 'listSharables'
	| 'createSharable'
	| 'completeTask'
>;

export type SyncTrigger = 'manual' | 'startup' | 'interval' | 'import' | 'refresh';

export interface SyncRequest {
	trigger: SyncTrigger;
	/** Time range to list; defaults to the configured sync window. */
	range?: TimeRange;
	/** Pre-fetched conversations (import dialog, single-note refresh). */
	conversations?: FieldyConversation[];
	/** Restricts the run to these conversation ids. */
	onlyIds?: ReadonlySet<string>;
	/** Create notes for conversations without one (defaults to the setting). */
	createNew?: boolean;
	/** Re-create notes the user deleted (defaults to the setting). */
	recreateDeleted?: boolean;
	/** Re-render even when nothing changed remotely (user edits are still protected). */
	force?: boolean;
	/** Destination folder for new notes (defaults to the setting). */
	folder?: string;
	signal?: AbortSignal;
}

export interface SyncProgress {
	phase: 'listing' | 'processing' | 'saving';
	done: number;
	total: number;
}

/**
 * What to do with a note the user edited: put the Fieldy version back and keep
 * the edited text below it ("keep-both"), put it back and drop the edits
 * ("overwrite"), or freeze the note for good ("stop-syncing").
 */
export type RestoreChoice = 'keep-both' | 'overwrite' | 'stop-syncing';

interface SyncEngineDeps {
	client: FieldyApi;
	store: NoteStore;
	state: SyncState;
	settings: () => FieldySyncSettings;
	formatDate: DateFormatter;
	now?: () => number;
	logger?: Logger;
	/** Privacy filters; without it, every conversation is public. */
	privacy?: PrivacyGuard;
	/** Told the author name of share links seen in Fieldy (to prefill the setting). */
	onShareAuthor?: (name: string) => void;
	/** Author name when the setting is empty: from the Fieldy account (its email name). */
	shareAuthorFallback?: () => Promise<string | null>;
}

export class SyncAlreadyRunningError extends FieldyError {
	constructor() {
		super('busy', 'A Fieldy sync is already running.');
		this.name = 'SyncAlreadyRunningError';
	}
}

const OPEN_STATUSES = new Set(['new', 'approved']);
const SAVE_EVERY = 25;

/** `fieldy_sync: false` pauses a note; a string "false" typed by hand counts too. */
export function isSyncPaused(frontmatter: Record<string, unknown> | null | undefined): boolean {
	const value = frontmatter?.[SYNC_CONTROL_KEY];
	return value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

function linkAbort(source: AbortSignal | undefined, target: AbortController): () => void {
	if (!source) return () => undefined;
	if (source.aborted) {
		target.abort();
		return () => undefined;
	}
	const onAbort = () => target.abort();
	source.addEventListener('abort', onAbort, { once: true });
	return () => source.removeEventListener('abort', onAbort);
}

function vaultError(err: unknown, path: string): FieldyError {
	if (err instanceof FieldyError) return err;
	const message = err instanceof Error ? err.message : String(err);
	return new FieldyError('vault-write', message, { path });
}

async function vaultOp<T>(path: string, op: () => Promise<T>): Promise<T> {
	try {
		return await op();
	} catch (err) {
		throw vaultError(err, path);
	}
}

function pickPrimary(refs: readonly NoteRef[], record: SyncRecord | undefined): NoteRef | undefined {
	if (refs.length === 0) return undefined;
	const tracked = record ? refs.find((r) => r.path === record.path) : undefined;
	return tracked ?? [...refs].sort((a, b) => a.path.localeCompare(b.path))[0];
}

/**
 * Imports and updates Fieldy conversations as notes. One run at a time;
 * every conversation is processed independently so one failure never aborts
 * the run.
 */
export class SyncEngine {
	private running = false;
	private controller: AbortController | null = null;
	onProgress: ((progress: SyncProgress) => void) | null = null;

	constructor(private readonly deps: SyncEngineDeps) {}

	get isRunning(): boolean {
		return this.running;
	}

	cancel(): void {
		this.controller?.abort();
	}

	async run(request: SyncRequest): Promise<SyncRunSummary> {
		return this.exclusive(request.signal, (signal) => new SyncRun(this.deps, request, signal, this.onProgress).execute());
	}

	/**
	 * Rewrites notes still using the old, long begin marker in the short form,
	 * moving its two values into properties. Block content is left exactly as
	 * it is, so edited notes stay edited. Returns how many notes changed.
	 */
	/** Applies the user's choice for an edited note. */
	async restoreFieldyVersion(id: string, resolution: RestoreChoice, signal?: AbortSignal): Promise<void> {
		await this.exclusive(signal, (inner) => new SyncRun(this.deps, { trigger: 'refresh', signal: inner }, inner, null).resolve(id, resolution));
	}

	private async exclusive<T>(external: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.running) throw new SyncAlreadyRunningError();
		this.running = true;
		const controller = new AbortController();
		this.controller = controller;
		const unlink = linkAbort(external, controller);
		try {
			return await fn(controller.signal);
		} finally {
			unlink();
			this.controller = null;
			this.running = false;
		}
	}
}

class SyncRun {
	private readonly settings: FieldySyncSettings;
	private readonly logger: Logger;
	private readonly now: () => number;
	private readonly counts: SyncCounts = emptyCounts();
	private readonly errors: SyncRunSummary['errors'] = [];
	private readonly createdIds: string[] = [];
	private readonly updatedIds: string[] = [];
	private readonly renderKey: string;
	private index = new Map<string, NoteRef[]>();
	private tasksByConversation = new Map<string, FieldyTask[]>();
	private speakerNameCache: Promise<Map<string, string>> | null = null;
	private templateCache: Promise<Map<string, string>> | null = null;
	private people: PeopleIndex | null = null;
	/** Transcripts already read for the privacy check, reused when rendering. */
	private readonly transcripts = new Map<string, FieldyTranscriptSegment[]>();
	/** Share links already read (or just created) for a new note, reused when rendering. */
	private readonly shareLinks = new Map<string, FieldySharable[]>();

	constructor(
		private readonly deps: SyncEngineDeps,
		private readonly request: SyncRequest,
		private readonly signal: AbortSignal,
		private readonly onProgress: ((progress: SyncProgress) => void) | null,
	) {
		const settings = deps.settings();
		// "Use Fieldy share links" off: no share link request of any kind.
		this.settings = settings.useShareLinks ? { ...settings } : { ...settings, includeShareLinks: false, createShareLinks: false };
		this.logger = deps.logger ?? silentLogger;
		this.now = deps.now ?? (() => Date.now());
		this.renderKey = renderKey(this.settings);
	}

	private nowIso(): string {
		return new Date(this.now()).toISOString();
	}

	private progress(phase: SyncProgress['phase'], done: number, total: number): void {
		try {
			this.onProgress?.({ phase, done, total });
		} catch {
			// Progress reporting must never break a sync.
		}
	}

	// ----------------------------------------------------------------- run

	async execute(): Promise<SyncRunSummary> {
		const startedAt = this.nowIso();
		let cancelled = false;
		let fatal: string | null = null;
		let fatalKind: string | null = null;
		try {
			// Template names are read again each run, so a renamed template is matched by its new name.
			this.deps.privacy?.forgetTemplates();
			const conversations = await this.loadConversations();
			if (conversations.length > 0) {
				this.tasksByConversation = await this.loadTasks();
				this.index = await this.deps.store.indexByFieldyId();
			}
			this.counts.scanned = conversations.length;
			for (let i = 0; i < conversations.length; i++) {
				if (this.signal.aborted) {
					cancelled = true;
					break;
				}
				const conversation = conversations[i]!;
				this.progress('processing', i, conversations.length);
				try {
					await this.processConversation(conversation);
				} catch (err) {
					if (isCancellation(err)) {
						cancelled = true;
						break;
					}
					this.counts.failed++;
					const error = toFieldyError(err);
					this.errors.push({ id: conversation.id, title: displayTitle(conversation), kind: error.kind, message: error.userMessage });
					this.logger.warn(`Failed to sync conversation ${conversation.id}`, err);
				}
				if ((i + 1) % SAVE_EVERY === 0) await this.saveState();
			}
			if (!cancelled) this.progress('processing', conversations.length, conversations.length);
		} catch (err) {
			if (isCancellation(err)) cancelled = true;
			else {
				const error = toFieldyError(err);
				fatal = error.userMessage;
				fatalKind = error.kind;
				this.logger.warn('Sync failed', err);
			}
		}
		const summary: SyncRunSummary = {
			trigger: this.request.trigger,
			startedAt,
			finishedAt: this.nowIso(),
			counts: this.counts,
			cancelled,
			fatal,
			fatalKind,
			errors: this.errors.slice(0, 50),
			createdIds: this.createdIds,
			updatedIds: this.updatedIds,
		};
		this.deps.state.lastRun = summary;
		this.progress('saving', this.counts.scanned, this.counts.scanned);
		await this.saveState();
		return summary;
	}

	private async saveState(): Promise<void> {
		try {
			await this.deps.state.save();
		} catch (err) {
			this.logger.error('Could not save the sync index', err);
		}
	}

	private async loadConversations(): Promise<FieldyConversation[]> {
		const s = this.settings;
		let items: FieldyConversation[];
		if (this.request.conversations) {
			items = this.request.conversations;
		} else {
			const nowMs = this.now();
			const range = this.request.range ?? { startTime: daysBefore(nowMs, s.syncWindowDays), endTime: new Date(nowMs).toISOString() };
			this.progress('listing', 0, 0);
			const result = await this.deps.client.listConversations(
				{ ...range, recordingSource: s.recordingSource === 'all' ? undefined : s.recordingSource },
				{ signal: this.signal, onPage: (loaded) => this.progress('listing', loaded, 0) },
			);
			this.counts.malformedItems += result.skipped;
			items = result.items;
		}
		const only = this.request.onlyIds;
		// Like brief conversations, the sync times only limit regular syncs, not explicit imports and refreshes.
		const times = s.syncTimeRules;
		const filtered = items.filter((c) => {
			if (only) return only.has(c.id);
			if (!s.includeBrief && c.type.toUpperCase() === 'BRIEF') return false;
			if (times.length > 0 && !inTimeRules(c.startTime, times)) {
				this.counts.skippedSchedule++;
				return false;
			}
			return true;
		});
		// Oldest first, so name suffixes for duplicate titles are stable.
		return filtered.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
	}

	private async loadTasks(): Promise<Map<string, FieldyTask[]>> {
		const byConversation = new Map<string, FieldyTask[]>();
		const statuses = taskStatusesFor(this.settings);
		if (statuses.length === 0) return byConversation;
		const tasks = await this.deps.client.listTasksByStatuses(statuses, { signal: this.signal });
		for (const task of tasks) {
			if (!task.memoryId) continue;
			const list = byConversation.get(task.memoryId) ?? [];
			list.push(task);
			byConversation.set(task.memoryId, list);
		}
		return byConversation;
	}

	// ------------------------------------------------------- classification

	/**
	 * Whether the conversation is private. Only a conversation that would be
	 * written (or already has a note) costs requests (template names, the
	 * transcript); for the others the cheap answer is enough, and null means
	 * "not checked": such a conversation gets no note in this run anyway.
	 */
	private async privacyOf(conversation: FieldyConversation, worthResolving: boolean): Promise<SettledVerdict | null> {
		const guard = this.deps.privacy;
		if (!guard) return { state: 'public' };
		const known = guard.check(conversation);
		if (known.state !== 'pending') return known;
		if (!worthResolving) return null;
		const { verdict, transcript } = await guard.resolve(conversation, this.signal);
		if (transcript) this.transcripts.set(conversation.id, transcript);
		return verdict;
	}

	/** Whether a conversation without a note would get one in this run. */
	private wouldCreate(conversation: FieldyConversation, record: SyncRecord | undefined): boolean {
		const recreate = this.request.recreateDeleted ?? this.settings.recreateDeleted;
		if (record && !recreate) return false;
		if (!record && !(this.request.createNew ?? this.settings.importNewOnSync)) return false;
		return !conversation.locked;
	}

	private async processConversation(conversation: FieldyConversation): Promise<void> {
		const tasks = this.tasksByConversation.get(conversation.id) ?? [];
		const refs = this.index.get(conversation.id) ?? [];
		const record = this.deps.state.get(conversation.id);
		const existing = pickPrimary(refs, record);
		const verdict = await this.privacyOf(conversation, existing !== undefined || this.wouldCreate(conversation, record));
		if (verdict?.state === 'private') {
			await this.keepPrivate(conversation, refs, record, describeMatches(verdict.matches));
			return;
		}
		// Unknown (null) only when nothing would be written anyway: the usual skips below apply.
		if (this.settings.linkSpeakers && this.settings.createSpeakerNotes && !conversation.locked) {
			const willHaveNote = existing ? !isSyncPaused(existing.frontmatter) : !record && (this.request.createNew ?? this.settings.importNewOnSync);
			if (willHaveNote) await this.ensurePeopleNotes(conversation.speakers);
		}
		const source = this.fingerprint(conversation, tasks);
		if (refs.length > 1) {
			this.counts.duplicates++;
			this.logger.warn(`Found ${refs.length} notes for Fieldy conversation ${conversation.id}; updating ${existing?.path ?? ''} only.`);
		}
		if (!existing) await this.handleMissing(conversation, record, tasks, source);
		else await this.handleExisting(conversation, existing, record, tasks, source);
	}

	private async handleMissing(conversation: FieldyConversation, record: SyncRecord | undefined, tasks: FieldyTask[], source: string): Promise<void> {
		const recreate = this.request.recreateDeleted ?? this.settings.recreateDeleted;
		if (record && !recreate) {
			// Imported before and since removed from the vault: respect the deletion.
			if (record.status !== 'deleted') this.deps.state.set(conversation.id, { ...record, status: 'deleted' });
			this.counts.skippedDeleted++;
			return;
		}
		const createNew = this.request.createNew ?? this.settings.importNewOnSync;
		if (!record && !createNew) {
			this.counts.skippedNew++;
			return;
		}
		if (conversation.locked) {
			this.counts.skippedLocked++;
			return;
		}
		await this.createNote(conversation, tasks, source);
	}

	private async handleExisting(
		conversation: FieldyConversation,
		ref: NoteRef,
		record: SyncRecord | undefined,
		initialTasks: FieldyTask[],
		initialSource: string,
	): Promise<void> {
		const s = this.settings;
		let tasks = initialTasks;
		let source = initialSource;
		if (isSyncPaused(ref.frontmatter)) {
			this.upsert(conversation, ref.path, record, { status: 'paused' });
			this.counts.skippedPaused++;
			return;
		}
		if (conversation.locked) {
			// Never replace real content with the plan-redacted version.
			this.counts.skippedLocked++;
			return;
		}

		const wantsTaskPush = s.pushTaskCompletion && tasks.some((t) => OPEN_STATUSES.has(t.status));
		// The note can only have been edited (or ticked) if its file changed since the plugin last read or wrote it.
		const untouchedSinceLastCheck =
			record?.localMtime !== undefined && ref.mtime !== null && record.localMtime === ref.mtime && record.path === ref.path;
		if (!this.request.force && record?.status === 'edited' && untouchedSinceLastCheck) {
			// The user's edited version: never updated, and nothing changed locally since we last looked.
			this.counts.edited++;
			return;
		}
		const indexSaysUnchanged =
			!this.request.force && record?.status === 'synced' && record.path === ref.path && record.sourceHash === source;
		if (indexSaysUnchanged && untouchedSinceLastCheck) {
			this.counts.unchanged++;
			return;
		}

		const note = await vaultOp(ref.path, () => this.deps.store.readNote(ref.path));
		const parsed = parseManagedBlock(note.body, note.meta);
		if (parsed.status !== 'ok') {
			const reason =
				parsed.status === 'missing'
					? 'The Fieldy section markers were removed, so the whole note is yours.'
					: `The Fieldy section markers were changed (${parsed.reason}).`;
			this.markEdited(conversation, ref.path, record, reason);
			return;
		}
		const block = parsed.block;
		const localStates = taskStates(block.inner);

		if (wantsTaskPush) {
			const pushed = await this.pushCompletions(tasks, localStates);
			if (pushed !== tasks) {
				tasks = pushed;
				this.tasksByConversation.set(conversation.id, tasks);
				source = this.fingerprint(conversation, tasks);
			}
		}

		if (isModified(block)) {
			// Edits win: the note becomes the user's edited version and is left exactly as written.
			// The original stays in Fieldy (viewable in the side panel) and can be restored on request.
			this.markEdited(conversation, ref.path, record, 'You edited the Fieldy section in Obsidian.');
			return;
		}
		if (!this.request.force && block.meta?.source === source) {
			// Nothing new from Fieldy since this note was written; leave it alone.
			this.upsert(conversation, ref.path, record, { status: 'synced', sourceHash: source, contentHash: block.meta.hash, editedReason: undefined });
			this.counts.unchanged++;
			return;
		}

		const input = await this.renderInput(conversation, tasks, localStates);
		const inner = renderConversationBody(input, s, this.deps.formatDate);
		const newBody = replaceBlock(block, inner);
		const meta = blockMeta(inner, source);
		const managed = buildManagedFrontmatter(input, s, this.deps.formatDate, this.nowIso());
		const frontmatterChanged = !sameManagedFrontmatter(ref.frontmatter ?? {}, managed);
		if (newBody === note.body && sameMeta(block.meta, meta) && !block.outdated && !frontmatterChanged) {
			this.upsert(conversation, ref.path, record, { status: 'synced', sourceHash: source, contentHash: hashBlock(inner) });
			this.counts.unchanged++;
			return;
		}

		// Managed properties first: if the second write fails, `fieldy_src` still
		// holds the old fingerprint and the next sync retries the whole update.
		// The body and its `fieldy_hash`/`fieldy_src` are always written together.
		await vaultOp(ref.path, () => this.deps.store.processFrontmatter(ref.path, (fm) => applyManagedFrontmatter(fm, managed)));
		const expectedHash = hashBlock(block.inner);
		const written = await vaultOp(ref.path, () =>
			this.deps.store.processNote(ref.path, (current) => {
				const again = parseManagedBlock(current.body, current.meta);
				if (again.status !== 'ok' || hashBlock(again.block.inner) !== expectedHash) return null;
				return { body: replaceBlock(again.block, inner), meta };
			}),
		);
		if (!written) {
			this.markEdited(conversation, ref.path, record, 'You edited the Fieldy section while a sync was running.');
			return;
		}
		this.upsert(conversation, ref.path, record, { status: 'synced', sourceHash: source, contentHash: hashBlock(inner), editedReason: undefined });
		this.counts.updated++;
		this.updatedIds.push(conversation.id);
	}

	/**
	 * A privacy filter matches: no note is created. A note from before is kept
	 * exactly as it is but no longer updated (its banner says why), or, with
	 * "Move notes of private conversations to the trash", moved to the trash
	 * and forgotten, so removing the filter imports the conversation again.
	 */
	private async keepPrivate(conversation: FieldyConversation, refs: readonly NoteRef[], record: SyncRecord | undefined, reason: string): Promise<void> {
		this.counts.skippedPrivate++;
		const primary = pickPrimary(refs, record);
		if (primary && this.settings.deletePrivateNotes) {
			for (const ref of refs) {
				await vaultOp(ref.path, () => this.deps.store.trash(ref.path));
				this.counts.privateTrashed++;
			}
			this.index.delete(conversation.id);
			this.deps.state.delete(conversation.id);
			return;
		}
		if (primary) this.upsert(conversation, primary.path, record, { status: 'private', privateReason: reason, editedReason: undefined });
		else if (record?.status === 'private') this.deps.state.set(conversation.id, { ...record, status: 'deleted', privateReason: undefined });
	}

	// ---------------------------------------------------------------- writes

	private async createNote(conversation: FieldyConversation, tasks: FieldyTask[], source: string): Promise<void> {
		const s = this.settings;
		const fmt = this.deps.formatDate;
		const folder = joinVaultPath(sanitizeFolderPath(this.request.folder ?? s.folder), subfolderFor(s.subfolders, conversation.startTime, fmt, s.subfolderFormat));
		const basename = applyFilenamePattern(
			s.filenamePattern,
			{ title: conversation.title, startTime: conversation.startTime, id: conversation.id },
			s.filenameDateFormat,
			fmt,
		);
		if (s.createShareLinks) await this.ensureShareLink(conversation);
		const input = await this.renderInput(conversation, tasks, undefined);
		const inner = renderConversationBody(input, s, fmt);
		const frontmatter = {
			...buildManagedFrontmatter(input, s, fmt, this.nowIso()),
			...buildCreationFrontmatter(conversation, s),
			...metaFrontmatter(blockMeta(inner, source)),
		};
		const body = initialBody(inner);

		// The folder may already exist with different letter case; use its real path.
		const target = folder ? await vaultOp(folder, () => this.deps.store.ensureFolder(folder)) : '';
		let path = uniqueNotePath(target, basename, (p) => this.deps.store.isTaken(p));
		try {
			await this.deps.store.create(path, frontmatter, body);
		} catch (err) {
			// Another process may have taken the name between the check and the write.
			if (!this.deps.store.isTaken(path)) throw vaultError(err, path);
			path = uniqueNotePath(target, basename, (p) => this.deps.store.isTaken(p));
			await vaultOp(path, () => this.deps.store.create(path, frontmatter, body));
		}
		this.index.set(conversation.id, [{ path, frontmatter, mtime: this.deps.store.mtime(path) }]);
		this.upsert(conversation, path, undefined, { status: 'synced', sourceHash: source, contentHash: hashBlock(inner) });
		this.counts.created++;
		this.createdIds.push(conversation.id);
	}

	/**
	 * "Create a share link for new notes": gives the conversation a Fieldy
	 * share link unless it has one (enabled or not: a link the user turned off
	 * stays off). A failure never stops the note from being created.
	 */
	private async ensureShareLink(conversation: FieldyConversation): Promise<void> {
		try {
			const author = this.settings.shareLinkAuthor.trim() || ((await this.deps.shareAuthorFallback?.()) ?? '');
			if (!author) {
				this.counts.shareLinksNoAuthor++;
				return;
			}
			const existing = await this.deps.client.listSharables(conversation.id, { signal: this.signal });
			const seen = existing.find((l) => l.authorName.trim() !== '')?.authorName;
			if (seen) this.deps.onShareAuthor?.(seen);
			if (existing.length > 0) {
				this.shareLinks.set(conversation.id, existing);
				return;
			}
			const created = await this.deps.client.createSharable(
				{ conversationId: conversation.id, authorName: author, sharedFields: shareLinkFields(this.settings) },
				{ signal: this.signal },
			);
			this.shareLinks.set(conversation.id, [created]);
			this.counts.shareLinksCreated++;
		} catch (err) {
			if (isCancellation(err)) throw err;
			this.counts.shareLinksFailed++;
			this.logger.warn(`Could not create a share link for conversation ${conversation.id}`, err);
		}
	}

	private upsert(conversation: FieldyConversation, path: string, record: SyncRecord | undefined, changes: Partial<SyncRecord>): void {
		const localMtime = this.deps.store.mtime(path) ?? record?.localMtime;
		this.deps.state.set(conversation.id, {
			path,
			title: displayTitle(conversation),
			startTime: conversation.startTime,
			sourceHash: record?.sourceHash ?? '',
			contentHash: record?.contentHash ?? '',
			remoteUpdatedAt: conversation.updatedAt,
			syncedAt: changes.status === 'synced' && changes.sourceHash !== record?.sourceHash ? this.nowIso() : (record?.syncedAt ?? this.nowIso()),
			status: 'synced',
			...(localMtime !== undefined ? { localMtime } : {}),
			...changes,
		});
	}

	/** Records the note as the user's edited version; nothing is written to it. */
	private markEdited(conversation: FieldyConversation, path: string, record: SyncRecord | undefined, reason: string): void {
		if (record?.status !== 'edited') this.counts.newlyEdited++;
		this.upsert(conversation, path, record, { status: 'edited', editedReason: reason });
		this.counts.edited++;
	}

	/** Opt-in: marks tasks completed in Fieldy when they were ticked in the note. */
	private async pushCompletions(tasks: FieldyTask[], localStates: ReadonlyMap<string, string>): Promise<FieldyTask[]> {
		let changed = false;
		const result: FieldyTask[] = [];
		for (const task of tasks) {
			const box = localStates.get(safeId(task.id));
			if (OPEN_STATUSES.has(task.status) && (box === 'x' || box === 'X')) {
				const completionDate = this.nowIso();
				const updated = await this.deps.client.completeTask(task.id, completionDate, { signal: this.signal });
				result.push(updated ?? { ...task, status: 'completed', completionDate });
				this.counts.tasksPushed++;
				changed = true;
			} else {
				result.push(task);
			}
		}
		return changed ? result : tasks;
	}

	// -------------------------------------------------------------- render

	/** People notes, read once per run (only when speaker links are on). */
	private peopleIndex(): PeopleIndex {
		if (!this.settings.linkSpeakers) return EMPTY_PEOPLE_INDEX;
		this.people ??= this.deps.store.peopleIndex(this.settings.peopleFolder);
		return this.people;
	}

	/** Creates an empty people note for each speaker without one (ambiguous and generic names excepted). */
	private async ensurePeopleNotes(speakers: readonly string[]): Promise<void> {
		const index = this.peopleIndex();
		const folder = sanitizeFolderPath(this.settings.peopleFolder) || DEFAULT_PEOPLE_FOLDER;
		let created = false;
		for (const raw of speakers) {
			const name = raw.replace(/\s+/g, ' ').trim();
			const key = personKey(name);
			if (!linkable(name) || index.targets.has(key) || index.ambiguous.has(key)) continue;
			const basename = sanitizeFilename(name);
			const target = await vaultOp(folder, () => this.deps.store.ensureFolder(folder));
			const path = joinVaultPath(target, `${basename}.md`);
			// Something already has that name (maybe a note outside the people folder): never overwrite or duplicate it.
			if (this.deps.store.isTaken(path)) continue;
			const frontmatter: Record<string, unknown> = { fieldy_speaker: name };
			if (basename !== name) frontmatter.aliases = [name];
			await vaultOp(path, () => this.deps.store.create(path, frontmatter, ''));
			this.counts.peopleCreated++;
			created = true;
		}
		if (created) this.people = null;
	}

	private fingerprint(conversation: FieldyConversation, tasks: readonly FieldyTask[]): string {
		return sourceFingerprint(conversation, tasks, this.renderKey, resolveSpeakerLinks(conversation.speakers, this.peopleIndex()));
	}

	private speakerNames(): Promise<Map<string, string>> {
		this.speakerNameCache ??= this.deps.client
			.listSpeakerProfiles({ signal: this.signal })
			.then((profiles) => new Map(profiles.map((p) => [p.id, p.name])))
			.catch((err: unknown) => {
				if (isCancellation(err)) throw err;
				this.logger.warn('Could not load speaker profiles; using transcript labels.', err);
				return new Map<string, string>();
			});
		return this.speakerNameCache;
	}

	private templates(): Promise<Map<string, string>> {
		this.templateCache ??= this.deps.client
			.listMemoryTemplates({ signal: this.signal })
			.then((templates) => new Map(templates.map((t) => [t.id, t.title])))
			.catch((err: unknown) => {
				if (isCancellation(err)) throw err;
				this.logger.warn('Could not load memory templates.', err);
				return new Map<string, string>();
			});
		return this.templateCache;
	}

	private async renderInput(
		conversation: FieldyConversation,
		tasks: readonly FieldyTask[],
		localTaskStates: ReadonlyMap<string, string> | undefined,
	): Promise<ConversationRenderInput> {
		const s = this.settings;
		const prefetched = this.transcripts.get(conversation.id);
		this.transcripts.delete(conversation.id);
		const transcript = !s.includeTranscript
			? null
			: prefetched
				? prefetched
				: await this.deps.client.listTranscriptions(
					{
						startTime: conversation.startTime,
						endTime: conversation.endTime ?? this.nowIso(),
						conversationId: conversation.id,
						recordingSource: s.recordingSource === 'all' ? undefined : s.recordingSource,
					},
					{ signal: this.signal },
				);
		const speakerNames = transcript?.some((seg) => seg.speakerProfileId) ? await this.speakerNames() : new Map<string, string>();
		const templateName = conversation.templateId ? ((await this.templates()).get(conversation.templateId) ?? null) : null;
		const knownLinks = this.shareLinks.get(conversation.id);
		this.shareLinks.delete(conversation.id);
		const shareLinks = !s.includeShareLinks ? [] : (knownLinks ?? (await this.deps.client.listSharables(conversation.id, { signal: this.signal })));
		const transcriptNames = s.linkTranscriptSpeakers && transcript ? transcript.map((seg) => speakerName(seg, speakerNames)) : [];
		const speakerLinks = resolveSpeakerLinks([...conversation.speakers, ...transcriptNames], this.peopleIndex());
		return { conversation, tasks, transcript, speakerNames, templateName, shareLinks, localTaskStates, speakerLinks };
	}

	// --------------------------------------------------------- edited notes

	async resolve(id: string, resolution: RestoreChoice): Promise<void> {
		const store = this.deps.store;
		const record = this.deps.state.get(id);
		this.index = await store.indexByFieldyId();
		const ref = pickPrimary(this.index.get(id) ?? [], record);
		if (!ref) throw new FieldyError('not-found', 'The note for this conversation no longer exists in the vault.');

		if (resolution === 'stop-syncing') {
			await vaultOp(ref.path, () =>
				store.processFrontmatter(ref.path, (fm) => {
					fm[SYNC_CONTROL_KEY] = false;
				}),
			);
			this.deps.state.set(id, { ...(record ?? this.placeholderRecord(ref.path)), path: ref.path, status: 'paused' });
			await this.saveState();
			return;
		}

		const conversation = await this.deps.client.getConversation(id, { signal: this.signal });
		if (!conversation) throw new FieldyError('not-found', 'This conversation no longer exists in Fieldy.');
		// Same rule as regular syncs: never replace real content with the plan-redacted version.
		if (conversation.locked) throw new FieldyError('locked', 'The conversation is locked by the Fieldy plan.');
		if (this.deps.privacy) {
			const { verdict, transcript } = await this.deps.privacy.resolve(conversation, this.signal);
			if (verdict.state === 'private') {
				this.upsert(conversation, ref.path, record, { status: 'private', privateReason: describeMatches(verdict.matches), editedReason: undefined });
				await this.saveState();
				throw new FieldyError('private', describeMatches(verdict.matches));
			}
			if (transcript) this.transcripts.set(id, transcript);
		}
		const statuses = taskStatusesFor(this.settings);
		const tasks =
			statuses.length > 0
				? (await this.deps.client.listTasksByStatuses(statuses, { signal: this.signal })).filter((t) => t.memoryId === id)
				: [];
		const source = this.fingerprint(conversation, tasks);
		const note = await vaultOp(ref.path, () => store.readNote(ref.path));
		const current = parseManagedBlock(note.body, note.meta);
		const input = await this.renderInput(conversation, tasks, current.status === 'ok' ? taskStates(current.block.inner) : undefined);
		const inner = renderConversationBody(input, this.settings, this.deps.formatDate);
		const managed = buildManagedFrontmatter(input, this.settings, this.deps.formatDate, this.nowIso());
		const keptOn = this.deps.formatDate(this.nowIso(), 'YYYY-MM-DD HH:mm');

		await vaultOp(ref.path, () =>
			store.processFrontmatter(ref.path, (fm) => {
				applyManagedFrontmatter(fm, managed);
				delete fm[SYNC_CONTROL_KEY];
			}),
		);
		await vaultOp(ref.path, () => store.processNote(ref.path, (now) => ({ body: resolvedBody(now, inner, resolution, keptOn, this.settings.keepTranscriptInEditedCopy), meta: blockMeta(inner, source) })));
		this.upsert(conversation, ref.path, record, { status: 'synced', sourceHash: source, contentHash: hashBlock(inner), editedReason: undefined });
		await this.saveState();
	}

	private placeholderRecord(path: string): SyncRecord {
		return { path, title: '', startTime: '', sourceHash: '', contentHash: '', remoteUpdatedAt: null, syncedAt: this.nowIso(), status: 'synced' };
	}
}

/** Strips every managed marker line, keeping the text between them. */
function stripMarkers(body: string): string {
	return body
		.split('\n')
		.filter((line) => !line.startsWith(BEGIN_TAG) && line.trim() !== END_MARKER)
		.join('\n');
}

function keptCopy(block: ManagedBlock, keptOn: string, withTranscript: boolean): string {
	const kept = withTranscript ? block.inner : withoutTranscript(block.inner);
	return `\n\n## Your edited version (kept ${keptOn})\n\n${kept.trim()}\n`;
}

/**
 * Body after restoring the Fieldy version of an edited note. "keep-both" writes the fresh Fieldy
 * content into the managed block and preserves the edited copy right after
 * it, outside the markers. "overwrite" replaces the block. Without a usable
 * block, both keep the existing text and append a fresh block.
 */
function resolvedBody(note: NoteContent, inner: string, resolution: RestoreChoice, keptOn: string, withTranscript: boolean): string {
	const parsed = parseManagedBlock(note.body, note.meta);
	if (parsed.status === 'ok') {
		const block = parsed.block;
		if (resolution === 'keep-both') {
			return `${block.before}${composeBlock(inner)}${keptCopy(block, keptOn, withTranscript)}${block.after}`;
		}
		return replaceBlock(block, inner);
	}
	const kept = stripMarkers(note.body).replace(/\s+$/, '');
	return `${kept}${kept ? '\n\n' : ''}${initialBody(inner)}`;
}

function sameMeta(a: BlockMeta | null, b: BlockMeta): boolean {
	return a !== null && a.hash === b.hash && a.source === b.source;
}
