import type { CreateSharableParams, FieldyConversation, FieldySharable, FieldyTask, FieldyTranscriptSegment, ListConversationsParams, TaskStatus } from '../../src/api/types';
import type { FieldyApi } from '../../src/sync/SyncEngine';
import { cancelledError } from '../../src/utils/async';
import { FieldyError } from '../../src/utils/errors';

/** Scriptable in-memory Fieldy account implementing the client surface the engine uses. */
export class FakeFieldyApi implements FieldyApi {
	conversations: FieldyConversation[] = [];
	transcripts = new Map<string, FieldyTranscriptSegment[]>();
	tasks: FieldyTask[] = [];
	sharables = new Map<string, FieldySharable[]>();
	failShareCreation = false;
	failTranscriptFor = new Set<string>();
	readonly calls = { list: 0, get: 0, transcripts: 0, tasks: 0, profiles: 0, templates: 0, sharables: 0, createSharable: 0, complete: 0 };
	readonly completed: string[] = [];
	lastListParams: Omit<ListConversationsParams, 'cursor'> | null = null;

	private check(signal?: AbortSignal): void {
		if (signal?.aborted) throw cancelledError();
	}

	async listConversations(params: Omit<ListConversationsParams, 'cursor'>, options: { signal?: AbortSignal; onPage?: (n: number) => void } = {}) {
		this.check(options.signal);
		this.calls.list++;
		this.lastListParams = params;
		const items = this.conversations.map((c) => structuredClone(c));
		options.onPage?.(items.length);
		return { items, skipped: 0 };
	}

	async getConversation(id: string, options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.get++;
		const found = this.conversations.find((c) => c.id === id);
		return found ? structuredClone(found) : null;
	}

	async listTranscriptions(params: { conversationId?: string }, options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.transcripts++;
		const id = params.conversationId ?? '';
		if (this.failTranscriptFor.has(id)) throw new FieldyError('server', 'HTTP 503', { status: 503 });
		return structuredClone(this.transcripts.get(id) ?? []);
	}

	async listTasksByStatuses(statuses: readonly TaskStatus[], options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.tasks++;
		return this.tasks.filter((t) => statuses.includes(t.status)).map((t) => structuredClone(t));
	}

	async listSpeakerProfiles(options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.profiles++;
		return [{ id: 'profile-1', name: 'Jordan', color: null }];
	}

	async listMemoryTemplates(options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.templates++;
		return [{ id: 'tpl-1', title: 'Sales call', emoji: null, description: null, prompt: '', sections: [], updatedAt: null }];
	}

	async listSharables(conversationId: string, options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.sharables++;
		return structuredClone(this.sharables.get(conversationId) ?? []);
	}

	readonly createdSharables: CreateSharableParams[] = [];

	async createSharable(params: CreateSharableParams, options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.createSharable++;
		if (this.failShareCreation) throw new FieldyError('server', 'HTTP 503', { status: 503 });
		this.createdSharables.push(structuredClone(params));
		const link: FieldySharable = { id: `s-${params.conversationId}`, url: `https://share.example/${params.conversationId}`, enabled: true, authorName: params.authorName, sharedFields: [...params.sharedFields] };
		this.sharables.set(params.conversationId, [link]);
		return structuredClone(link);
	}

	async completeTask(id: string, completionDate: string, options: { signal?: AbortSignal } = {}) {
		this.check(options.signal);
		this.calls.complete++;
		this.completed.push(id);
		const task = this.tasks.find((t) => t.id === id);
		if (!task) return null;
		task.status = 'completed';
		task.completionDate = completionDate;
		return structuredClone(task);
	}
}
