/*
 * Lightweight sync index persisted in the plugin's data.json. It speeds up
 * change detection (no file reads for unchanged conversations), remembers
 * notes the user deleted (so they are not re-created) and lists edited notes.
 * It is a cache: identity comes from `fieldy_id` in frontmatter and change
 * detection data also lives in each note's managed-block marker, so resetting
 * the index never causes duplicates.
 */

/**
 * - `synced`: the note matches what the plugin last wrote and receives updates.
 * - `edited`: the user changed the Fieldy section; the note is left as written
 *   and receives no updates (the original remains in Fieldy).
 * - `deleted`: imported before, then removed from the vault.
 * - `paused`: the user set `fieldy_sync: false`.
 * - `private`: a privacy filter matches the conversation; its note (from
 *   before the filter) is kept as it is and receives no updates.
 */
type RecordStatus = 'synced' | 'edited' | 'deleted' | 'paused' | 'private';

export interface SyncRecord {
	path: string;
	title: string;
	startTime: string;
	sourceHash: string;
	contentHash: string;
	remoteUpdatedAt: string | null;
	syncedAt: string;
	status: RecordStatus;
	/** Why the note counts as edited (markers removed, section edited...). */
	editedReason?: string;
	/** Which privacy filters match (status `private`), e.g. `keyword "doctor"`. */
	privateReason?: string;
	/** File modification time when the plugin last read or wrote the note. */
	localMtime?: number;
}

export interface SyncCounts {
	scanned: number;
	created: number;
	updated: number;
	unchanged: number;
	/** Notes kept as the user edited them (including ones seen before). */
	edited: number;
	/** Notes found edited for the first time in this run. */
	newlyEdited: number;
	skippedLocked: number;
	skippedDeleted: number;
	skippedPaused: number;
	skippedNew: number;
	/** Conversations kept out by a privacy filter. */
	skippedPrivate: number;
	/** Notes of private conversations moved to the trash (setting "Move notes of private conversations to the trash"). */
	privateTrashed: number;
	/** Share links created for new notes. */
	shareLinksCreated: number;
	/** Share links that could not be created (the notes were created anyway). */
	shareLinksFailed: number;
	/** New notes that got no share link because no author name is set. */
	shareLinksNoAuthor: number;
	/** Conversations that started outside the "sync only at" times. */
	skippedSchedule: number;
	failed: number;
	tasksPushed: number;
	duplicates: number;
	malformedItems: number;
	/** People notes created for new speakers. */
	peopleCreated: number;
}

export interface SyncRunSummary {
	trigger: string;
	startedAt: string;
	finishedAt: string;
	counts: SyncCounts;
	cancelled: boolean;
	/** User-facing message of a failure that stopped the run. */
	fatal: string | null;
	/** Category of that failure; safe to share. */
	fatalKind: string | null;
	errors: SyncErrorEntry[];
	/** Conversations whose note this run created. */
	createdIds: string[];
	/** Conversations whose note this run updated. */
	updatedIds: string[];
}

interface SyncErrorEntry {
	id: string;
	title: string;
	/** Error category; safe to share (no titles or paths). */
	kind: string;
	/** User-facing message; may contain note paths. */
	message: string;
}

export interface SyncStateData {
	version: 1;
	records: Record<string, SyncRecord>;
	lastRun: SyncRunSummary | null;
}

export function emptySyncState(): SyncStateData {
	return { version: 1, records: {}, lastRun: null };
}

export function emptyCounts(): SyncCounts {
	return {
		scanned: 0,
		created: 0,
		updated: 0,
		unchanged: 0,
		edited: 0,
		newlyEdited: 0,
		skippedLocked: 0,
		skippedDeleted: 0,
		skippedPaused: 0,
		skippedNew: 0,
		skippedPrivate: 0,
		skippedSchedule: 0,
		privateTrashed: 0,
		shareLinksCreated: 0,
		shareLinksFailed: 0,
		shareLinksNoAuthor: 0,
		failed: 0,
		tasksPushed: 0,
		duplicates: 0,
		malformedItems: 0,
		peopleCreated: 0,
	};
}

const STATUSES: readonly RecordStatus[] = ['synced', 'edited', 'deleted', 'paused', 'private'];

function statusOf(value: unknown): RecordStatus | null {
	return typeof value === 'string' && (STATUSES as readonly string[]).includes(value) ? (value as RecordStatus) : null;
}

function isRecord(value: unknown): value is Omit<SyncRecord, 'status'> & { status: string } {
	if (typeof value !== 'object' || value === null) return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.path === 'string' &&
		typeof r.sourceHash === 'string' &&
		typeof r.contentHash === 'string' &&
		typeof r.syncedAt === 'string' &&
		statusOf(r.status) !== null
	);
}

