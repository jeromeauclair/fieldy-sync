import { FieldyError } from '../utils/errors';
import {
	RECORDING_SOURCES,
	TASK_STATUSES,
	type FieldyConversation,
	type FieldyLocation,
	type FieldyMemoryTemplate,
	type FieldyQuote,
	type FieldySharable,
	type FieldySpeakerProfile,
	type FieldyTask,
	type FieldyTranscriptSegment,
	type FieldyUser,
	type Page,
	type RecordingSource,
	type TaskStatus,
} from './types';

/*
 * Runtime validation of Fieldy responses. Identity fields (ids, timestamps)
 * are required; an item without them is dropped and counted. Optional or
 * nullable fields fall back to safe defaults so a partially populated item
 * still renders. A response whose envelope is wrong is "malformed".
 */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function nonEmptyStr(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function malformed(what: string): FieldyError {
	return new FieldyError('malformed-response', `Malformed Fieldy response: ${what}`);
}

function parseLocation(value: unknown): FieldyLocation | null {
	if (!isObject(value)) return null;
	const coords = isObject(value.coordinates) ? value.coordinates : null;
	const latitude = coords ? num(coords.latitude) : null;
	const longitude = coords ? num(coords.longitude) : null;
	return {
		address: str(value.address),
		street: str(value.street),
		streetNumber: str(value.streetNumber),
		city: str(value.city),
		zip: str(value.zip),
		country: str(value.country),
		placeId: str(value.placeId),
		coordinates: latitude !== null && longitude !== null ? { latitude, longitude } : null,
	};
}

function parseQuotes(value: unknown): FieldyQuote[] {
	if (!Array.isArray(value)) return [];
	const quotes: FieldyQuote[] = [];
	for (const q of value) {
		if (isObject(q)) {
			const text = nonEmptyStr(q.text);
			if (text) quotes.push({ text, context: nonEmptyStr(q.context) });
		}
	}
	return quotes;
}

export function parseConversation(value: unknown): FieldyConversation | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const startTime = nonEmptyStr(value.startTime);
	if (!id || !startTime || Number.isNaN(Date.parse(startTime))) return null;
	const speakers = strArray(value.speakers);
	return {
		id,
		title: str(value.title),
		summary: str(value.summary),
		content: str(value.content),
		locked: value.locked === true,
		startTime,
		endTime: nonEmptyStr(value.endTime),
		type: str(value.type) ?? 'FULL',
		keywords: strArray(value.keywords),
		// `memorySpeakers` is the deprecated alias of `speakers`.
		speakers: speakers.length > 0 ? speakers : strArray(value.memorySpeakers),
		quotes: parseQuotes(value.quotes),
		location: parseLocation(value.location),
		locationId: str(value.locationId),
		// `memoryTemplateId` is the deprecated alias of `templateId`.
		templateId: nonEmptyStr(value.templateId) ?? nonEmptyStr(value.memoryTemplateId),
		recommendedTemplateIds: strArray(value.recommendedTemplateIds),
		calendarEventId: str(value.calendarEventId),
		updatedAt: nonEmptyStr(value.updatedAt),
	};
}

function parseRecordingSource(value: unknown): RecordingSource | null {
	return typeof value === 'string' && (RECORDING_SOURCES as readonly string[]).includes(value)
		? (value as RecordingSource)
		: null;
}

export function parseTranscriptSegment(value: unknown): FieldyTranscriptSegment | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const timestamp = nonEmptyStr(value.timestamp);
	const text = str(value.text);
	if (!id || !timestamp || text === null) return null;
	return {
		id,
		text,
		timestamp,
		speaker: str(value.speaker) ?? '',
		speakerProfileId: nonEmptyStr(value.speakerProfileId),
		start: num(value.start),
		end: num(value.end),
		createdAt: str(value.createdAt),
		recordingSource: parseRecordingSource(value.recordingSource),
	};
}

function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function parseTask(value: unknown): FieldyTask | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const title = str(value.title);
	const status = value.status;
	if (!id || title === null || !isTaskStatus(status)) return null;
	return {
		id,
		title,
		date: nonEmptyStr(value.date),
		status,
		memoryId: nonEmptyStr(value.memoryId),
		completionDate: nonEmptyStr(value.completionDate),
		cancellationDate: nonEmptyStr(value.cancellationDate),
	};
}

export function parseSpeakerProfile(value: unknown): FieldySpeakerProfile | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const name = nonEmptyStr(value.name);
	if (!id || !name) return null;
	return { id, name, color: str(value.color) };
}

export function parseMemoryTemplate(value: unknown): FieldyMemoryTemplate | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const title = nonEmptyStr(value.title);
	if (!id || !title) return null;
	const sections = Array.isArray(value.sections)
		? value.sections.flatMap((s: unknown) => {
				if (!isObject(s)) return [];
				const sectionTitle = str(s.title);
				return sectionTitle !== null ? [{ title: sectionTitle, prompt: str(s.prompt) ?? '' }] : [];
			})
		: [];
	return {
		id,
		title,
		emoji: nonEmptyStr(value.emoji),
		description: str(value.description),
		prompt: str(value.prompt) ?? '',
		sections,
		updatedAt: nonEmptyStr(value.updatedAt),
	};
}

export function parseSharable(value: unknown): FieldySharable | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const url = nonEmptyStr(value.url);
	if (!id || !url || !/^https:\/\//i.test(url)) return null;
	return {
		id,
		url,
		enabled: value.enabled === true,
		authorName: str(value.authorName) ?? '',
		sharedFields: strArray(value.sharedFields),
	};
}

export function parseUser(value: unknown): FieldyUser {
	if (!isObject(value) || typeof value.email !== 'string') throw malformed('user is missing "email"');
	return { email: value.email };
}

/** Parses `{ items: [...], nextCursor? }` envelopes. */
export function parsePage<T>(value: unknown, parseItem: (item: unknown) => T | null, what: string): Page<T> {
	if (!isObject(value) || !Array.isArray(value.items)) throw malformed(`${what} response has no "items" array`);
	const items: T[] = [];
	let skipped = 0;
	for (const raw of value.items) {
		const item = parseItem(raw);
		if (item === null) skipped++;
		else items.push(item);
	}
	const cursor = value.nextCursor;
	if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') {
		throw malformed(`${what} response has an invalid "nextCursor"`);
	}
	return { items, nextCursor: nonEmptyStr(cursor), skipped };
}
