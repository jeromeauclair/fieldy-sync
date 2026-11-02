import type { FieldyTask } from '../api/types';
import { isValidIso, type DateFormatter } from '../utils/dates';
import { inlineText } from './sanitize';

/**
 * The parts of the Obsidian Tasks plugin's settings that decide how a task
 * line must be written (see `src/Config/Settings.ts` in obsidian-tasks).
 */
export interface TasksFormat {
	/** `taskFormat`: `tasksPluginEmoji` (default) or `dataview` inline fields. */
	style: 'emoji' | 'dataview';
	/** `globalFilter` (for example `#task`); '' when none is set. Lines without it are not tasks for the plugin. */
	globalFilter: string;
	/** Checkbox symbols of the first configured status of each type. */
	todoSymbol: string;
	doneSymbol: string;
	cancelledSymbol: string;
	/** `setCreatedDate`, `setDoneDate`, `setCancelledDate`. */
	setCreatedDate: boolean;
	setDoneDate: boolean;
	setCancelledDate: boolean;
}

/** The Tasks plugin's own defaults, used for anything its settings do not say. */
export const DEFAULT_TASKS_FORMAT: TasksFormat = {
	style: 'emoji',
	globalFilter: '',
	todoSymbol: ' ',
	doneSymbol: 'x',
	cancelledSymbol: '-',
	setCreatedDate: false,
	setDoneDate: true,
	setCancelledDate: true,
};

const DISMISSED: readonly FieldyTask['status'][] = ['rejected', 'skipped', 'cancelled', 'expired'];

/** Same symbols as the Tasks plugin's emoji and Dataview serializers. */
const FIELDS = {
	created: { emoji: '➕', dataview: 'created' },
	scheduled: { emoji: '⏳', dataview: 'scheduled' },
	due: { emoji: '📅', dataview: 'due' },
	cancelled: { emoji: '❌', dataview: 'cancelled' },
	done: { emoji: '✅', dataview: 'completion' },
} as const;

/**
 * Signifiers the Tasks plugin reads as metadata. A title containing one
 * would be cut short or get a wrong date, so they are removed from titles.
 */
const SIGNIFIERS = /[📅⏳🛫✅❌➕🔁⏫🔼🔽⏬🔺🆔⛔🏁]️?/gu;
/** Dataview-style inline fields (`[due:: …]`, `(priority:: …)`) in a title. */
const INLINE_FIELDS = /[[(][\w-]+::[^\])]*[\])]/g;

function cleanTitle(text: string | null | undefined, fallback: string): string {
	return inlineText(text ?? '').replace(SIGNIFIERS, '').replace(INLINE_FIELDS, '').replace(/\s+/g, ' ').trim() || fallback;
}

function field(style: TasksFormat['style'], name: keyof typeof FIELDS, date: string): string {
	// The Dataview serializer puts two spaces before each field (a rendering fix in the Tasks plugin).
	return style === 'emoji' ? ` ${FIELDS[name].emoji} ${date}` : `  [${FIELDS[name].dataview}:: ${date}]`;
}

/**
 * A Fieldy task as an Obsidian Tasks line, written the way the Tasks plugin
 * itself writes one with the user's settings: their status symbols, global
 * filter, format, and created/done/cancelled date preferences, with fields in
 * the plugin's order (created, due, cancelled, done). `link` (a wikilink to
 * the conversation note) goes in the description, before the metadata.
 * `today` is the created date when the user has the Tasks plugin add one.
 */
export function obsidianTaskLine(task: FieldyTask, format: TasksFormat, formatDate: DateFormatter, link?: string, today?: string): string {
	const day = (iso: string | null | undefined) => (iso && isValidIso(iso) ? formatDate(iso, 'YYYY-MM-DD') : null);
	const title = cleanTitle(task.title, 'Untitled task');
	const filter = format.globalFilter.trim();
	// The Tasks plugin checks for the filter anywhere in the description and puts it first when it adds one.
	const description = [filter && !title.includes(filter) ? filter : '', title, link ?? ''].filter(Boolean).join(' ');

	const completed = task.status === 'completed';
	const dismissed = DISMISSED.includes(task.status);
	const box = completed ? format.doneSymbol : dismissed ? format.cancelledSymbol : format.todoSymbol;

	let meta = '';
	const created = format.setCreatedDate ? day(today) : null;
	if (created) meta += field(format.style, 'created', created);
	const due = day(task.date);
	if (due) meta += field(format.style, 'due', due);
	const cancelled = dismissed && format.setCancelledDate ? day(task.cancellationDate) : null;
	if (cancelled) meta += field(format.style, 'cancelled', cancelled);
	const done = completed && format.setDoneDate ? day(task.completionDate) : null;
	if (done) meta += field(format.style, 'done', done);
	return `- [${box}] ${description}${meta}`;
}

/**
 * A calendar event (a conversation's meeting) as an Obsidian Tasks line,
 * scheduled on the day it took place, so it appears in the Tasks plugin's
 * date-based queries next to the conversation's tasks.
 */
export function obsidianEventLine(title: string, startIso: string, format: TasksFormat, formatDate: DateFormatter, link?: string, today?: string): string {
	const day = (iso: string | null | undefined) => (iso && isValidIso(iso) ? formatDate(iso, 'YYYY-MM-DD') : null);
	const name = cleanTitle(title, 'Untitled event');
	const filter = format.globalFilter.trim();
	const description = [filter && !name.includes(filter) ? filter : '', name, link ?? ''].filter(Boolean).join(' ');
	let meta = '';
	const created = format.setCreatedDate ? day(today) : null;
	if (created) meta += field(format.style, 'created', created);
	const scheduled = day(startIso);
	if (scheduled) meta += field(format.style, 'scheduled', scheduled);
	return `- [${format.todoSymbol}] ${description}${meta}`;
}
