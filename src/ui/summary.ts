import type { NoticeLevel } from '../settings/settings';
import type { SyncCounts, SyncRunSummary } from '../sync/SyncState';

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** One-line, human-readable result of a sync run, built from real counts. */
export function formatSyncSummary(summary: SyncRunSummary): string {
	if (summary.fatal) return `Fieldy sync failed: ${summary.fatal}`;
	const c = summary.counts;
	const parts: string[] = [];
	if (c.created > 0) parts.push(`${c.created} new`);
	if (c.updated > 0) parts.push(`${c.updated} updated`);
	if (c.unchanged > 0) parts.push(`${c.unchanged} unchanged`);
	if (c.tasksPushed > 0) parts.push(plural(c.tasksPushed, 'task') + ' completed in Fieldy');
	if (c.peopleCreated > 0) parts.push(plural(c.peopleCreated, 'people note') + ' created');
	const head = summary.cancelled ? 'Fieldy sync cancelled' : 'Fieldy sync complete';
	let text = parts.length > 0 ? `${head}: ${parts.join(', ')}.` : `${head}: no conversations ${c.scanned === 0 ? 'found in the sync window' : 'needed changes'}.`;

	if (c.edited > 0) text += ` ${plural(c.edited, 'edited note')} kept as you wrote ${c.edited === 1 ? 'it' : 'them'}.`;
	const skipped: string[] = [];
	if (c.skippedLocked > 0) skipped.push(`${c.skippedLocked} locked by your Fieldy plan`);
	if (c.skippedDeleted > 0) skipped.push(`${c.skippedDeleted} deleted from the vault`);
	if (c.skippedPaused > 0) skipped.push(`${c.skippedPaused} paused`);
	if (c.skippedNew > 0) skipped.push(`${c.skippedNew} new not imported`);
	if (skipped.length > 0) text += ` Skipped: ${skipped.join(', ')}.`;
	if (c.duplicates > 0) text += ` ${plural(c.duplicates, 'conversation')} has more than one note.`;
	if (c.failed > 0) {
		const first = summary.errors[0];
		text += ` ${c.failed} failed${first ? ` (first: ${first.title}: ${first.message})` : ''}.`;
	}
	return text;
}

function hasChanges(c: SyncCounts): boolean {
	return c.created > 0 || c.updated > 0 || c.tasksPushed > 0 || c.peopleCreated > 0;
}

/** Only real problems; notes the user edited are expected and never alarming. */
function hasProblems(summary: SyncRunSummary): boolean {
	return summary.fatal !== null || summary.counts.failed > 0;
}

/** Automatic syncs notify according to the user's preference; manual runs always do. */
export function shouldNotify(summary: SyncRunSummary, automatic: boolean, level: NoticeLevel): boolean {
	if (!automatic || level === 'all') return true;
	if (level === 'errors') return hasProblems(summary);
	return hasProblems(summary) || hasChanges(summary.counts);
}

/** Short status-bar text. */
export function statusBarText(summary: SyncRunSummary | null, formatTime: (iso: string) => string): string {
	if (!summary) return 'Fieldy';
	if (summary.fatal) return 'Fieldy: sync failed';
	return `Fieldy: synced ${formatTime(summary.finishedAt)}`;
}
