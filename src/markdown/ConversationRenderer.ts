import type {
	FieldyConversation,
	FieldyLocation,
	FieldySharable,
	FieldyTask,
	FieldyTranscriptSegment,
	TaskStatus,
} from '../api/types';
import type { FieldySyncSettings } from '../settings/settings';
import { durationMinutes, formatDuration, isValidIso, type DateFormatter } from '../utils/dates';
import { stableStringify } from '../utils/hash';
import { HASH_KEY, SOURCE_KEY } from './managedBlock';
import { inlineText, lineText, markdownBlock, parseTagList, safeId, toTag } from './sanitize';
import { speakerMarkdown, type SpeakerLinks } from './speakerLinks';
import { renderTranscript } from './TranscriptRenderer';

/** Bump when the rendered output changes, so unedited notes are refreshed once. */
const RENDER_VERSION = 1;

/** Frontmatter keys starting with this prefix are owned by the plugin. */
const MANAGED_KEY_PREFIX = 'fieldy_';
/** Set to `false` by the user to stop syncing a note. */
export const SYNC_CONTROL_KEY = 'fieldy_sync';
export const ID_KEY = 'fieldy_id';
export const SYNCED_KEY = 'fieldy_synced';
/** `fieldy_*` keys the managed-property updates never touch: the user's pause switch and the block's own properties. */
const UNMANAGED_KEYS: ReadonlySet<string> = new Set([SYNC_CONTROL_KEY, HASH_KEY, SOURCE_KEY]);

export type RenderSettings = Pick<
	FieldySyncSettings,
	| 'includeSummary'
	| 'includeDetails'
	| 'includeQuotes'
	| 'includeTasks'
	| 'includeCompletedTasks'
	| 'includeDismissedTasks'
	| 'dataviewTaskFields'
	| 'includeTranscript'
	| 'includeShareLinks'
	| 'recordingSource'
	| 'noteDateFormat'
	| 'frontmatterDates'
	| 'transcriptFormat'
	| 'timestampStyle'
	| 'collapseTranscript'
	| 'fmSpeakers'
	| 'fmKeywords'
	| 'fmLocation'
	| 'fmTemplate'
	| 'tags'
	| 'keywordTags'
	| 'titleAlias'
	| 'linkSpeakers'
	| 'linkTranscriptSpeakers'
>;

export interface ConversationRenderInput {
	conversation: FieldyConversation;
	tasks: readonly FieldyTask[];
	/** `null` when transcripts are not included. */
	transcript: readonly FieldyTranscriptSegment[] | null;
	speakerNames: ReadonlyMap<string, string>;
	templateName: string | null;
	shareLinks: readonly FieldySharable[];
	/** Checkbox characters currently in the note, by task id, to keep local ticks. */
	localTaskStates?: ReadonlyMap<string, string>;
	/** People notes matching the speakers, when speaker links are on. */
	speakerLinks?: SpeakerLinks;
}

/** Identifies the render-affecting settings; part of every note's source fingerprint. */
export function renderKey(settings: RenderSettings): string {
	return stableStringify({
		v: RENDER_VERSION,
		includeSummary: settings.includeSummary,
		includeDetails: settings.includeDetails,
		includeQuotes: settings.includeQuotes,
		includeTasks: settings.includeTasks,
		includeCompletedTasks: settings.includeCompletedTasks,
		includeDismissedTasks: settings.includeDismissedTasks,
		includeTranscript: settings.includeTranscript,
		includeShareLinks: settings.includeShareLinks,
		// The recording-source filter decides which transcript segments are included.
		recordingSource: settings.recordingSource,
		noteDateFormat: settings.noteDateFormat,
		frontmatterDates: settings.frontmatterDates,
		transcriptFormat: settings.transcriptFormat,
		timestampStyle: settings.timestampStyle,
		collapseTranscript: settings.collapseTranscript,
		fmSpeakers: settings.fmSpeakers,
		fmKeywords: settings.fmKeywords,
		fmLocation: settings.fmLocation,
		fmTemplate: settings.fmTemplate,
		...(settings.dataviewTaskFields ? { dataviewTaskFields: true } : {}),
		// Only when on, so turning the feature on later is the only thing that re-renders notes.
		...(settings.linkSpeakers ? { linkSpeakers: true, linkTranscriptSpeakers: settings.linkTranscriptSpeakers } : {}),
	});
}

export function displayTitle(conversation: FieldyConversation): string {
	return inlineText(conversation.title) || 'Untitled conversation';
}

