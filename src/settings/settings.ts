import { RECORDING_SOURCES, type RecordingSource, type TaskStatus } from '../api/types';
import { MAX_REQUESTS_PER_MINUTE } from '../api/rateLimiter';
import { sanitizeFolderPath } from '../utils/paths';
import { sanitizeTimeRules, type TimeRule } from '../utils/timeRules';

export type TranscriptFormat = 'paragraphs' | 'timestamped' | 'timestamped-speaker';
export type TimestampStyle = 'clock' | 'elapsed';
export type SubfolderMode = 'none' | 'year' | 'year-month' | 'month' | 'week' | 'day' | 'custom';
const SUBFOLDER_MODES: readonly SubfolderMode[] = ['none', 'year', 'year-month', 'month', 'week', 'day', 'custom'];
type FrontmatterDateStyle = 'local' | 'iso';
export type NoticeLevel = 'all' | 'changes' | 'errors';
type RecordingSourceFilter = 'all' | RecordingSource;

export interface FieldySyncSettings {
	// Fieldy connection
	/** Id of the secret in Obsidian's secret storage. Never the key itself. */
	apiKeySecretId: string;

	// Import and sync
	folder: string;
	subfolders: SubfolderMode;
	/** Moment format for `custom` subfolders; "/" separates folders. */
	subfolderFormat: string;
	importNewOnSync: boolean;
	syncWindowDays: number;
	recordingSource: RecordingSourceFilter;
	includeBrief: boolean;
	/** When a conversation must have started to be synced; empty = any time. */
	syncTimeRules: TimeRule[];
	syncOnStartup: boolean;
	autoSyncMinutes: number;
	recreateDeleted: boolean;
	includeSummary: boolean;
	includeDetails: boolean;
	includeQuotes: boolean;
	includeTasks: boolean;
	includeCompletedTasks: boolean;
	includeDismissedTasks: boolean;
	/** Due dates written as Dataview `[due:: YYYY-MM-DD]` fields instead of "(due …)". */
	dataviewTaskFields: boolean;
	pushTaskCompletion: boolean;
	includeTranscript: boolean;
	includeShareLinks: boolean;
	/**
	 * Master switch for Fieldy share links. Off: the plugin never lists,
	 * checks, creates or changes share links, and shows none (local first).
	 */
	useShareLinks: boolean;
	/** Create a Fieldy share link, when there is none, for every conversation that gets a new note. */
	createShareLinks: boolean;
	/** Shown on share links the plugin creates; required by Fieldy. */
	shareLinkAuthor: string;
	/** Share links the plugin creates include the transcript. */
	shareLinkTranscript: boolean;
	/** Show the Fieldy section's markers as a status banner and divider (display only). */
	showNoteBanner: boolean;
	/** Banner colours: the theme's (blue, orange, grey) or the three below. */
	bannerColors: 'theme' | 'custom';
	bannerColorSynced: string;
	bannerColorEdited: string;
	bannerColorPaused: string;
	/** The same three for dark mode. */
	bannerColorSyncedDark: string;
	bannerColorEditedDark: string;
	bannerColorPausedDark: string;
	/** When restoring with "keep my edits", also copy the transcript into the kept edited version. */
	keepTranscriptInEditedCopy: boolean;

	// Markdown
	filenamePattern: string;
	filenameDateFormat: string;
	noteDateFormat: string;
	frontmatterDates: FrontmatterDateStyle;
	transcriptFormat: TranscriptFormat;
	timestampStyle: TimestampStyle;
	collapseTranscript: boolean;
	fmSpeakers: boolean;
	fmKeywords: boolean;
	fmLocation: boolean;
	fmTemplate: boolean;
	tags: string;
	keywordTags: boolean;
	titleAlias: boolean;
	linkSpeakers: boolean;
	/** Folder of people notes ('' = the whole vault). */
	peopleFolder: string;
	linkTranscriptSpeakers: boolean;
	/** Create a people note for speakers that have none (needs speaker links). */
	createSpeakerNotes: boolean;

