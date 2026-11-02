/**
 * The ```fieldy``` code block: a small query language over the Fieldy notes
 * in the vault (no Dataview needed, no requests to Fieldy). Pure functions;
 * the vault is read in `ui/fieldyBlock.ts`.
 *
 * ```fieldy
 * show: conversations   (conversations, tasks or stats)
 * period: this week     (today, yesterday, this week, last week, this month,
 *                        last month, 7 days, all, 2026-10-01, 2026-10-01 to 2026-10-31)
 * speaker: Marie        (part of a speaker's name)
 * kind: full            (all, full or brief)
 * tasks: open           (open, done or all; for tasks)
 * sort: newest          (newest, oldest or longest; for conversations)
 * limit: 20
 * ```
 */

export type QueryShow = 'conversations' | 'tasks' | 'stats';
export type QueryKind = 'all' | 'full' | 'brief';
export type QueryTasks = 'open' | 'done' | 'all';
export type QuerySort = 'newest' | 'oldest' | 'longest';

export interface FieldyQuery {
	show: QueryShow;
	/** Epoch ms, start inclusive and end exclusive; null for no bound. */
	from: number | null;
	to: number | null;
	periodLabel: string;
	speaker: string | null;
	kind: QueryKind;
	tasks: QueryTasks;
	sort: QuerySort;
	limit: number;
	errors: string[];
}

/** A Fieldy note, from its properties. */
export interface ConversationRecord {
	path: string;
	title: string;
	/** Epoch ms; NaN when the note has no readable start. */
	start: number;
	minutes: number | null;
	speakers: string[];
	kind: string;
	location: string | null;
}

/** A task inside a Fieldy note's section. */
export interface TaskRecord {
	path: string;
	/** 0-based line in the note. */
	line: number;
	text: string;
	/** The checkbox character: ' ' open, 'x' done, '-' dismissed, or another custom status. */
	status: string;
	due: string | null;
	conversation: ConversationRecord;
}

export const QUERY_KEYS = ['show', 'period', 'speaker', 'kind', 'tasks', 'sort', 'limit'] as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function addDays(ms: number, days: number): number {
	const d = new Date(ms);
	d.setDate(d.getDate() + days);
	return d.getTime();
}

/** Monday 00:00 of the week containing `ms`. */
function startOfWeek(ms: number): number {
	const day = startOfDay(ms);
	const weekday = (new Date(day).getDay() + 6) % 7;
	return addDays(day, -weekday);
}

function startOfMonth(ms: number, offset = 0): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

/** A local calendar date, `YYYY-MM-DD`, as epoch ms at its midnight; null if invalid. */
function localDate(text: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.getMonth() === Number(m[2]) - 1 ? d.getTime() : null;
}

