import type { FieldyConversation, FieldyMemoryTemplate, FieldyTranscriptSegment, ListTranscriptionsParams } from '../api/types';
import type { FieldySyncSettings } from '../settings/settings';
import {
	conversationMatches,
	hasPrivacyRules,
	privacyRules,
	transcriptMatches,
	transcriptRulesActive,
	transcriptRulesKey,
	type PrivacyMatch,
	type PrivacyRuleKind,
	type PrivacyRules,
} from './privacy';

/**
 * - `public`: no privacy filter matches.
 * - `private`: kept out of the vault; `matches` says which filters.
 * - `pending`: not known yet without a request (the transcript, or the
 *   template names, still have to be read). Treated as private until then.
 */
export type PrivacyVerdict = { state: 'public' } | { state: 'private'; matches: PrivacyMatch[] } | { state: 'pending' };
export type SettledVerdict = Exclude<PrivacyVerdict, { state: 'pending' }>;

const PUBLIC: SettledVerdict = { state: 'public' };
const PENDING: PrivacyVerdict = { state: 'pending' };

/** A transcript checked against the transcript rules; reused while the rules and the conversation are unchanged. */
export interface TranscriptCheck {
	key: string;
	updatedAt: string | null;
	matches: PrivacyMatch[];
}

/** Transcript results kept in data.json, so each transcript is read once, not at every sync. */
const MAX_TRANSCRIPT_CHECKS = 5000;

const KINDS: readonly PrivacyRuleKind[] = ['keyword', 'speaker', 'place', 'template', 'time'];

/** Validates stored transcript results; anything malformed is dropped (it is only a cache). */
export function sanitizeTranscriptChecks(raw: unknown): Record<string, TranscriptCheck> {
	const out: Record<string, TranscriptCheck> = {};
	if (typeof raw !== 'object' || raw === null) return out;
	for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== 'object' || value === null) continue;
		const v = value as Record<string, unknown>;
		if (typeof v.key !== 'string' || !Array.isArray(v.matches)) continue;
		const matches: PrivacyMatch[] = [];
		for (const m of v.matches as unknown[]) {
			if (typeof m !== 'object' || m === null) continue;
			const match = m as Record<string, unknown>;
			if (typeof match.value !== 'string' || !KINDS.includes(match.kind as PrivacyRuleKind)) continue;
			matches.push({ kind: match.kind as PrivacyRuleKind, value: match.value, ...(match.inTranscript === true ? { inTranscript: true } : {}) });
		}
		out[id] = { key: v.key, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null, matches };
	}
	return out;
}

export class TranscriptCheckCache {
	/** Bumped on every change, so verdicts built on older results are recomputed. */
	revision = 0;

	constructor(
		private data: Record<string, TranscriptCheck> = {},
		private readonly onChange: () => void = () => undefined,
	) {}

	get(id: string): TranscriptCheck | undefined {
		return this.data[id];
	}

	set(id: string, check: TranscriptCheck): void {
		delete this.data[id];
		this.data[id] = check;
		this.revision++;
		const ids = Object.keys(this.data);
		// Oldest entries first (insertion order).
		for (let i = 0; i < ids.length - MAX_TRANSCRIPT_CHECKS; i++) delete this.data[ids[i]!];
		this.onChange();
	}

	replace(data: Record<string, TranscriptCheck>): void {
		this.data = data;
		this.revision++;
	}

	toJSON(): Record<string, TranscriptCheck> {
		return this.data;
	}
}

interface PrivacyClient {
	listTranscriptions(params: ListTranscriptionsParams, options?: { signal?: AbortSignal }): Promise<FieldyTranscriptSegment[]>;
	listMemoryTemplates(options?: { signal?: AbortSignal }): Promise<FieldyMemoryTemplate[]>;
}

interface PrivacyGuardDeps {
	settings: () => FieldySyncSettings;
	client: PrivacyClient;
	cache: TranscriptCheckCache;
	now?: () => number;
}

/**
 * Decides whether conversations are private. `check()` answers at once from
 * what is already known; `resolve()` makes the requests a definite answer
 * needs (memory template names, the transcript) and remembers the result.
 */
export class PrivacyGuard {
	private rulesFor: { source: string; rules: PrivacyRules } | null = null;
	private templateTitles: Map<string, string> | null = null;
	private templatesLoading: Promise<void> | null = null;
	/** Bumped when template names arrive or are forgotten. */
	private templatesRevision = 0;
	/**
	 * Verdicts by conversation object. The panel asks about each card several
	 * times per redraw, and time rules check a conversation minute by minute.
	 */
	private verdicts = new WeakMap<FieldyConversation, { key: string; verdict: PrivacyVerdict }>();

