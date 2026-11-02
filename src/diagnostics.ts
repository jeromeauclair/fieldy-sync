import type { FieldySyncSettings } from './settings/settings';
import type { SyncState } from './sync/SyncState';
import { redactSecrets } from './utils/redact';

interface DiagnosticsInput {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
	settings: FieldySyncSettings;
	apiKeyConfigured: boolean;
	state: SyncState;
	syncRunning: boolean;
	rateLimitPerMinute: number;
	knownSecrets: readonly (string | null)[];
}

/**
 * Plain-text diagnostics for bug reports. Contains no API key, no secret
 * name, no note content and no conversation titles; only configuration and
 * counts. Everything passes through secret redaction as a final guard.
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
	const { settings, state } = input;
	const statusCounts: Record<string, number> = {};
	for (const [, record] of state.entries()) statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
	const last = state.lastRun;
	const safeSettings: Record<string, unknown> = { ...settings };
	delete safeSettings.apiKeySecretId;
	// Error messages can contain note paths (built from conversation titles), so only kinds are reported.
	const errorKinds: Record<string, number> = {};
	for (const error of last?.errors ?? []) errorKinds[error.kind] = (errorKinds[error.kind] ?? 0) + 1;

	const lines = [
		'Fieldy Sync diagnostics',
		`Plugin version: ${input.pluginVersion}`,
		`Obsidian API version: ${input.obsidianVersion}`,
		`Platform: ${input.platform}`,
		`API key configured: ${input.apiKeyConfigured ? 'yes' : 'no'}`,
		`Sync running: ${input.syncRunning ? 'yes' : 'no'}`,
		`Rate budget: ${input.rateLimitPerMinute} requests/minute`,
		`Sync index entries: ${state.size} ${JSON.stringify(statusCounts)}`,
		'',
		'Last run:',
		last
			? [
					`  trigger: ${last.trigger}`,
					`  started: ${last.startedAt}`,
					`  finished: ${last.finishedAt}`,
					`  cancelled: ${last.cancelled}`,
					`  fatal: ${last.fatalKind ?? 'none'}`,
					`  counts: ${JSON.stringify(last.counts)}`,
					`  error kinds: ${Object.keys(errorKinds).length > 0 ? JSON.stringify(errorKinds) : 'none'}`,
				].join('\n')
			: '  none',
		'',
		'Settings:',
		JSON.stringify(safeSettings, null, 2),
	];
	return redactSecrets(lines.join('\n'), input.knownSecrets);
}
