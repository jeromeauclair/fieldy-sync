/**
 * Time filters as a list of rules, one per row of the settings form:
 * days of the week and an optional time range, combined from top to
 * bottom with "or", "and" or "except". Times are local; a range ending
 * before it starts runs past midnight (into the next day).
 */

export type TimeRuleOp = 'or' | 'and' | 'except';

export interface TimeRule {
	/** How this row combines with the rows above it (ignored on the first row). */
	op: TimeRuleOp;
	/** Days of the week, 0 = Sunday; empty = every day. */
	days: number[];
	/** `HH:MM`; empty = from midnight. */
	from: string;
	/** `HH:MM`; empty = until midnight. */
	to: string;
}

export const TIME_RULE_OPS: Record<TimeRuleOp, string> = {
	or: 'or',
	and: 'and',
	except: 'except',
};

/** Monday first, as most calendars show it. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(clock: string): number | null {
	const m = CLOCK.exec(clock);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Validates rules loaded from disk; anything malformed is dropped or reset. */
export function sanitizeTimeRules(raw: unknown): TimeRule[] {
	if (!Array.isArray(raw)) return [];
	const rules: TimeRule[] = [];
	for (const item of raw.slice(0, 50)) {
		if (typeof item !== 'object' || item === null) continue;
		const r = item as Record<string, unknown>;
		const op: TimeRuleOp = r.op === 'and' || r.op === 'except' ? r.op : 'or';
		const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
		const from = typeof r.from === 'string' && CLOCK.test(r.from) ? r.from : '';
		const to = typeof r.to === 'string' && CLOCK.test(r.to) ? r.to : '';
		rules.push({ op, days, from, to });
	}
	return rules;
}

/** Whether one row matches a local moment. */
function ruleMatches(date: Date, rule: TimeRule): boolean {
	const day = date.getDay();
	const minutes = date.getHours() * 60 + date.getMinutes();
	const onDay = (d: number) => rule.days.length === 0 || rule.days.includes(d);
	const from = minutesOf(rule.from) ?? 0;
	const to = minutesOf(rule.to) ?? 24 * 60;
	if (from === to) return onDay(day);
	if (from < to) return onDay(day) && minutes >= from && minutes < to;
	// Past midnight: the late part belongs to the day it started on.
	return (onDay(day) && minutes >= from) || (onDay((day + 6) % 7) && minutes < to);
}

/** The rows combined from top to bottom. */
function rulesMatch(date: Date, rules: readonly TimeRule[]): boolean {
	let result = false;
	rules.forEach((rule, index) => {
		const hit = ruleMatches(date, rule);
		if (index === 0) result = hit;
		else if (rule.op === 'or') result = result || hit;
		else if (rule.op === 'and') result = result && hit;
		else result = result && !hit;
	});
	return result;
}

/** Whether a moment (ISO) matches the rules; false without rules. */
export function inTimeRules(iso: string, rules: readonly TimeRule[]): boolean {
	const date = new Date(iso);
	return rules.length > 0 && !Number.isNaN(date.getTime()) && rulesMatch(date, rules);
}

const MINUTE = 60_000;
/** Longest stretch checked minute by minute. */
const MAX_SPAN = 2 * 24 * 60 * MINUTE;

/** Whether any moment from `startIso` to `endIso` matches the rules. */
export function overlapsTimeRules(startIso: string, endIso: string | null, rules: readonly TimeRule[]): boolean {
	if (rules.length === 0) return false;
	const start = Date.parse(startIso);
	if (Number.isNaN(start)) return false;
	const parsedEnd = endIso ? Date.parse(endIso) : Number.NaN;
	const end = Number.isNaN(parsedEnd) || parsedEnd < start ? start : Math.min(parsedEnd, start + MAX_SPAN);
	if (rulesMatch(new Date(start), rules)) return true;
	for (let t = Math.ceil(start / MINUTE) * MINUTE; t <= end; t += MINUTE) if (rulesMatch(new Date(t), rules)) return true;
	return rulesMatch(new Date(end), rules);
}

function daysText(days: readonly number[]): string {
	if (days.length === 0 || days.length === 7) return 'every day';
	const set = new Set(days);
	if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Mon–Fri';
	if (set.size === 2 && set.has(0) && set.has(6)) return 'Sat–Sun';
	return WEEK_ORDER.filter((d) => set.has(d))
		.map((d) => DAY_SHORT[d])
		.join(', ');
}

/** `Mon–Fri 08:00–18:00`, `every day 12:00–13:00`, `Sat–Sun all day`. */
export function describeTimeRule(rule: TimeRule): string {
	const days = daysText(rule.days);
	if (!rule.from && !rule.to) return `${days} all day`;
	const from = rule.from || '00:00';
	const to = rule.to || '24:00';
	const night = (minutesOf(rule.from) ?? 0) > (minutesOf(rule.to) ?? 24 * 60);
	return `${days} ${from}–${to}${night ? ' (next day)' : ''}`;
}

/** The whole list in words: `Mon–Fri 08:00–18:00, except every day 12:00–13:00`. */
export function describeTimeRules(rules: readonly TimeRule[]): string {
	return rules.map((rule, index) => (index === 0 ? describeTimeRule(rule) : `${TIME_RULE_OPS[rule.op]} ${describeTimeRule(rule)}`)).join(', ');
}
