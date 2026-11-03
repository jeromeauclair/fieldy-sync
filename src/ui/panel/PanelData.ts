import { moment } from 'obsidian';
import {
	TASK_STATUSES,
	type FieldyConversation,
	type FieldyMemoryTemplate,
	type FieldySharable,
	type FieldySpeakerProfile,
	type FieldyTask,
	type FieldyTranscriptSegment,
} from '../../api/types';
import { renderSnippet, type ConversationRenderInput, type SnippetKind } from '../../markdown/ConversationRenderer';
import { resolveSpeakerLinks } from '../../markdown/speakerLinks';
import { speakerName } from '../../markdown/TranscriptRenderer';
import type FieldySyncPlugin from '../../main';

/** Transcripts kept in memory (long ones are several hundred kB each). */
const MAX_CACHED_TRANSCRIPTS = 20;

/**
 * Loads Fieldy data on demand for the side panel and caches it for the
 * panel's lifetime. Everything goes through the plugin's rate-limited client.
 * Failed loads are not cached, so the next attempt retries. `dispose()`
 * cancels all requests still in flight (when the panel closes).
 */
export class PanelData {
	private controller = new AbortController();
	private tasksPromise: Promise<FieldyTask[]> | null = null;
	private profilesPromise: Promise<FieldySpeakerProfile[]> | null = null;
	private templatesPromise: Promise<FieldyMemoryTemplate[]> | null = null;
	private readonly transcripts = new Map<string, Promise<FieldyTranscriptSegment[]>>();
	private readonly shareLinks = new Map<string, Promise<FieldySharable[]>>();
	/** Conversations seen by the panel, by id (for task → conversation lookups). */
	readonly conversations = new Map<string, FieldyConversation>();

	constructor(private readonly plugin: FieldySyncPlugin) {}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	dispose(): void {
		this.controller.abort();
	}

	/** Forgets cached data and cancels pending requests (the refresh buttons). */
	reset(): void {
		this.controller.abort();
		this.controller = new AbortController();
		this.tasksPromise = null;
		this.profilesPromise = null;
		this.templatesPromise = null;
		this.transcripts.clear();
		this.shareLinks.clear();
	}

	/** Runs a request, reports its outcome to the connection status, and forgets it on failure. */
	private async track<T>(load: () => Promise<T>, forget: () => void): Promise<T> {
		try {
			const value = await load();
			this.plugin.reportRequestOutcome();
			return value;
		} catch (err) {
			forget();
			this.plugin.reportRequestOutcome(err);
			throw err;
		}
	}

	/** Drops cached tasks, profiles and templates so the next read fetches them again. */
	forgetLists(): void {
		this.tasksPromise = null;
		this.profilesPromise = null;
		this.templatesPromise = null;
	}

	remember(conversations: readonly FieldyConversation[]): void {
		for (const c of conversations) this.conversations.set(c.id, c);
	}

	allTasks(): Promise<FieldyTask[]> {
		this.tasksPromise ??= this.track(
			() => this.plugin.client.listTasksByStatuses(TASK_STATUSES, { signal: this.signal }),
			() => (this.tasksPromise = null),
		);
		return this.tasksPromise;
	}

	/** Puts a task changed in Fieldy into the cached list, so every tab shows it at once. */
	async replaceTask(task: FieldyTask): Promise<void> {
		const list = await this.tasksPromise?.catch(() => null);
		if (!list) return;
		const index = list.findIndex((t) => t.id === task.id);
		if (index === -1) list.push(task);
		else list[index] = task;
	}

	async tasksFor(conversationId: string): Promise<FieldyTask[]> {
		return (await this.allTasks()).filter((t) => t.memoryId === conversationId);
	}

	speakerProfiles(): Promise<FieldySpeakerProfile[]> {
		this.profilesPromise ??= this.track(
			() => this.plugin.client.listSpeakerProfiles({ signal: this.signal }),
			() => (this.profilesPromise = null),
		);
		return this.profilesPromise;
	}