	// Privacy: one entry per line (or comma). Matching conversations are kept out of the vault.
	privateKeywords: string;
	privateSpeakers: string;
	privatePlaces: string;
	/** Fieldy memory template names. */
	privateTemplates: string;
	/** A conversation with any moment matching these rules is private. */
	privateTimeRules: TimeRule[];
	/** Also look for private keywords and speakers in transcripts (one request per conversation, once). */
	privacySearchTranscript: boolean;
	/** Move the notes of conversations that became private to the trash (instead of keeping them, frozen). */
	deletePrivateNotes: boolean;
	/** Show the title (and the brief icon) on private conversations' cards. */
	showPrivateTitles: boolean;

	// Advanced
	requestTimeoutSeconds: number;
	maxRetries: number;
	requestsPerMinute: number;
	notices: NoticeLevel;
	showStatusBar: boolean;
	debugLogging: boolean;
	/** The one-time "not tested on mobile yet" notice was shown on this vault. */
	mobileNoticeShown: boolean;
}

/** Where users report problems (also linked from the mobile notice). */
export const ISSUES_URL = 'https://github.com/jeromeauclair/fieldy-sync/issues';

/** The developer's Fieldy referral link ($30 off), shown only while no API key is set. */
export const FIELDY_REFERRAL_URL = 'https://www.fieldy.ai/referral/157VTP5FKX?from=J%C3%89R%C3%94ME';

export const DEFAULT_SETTINGS: FieldySyncSettings = {
	apiKeySecretId: '',

	folder: 'Fieldy',
	subfolders: 'none',
	subfolderFormat: 'YYYY/MM',
	importNewOnSync: true,
	syncWindowDays: 7,
	recordingSource: 'all',
	includeBrief: true,
	syncTimeRules: [],
	syncOnStartup: false,
	autoSyncMinutes: 0,
	recreateDeleted: false,
	includeSummary: true,
	includeDetails: true,
	includeQuotes: true,
	includeTasks: true,
	includeCompletedTasks: true,
	includeDismissedTasks: false,
	dataviewTaskFields: false,
	pushTaskCompletion: false,
	includeTranscript: true,
	includeShareLinks: false,
	useShareLinks: true,
	createShareLinks: true,
	shareLinkAuthor: '',
	shareLinkTranscript: true,
	showNoteBanner: true,
	bannerColors: 'theme',
	bannerColorSynced: '#086ddd',
	bannerColorEdited: '#ec7500',
	bannerColorPaused: '#8a8a8a',
	bannerColorSyncedDark: '#5aa7ff',
	bannerColorEditedDark: '#ffa94d',
	bannerColorPausedDark: '#a3a3a3',
	keepTranscriptInEditedCopy: true,

	filenamePattern: '{date} - {title}',
	filenameDateFormat: 'YYYY-MM-DD',
	noteDateFormat: 'YYYY-MM-DD HH:mm',
	frontmatterDates: 'local',
	transcriptFormat: 'timestamped-speaker',
	timestampStyle: 'clock',
	collapseTranscript: false,
	fmSpeakers: true,
	fmKeywords: true,
	fmLocation: true,
	fmTemplate: true,
	tags: 'fieldy',
	keywordTags: false,
	titleAlias: false,
	linkSpeakers: false,
	peopleFolder: '',
	linkTranscriptSpeakers: false,
	createSpeakerNotes: false,

	privateKeywords: '',
	privateSpeakers: '',
	privatePlaces: '',
	privateTemplates: '',
	privateTimeRules: [],
	privacySearchTranscript: false,
	deletePrivateNotes: false,
	showPrivateTitles: false,

	requestTimeoutSeconds: 30,
	maxRetries: 3,
	requestsPerMinute: 60,
	notices: 'changes',
	showStatusBar: true,
	debugLogging: false,
	mobileNoticeShown: false,
};

export const SYNC_WINDOW_OPTIONS: Record<string, string> = {
	'1': 'Last day',
	'3': 'Last 3 days',
	'7': 'Last 7 days',
	'14': 'Last 14 days',
	'30': 'Last 30 days',
	'90': 'Last 90 days',
	'365': 'Last 365 days',
};

