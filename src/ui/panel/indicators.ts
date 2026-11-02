import { RECORDING_SOURCES, type FieldyConversation, type FieldyLocation, type RecordingSource } from '../../api/types';
import { detailsLines, locationText } from '../../markdown/ConversationRenderer';

export type IndicatorKey = 'brief' | 'summary' | 'details' | 'tasks' | 'quotes' | 'link' | 'location' | 'calendar';

/** `on`: the conversation has it; `off`: it does not; `unknown`: not checked yet. */
export type IndicatorState = 'on' | 'off' | 'unknown';

export interface Indicator {
	key: IndicatorKey;
	icon: string;
	state: IndicatorState;
	/** Tooltip and accessible label describing the current state. */
	label: string;
}

export const INDICATOR_ICONS: Record<IndicatorKey, string> = {
	brief: 'zap',
	summary: 'align-left',
	details: 'file-text',
	tasks: 'list-checks',
	quotes: 'quote',
	link: 'link',
	location: 'map-pin',
	calendar: 'calendar',
};

/** Short names, for the filter buttons. */
export const INDICATOR_NAMES: Record<IndicatorKey, string> = {
	brief: 'Brief',
	summary: 'Summary',
	details: 'Full memory content',
	tasks: 'Tasks',
	quotes: 'Quotes',
	link: 'Share link',
	location: 'Location',
	calendar: 'Calendar event',
};

export const INDICATOR_ORDER: readonly IndicatorKey[] = ['brief', 'summary', 'details', 'tasks', 'quotes', 'link', 'location', 'calendar'];

export const SOURCE_LABELS: Record<RecordingSource, string> = {
	wearable: 'Fieldy wearable',
	phone: 'Phone',
	desktop: 'Desktop app',
};

export const SOURCE_ICONS: Record<RecordingSource, string> = {
	wearable: 'mic',
	phone: 'smartphone',
	desktop: 'monitor',
};

/**
 * Icons and label for where a conversation was recorded; `undefined` while not
 * checked yet. Only the filter row's own icons are used: none while checking or
 * when no source lists the conversation, one per source otherwise.
 */
export function sourceIndicator(sources: ReadonlySet<RecordingSource> | undefined): { icons: string[]; label: string; state: IndicatorState } {
	if (sources === undefined) return { icons: [], label: 'Checking where it was recorded…', state: 'unknown' };
	const list = RECORDING_SOURCES.filter((s) => sources.has(s));
	if (list.length === 0) return { icons: [], label: 'Recording source unknown', state: 'off' };
	return { icons: list.map((s) => SOURCE_ICONS[s]), label: `Recorded with: ${list.map((s) => SOURCE_LABELS[s]).join(', ')}`, state: 'on' };
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a conversation contains, at a glance. Everything comes from the
 * conversation itself except tasks (one cached lookup for all conversations)
 * and share links (checked per conversation in the background), which stay
 * `unknown` until known.
 */
export function conversationIndicators(
	conversation: FieldyConversation,
	taskCount: number | undefined,
	hasShareLink: boolean | undefined,
): Indicator[] {
	const c = conversation;
	const location = locationText(c.location);
	const state = (value: boolean | undefined): IndicatorState => (value === undefined ? 'unknown' : value ? 'on' : 'off');
	const all: Record<IndicatorKey, Indicator> = {
		brief: {
			key: 'brief',
			icon: INDICATOR_ICONS.brief,
			state: state(c.type.toUpperCase() === 'BRIEF'),
			label: c.type.toUpperCase() === 'BRIEF' ? 'Brief: a short conversation with a short summary' : 'Not brief: a full conversation',
		},
		summary: {
			key: 'summary',
			icon: INDICATOR_ICONS.summary,
			state: state(!!c.summary?.trim()),
			label: c.summary?.trim() ? 'Has a summary' : 'No summary yet',
		},
		details: {
			key: 'details',
			icon: INDICATOR_ICONS.details,
			state: state(detailsLines(c).length > 0),
			label: detailsLines(c).length > 0 ? 'Has full memory content (from your Fieldy template)' : 'No full memory content',
		},
		tasks: {
			key: 'tasks',
			icon: INDICATOR_ICONS.tasks,
			state: state(taskCount === undefined ? undefined : taskCount > 0),
			label: taskCount === undefined ? 'Checking tasks…' : taskCount > 0 ? `Has ${plural(taskCount, 'task')}` : 'No tasks',
		},
		quotes: {
			key: 'quotes',
			icon: INDICATOR_ICONS.quotes,
			state: state(c.quotes.length > 0),
			label: c.quotes.length > 0 ? `Has ${plural(c.quotes.length, 'quote')}` : 'No quotes',
		},
		link: {
			key: 'link',
			icon: INDICATOR_ICONS.link,
			state: state(hasShareLink),
			label: hasShareLink === undefined ? 'Checking for a share link…' : hasShareLink ? 'Shared: has an active Fieldy share link' : 'Not shared',
		},
		location: {
			key: 'location',
			icon: INDICATOR_ICONS.location,
			state: state(location !== null),
			label: location ? `Recorded at ${location}` : 'No location',
		},
		calendar: {
			key: 'calendar',
			icon: INDICATOR_ICONS.calendar,
			state: state(!!c.calendarEventId),
			label: c.calendarEventId ? 'Linked to a calendar event' : 'No calendar event',
		},
	};
	return INDICATOR_ORDER.map((key) => all[key]);
}

/** Map links for a place: by coordinates when Fieldy has them, otherwise by address; null when it has neither. */
export function mapLinks(location: FieldyLocation | null): { google: string; osm: string } | null {
	const coords = location?.coordinates;
	if (coords) {
		const { latitude: lat, longitude: lon } = coords;
		return {
			google: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
			osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
		};
	}
	const address = locationText(location);
	if (!address) return null;
	const q = encodeURIComponent(address);
	return { google: `https://www.google.com/maps/search/?api=1&query=${q}`, osm: `https://www.openstreetmap.org/search?query=${q}` };
}
