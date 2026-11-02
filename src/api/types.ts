/**
 * Types for the Fieldy Public API v2 (OpenAPI 3.1.1, "Fieldy Public API"
 * 2.0.0). Only fields present in the official specification are modelled.
 * Values are normalised by `validate.ts` (deprecated aliases folded in,
 * optional arrays defaulted) before they reach the rest of the plugin.
 */

export const FIELDY_API_BASE_URL = 'https://api.fieldy.ai/api/public/v2';

export const TASK_STATUSES = ['new', 'approved', 'completed', 'rejected', 'skipped', 'cancelled', 'expired'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RECORDING_SOURCES = ['wearable', 'phone', 'desktop'] as const;
export type RecordingSource = (typeof RECORDING_SOURCES)[number];

export interface FieldyUser {
	email: string;
}

interface FieldyCoordinates {
	latitude: number;
	longitude: number;
}

export interface FieldyLocation {
	address: string | null;
	street: string | null;
	streetNumber: string | null;
	city: string | null;
	zip: string | null;
	country: string | null;
	placeId: string | null;
	coordinates: FieldyCoordinates | null;
}

export interface FieldyQuote {
	text: string;
	context: string | null;
}

/** `GET /conversations` item and `GET /conversations/{id}` response. */
export interface FieldyConversation {
	id: string;
	title: string | null;
	summary: string | null;
	content: string | null;
	/** Content redacted by the free-plan history window. */
	locked: boolean;
	startTime: string;
	endTime: string | null;
	/** `FULL` or `BRIEF` per the spec. */
	type: string;
	keywords: string[];
	speakers: string[];
	quotes: FieldyQuote[];
	location: FieldyLocation | null;
	locationId: string | null;
	templateId: string | null;
	recommendedTemplateIds: string[];
	calendarEventId: string | null;
	updatedAt: string | null;
}

/** `GET /transcriptions` item. */
export interface FieldyTranscriptSegment {
	id: string;
	text: string;
	/** Wall-clock ISO 8601 timestamp of the segment. */
	timestamp: string;
	speaker: string;
	speakerProfileId: string | null;
	/** Offsets in seconds on the audio timeline (not wall clock). */
	start: number | null;
	end: number | null;
	createdAt: string | null;
	recordingSource: RecordingSource | null;
}

/** `GET /tasks` item. `memoryId` is the id of the originating conversation. */
export interface FieldyTask {
	id: string;
	title: string;
	date: string | null;
	status: TaskStatus;
	memoryId: string | null;
	completionDate: string | null;
	cancellationDate: string | null;
}

/** Fields `PATCH /tasks/{id}` accepts; dates are ISO 8601. Fieldy cannot clear a date. */
export interface TaskChanges {
	title?: string;
	date?: string;
	status?: TaskStatus;
	completionDate?: string;
	cancellationDate?: string;
}

export interface FieldySpeakerProfile {
	id: string;
	name: string;
	color: string | null;
}

interface FieldyMemoryTemplateSection {
	title: string;
	prompt: string;
}

export interface FieldyMemoryTemplate {
	id: string;
	title: string;
	emoji: string | null;
	description: string | null;
	/** Instructions Fieldy uses to summarise conversations with this template. */
	prompt: string;
	sections: FieldyMemoryTemplateSection[];
	/** Last change in Fieldy (ISO 8601), when Fieldy reports it. */
	updatedAt: string | null;
}

export interface FieldySharable {
	id: string;
	url: string;
	enabled: boolean;
	authorName: string;
	sharedFields: string[];
}

export interface Page<T> {
	items: T[];
	nextCursor: string | null;
	/** Items dropped because they lacked required fields. */
	skipped: number;
}

export interface TimeRange {
	/** ISO 8601. */
	startTime: string;
	/** ISO 8601. */
	endTime: string;
}

type ConversationRangeMode = 'starts-in-range' | 'intersects-range';

export interface ListConversationsParams extends TimeRange {
	mode?: ConversationRangeMode;
	pageSize?: number;
	cursor?: string;
	recordingSource?: RecordingSource;
}

export interface ListTranscriptionsParams {
	startTime: string;
	endTime?: string;
	conversationId?: string;
	recordingSource?: RecordingSource;
}
