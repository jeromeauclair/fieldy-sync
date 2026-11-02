/** Formats an ISO timestamp with a Moment.js format string (provided by Obsidian). */
export type DateFormatter = (iso: string, format: string) => string;

export function isValidIso(iso: string | null | undefined): iso is string {
	return typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
}

export function durationMinutes(startIso: string, endIso: string | null): number | null {
	if (!isValidIso(startIso) || !isValidIso(endIso)) return null;
	const ms = Date.parse(endIso) - Date.parse(startIso);
	if (ms < 0) return null;
	return Math.round(ms / 60_000);
}

export function formatDuration(minutes: number | null): string | null {
	if (minutes === null) return null;
	if (minutes < 1) return 'under 1 min';
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/** `H:MM:SS` for elapsed times of an hour or more, otherwise `MM:SS`. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function daysBefore(nowMs: number, days: number): string {
	return new Date(nowMs - days * 24 * 3600 * 1000).toISOString();
}

/** Earliest date used for "entire history" queries. */
export const HISTORY_START_ISO = '2020-01-01T00:00:00.000Z';
