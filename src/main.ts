import { apiVersion, Events, moment, Notice, Platform, Plugin, TFile } from 'obsidian';
import { FieldyClient } from './api/FieldyClient';
import { obsidianTransport } from './api/obsidianTransport';
import { RateLimiter } from './api/rateLimiter';
import { EMPTY_PEOPLE_INDEX, type PeopleIndex } from './markdown/speakerLinks';
import { DEFAULT_RETRY_POLICY } from './api/retry';
import type { FieldyConversation } from './api/types';
import { connectionLabel, nextConnectionState, type ConnectionState } from './connection';
import { buildDiagnostics } from './diagnostics';
import { ID_KEY } from './markdown/ConversationRenderer';
import { ISSUES_URL, sanitizeSettings, type FieldySyncSettings } from './settings/settings';
import { FieldySettingsTab } from './settings/SettingsTab';
import { ObsidianNoteStore } from './sync/ObsidianNoteStore';
import type { NoteRef } from './sync/NoteStore';
import { isSyncPaused, SyncAlreadyRunningError, SyncEngine, type RestoreChoice, type SyncRequest, type SyncTrigger } from './sync/SyncEngine';
import { mergeSyncState, sanitizeSyncState, SyncState, type SyncRunSummary, type SyncStateData } from './sync/SyncState';
import { EditedNotesModal } from './ui/EditedNotesModal';
import { ExportModal } from './ui/ExportModal';
import { ImportModal } from './ui/ImportModal';
import { registerFieldyBlock } from './ui/fieldyBlock';
import { registerNoteBanner } from './ui/noteBanner';
import { QueryPresetModal } from './ui/QueryPresetModal';
import { FIELDY_VIEW_TYPE, FieldyView } from './ui/panel/FieldyView';
import { StatusBar } from './ui/StatusBar';
import { formatSyncSummary, shouldNotify } from './ui/summary';
import { systemClock } from './utils/async';
import { describeError, FieldyError, toFieldyError } from './utils/errors';
import { createLogger, type Logger } from './utils/logger';
import { redactSecrets } from './utils/redact';

interface PluginData {
	settings: FieldySyncSettings;
	state: SyncStateData;
}

export type LocalStatus = 'imported' | 'deleted' | 'edited' | 'paused';

/**
 * Events on `plugin.events`:
 * - `connection-changed` (state: ConnectionState)
 * - `sync-started`
 * - `sync-finished` (summary: SyncRunSummary | null)
 * - `settings-changed`
 */
export type FieldyEvent = 'connection-changed' | 'sync-started' | 'sync-finished' | 'settings-changed';

const STARTUP_DELAY_MS = 10_000;
const PERSIST_DELAY_MS = 500;
const AUTOMATIC: ReadonlySet<SyncTrigger> = new Set(['startup', 'interval']);

export default class FieldySyncPlugin extends Plugin {
	override settings!: FieldySyncSettings;
	syncState!: SyncState;
	client!: FieldyClient;
	engine!: SyncEngine;
	readonly events = new Events();
	connection: ConnectionState = { status: 'unknown' };

	private limiter!: RateLimiter;
	private store!: ObsidianNoteStore;
	private logger!: Logger;
	private statusBar: StatusBar | null = null;
	private intervalId: number | null = null;
	private scheduledMinutes = 0;
	private startupTimer: number | null = null;
	/** Sync index written by another device while a sync was running; merged afterwards. */
	private pendingExternalState: SyncStateData | null = null;
	private saving: Promise<void> = Promise.resolve();
	private saveQueued: Promise<void> | null = null;
	private persistTimer: number | null = null;

	override async onload(): Promise<void> {
		await this.loadPluginData();
		this.logger = createLogger(() => this.settings.debugLogging);
		this.limiter = new RateLimiter(this.settings.requestsPerMinute, systemClock);
		this.client = new FieldyClient({
			getApiKey: () => this.getApiKey(),
			transport: obsidianTransport,
			limiter: this.limiter,
			timeoutMs: () => this.settings.requestTimeoutSeconds * 1000,
			retryPolicy: () => ({ ...DEFAULT_RETRY_POLICY, maxRetries: this.settings.maxRetries }),
			logger: this.logger,
		});
		this.store = new ObsidianNoteStore(this.app);
		this.engine = new SyncEngine({
			client: this.client,
			store: this.store,
			state: this.syncState,
			settings: () => this.settings,
			formatDate: (iso, format) => moment(iso).format(format),
			logger: this.logger,
		});
		if (!this.hasApiKey()) this.connection = { status: 'not-configured' };

		const statusEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusEl);
		this.statusBar.setVisible(this.settings.showStatusBar);
		this.statusBar.finish(this.syncState.lastRun);
		this.engine.onProgress = (progress) => this.statusBar?.progress(progress);
		this.registerDomEvent(statusEl, 'click', () => {
			if (!this.engine.isRunning) void this.runSync('manual');
		});