/** The time span a `period:` value names, relative to `now`. */
export function parsePeriod(value: string, now: number): { from: number | null; to: number | null; label: string } | null {
	const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
	const today = startOfDay(now);
	switch (v) {
		case 'all':
		case 'all time':
		case 'everything':
			return { from: null, to: null, label: 'all time' };
		case 'today':
			return { from: today, to: addDays(today, 1), label: 'today' };
		case 'yesterday':
			return { from: addDays(today, -1), to: today, label: 'yesterday' };
		case 'this week':
			return { from: startOfWeek(now), to: addDays(startOfWeek(now), 7), label: 'this week' };
		case 'last week':
			return { from: addDays(startOfWeek(now), -7), to: startOfWeek(now), label: 'last week' };
		case 'this month':
			return { from: startOfMonth(now), to: startOfMonth(now, 1), label: 'this month' };
		case 'last month':
			return { from: startOfMonth(now, -1), to: startOfMonth(now), label: 'last month' };
	}
	const days = /^(?:last )?(\d{1,4}) ?(?:d|days?)$/.exec(v);
	if (days) {
		const n = Number(days[1]);
		if (n < 1) return null;
		return { from: now - n * DAY, to: null, label: `last ${n} day${n === 1 ? '' : 's'}` };
	}
	const range = /^(\d{4}-\d{2}-\d{2})(?: ?(?:to|\.\.|–|-) ?(\d{4}-\d{2}-\d{2}))?$/.exec(v);
	if (range) {
		const from = localDate(range[1] ?? '');
		const last = range[2] ? localDate(range[2]) : from;
		if (from === null || last === null || last < from) return null;
		return { from, to: addDays(last, 1), label: range[2] ? `${range[1]} to ${range[2]}` : (range[1] ?? '') };
	}
	return null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
	const v = value.trim().toLowerCase();
	return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Reads the block's `key: value` lines. Unknown keys and values become messages, never exceptions. */
export function parseFieldyQuery(source: string, now: number): FieldyQuery {
	const query: FieldyQuery = {
		show: 'conversations',
		from: now - 7 * DAY,
		to: null,
		periodLabel: 'last 7 days',
		speaker: null,
		kind: 'all',
		tasks: 'open',
		sort: 'newest',
		limit: DEFAULT_LIMIT,
		errors: [],
	};
	let periodSet = false;
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.replace(/\s+#.*$/, '').trim();
		if (line === '' || line.startsWith('#')) continue;
		const colon = line.indexOf(':');
		if (colon === -1) {
			query.errors.push(`"${line}" is not "key: value".`);
			continue;
		}
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		const bad = (choices: string) => query.errors.push(`"${key}: ${value}": use ${choices}.`);
		switch (key) {
			case 'show': {
				const show = oneOf(value === 'conversation' ? 'conversations' : value === 'task' ? 'tasks' : value, ['conversations', 'tasks', 'stats'] as const);
				if (show) query.show = show;
				else bad('conversations, tasks or stats');
				break;
			}
			case 'period':
			case 'from': {
				const period = parsePeriod(value, now);
				if (period) {
					query.from = period.from;
					query.to = period.to;
					query.periodLabel = period.label;
					periodSet = true;
				} else bad('today, yesterday, this week, last week, this month, last month, 7 days, all, or 2026-10-01 to 2026-10-31');
				break;
			}
			case 'speaker':
			case 'with':
				query.speaker = value || null;
				break;
			case 'kind': {
				const kind = oneOf(value, ['all', 'full', 'brief'] as const);
				if (kind) query.kind = kind;
				else bad('all, full or brief');
				break;
			}
			case 'tasks':
			case 'status': {
				const tasks = oneOf(value === 'completed' ? 'done' : value, ['open', 'done', 'all'] as const);
				if (tasks) query.tasks = tasks;
				else bad('open, done or all');
				break;
			}
			case 'sort': {
				const sort = oneOf(value, ['newest', 'oldest', 'longest'] as const);
				if (sort) query.sort = sort;
				else bad('newest, oldest or longest');
				break;
			}
			case 'limit': {
				const n = Number(value);
				if (Number.isInteger(n) && n >= 1) query.limit = Math.min(n, MAX_LIMIT);
				else bad('a whole number such as 20');
				break;
			}
			default:
				query.errors.push(`Unknown option "${key}". Options: ${QUERY_KEYS.join(', ')}.`);
		}
	}
	// Open tasks are rarely only last week's: without a period, tasks look at everything.
	if (!periodSet && query.show === 'tasks') {
		query.from = null;
		query.to = null;
		query.periodLabel = 'all time';
	}
	return query;
}

/** "[[People/Marie|Marie]]" → "Marie"; plain names unchanged. */
export function speakerLabel(value: string): string {
	const link = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/.exec(value.trim());
	if (!link) return value.trim();
	return (link[2] ?? link[1] ?? '').split('/').pop()?.trim() ?? '';
}

function matchesConversation(c: ConversationRecord, q: FieldyQuery): boolean {
	if (q.from !== null && !(c.start >= q.from)) return false;
	if (q.to !== null && !(c.start < q.to)) return false;
	if (q.kind === 'brief' && c.kind !== 'brief') return false;
	if (q.kind === 'full' && c.kind === 'brief') return false;
	if (q.speaker) {
		const wanted = q.speaker.toLowerCase();
		if (!c.speakers.some((s) => speakerLabel(s).toLowerCase().includes(wanted))) return false;
	}
	return true;
}

export function selectConversations(all: readonly ConversationRecord[], q: FieldyQuery): ConversationRecord[] {
	const list = all.filter((c) => matchesConversation(c, q));
	if (q.sort === 'oldest') list.sort((a, b) => a.start - b.start);
	else if (q.sort === 'longest') list.sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1) || b.start - a.start);
	else list.sort((a, b) => b.start - a.start);
	return list;
}

