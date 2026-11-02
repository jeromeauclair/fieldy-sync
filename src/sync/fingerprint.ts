import type { FieldyConversation, FieldyTask } from '../api/types';
import type { SpeakerLinks } from '../markdown/speakerLinks';
import { hashString, stableStringify } from '../utils/hash';

/**
 * Fingerprint of everything a note is rendered from: the conversation's
 * content fields, its tasks and the render settings. `updatedAt` is left out
 * on purpose so a timestamp-only change does not rewrite notes. Transcripts
 * are not part of it (they would cost a request per conversation to check);
 * Fieldy updates the conversation when it is reprocessed. Speaker links come
 * from the vault, so a new or renamed people note updates the notes that
 * mention that person.
 */
export function sourceFingerprint(conversation: FieldyConversation, tasks: readonly FieldyTask[], renderKey: string, speakerLinks?: SpeakerLinks): string {
	const c = conversation;
	return hashString(
		stableStringify({
			c: {
				title: c.title,
				summary: c.summary,
				content: c.content,
				locked: c.locked,
				startTime: c.startTime,
				endTime: c.endTime,
				type: c.type,
				keywords: c.keywords,
				speakers: c.speakers,
				quotes: c.quotes,
				location: c.location,
				templateId: c.templateId,
			},
			t: tasks
				.map((t) => ({ id: t.id, title: t.title, date: t.date, status: t.status }))
				.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
			r: renderKey,
			// Left out when empty, so notes without links keep their fingerprint.
			...(speakerLinks && speakerLinks.size > 0 ? { l: [...speakerLinks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) } : {}),
		}),
	);
}
