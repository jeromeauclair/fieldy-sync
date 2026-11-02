import type { FieldyConversation, RecordingSource } from '../../api/types';
import { locationText } from '../../markdown/ConversationRenderer';
import type { LocalStatus } from '../../main';
import type { Indicator, IndicatorKey } from './indicators';

export type RowStatus = LocalStatus | 'new' | 'locked';

/** `has`: only conversations with it; `lacks`: only conversations without it. */
export type ContentRule = 'has' | 'lacks';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
	morning: 'Morning (5:00–12:00)',
	afternoon: 'Afternoon (12:00–17:00)',
	evening: 'Evening (17:00–22:00)',
	night: 'Night (22:00–5:00)',
};

export interface PanelFilters {
	content: Partial<Record<IndicatorKey, ContentRule>>;
	/** Local calendar day, `YYYY-MM-DD`. */
	day: string | null;
	timeOfDay: TimeOfDay | null;
	speaker: string | null;
	location: string | null;
	status: RowStatus | null;
	source: RecordingSource | null;
}

export function emptyFilters(): PanelFilters {
	return { content: {}, day: null, timeOfDay: null, speaker: null, location: null, status: null, source: null };
}

export function activeFilterCount(filters: PanelFilters): number {
	const fields = [filters.day, filters.timeOfDay, filters.speaker, filters.location, filters.status, filters.source];
	return Object.keys(filters.content).length + fields.filter((v) => v !== null).length;
}

/** Cycles a content icon filter: any → has → lacks → any. */
export function nextContentRule(rule: ContentRule | undefined): ContentRule | undefined {
	if (rule === undefined) return 'has';
	if (rule === 'has') return 'lacks';
	return undefined;
}

/** Local calendar day of an ISO timestamp, `YYYY-MM-DD`. */
export function dayKey(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeOfDay(iso: string): TimeOfDay {
	const hour = new Date(iso).getHours();
	if (hour >= 5 && hour < 12) return 'morning';
	if (hour >= 12 && hour < 17) return 'afternoon';
	if (hour >= 17 && hour < 22) return 'evening';
	return 'night';
}

/** Choices for the date, speaker and location filters, from the loaded conversations. */
export function filterOptions(conversations: readonly FieldyConversation[]): { days: string[]; speakers: string[]; locations: string[] } {
	const days = new Set<string>();
	const speakers = new Set<string>();
	const locations = new Set<string>();
	for (const c of conversations) {
		days.add(dayKey(c.startTime));
		for (const speaker of c.speakers) if (speaker.trim()) speakers.add(speaker.trim());
		const location = locationText(c.location);
		if (location) locations.add(location);
	}
	const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
	return {
		days: [...days].sort().reverse(),
		speakers: [...speakers].sort(byName),
		locations: [...locations].sort(byName),
	};
}

/**
 * Whether a conversation passes every active filter. A content icon whose
 * state is not known yet (tasks, share links, recording source) passes
 * neither `has` nor `lacks`, nor a source filter.
 */
export function matchesFilters(
	c: FieldyConversation,
	indicators: readonly Indicator[],
	status: RowStatus,
	filters: PanelFilters,
	sources?: ReadonlySet<RecordingSource>,
): boolean {
	for (const indicator of indicators) {
		const rule = filters.content[indicator.key];
		if (rule === 'has' && indicator.state !== 'on') return false;
		if (rule === 'lacks' && indicator.state !== 'off') return false;
	}
	if (filters.day !== null && dayKey(c.startTime) !== filters.day) return false;
	if (filters.timeOfDay !== null && timeOfDay(c.startTime) !== filters.timeOfDay) return false;
	if (filters.speaker !== null && !c.speakers.some((s) => s.trim() === filters.speaker)) return false;
	if (filters.location !== null && locationText(c.location) !== filters.location) return false;
	if (filters.status !== null && status !== filters.status) return false;
	if (filters.source !== null && !sources?.has(filters.source)) return false;
	return true;
}