export function selectTasks(all: readonly TaskRecord[], q: FieldyQuery): TaskRecord[] {
	const list = all.filter((t) => {
		if (q.tasks === 'open') return t.status === ' ';
		if (q.tasks === 'done') return t.status.toLowerCase() === 'x';
		return true;
	});
	// Due first (soonest first), then newest conversations.
	return list.sort((a, b) => (a.due ?? '￿').localeCompare(b.due ?? '￿') || b.conversation.start - a.conversation.start || a.line - b.line);
}

const TASK_LINE = /^\s*[-*+] \[([^\]])\] (.*)$/;
const DUE = [/\[due:: ?(\d{4}-\d{2}-\d{2})\]/, /📅 ?(\d{4}-\d{2}-\d{2})/, /\(due (\d{4}-\d{2}-\d{2})\)/];

/** The tasks of a note's Fieldy section (between the markers); `lines` is the whole note. */
export function tasksInSection(lines: readonly string[], begin: number, end: number, conversation: ConversationRecord): TaskRecord[] {
	const tasks: TaskRecord[] = [];
	for (let i = begin + 1; i < end; i++) {
		const m = TASK_LINE.exec(lines[i] ?? '');
		if (!m) continue;
		let text = (m[2] ?? '').replace(/\s*%%[^%]*%%/g, '');
		let due: string | null = null;
		for (const pattern of DUE) {
			const found = pattern.exec(text);
			if (found) {
				due ??= found[1] ?? null;
				text = text.replace(pattern, '');
			}
		}
		tasks.push({ path: conversation.path, line: i, text: text.replace(/\s+/g, ' ').trim(), status: m[1] ?? ' ', due, conversation });
	}
	return tasks;
}

interface QueryStats {
	conversations: number;
	minutes: number;
	averageMinutes: number | null;
	longest: ConversationRecord | null;
	days: number;
	busiestDays: { day: string; count: number; minutes: number }[];
	topSpeakers: { name: string; count: number }[];
	openTasks: number;
	doneTasks: number;
}

function dayKey(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Generic labels Fieldy uses for unrecognised voices; not worth ranking. */
const GENERIC_SPEAKER = /^(unknown( speaker)?|speaker ?[a-z0-9]{1,2})$/i;

export function computeStats(conversations: readonly ConversationRecord[], tasks: readonly TaskRecord[]): QueryStats {
	const days = new Map<string, { count: number; minutes: number }>();
	const speakers = new Map<string, number>();
	let minutes = 0;
	let timed = 0;
	let longest: ConversationRecord | null = null;
	for (const c of conversations) {
		if (c.minutes !== null) {
			minutes += c.minutes;
			timed++;
			if (!longest || c.minutes > (longest.minutes ?? -1)) longest = c;
		}
		if (!Number.isNaN(c.start)) {
			const key = dayKey(c.start);
			const day = days.get(key) ?? { count: 0, minutes: 0 };
			day.count++;
			day.minutes += c.minutes ?? 0;
			days.set(key, day);
		}
		for (const s of new Set(c.speakers.map(speakerLabel))) {
			if (s && !GENERIC_SPEAKER.test(s)) speakers.set(s, (speakers.get(s) ?? 0) + 1);
		}
	}
	return {
		conversations: conversations.length,
		minutes,
		averageMinutes: timed > 0 ? Math.round(minutes / timed) : null,
		longest,
		days: days.size,
		busiestDays: [...days]
			.map(([day, v]) => ({ day, ...v }))
			.sort((a, b) => b.minutes - a.minutes || b.count - a.count || b.day.localeCompare(a.day))
			.slice(0, 5),
		topSpeakers: [...speakers]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
			.slice(0, 5),
		openTasks: tasks.filter((t) => t.status === ' ').length,
		doneTasks: tasks.filter((t) => t.status.toLowerCase() === 'x').length,
	};
}