/** Validates persisted state; invalid entries are dropped (they are only a cache). */
export function sanitizeSyncState(raw: unknown): SyncStateData {
	const state = emptySyncState();
	if (typeof raw !== 'object' || raw === null) return state;
	const r = raw as { records?: unknown; lastRun?: unknown };
	if (typeof r.records === 'object' && r.records !== null) {
		for (const [id, record] of Object.entries(r.records as Record<string, unknown>)) {
			if (isRecord(record)) {
				const reason = (record as { editedReason?: unknown }).editedReason;
				const privateReason = (record as { privateReason?: unknown }).privateReason;
				state.records[id] = {
					path: record.path,
					title: typeof record.title === 'string' ? record.title : '',
					startTime: typeof record.startTime === 'string' ? record.startTime : '',
					sourceHash: record.sourceHash,
					contentHash: record.contentHash,
					remoteUpdatedAt: typeof record.remoteUpdatedAt === 'string' ? record.remoteUpdatedAt : null,
					syncedAt: record.syncedAt,
					status: statusOf(record.status) ?? 'synced',
					...(typeof reason === 'string' ? { editedReason: reason } : {}),
					...(typeof privateReason === 'string' ? { privateReason } : {}),
					...(typeof record.localMtime === 'number' && Number.isFinite(record.localMtime) ? { localMtime: record.localMtime } : {}),
				};
			}
		}
	}
	state.lastRun = sanitizeRunSummary(r.lastRun);
	return state;
}

function sanitizeRunSummary(raw: unknown): SyncRunSummary | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.finishedAt !== 'string' || typeof r.counts !== 'object' || r.counts === null) return null;
	const counts = emptyCounts();
	const stored = r.counts as Record<string, unknown>;
	for (const key of Object.keys(counts) as (keyof SyncCounts)[]) {
		const value = stored[key];
		if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value;
	}
	const errors: SyncErrorEntry[] = [];
	if (Array.isArray(r.errors)) {
		for (const e of r.errors as unknown[]) {
			if (typeof e !== 'object' || e === null) continue;
			const entry = e as Record<string, unknown>;
			errors.push({
				id: typeof entry.id === 'string' ? entry.id : '',
				title: typeof entry.title === 'string' ? entry.title : '',
				kind: typeof entry.kind === 'string' ? entry.kind : 'unknown',
				message: typeof entry.message === 'string' ? entry.message : '',
			});
		}
	}
	return {
		trigger: typeof r.trigger === 'string' ? r.trigger : 'manual',
		startedAt: typeof r.startedAt === 'string' ? r.startedAt : r.finishedAt,
		finishedAt: r.finishedAt,
		counts,
		cancelled: r.cancelled === true,
		fatal: typeof r.fatal === 'string' ? r.fatal : null,
		fatalKind: typeof r.fatalKind === 'string' ? r.fatalKind : typeof r.fatal === 'string' ? 'unknown' : null,
		errors,
		createdIds: stringList(r.createdIds),
		updatedIds: stringList(r.updatedIds),
	};
}

function stringList(raw: unknown): string[] {
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Combines the in-memory index with one written by another device (e.g.
 * delivered by Obsidian Sync). Records from both sides are kept; when both
 * know a conversation, the more recently synced record wins, and the local
 * one wins ties. The most recent run summary is kept.
 */
export function mergeSyncState(local: SyncStateData, external: SyncStateData): SyncStateData {
	const records: Record<string, SyncRecord> = { ...external.records };
	for (const [id, record] of Object.entries(local.records)) {
		const other = records[id];
		if (!other || record.syncedAt >= other.syncedAt) records[id] = record;
	}
	const lastRun =
		local.lastRun && external.lastRun
			? local.lastRun.finishedAt >= external.lastRun.finishedAt
				? local.lastRun
				: external.lastRun
			: (local.lastRun ?? external.lastRun);
	return { version: 1, records, lastRun };
}

export class SyncState {
	constructor(
		private data: SyncStateData,
		private readonly persist: (data: SyncStateData) => Promise<void>,
	) {}

	get(id: string): SyncRecord | undefined {
		return this.data.records[id];
	}

	set(id: string, record: SyncRecord): void {
		this.data.records[id] = record;
	}

	delete(id: string): void {
		delete this.data.records[id];
	}

	entries(): [string, SyncRecord][] {
		return Object.entries(this.data.records);
	}

	/** Notes kept from before a privacy filter matched their conversation. */
	privateNotes(): [string, SyncRecord][] {
		return this.entries().filter(([, r]) => r.status === 'private');
	}

	/** Notes the user edited, which sync leaves as written. */
	edited(): [string, SyncRecord][] {
		return this.entries().filter(([, r]) => r.status === 'edited');
	}

	get size(): number {
		return Object.keys(this.data.records).length;
	}

	get lastRun(): SyncRunSummary | null {
		return this.data.lastRun;
	}

	set lastRun(summary: SyncRunSummary | null) {
		this.data.lastRun = summary;
	}

	/** Updates the path of a record after the user renamed or moved a note. */
	renamePath(oldPath: string, newPath: string): boolean {
		let changed = false;
		for (const record of Object.values(this.data.records)) {
			if (record.path === oldPath) {
				record.path = newPath;
				changed = true;
			}
		}
		return changed;
	}

	clear(): void {
		this.data = emptySyncState();
	}

	replace(data: SyncStateData): void {
		this.data = data;
	}

	toJSON(): SyncStateData {
		return this.data;
	}

	save(): Promise<void> {
		return this.persist(this.data);
	}
}
