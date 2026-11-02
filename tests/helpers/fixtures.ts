import moment from 'moment';
import type { FieldyConversation, FieldyTask, FieldyTranscriptSegment, TaskStatus } from '../../src/api/types';
import { DEFAULT_SETTINGS, type FieldySyncSettings } from '../../src/settings/settings';
import type { DateFormatter } from '../../src/utils/dates';

/** Deterministic (UTC) date formatter for tests. */
export const formatUtc: DateFormatter = (iso, format) => moment.utc(iso).format(format);

export function makeConversation(id: string, overrides: Partial<FieldyConversation> = {}): FieldyConversation {
	return {
		id,
		title: `Meeting ${id}`,
		summary: `Summary of ${id}.`,
		content: null,
		locked: false,
		startTime: '2026-10-01T14:00:00.000Z',
		endTime: '2026-10-01T14:45:00.000Z',
		type: 'FULL',
		keywords: [],
		speakers: ['Alex', 'Sam'],
		quotes: [],
		location: null,
		locationId: null,
		templateId: null,
		recommendedTemplateIds: [],
		calendarEventId: null,
		updatedAt: '2026-10-01T15:00:00.000Z',
		...overrides,
	};
}

export function makeTask(id: string, memoryId: string | null, status: TaskStatus = 'new', overrides: Partial<FieldyTask> = {}): FieldyTask {
	return {
		id,
		title: `Task ${id}`,
		date: null,
		status,
		memoryId,
		completionDate: null,
		cancellationDate: null,
		...overrides,
	};
}

export function makeSegment(id: string, timestamp: string, speaker: string, text: string, overrides: Partial<FieldyTranscriptSegment> = {}): FieldyTranscriptSegment {
	return {
		id,
		text,
		timestamp,
		speaker,
		speakerProfileId: null,
		start: null,
		end: null,
		createdAt: null,
		recordingSource: 'wearable',
		...overrides,
	};
}

export function testSettings(overrides: Partial<FieldySyncSettings> = {}): FieldySyncSettings {
	return { ...DEFAULT_SETTINGS, apiKeySecretId: 'fieldy-api-key', ...overrides };
}