	templates(): Promise<FieldyMemoryTemplate[]> {
		this.templatesPromise ??= this.track(
			() => this.plugin.client.listMemoryTemplates({ signal: this.signal }),
			() => (this.templatesPromise = null),
		);
		return this.templatesPromise;
	}

	transcript(conversation: FieldyConversation): Promise<FieldyTranscriptSegment[]> {
		let promise = this.transcripts.get(conversation.id);
		if (promise) {
			// Most recently used last, so the oldest is dropped first.
			this.transcripts.delete(conversation.id);
			this.transcripts.set(conversation.id, promise);
		} else {
			const source = this.plugin.settings.recordingSource;
			promise = this.track(
				() =>
					this.plugin.client.listTranscriptions(
						{
							startTime: conversation.startTime,
							endTime: conversation.endTime ?? new Date().toISOString(),
							conversationId: conversation.id,
							recordingSource: source === 'all' ? undefined : source,
						},
						{ signal: this.signal },
					),
				() => this.transcripts.delete(conversation.id),
			);
			this.transcripts.set(conversation.id, promise);
			for (const id of this.transcripts.keys()) {
				if (this.transcripts.size <= MAX_CACHED_TRANSCRIPTS) break;
				this.transcripts.delete(id);
			}
		}
		return promise;
	}

	sharables(conversationId: string): Promise<FieldySharable[]> {
		// Share links turned off: never asked for.
		if (!this.plugin.settings.useShareLinks) return Promise.resolve([]);
		let promise = this.shareLinks.get(conversationId);
		if (!promise) {
			promise = this.track(
				() => this.plugin.client.listSharables(conversationId, { signal: this.signal }),
				() => this.shareLinks.delete(conversationId),
			).then((links) => {
				const author = links.find((l) => l.authorName.trim() !== '')?.authorName;
				if (author) this.plugin.rememberShareAuthor(author);
				return links;
			});
			this.shareLinks.set(conversationId, promise);
		}
		return promise;
	}

	/** Puts a conversation's links changed from the panel into the cache. */
	setSharables(conversationId: string, links: FieldySharable[]): void {
		this.shareLinks.set(conversationId, Promise.resolve(links));
	}

	/** Everything needed to render pieces of a conversation; the transcript only when asked. */
	async renderInput(conversation: FieldyConversation, withTranscript: boolean): Promise<ConversationRenderInput> {
		const [tasks, transcript, templates] = await Promise.all([
			this.tasksFor(conversation.id),
			withTranscript ? this.transcript(conversation) : Promise.resolve(null),
			conversation.templateId ? this.templates().catch(() => []) : Promise.resolve([]),
		]);
		const speakerNames =
			transcript?.some((s) => s.speakerProfileId) === true
				? new Map((await this.speakerProfiles().catch(() => [])).map((p) => [p.id, p.name]))
				: new Map<string, string>();
		const templateName = templates.find((t) => t.id === conversation.templateId)?.title ?? null;
		const transcriptNames = this.plugin.settings.linkTranscriptSpeakers && transcript ? transcript.map((s) => speakerName(s, speakerNames)) : [];
		const speakerLinks = resolveSpeakerLinks([...conversation.speakers, ...transcriptNames], this.plugin.peopleIndex());
		return { conversation, tasks, transcript, speakerNames, templateName, shareLinks: [], speakerLinks };
	}

	/** Markdown for one piece of a conversation, using the user's formatting settings. */
	async snippet(conversation: FieldyConversation, kind: SnippetKind, display = false): Promise<string> {
		const needsTranscript = kind === 'transcript' || kind === 'full';
		const input = await this.renderInput(conversation, needsTranscript);
		// Shown in the panel: plain "(due …)" dates; Dataview fields are only for notes and copies.
		const settings = display ? { ...this.plugin.settings, dataviewTaskFields: false } : this.plugin.settings;
		return renderSnippet(kind, input, settings, (iso, format) => moment(iso).format(format));
	}
}
