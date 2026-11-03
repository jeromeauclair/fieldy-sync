import type { FieldyConversation, FieldyTranscriptSegment } from '../api/types';
import type { FieldySyncSettings } from '../settings/settings';
import { describeTimeRules, overlapsTimeRules, type TimeRule } from '../utils/timeRules';

/**
 * Privacy filters: conversations matching one of the user's rules are kept
 * out of the vault (no note, no tasks, no export) and show in the panel as a
 * brief "private" card. Matching is local and ignores case and accents.
 */

export type PrivacyRuleKind = 'keyword' | 'speaker' | 'place' | 'template' | 'time';

export interface PrivacyMatch {
	kind: PrivacyRuleKind;
	/** The rule as the user wrote it. */
	value: string;
	/** Found in the transcript (only with "Also search transcripts"). */
	inTranscript?: boolean;
}

interface Rule {
	/** As written by the user, for messages. */
	value: string;
	/** Normalised for matching. */
	key: string;
	/** A trailing `*` matches any word starting with `key`. */
	prefix: boolean;
}

export interface PrivacyRules {
	keywords: Rule[];
	speakers: Rule[];
	places: Rule[];
	templates: Rule[];
	/** Private times: a conversation touching one of them is private. */
	times: TimeRule[];
	searchTranscript: boolean;
}

/** Lower case, without accents, with runs of spaces collapsed. */
export function normalizeText(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/** One rule per line or comma; blank entries and repeats are dropped. */
function parseRules(raw: string, allowPrefix: boolean): Rule[] {
	const seen = new Set<string>();
	const rules: Rule[] = [];
	for (const part of raw.split(/[\n,]/)) {
		const value = part.trim();
		if (!value) continue;
		const prefix = allowPrefix && value.endsWith('*');
		const key = normalizeText(prefix ? value.slice(0, -1) : value);
		const id = `${key}${prefix ? '*' : ''}`;
		if (!key || seen.has(id)) continue;
		seen.add(id);
		rules.push({ value, key, prefix });
	}
	return rules;
}

export function privacyRules(
	settings: Pick<FieldySyncSettings, 'privateKeywords' | 'privateSpeakers' | 'privatePlaces' | 'privateTemplates' | 'privateTimeRules' | 'privacySearchTranscript'>,
): PrivacyRules {
	return {
		keywords: parseRules(settings.privateKeywords, true),
		speakers: parseRules(settings.privateSpeakers, false),
		places: parseRules(settings.privatePlaces, true),
		templates: parseRules(settings.privateTemplates, false),
		times: settings.privateTimeRules,
		searchTranscript: settings.privacySearchTranscript,
	};
}

export function hasPrivacyRules(rules: PrivacyRules): boolean {
	return rules.keywords.length + rules.speakers.length + rules.places.length + rules.templates.length + rules.times.length > 0;
}

/** Whether a conversation can only be cleared by reading its transcript. */
export function transcriptRulesActive(rules: PrivacyRules): boolean {
	return rules.searchTranscript && (rules.keywords.length > 0 || rules.speakers.length > 0);
}

/** Identifies the rules a transcript was checked against (cached results are only reused for the same rules). */
export function transcriptRulesKey(rules: PrivacyRules): string {
	const list = (r: Rule[]) => r.map((x) => `${x.key}${x.prefix ? '*' : ''}`).sort().join('\u0001');
	return `${list(rules.keywords)}\u0002${list(rules.speakers)}`;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const compiled = new Map<string, RegExp>();

/** Whole words or phrases; with `prefix`, the last word may continue ("therap*" matches "therapist"). */
function wordPattern(rule: Rule): RegExp {
	const id = `${rule.key}${rule.prefix ? '*' : ''}`;
	let re = compiled.get(id);
	if (!re) {
		const body = rule.key.split(' ').map(escapeRegExp).join('\\s+');
		re = new RegExp(`(?<![\\p{L}\\p{N}])${body}${rule.prefix ? '' : '(?![\\p{L}\\p{N}])'}`, 'u');
		if (compiled.size > 500) compiled.clear();
		compiled.set(id, re);
	}
	return re;
}

function containsWord(normalizedText: string, rule: Rule): boolean {
	return normalizedText !== '' && wordPattern(rule).test(normalizedText);
}

/** Text a keyword rule looks at, from what Fieldy sends with the conversation list. */
function conversationText(c: FieldyConversation): string {
	return normalizeText(
		[c.title, c.summary, c.content, ...c.keywords, ...c.quotes.flatMap((q) => [q.text, q.context])].filter((part): part is string => !!part).join('\n'),
	);
}

function placeText(c: FieldyConversation): string {
	const l = c.location;
	if (!l) return '';
	return normalizeText([l.address, l.street, l.city, l.zip, l.country].filter((part): part is string => !!part).join('\n'));
}

/**
 * Rules matched by the conversation itself (title, summary, memory notes,
 * keywords, quotes, speakers, location, template). `templateTitle` is the
 * conversation's template name, when known.
 */
export function conversationMatches(c: FieldyConversation, rules: PrivacyRules, templateTitle: string | null): PrivacyMatch[] {
	const matches: PrivacyMatch[] = [];
	if (rules.keywords.length > 0) {
		const text = conversationText(c);
		for (const rule of rules.keywords) if (containsWord(text, rule)) matches.push({ kind: 'keyword', value: rule.value });
	}
	if (rules.speakers.length > 0) {
		const speakers = new Set(c.speakers.map(normalizeText));
		for (const rule of rules.speakers) if (speakers.has(rule.key)) matches.push({ kind: 'speaker', value: rule.value });
	}
	if (rules.places.length > 0) {
		const text = placeText(c);
		for (const rule of rules.places) if (containsWord(text, rule)) matches.push({ kind: 'place', value: rule.value });
	}
	if (rules.templates.length > 0 && c.templateId) {
		const title = templateTitle ? normalizeText(templateTitle) : null;
		const id = normalizeText(c.templateId);
		for (const rule of rules.templates) if (rule.key === title || rule.key === id) matches.push({ kind: 'template', value: rule.value });
	}
	if (rules.times.length > 0) {
		if (overlapsTimeRules(c.startTime, c.endTime, rules.times)) matches.push({ kind: 'time', value: describeTimeRules(rules.times) });
	}
	return matches;
}

/** Keyword and speaker rules matched by the transcript (words said, speaker labels). */
export function transcriptMatches(segments: readonly FieldyTranscriptSegment[], rules: PrivacyRules): PrivacyMatch[] {
	const matches: PrivacyMatch[] = [];
	if (rules.keywords.length > 0) {
		const text = normalizeText(segments.map((s) => s.text).join('\n'));
		for (const rule of rules.keywords) if (containsWord(text, rule)) matches.push({ kind: 'keyword', value: rule.value, inTranscript: true });
	}
	if (rules.speakers.length > 0) {
		const speakers = new Set(segments.map((s) => normalizeText(s.speaker)));
		for (const rule of rules.speakers) if (speakers.has(rule.key)) matches.push({ kind: 'speaker', value: rule.value, inTranscript: true });
	}
	return matches;
}

const KIND_LABELS: Record<PrivacyRuleKind, string> = {
	keyword: 'keyword',
	speaker: 'speaker',
	place: 'place',
	template: 'template',
	time: 'time',
};

/** `keyword "doctor", speaker "Dr Martin" (in the transcript)`. */
export function describeMatches(matches: readonly PrivacyMatch[]): string {
	return matches.map((m) => `${KIND_LABELS[m.kind]} "${m.value}"${m.inTranscript ? ' (in the transcript)' : ''}`).join(', ');
}