	constructor(private readonly deps: PrivacyGuardDeps) {}

	rules(): PrivacyRules {
		const s = this.deps.settings();
		const source = [s.privateKeywords, s.privateSpeakers, s.privatePlaces, s.privateTemplates, JSON.stringify(s.privateTimeRules), String(s.privacySearchTranscript)].join('\u0000');
		if (this.rulesFor?.source !== source) this.rulesFor = { source, rules: privacyRules(s) };
		return this.rulesFor.rules;
	}

	/** Whether any privacy filter is set. */
	active(): boolean {
		return hasPrivacyRules(this.rules());
	}

	/** Template names are read again next time (each sync starts fresh, so renamed templates are seen). */
	forgetTemplates(): void {
		this.templateTitles = null;
		this.templatesLoading = null;
		this.templatesRevision++;
	}

	/** Uses template names the caller already loaded. */
	setTemplates(templates: readonly Pick<FieldyMemoryTemplate, 'id' | 'title'>[]): void {
		this.templateTitles = new Map(templates.map((t) => [t.id, t.title]));
		this.templatesRevision++;
	}

	private async loadTemplates(signal?: AbortSignal): Promise<void> {
		this.templatesLoading ??= this.deps.client
			.listMemoryTemplates({ signal })
			.then((templates) => this.setTemplates(templates))
			.catch((err: unknown) => {
				this.templatesLoading = null;
				throw err;
			});
		await this.templatesLoading;
	}

	/** Reads the template names when a template filter needs them (one request, then kept). */
	async prepare(signal?: AbortSignal): Promise<void> {
		if (this.rules().templates.length > 0 && this.templateTitles === null) await this.loadTemplates(signal);
	}

	/** What is known without any request. */
	check(c: FieldyConversation): PrivacyVerdict {
		const rules = this.rules();
		if (!hasPrivacyRules(rules)) return PUBLIC;
		const key = `${this.rulesFor?.source ?? ''}\u0001${this.templatesRevision}\u0001${this.deps.cache.revision}`;
		const known = this.verdicts.get(c);
		if (known?.key === key) return known.verdict;
		const verdict = this.decide(c, rules);
		this.verdicts.set(c, { key, verdict });
		return verdict;
	}

	private decide(c: FieldyConversation, rules: PrivacyRules): PrivacyVerdict {
		const needsTemplateName = rules.templates.length > 0 && c.templateId !== null && this.templateTitles === null;
		const direct = conversationMatches(c, rules, c.templateId ? (this.templateTitles?.get(c.templateId) ?? null) : null);
		if (direct.length > 0) return { state: 'private', matches: direct };
		if (needsTemplateName) return PENDING;
		if (!transcriptRulesActive(rules)) return PUBLIC;
		const cached = this.deps.cache.get(c.id);
		if (cached && cached.key === transcriptRulesKey(rules) && cached.updatedAt === c.updatedAt) {
			return cached.matches.length > 0 ? { state: 'private', matches: cached.matches } : PUBLIC;
		}
		return PENDING;
	}

	/**
	 * A definite answer, reading template names and the transcript when
	 * needed. Returns the transcript it read, so callers that need it anyway
	 * do not ask for it twice. Throws when a request fails (nothing must be
	 * written for a conversation whose privacy is unknown).
	 */
	async resolve(c: FieldyConversation, signal?: AbortSignal): Promise<{ verdict: SettledVerdict; transcript: FieldyTranscriptSegment[] | null }> {
		const rules = this.rules();
		if (c.templateId !== null) await this.prepare(signal);
		const known = this.check(c);
		if (known.state !== 'pending') return { verdict: known, transcript: null };
		const s = this.deps.settings();
		const now = this.deps.now ?? (() => Date.now());
		const transcript = await this.deps.client.listTranscriptions(
			{
				startTime: c.startTime,
				endTime: c.endTime ?? new Date(now()).toISOString(),
				conversationId: c.id,
				recordingSource: s.recordingSource === 'all' ? undefined : s.recordingSource,
			},
			{ signal },
		);
		const matches = transcriptMatches(transcript, rules);
		this.deps.cache.set(c.id, { key: transcriptRulesKey(rules), updatedAt: c.updatedAt, matches });
		return { verdict: matches.length > 0 ? { state: 'private', matches } : PUBLIC, transcript };
	}
}