function plain(text: string): string {
	// For YAML values: single line, no control characters. YAML quoting is done by stringifyYaml.
	// eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
	return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function locationText(location: FieldyLocation | null): string | null {
	if (!location) return null;
	if (location.address?.trim()) return plain(location.address);
	const street = [location.streetNumber, location.street].filter((p) => p?.trim()).join(' ');
	const parts = [street, location.city, location.zip, location.country].map((p) => (p ?? '').trim()).filter((p) => p !== '');
	return parts.length > 0 ? plain(parts.join(', ')) : null;
}

const OPEN_STATUSES: readonly TaskStatus[] = ['new', 'approved'];
const DISMISSED_STATUSES: readonly TaskStatus[] = ['rejected', 'skipped', 'cancelled', 'expired'];

function taskRank(task: FieldyTask): number {
	if (OPEN_STATUSES.includes(task.status)) return 0;
	if (task.status === 'completed') return 1;
	return 2;
}

function visibleTasks(tasks: readonly FieldyTask[], settings: RenderSettings): FieldyTask[] {
	if (!settings.includeTasks) return [];
	return tasks
		.filter((t) => OPEN_STATUSES.includes(t.status) || (t.status === 'completed' ? settings.includeCompletedTasks : settings.includeDismissedTasks))
		.slice()
		.sort((a, b) => taskRank(a) - taskRank(b) || (a.date ?? '￿').localeCompare(b.date ?? '￿') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/**
 * One task as a Markdown checkbox. In notes the line ends with a hidden
 * `%%fieldy-task:<id>%%` marker so local ticks can be matched to Fieldy
 * tasks; snippets copied or inserted by the user leave it out.
 */
export function taskLine(
	task: FieldyTask,
	local: ReadonlyMap<string, string> | undefined,
	formatDate: DateFormatter,
	withId = true,
	dataview = false,
): string {
	const id = safeId(task.id);
	let box = ' ';
	if (task.status === 'completed') box = 'x';
	else if (DISMISSED_STATUSES.includes(task.status)) box = '-';
	else {
		const localBox = local?.get(id);
		if (localBox && localBox !== ' ') box = localBox;
	}
	const title = inlineText(task.title) || 'Untitled task';
	const dueDate = task.date && isValidIso(task.date) ? formatDate(task.date, 'YYYY-MM-DD') : null;
	// Dataview reads `[due:: …]` as the task's due date (sortable and filterable in TASK queries).
	const due = dueDate ? (dataview ? ` [due:: ${dueDate}]` : ` (due ${dueDate})`) : '';
	const status = DISMISSED_STATUSES.includes(task.status) ? ` (${task.status})` : '';
	return `- [${box}] ${title}${due}${status}${withId ? ` %%fieldy-task:${id}%%` : ''}`;
}

function whenLine(conversation: FieldyConversation, settings: RenderSettings, formatDate: DateFormatter): string {
	const start = formatDate(conversation.startTime, settings.noteDateFormat);
	if (!isValidIso(conversation.endTime)) return `${start} (in progress)`;
	const sameDay = formatDate(conversation.startTime, 'YYYY-MM-DD') === formatDate(conversation.endTime, 'YYYY-MM-DD');
	const end = formatDate(conversation.endTime, sameDay ? 'HH:mm' : settings.noteDateFormat);
	const duration = formatDuration(durationMinutes(conversation.startTime, conversation.endTime));
	return `${start} – ${end}${duration ? ` (${duration})` : ''}`;
}

// ----------------------------------------------------------------- sections
// Each section renderer returns Markdown lines and is shared by the note
// renderer and by the side panel's copy/insert actions.

/** "When / Speakers / Location / Template / Keywords" list. */
export function metadataLines(input: ConversationRenderInput, settings: RenderSettings, formatDate: DateFormatter): string[] {
	const c = input.conversation;
	const meta: string[] = [`- **When:** ${whenLine(c, settings, formatDate)}`];
	if (c.speakers.length > 0) meta.push(`- **Speakers:** ${c.speakers.map((name) => speakerMarkdown(name, linksFor(input, settings))).join(', ')}`);
	const location = locationText(c.location);
	if (location) meta.push(`- **Location:** ${inlineText(location)}`);
	if (input.templateName) meta.push(`- **Template:** ${inlineText(input.templateName)}`);
	if (c.keywords.length > 0) meta.push(`- **Keywords:** ${c.keywords.map(inlineText).join(', ')}`);
	return meta;
}

export function summaryLines(conversation: FieldyConversation): string[] {
	const summary = markdownBlock(conversation.summary);
	return summary ? [summary] : [];
}

/** Memory content; in notes it is omitted when it only repeats the summary. */
export function detailsLines(conversation: FieldyConversation, skipIfSameAsSummary = true): string[] {
	const details = markdownBlock(conversation.content);
	if (!details) return [];
	if (skipIfSameAsSummary && details === markdownBlock(conversation.summary)) return [];
	return [details];
}

export function quoteLines(conversation: FieldyConversation): string[] {
	const quotes: string[] = [];
	for (const quote of conversation.quotes) {
		if (quotes.length > 0) quotes.push('');
		quotes.push(`> ${lineText(quote.text)}`);
		if (quote.context) quotes.push(`> — *${inlineText(quote.context)}*`);
	}
	return quotes;
}

function shareLinkLines(links: readonly FieldySharable[]): string[] {
	return links.filter((s) => s.enabled).map((s) => `- <${s.url.replace(/[<>\s]/g, '')}>`);
}

/** Transcript lines in the configured format (no heading, never collapsed). */
export function transcriptLines(input: ConversationRenderInput, settings: RenderSettings, formatDate: DateFormatter): string[] {
	if (!input.transcript) return [];
	return renderTranscript(input.transcript, {
		format: settings.transcriptFormat,
		timestampStyle: settings.timestampStyle,
		conversationStart: input.conversation.startTime,
		formatDate,
		speakerNames: input.speakerNames,
		speakerLinks: settings.linkTranscriptSpeakers ? linksFor(input, settings) : undefined,
	});
}

function linksFor(input: ConversationRenderInput, settings: RenderSettings): SpeakerLinks | undefined {
	return settings.linkSpeakers ? input.speakerLinks : undefined;
}

/** Renders the managed block content for a conversation. */
export function renderConversationBody(input: ConversationRenderInput, settings: RenderSettings, formatDate: DateFormatter): string {
	const c = input.conversation;
	const out: string[] = [];
	const section = (heading: string, lines: string[]) => {
		if (lines.length === 0) return;
		out.push('', `## ${heading}`, '', ...lines);
	};

	out.push(`# ${displayTitle(c)}`, '');
	out.push(...metadataLines(input, settings, formatDate));

	if (c.locked) {
		out.push('', '> [!warning] Locked by Fieldy', '> This conversation is outside your Fieldy plan\'s history window, so its content is not available.');
	}

	if (settings.includeSummary) section('Summary', summaryLines(c));
	if (settings.includeDetails) section('Details', detailsLines(c));
	section(
		'Tasks',
		visibleTasks(input.tasks, settings).map((t) => taskLine(t, input.localTaskStates, formatDate, true, settings.dataviewTaskFields)),
	);
	if (settings.includeQuotes) section('Quotes', quoteLines(c));
	if (settings.includeShareLinks) section('Share links', shareLinkLines(input.shareLinks));
	if (settings.includeTranscript && input.transcript) {
		const lines = transcriptLines(input, settings, formatDate);
		if (lines.length > 0 && settings.collapseTranscript) {
			section('Transcript', ['> [!quote]- Show transcript', ...lines.map((l) => (l === '' ? '>' : `> ${l}`))]);
		} else {
			section('Transcript', lines);
		}
	}
	return out.join('\n');
}

/**
 * Block content without its `## Transcript` section (up to the next heading
 * of level 1 or 2, or the end). Content without one is returned unchanged.
 */
export function withoutTranscript(inner: string): string {
	const lines = inner.split('\n');
	const start = lines.findIndex((l) => /^##[ \t]+Transcript[ \t]*\r?$/.test(l));
	if (start === -1) return inner;
	let end = lines.findIndex((l, i) => i > start && /^#{1,2}[ \t]/.test(l));
	if (end === -1) end = lines.length;
	let from = start;
	while (from > 0 && (lines[from - 1] ?? '').trim() === '') from--;
	return [...lines.slice(0, from), ...(end < lines.length ? ['', ...lines.slice(end)] : [])].join('\n');
}

// ----------------------------------------------------------------- snippets

export type SnippetKind = 'overview' | 'summary' | 'details' | 'tasks' | 'quotes' | 'transcript' | 'full';

export const SNIPPET_LABELS: Record<SnippetKind, string> = {
	overview: 'Title and details',
	summary: 'Summary',
	details: 'Full memory content',
	tasks: 'Tasks',
	quotes: 'Quotes',
	transcript: 'Transcript',
	full: 'Whole conversation',
};

/**
 * Plain Markdown for one piece of a conversation, to copy or insert into any
 * note. Snippets are not managed by sync: they carry no markers and no hidden
 * task ids. Returns an empty string when Fieldy has no data for that piece.
 * The user picked the piece explicitly, so the "include" settings do not
 * apply; formatting settings (dates, transcript format) do.
 */
export function renderSnippet(kind: SnippetKind, input: ConversationRenderInput, settings: RenderSettings, formatDate: DateFormatter): string {
	const c = input.conversation;
	const allTasks = visibleTasks(input.tasks, { ...settings, includeTasks: true, includeCompletedTasks: true });
	switch (kind) {
		case 'overview':
			return [`# ${displayTitle(c)}`, '', ...metadataLines(input, settings, formatDate)].join('\n');
		case 'summary':
			return summaryLines(c).join('\n');
		case 'details':
			return detailsLines(c, false).join('\n');
		case 'tasks':
			return allTasks.map((t) => taskLine(t, undefined, formatDate, false, settings.dataviewTaskFields)).join('\n');
		case 'quotes':
			return quoteLines(c).join('\n');
		case 'transcript':
			return transcriptLines(input, settings, formatDate).join('\n');
		case 'full': {
			const everything: RenderSettings = {
				...settings,
				includeSummary: true,
				includeDetails: true,
				includeQuotes: true,
				includeTasks: true,
				includeCompletedTasks: true,
				includeTranscript: input.transcript !== null,
				collapseTranscript: false,
			};
			return renderConversationBody(input, everything, formatDate).replace(/ %%fieldy-task:[A-Za-z0-9_-]+%%/g, '');
		}
	}
}

function fmDate(iso: string, settings: RenderSettings, formatDate: DateFormatter): string {
	return settings.frontmatterDates === 'iso' ? iso : formatDate(iso, 'YYYY-MM-DDTHH:mm:ss');
}

/** The plugin-managed frontmatter properties (all prefixed `fieldy_`). */
export function buildManagedFrontmatter(
	input: ConversationRenderInput,
	settings: RenderSettings,
	formatDate: DateFormatter,
	syncedAt: string,
): Record<string, unknown> {
	const c = input.conversation;
	const fm: Record<string, unknown> = {
		[ID_KEY]: c.id,
		fieldy_type: 'conversation',
		fieldy_start: fmDate(c.startTime, settings, formatDate),
	};
	if (isValidIso(c.endTime)) {
		fm.fieldy_end = fmDate(c.endTime, settings, formatDate);
		const minutes = durationMinutes(c.startTime, c.endTime);
		if (minutes !== null) fm.fieldy_duration_minutes = minutes;
	}
	fm.fieldy_kind = plain(c.type).toLowerCase() || 'full';
	if (isValidIso(c.updatedAt)) fm.fieldy_updated = fmDate(c.updatedAt, settings, formatDate);
	fm[SYNCED_KEY] = fmDate(syncedAt, settings, formatDate);
	if (settings.fmSpeakers && c.speakers.length > 0) {
		const links = linksFor(input, settings);
		// A linked name is stored as "[[Note|Name]]", which Obsidian shows as a link in the property.
		fm.fieldy_speakers = c.speakers.map((name) => {
			const markdown = speakerMarkdown(name, links);
			return markdown.startsWith('[[') ? markdown : plain(name);
		});
	}
	if (settings.fmKeywords && c.keywords.length > 0) fm.fieldy_keywords = c.keywords.map(plain);
	const location = locationText(c.location);
	if (settings.fmLocation && location) fm.fieldy_location = location;
	if (settings.fmTemplate && input.templateName) fm.fieldy_template = plain(input.templateName);
	return fm;
}

/** Properties written only when a note is created; afterwards they belong to the user. */
export function buildCreationFrontmatter(conversation: FieldyConversation, settings: RenderSettings): Record<string, unknown> {
	const fm: Record<string, unknown> = {};
	const tags = parseTagList(settings.tags);
	if (settings.keywordTags) {
		for (const keyword of conversation.keywords) {
			const tag = toTag(keyword);
			if (tag && !tags.includes(tag)) tags.push(tag);
		}
	}
	if (tags.length > 0) fm.tags = tags;
	const title = plain(conversation.title ?? '');
	if (settings.titleAlias && title) fm.aliases = [title];
	return fm;
}

/** True when two managed frontmatter sets are equal, ignoring the sync timestamp. */
export function sameManagedFrontmatter(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const strip = (fm: Record<string, unknown>) => {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fm)) {
			if (key.startsWith(MANAGED_KEY_PREFIX) && key !== SYNCED_KEY && !UNMANAGED_KEYS.has(key)) out[key] = value;
		}
		return stableStringify(out);
	};
	return strip(a) === strip(b);
}

/**
 * Applies managed properties to a frontmatter object in place: sets the new
 * values and removes stale `fieldy_*` keys. User keys, `tags`, `aliases` and
 * `fieldy_sync`, `fieldy_hash` and `fieldy_src` are untouched.
 */
export function applyManagedFrontmatter(target: Record<string, unknown>, managed: Record<string, unknown>): void {
	for (const key of Object.keys(target)) {
		if (key.startsWith(MANAGED_KEY_PREFIX) && !UNMANAGED_KEYS.has(key) && !(key in managed)) delete target[key];
	}
	for (const [key, value] of Object.entries(managed)) target[key] = value;
}