export const AUTO_SYNC_OPTIONS: Record<string, string> = {
	'0': 'Off',
	'15': 'Every 15 minutes',
	'30': 'Every 30 minutes',
	'60': 'Every hour',
	'180': 'Every 3 hours',
	'360': 'Every 6 hours',
	'720': 'Every 12 hours',
	'1440': 'Once a day',
};

/** The part of an email before the @ (and before any +tag): the fallback author name of share links. */
export function emailName(email: string): string | null {
	const local = email.split('@')[0]?.split('+')[0]?.trim() ?? '';
	return local || null;
}

/** Fields of a share link the plugin creates, the same as the Fieldy app's own links. */
export function shareLinkFields(settings: Pick<FieldySyncSettings, 'shareLinkTranscript'>): string[] {
	const fields = ['title', 'startTime', 'endTime', 'summary', 'quotes', 'keywords'];
	if (settings.shareLinkTranscript) fields.push('transcriptions');
	return fields;
}

/** Statuses requested from `GET /tasks` for the current settings. */
export function taskStatusesFor(settings: FieldySyncSettings): TaskStatus[] {
	if (!settings.includeTasks) return [];
	const statuses: TaskStatus[] = ['new', 'approved'];
	if (settings.includeCompletedTasks) statuses.push('completed');
	if (settings.includeDismissedTasks) statuses.push('rejected', 'skipped', 'cancelled', 'expired');
	return statuses;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

/** A `#rrggbb` colour; anything else (it ends up in a style property) falls back. */
function hex(value: unknown, fallback: string): string {
	return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function text(value: unknown, fallback: string, maxLength = 200): string {
	return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

/**
 * Validates settings loaded from disk (possibly written by an older version
 * or edited by hand) and fills in defaults. Unknown keys are dropped, which
 * also discards anything that should never have been stored.
 */
export function sanitizeSettings(raw: unknown): FieldySyncSettings {
	const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;
	const secretId = text(s.apiKeySecretId, d.apiKeySecretId, 64);
	return {
		apiKeySecretId: /^[a-z0-9-]*$/.test(secretId) ? secretId : '',

		folder: text(s.folder, d.folder, 300).trim() || d.folder,
		subfolders: pick(s.subfolders, SUBFOLDER_MODES, d.subfolders),
		subfolderFormat: text(s.subfolderFormat, d.subfolderFormat, 100).trim() || d.subfolderFormat,
		importNewOnSync: bool(s.importNewOnSync, d.importNewOnSync),
		syncWindowDays: int(s.syncWindowDays, d.syncWindowDays, 1, 3650),
		recordingSource: pick(s.recordingSource, ['all', ...RECORDING_SOURCES] as const, d.recordingSource),
		includeBrief: bool(s.includeBrief, d.includeBrief),
		syncTimeRules: sanitizeTimeRules(s.syncTimeRules),
		syncOnStartup: bool(s.syncOnStartup, d.syncOnStartup),
		autoSyncMinutes: int(s.autoSyncMinutes, d.autoSyncMinutes, 0, 10_080),
		recreateDeleted: bool(s.recreateDeleted, d.recreateDeleted),
		includeSummary: bool(s.includeSummary, d.includeSummary),
		includeDetails: bool(s.includeDetails, d.includeDetails),
		includeQuotes: bool(s.includeQuotes, d.includeQuotes),
		includeTasks: bool(s.includeTasks, d.includeTasks),
		includeCompletedTasks: bool(s.includeCompletedTasks, d.includeCompletedTasks),
		includeDismissedTasks: bool(s.includeDismissedTasks, d.includeDismissedTasks),
		dataviewTaskFields: bool(s.dataviewTaskFields, d.dataviewTaskFields),
		pushTaskCompletion: bool(s.pushTaskCompletion, d.pushTaskCompletion),
		includeTranscript: bool(s.includeTranscript, d.includeTranscript),
		includeShareLinks: bool(s.includeShareLinks, d.includeShareLinks),
		useShareLinks: bool(s.useShareLinks, d.useShareLinks),
		createShareLinks: bool(s.createShareLinks, d.createShareLinks),
		shareLinkAuthor: text(s.shareLinkAuthor, d.shareLinkAuthor, 100).trim(),
		shareLinkTranscript: bool(s.shareLinkTranscript, d.shareLinkTranscript),
		showNoteBanner: bool(s.showNoteBanner, d.showNoteBanner),
		bannerColors: pick(s.bannerColors, ['theme', 'custom'] as const, d.bannerColors),
		bannerColorSynced: hex(s.bannerColorSynced, d.bannerColorSynced),
		bannerColorEdited: hex(s.bannerColorEdited, d.bannerColorEdited),
		bannerColorPaused: hex(s.bannerColorPaused, d.bannerColorPaused),
		bannerColorSyncedDark: hex(s.bannerColorSyncedDark, d.bannerColorSyncedDark),
		bannerColorEditedDark: hex(s.bannerColorEditedDark, d.bannerColorEditedDark),
		bannerColorPausedDark: hex(s.bannerColorPausedDark, d.bannerColorPausedDark),
		keepTranscriptInEditedCopy: bool(s.keepTranscriptInEditedCopy, d.keepTranscriptInEditedCopy),

		filenamePattern: text(s.filenamePattern, d.filenamePattern).trim() || d.filenamePattern,
		filenameDateFormat: text(s.filenameDateFormat, d.filenameDateFormat, 60).trim() || d.filenameDateFormat,
		noteDateFormat: text(s.noteDateFormat, d.noteDateFormat, 60).trim() || d.noteDateFormat,
		frontmatterDates: pick(s.frontmatterDates, ['local', 'iso'] as const, d.frontmatterDates),
		transcriptFormat: pick(s.transcriptFormat, ['paragraphs', 'timestamped', 'timestamped-speaker'] as const, d.transcriptFormat),
		timestampStyle: pick(s.timestampStyle, ['clock', 'elapsed'] as const, d.timestampStyle),
		collapseTranscript: bool(s.collapseTranscript, d.collapseTranscript),
		fmSpeakers: bool(s.fmSpeakers, d.fmSpeakers),
		fmKeywords: bool(s.fmKeywords, d.fmKeywords),
		fmLocation: bool(s.fmLocation, d.fmLocation),
		fmTemplate: bool(s.fmTemplate, d.fmTemplate),
		tags: text(s.tags, d.tags, 500),
		keywordTags: bool(s.keywordTags, d.keywordTags),
		titleAlias: bool(s.titleAlias, d.titleAlias),
		linkSpeakers: bool(s.linkSpeakers, d.linkSpeakers),
		peopleFolder: sanitizeFolderPath(text(s.peopleFolder, d.peopleFolder, 300)),
		linkTranscriptSpeakers: bool(s.linkTranscriptSpeakers, d.linkTranscriptSpeakers),
		createSpeakerNotes: bool(s.createSpeakerNotes, d.createSpeakerNotes),

		privateKeywords: text(s.privateKeywords, d.privateKeywords, 5000),
		privateSpeakers: text(s.privateSpeakers, d.privateSpeakers, 5000),
		privatePlaces: text(s.privatePlaces, d.privatePlaces, 5000),
		privateTemplates: text(s.privateTemplates, d.privateTemplates, 5000),
		privateTimeRules: sanitizeTimeRules(s.privateTimeRules),
		privacySearchTranscript: bool(s.privacySearchTranscript, d.privacySearchTranscript),
		deletePrivateNotes: bool(s.deletePrivateNotes, d.deletePrivateNotes),
		showPrivateTitles: bool(s.showPrivateTitles, d.showPrivateTitles),

		requestTimeoutSeconds: int(s.requestTimeoutSeconds, d.requestTimeoutSeconds, 5, 300),
		maxRetries: int(s.maxRetries, d.maxRetries, 0, 10),
		requestsPerMinute: int(s.requestsPerMinute, d.requestsPerMinute, 5, MAX_REQUESTS_PER_MINUTE),
		notices: pick(s.notices, ['all', 'changes', 'errors'] as const, d.notices),
		showStatusBar: bool(s.showStatusBar, d.showStatusBar),
		debugLogging: bool(s.debugLogging, d.debugLogging),
		mobileNoticeShown: bool(s.mobileNoticeShown, d.mobileNoticeShown),
	};
}