		this.registerView(FIELDY_VIEW_TYPE, (leaf) => new FieldyView(leaf, this));
		this.addRibbonIcon('refresh-cw', 'Sync Fieldy conversations', () => void this.runSync('manual'));
		this.addRibbonIcon('messages-square', 'Open Fieldy panel', () => void this.openPanel());
		this.registerCommands();
		this.addSettingTab(new FieldySettingsTab(this.app, this));
		registerNoteBanner(this);
		registerFieldyBlock(this);

		// Keep the sync index pointing at notes the user renames or moves.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && this.syncState.renamePath(oldPath, file.path)) this.persistSoon();
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.showMobileNotice();
			this.scheduleAutoSync();
			if (this.settings.syncOnStartup) {
				this.startupTimer = window.setTimeout(() => {
					this.startupTimer = null;
					void this.runSync('startup');
				}, STARTUP_DELAY_MS);
			}
		});
	}

	override onunload(): void {
		this.engine?.cancel();
		if (this.startupTimer !== null) window.clearTimeout(this.startupTimer);
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		this.startupTimer = null;
		this.intervalId = null;
		// A settings change still waiting to be written.
		if (this.persistTimer !== null) void this.persist();
	}

	/** Once per vault on phones and tablets: mobile works but has not been tested yet. */
	private showMobileNotice(): void {
		if (!Platform.isMobile || this.settings.mobileNoticeShown) return;
		const message = createFragment((frag) => {
			frag.appendText('Fieldy Sync has not been tested on mobile yet. It should work, but if something looks wrong, please report it on ');
			frag.createEl('a', { text: 'GitHub', href: ISSUES_URL });
			frag.appendText(' (Fieldy Sync: Copy diagnostics helps).');
		});
		new Notice(message, 15_000);
		void this.updateSetting('mobileNoticeShown', true);
	}

	// ---------------------------------------------------------------- data

	private async loadPluginData(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<PluginData>;
		this.settings = sanitizeSettings(raw.settings);
		const state = sanitizeSyncState(raw.state);
		if (this.syncState) this.syncState.replace(state);
		else this.syncState = new SyncState(state, () => this.persist());
	}

	/**
	 * Writes settings and the sync index to data.json. Writes never overlap:
	 * one asked for while another runs waits for it, and several waiting
	 * ones become a single write of the latest data.
	 */
	persist(): Promise<void> {
		this.cancelPersistSoon();
		this.saveQueued ??= this.saving.then(async () => {
			this.saveQueued = null;
			await this.saveData({ settings: this.settings, state: this.syncState.toJSON() } satisfies PluginData);
		});
		this.saving = this.saveQueued.catch(() => undefined);
		return this.saveQueued;
	}

	/** Writes after a short pause, so typing in a settings field or renaming many notes is one write, not one per change. */
	private persistSoon(): void {
		this.cancelPersistSoon();
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			this.persist().catch((err: unknown) => this.logger.error('Could not save the Fieldy Sync data', err));
		}, PERSIST_DELAY_MS);
	}

	private cancelPersistSoon(): void {
		if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
		this.persistTimer = null;
	}

	override async onExternalSettingsChange(): Promise<void> {
		// data.json changed on disk (e.g. Obsidian Sync from another device).
		const raw = ((await this.loadData()) ?? {}) as Partial<PluginData>;
		// A running sync works on its own settings snapshot, so settings apply right away.
		this.settings = sanitizeSettings(raw.settings);
		const external = sanitizeSyncState(raw.state);
		if (this.engine?.isRunning) {
			// The run owns the index until it finishes; merge then instead of losing either side.
			this.pendingExternalState = external;
		} else {
			// Merge without saving: the file already holds the other device's view, and
			// writing it back immediately would bounce between devices.
			this.syncState.replace(mergeSyncState(this.syncState.toJSON(), external));
		}
		this.applyRuntimeSettings();
		this.statusBar?.finish(this.syncState.lastRun);
		this.events.trigger('settings-changed');
	}

	/** Merges a sync index that arrived during a run, then saves the combined index. */
	private async mergePendingExternalState(): Promise<void> {
		const external = this.pendingExternalState;
		if (!external) return;
		this.pendingExternalState = null;
		this.syncState.replace(mergeSyncState(this.syncState.toJSON(), external));
		try {
			await this.persist();
		} catch (err) {
			this.logger.error('Could not save the merged sync index', err);
		}
	}

	async updateSetting(key: keyof FieldySyncSettings, value: unknown): Promise<void> {
		const before = this.settings.apiKeySecretId;
		this.settings = sanitizeSettings({ ...this.settings, [key]: value });
		this.persistSoon();
		this.applyRuntimeSettings();
		if (key === 'apiKeySecretId' && this.settings.apiKeySecretId !== before) {
			// A different secret means the previous connection result no longer applies.
			this.setConnection(this.hasApiKey() ? { status: 'unknown' } : { status: 'not-configured' });
		}
		this.events.trigger('settings-changed');
	}

	private applyRuntimeSettings(): void {
		this.limiter.setLimit(this.settings.requestsPerMinute);
		this.statusBar?.setVisible(this.settings.showStatusBar);
		this.scheduleAutoSync();
	}

	async resetSyncState(): Promise<void> {
		if (this.engine.isRunning) throw new SyncAlreadyRunningError();
		this.syncState.clear();
		await this.persist();
		this.statusBar?.finish(null);
		this.events.trigger('sync-finished', null);
	}

	// ----------------------------------------------------------- connection

	/** Reads the API key from Obsidian's secret storage. Never stored or cached by the plugin. */
	private getApiKey(): string | null {
		const id = this.settings.apiKeySecretId;
		if (!id) return null;
		try {
			const key = this.app.secretStorage.getSecret(id);
			return key && key.trim() !== '' ? key.trim() : null;
		} catch {
			return null;
		}
	}

	hasApiKey(): boolean {
		return this.getApiKey() !== null;
	}

	private setConnection(state: ConnectionState): void {
		this.connection = state;
		this.events.trigger('connection-changed', state);
	}

	/** Lets any request (sync, panel, commands) keep the connection status current. */
	reportRequestOutcome(error?: unknown): void {
		const now = new Date().toISOString();
		if (error === undefined) {
			this.setConnection(nextConnectionState(this.connection, { ok: true }, now));
			return;
		}
		const fieldyError = toFieldyError(error);
		if (fieldyError.kind === 'cancelled') return;
		const next = nextConnectionState(this.connection, { ok: false, kind: fieldyError.kind, message: fieldyError.userMessage }, now);
		if (next !== this.connection) this.setConnection(next);
	}

	/** Checks the key with one inexpensive request and updates the connection status. */
	async testConnection(): Promise<ConnectionState> {
		if (!this.hasApiKey()) {
			this.setConnection({ status: 'not-configured', message: new FieldyError('missing-api-key', 'No API key').userMessage });
			return this.connection;
		}
		this.setConnection({ ...this.connection, status: 'checking' });
		try {
			const user = await this.client.getCurrentUser({ retries: 0 });
			this.setConnection(nextConnectionState(this.connection, { ok: true, email: user.email }, new Date().toISOString()));
		} catch (err) {
			const error = toFieldyError(err);
			this.setConnection({ status: error.kind === 'missing-api-key' ? 'not-configured' : 'error', message: error.userMessage, checkedAt: new Date().toISOString() });
		}
		return this.connection;
	}

	// ------------------------------------------------------------- actions

	/** (Re)starts the periodic sync only when the interval actually changed. */
	private scheduleAutoSync(): void {
		const minutes = this.settings.autoSyncMinutes;
		const alreadyScheduled = minutes === this.scheduledMinutes && (minutes === 0 || this.intervalId !== null);
		if (alreadyScheduled) return;
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		this.intervalId = null;
		this.scheduledMinutes = minutes;
		if (minutes > 0) {
			this.intervalId = window.setInterval(() => void this.runSync('interval'), minutes * 60_000);
			this.registerInterval(this.intervalId);
		}
	}

	/** Runs a sync unless one is already running. Never throws. */
	async runSync(trigger: SyncTrigger, request: Omit<SyncRequest, 'trigger'> = {}): Promise<SyncRunSummary | null> {
		const automatic = AUTOMATIC.has(trigger);
		if (!this.hasApiKey()) {
			if (!automatic) new Notice(new FieldyError('missing-api-key', 'No API key').userMessage);
			this.setConnection({ status: 'not-configured' });
			return null;
		}
		if (this.engine.isRunning) {
			if (!automatic) new Notice('A Fieldy sync is already running.');
			return null;
		}
		this.statusBar?.start();
		this.events.trigger('sync-started');
		let summary: SyncRunSummary | null = null;
		try {
			summary = await this.engine.run({ trigger, ...request });
			if (summary.fatalKind) {
				this.reportRequestOutcome(new FieldyError(summary.fatalKind as FieldyError['kind'], summary.fatal ?? '', {}));
			} else if (!summary.cancelled) {
				this.reportRequestOutcome();
			}
			if (shouldNotify(summary, automatic, this.settings.notices)) {
				new Notice(formatSyncSummary(summary), summary.fatal || summary.counts.failed > 0 ? 12_000 : 6_000);
			}
		} catch (err) {
			if (!(err instanceof SyncAlreadyRunningError) || !automatic) new Notice(describeError(err));
		} finally {
			await this.mergePendingExternalState();
			this.statusBar?.finish(summary ?? this.syncState.lastRun);
			this.events.trigger('sync-finished', summary);
		}
		return summary;
	}

	/** Puts the Fieldy version back into an edited note (the user chose how). */
	async restoreFieldyVersion(id: string, choice: RestoreChoice): Promise<void> {
		try {
			await this.engine.restoreFieldyVersion(id, choice);
			await this.persist();
		} finally {
			await this.mergePendingExternalState();
			this.statusBar?.finish(this.syncState.lastRun);
			this.events.trigger('sync-finished', null);
		}
	}

	/** Imports one conversation as a managed note (same rules as sync: no duplicates, edits protected). */
	async importConversation(conversation: FieldyConversation): Promise<SyncRunSummary | null> {
		return this.runSync('import', {
			conversations: [conversation],
			onlyIds: new Set([conversation.id]),
			createNew: true,
			recreateDeleted: true,
		});
	}

	/** Re-renders one note from Fieldy (user edits are still protected). */
	async refreshNote(id: string, conversation?: FieldyConversation): Promise<void> {
		if (!this.hasApiKey()) {
			new Notice(new FieldyError('missing-api-key', 'No API key').userMessage);
			return;
		}
		try {
			const fresh = conversation ?? (await this.client.getConversation(id));
			if (!fresh) {
				new Notice('This conversation no longer exists in Fieldy.');
				return;
			}
			await this.runSync('refresh', { conversations: [fresh], onlyIds: new Set([id]), force: true, createNew: false, recreateDeleted: false });
		} catch (err) {
			this.reportRequestOutcome(err);
			new Notice(describeError(err));
		}
	}

	/** Paths of notes linked to Fieldy conversations (first note per id). */
	async noteIndex(): Promise<Map<string, string>> {
		return this.pathsFrom(await new ObsidianNoteStore(this.app).indexByFieldyId());
	}

	/** Note paths and local states from a single scan of the vault (the panel needs both). */
	async localIndex(ids: readonly string[]): Promise<{ statuses: Map<string, LocalStatus>; paths: Map<string, string> }> {
		const index = await new ObsidianNoteStore(this.app).indexByFieldyId();
		return { statuses: this.statusesFrom(index, ids), paths: this.pathsFrom(index) };
	}

	private pathsFrom(index: Map<string, NoteRef[]>): Map<string, string> {
		const paths = new Map<string, string>();
		for (const [id, refs] of index) {
			const tracked = this.syncState.get(id)?.path;
			const ref = refs.find((r) => r.path === tracked) ?? refs[0];
			if (ref) paths.set(id, ref.path);
		}
		return paths;
	}

	/** Local state of conversations for the import dialog and the panel. */
	async localStatuses(ids: readonly string[]): Promise<Map<string, LocalStatus>> {
		return this.statusesFrom(await new ObsidianNoteStore(this.app).indexByFieldyId(), ids);
	}

	private statusesFrom(index: Map<string, NoteRef[]>, ids: readonly string[]): Map<string, LocalStatus> {
		const result = new Map<string, LocalStatus>();
		for (const id of ids) {
			const refs = index.get(id);
			const record = this.syncState.get(id);
			if (refs && refs.length > 0) {
				if (refs.some((r) => isSyncPaused(r.frontmatter))) result.set(id, 'paused');
				else result.set(id, record?.status === 'edited' ? 'edited' : 'imported');
			} else if (record) {
				result.set(id, 'deleted');
			}
		}
		return result;
	}

	async openNote(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice('That note no longer exists.');
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	async openPanel(): Promise<FieldyView | null> {
		const leaf = await this.app.workspace.ensureSideLeaf(FIELDY_VIEW_TYPE, 'right', { active: true, reveal: true });
		await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof FieldyView ? leaf.view : null;
	}

	/** Shows the original Fieldy content of a conversation in the side panel, without touching the note. */
	async showFieldyVersion(id: string): Promise<void> {
		const view = await this.openPanel();
		if (view) await view.showConversation(id);
	}

	private activeFieldyId(): { file: TFile; id: string } | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;
		const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[ID_KEY];
		return typeof id === 'string' && id.trim() !== '' ? { file, id: id.trim() } : null;
	}

	async copyShareLink(id: string): Promise<void> {
		const url = await this.shareLinkUrl(id);
		if (!url) return;
		await navigator.clipboard.writeText(url);
		new Notice('Fieldy share link copied to the clipboard.');
	}

	/** The conversation's first active share link; null (after a notice) when it has none or the lookup fails. */
	async shareLinkUrl(id: string): Promise<string | null> {
		try {
			const links = (await this.client.listSharables(id)).filter((s) => s.enabled);
			this.reportRequestOutcome();
			const first = links[0];
			if (!first) {
				new Notice('This conversation has no active share link. Create one in the Fieldy app first.');
				return null;
			}
			return first.url;
		} catch (err) {
			this.reportRequestOutcome(err);
			new Notice(describeError(err));
			return null;
		}
	}

	async copyDiagnostics(): Promise<void> {
		const platform = Platform.isMobile ? 'mobile' : 'desktop';
		const os = Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'other';
		const text = buildDiagnostics({
			pluginVersion: this.manifest.version,
			obsidianVersion: apiVersion,
			platform: `${platform} (${os})`,
			settings: this.settings,
			apiKeyConfigured: this.hasApiKey(),
			state: this.syncState,
			syncRunning: this.engine.isRunning,
			rateLimitPerMinute: this.limiter.limit,
			knownSecrets: [this.getApiKey()],
		});
		try {
			await navigator.clipboard.writeText(redactSecrets(text, [this.getApiKey()]));
			new Notice('Diagnostics copied to the clipboard.');
		} catch (err) {
			new Notice(describeError(err));
		}
	}

	get rateLimitPerMinute(): number {
		return this.limiter.limit;
	}

	/** People notes for speaker links (empty when the setting is off). */
	peopleIndex(): PeopleIndex {
		return this.settings.linkSpeakers ? this.store.peopleIndex(this.settings.peopleFolder) : EMPTY_PEOPLE_INDEX;
	}

	/** Requests sent to Fieldy in the last minute. */
	get requestsLastMinute(): number {
		return this.limiter.recentCount;
	}

	/** True while the request budget is used up, so background work should wait. */
	get rateLimiterBusy(): boolean {
		return this.limiter.waitTimeMs > 0;
	}

	private registerCommands(): void {
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.runSync('manual') });
		this.addCommand({ id: 'import-conversations', name: 'Import conversations', callback: () => new ImportModal(this.app, this).open() });
		this.addCommand({ id: 'export-conversations', name: 'Export conversations', callback: () => new ExportModal(this.app, this).open() });
		this.addCommand({ id: 'insert-query', name: 'Insert a Fieldy or Dataview query', callback: () => new QueryPresetModal(this.app).open() });
		this.addCommand({ id: 'open-panel', name: 'Open Fieldy panel', callback: () => void this.openPanel() });
		this.addCommand({
			id: 'test-connection',
			name: 'Test connection',
			callback: async () => {
				const state = await this.testConnection();
				new Notice(connectionLabel(state));
			},
		});
		this.addCommand({ id: 'review-edited-notes', name: 'Review edited notes', callback: () => new EditedNotesModal(this.app, this).open() });
		this.addCommand({
			id: 'show-fieldy-version',
			name: 'Show Fieldy version of current note',
			checkCallback: (checking) => {
				const active = this.activeFieldyId();
				if (!active) return false;
				if (!checking) void this.showFieldyVersion(active.id);
				return true;
			},
		});
		this.addCommand({
			id: 'cancel-sync',
			name: 'Cancel running sync',
			checkCallback: (checking) => {
				if (!this.engine.isRunning) return false;
				if (!checking) {
					this.engine.cancel();
					new Notice('Cancelling the Fieldy sync…');
				}
				return true;
			},
		});
		this.addCommand({
			id: 'refresh-current-note',
			name: 'Refresh current note from Fieldy',
			checkCallback: (checking) => {
				const active = this.activeFieldyId();
				if (!active) return false;
				if (!checking) void this.refreshNote(active.id);
				return true;
			},
		});
		this.addCommand({
			id: 'copy-share-link',
			name: 'Copy share link of current note',
			checkCallback: (checking) => {
				const active = this.activeFieldyId();
				if (!active) return false;
				if (!checking) void this.copyShareLink(active.id);
				return true;
			},
		});
		this.addCommand({ id: 'copy-diagnostics', name: 'Copy diagnostics', callback: () => void this.copyDiagnostics() });
	}
}
