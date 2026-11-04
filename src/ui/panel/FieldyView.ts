import { debounce, ItemView, moment, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import { connectionLabel } from '../../connection';
import type FieldySyncPlugin from '../../main';
import { EditedNotesModal } from '../EditedNotesModal';
import { ImportModal } from '../ImportModal';
import { AccountTab } from './AccountTab';
import { ConversationsTab, iconButton } from './ConversationsTab';
import { PanelData } from './PanelData';
import { TasksTab } from './TasksTab';

export const FIELDY_VIEW_TYPE = 'fieldy-sync-panel';

type TabKey = 'conversations' | 'tasks' | 'account';

const REQUEST_COUNT_REFRESH_MS = 2_000;

const TABS: { key: TabKey; label: string; icon: string }[] = [
	{ key: 'conversations', label: 'Conversations', icon: 'messages-square' },
	{ key: 'tasks', label: 'Tasks', icon: 'list-checks' },
	{ key: 'account', label: 'Account', icon: 'user-round' },
];

/**
 * Side panel to browse Fieldy and take exactly what you need, without
 * running a sync: connection status, conversations, tasks and account
 * information. It only reads from Fieldy, except for task changes the user
 * makes in the Tasks tab.
 */
export class FieldyView extends ItemView {
	readonly data: PanelData;
	private tab: TabKey = 'conversations';
	private statusEl!: HTMLElement;
	private syncEl!: HTMLElement;
	private requestsEl!: HTMLElement;
	private readonly tabButtons = new Map<TabKey, HTMLElement>();
	private readonly tabBodies = new Map<TabKey, HTMLElement>();
	private conversations!: ConversationsTab;
	private tasks!: TasksTab;
	private account!: AccountTab;

	constructor(
		leaf: WorkspaceLeaf,
		readonly plugin: FieldySyncPlugin,
	) {
		super(leaf);
		this.data = new PanelData(plugin);
	}

	override getViewType(): string {
		return FIELDY_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return 'Fieldy';
	}

	override getIcon(): string {
		return 'messages-square';
	}

	private flashEl: HTMLElement | null = null;
	private flashTimer: number | null = null;

	/**
	 * A short message at the bottom of the panel, instead of an Obsidian notice
	 * (those appear at the top right, over the panel's own header). Replaces
	 * the previous one; click to dismiss. `ms` 0 keeps it until hidden.
	 */
	readonly flash = (text: string, kind: 'info' | 'error' = 'info', ms?: number): { hide: () => void; setText: (text: string) => void } => {
		this.flashEl?.remove();
		if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
		const el = this.contentEl.createDiv({ cls: `fieldy-flash is-${kind}`, text, attr: { role: kind === 'error' ? 'alert' : 'status' } });
		this.flashEl = el;
		const hide = () => {
			if (this.flashEl === el) this.flashEl = null;
			el.addClass('is-leaving');
			window.setTimeout(() => el.remove(), 200);
		};
		el.addEventListener('click', hide);
		const duration = ms ?? (kind === 'error' ? 8000 : 3500);
		this.flashTimer = duration > 0 ? window.setTimeout(hide, duration) : null;
		return { hide, setText: (next) => el.setText(next) };
	};

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('fieldy-panel');

		const header = root.createDiv({ cls: 'fieldy-panel-header' });
		this.statusEl = header.createDiv({ cls: 'fieldy-panel-status' });
		this.syncEl = header.createDiv({ cls: 'fieldy-panel-sync' });

		const tabs = root.createDiv({ cls: 'fieldy-panel-tabs', attr: { role: 'tablist' } });
		for (const { key, label, icon } of TABS) {
			const button = tabs.createEl('button', { cls: 'fieldy-panel-tab', attr: { role: 'tab', 'aria-label': label } });
			setIcon(button.createSpan(), icon);
			button.createSpan({ text: label });
			button.addEventListener('click', () => this.selectTab(key));
			this.tabButtons.set(key, button);
			this.tabBodies.set(key, root.createDiv({ cls: 'fieldy-panel-body', attr: { role: 'tabpanel' } }));
		}

		this.conversations = new ConversationsTab(this.tabBodies.get('conversations')!, this);
		this.tasks = new TasksTab(this.tabBodies.get('tasks')!, this);
		this.account = new AccountTab(this.tabBodies.get('account')!, this);
		this.conversations.render();
		this.tasks.render();
		this.account.render();

		this.renderStatus();
		this.renderSyncLine();
		this.selectTab(this.tab);
		this.registerInterval(window.setInterval(() => this.renderRequestCount(), REQUEST_COUNT_REFRESH_MS));

		// Keep everything current while the panel is open; all listeners are released on close.
		const events = this.plugin.events;
		this.registerEvent(events.on('connection-changed', () => this.onConnectionChanged()));
		this.registerEvent(events.on('sync-started', () => this.renderSyncLine()));
		this.registerEvent(
			events.on('sync-finished', () => {
				this.renderSyncLine();
				void this.conversations.refreshLocal();
				if (this.tab === 'account') this.account.render();
			}),
		);
		// Before a setting changes (a privacy filter or exception, for example), the filtered list keeps its cards until the filters apply again.
		this.registerEvent(events.on('settings-changing', () => this.conversations.holdListing()));
		this.registerEvent(
			events.on(
				'settings-changed',
				debounce(
					() => {
						// Each part on its own: one failing must not leave the others showing stale (possibly private) content.
						for (const update of [() => this.renderSyncLine(), () => this.conversations.onSettingsChanged(), () => this.tasks.onSettingsChanged()]) {
							try {
								update();
							} catch (err) {
								console.error('Fieldy Sync: could not refresh the panel', err);
							}
						}
					},
					300,
					true,
				),
			),
		);
		const refreshNotes = debounce(() => void this.conversations.refreshLocal(), 1500, true);
		this.registerEvent(this.app.vault.on('create', refreshNotes));
		this.registerEvent(this.app.vault.on('delete', refreshNotes));
		this.registerEvent(this.app.vault.on('rename', refreshNotes));

		if (this.plugin.connection.status === 'unknown' && this.plugin.hasApiKey()) void this.plugin.testConnection();
	}

	override async onClose(): Promise<void> {
		// Cancel anything still loading; nothing else outlives the panel.
		this.data.dispose();
		this.conversations.disconnect();
	}

	private selectTab(key: TabKey): void {
		this.tab = key;
		for (const [tabKey, button] of this.tabButtons) {
			const active = tabKey === key;
			button.toggleClass('is-active', active);
			button.setAttribute('aria-selected', String(active));
			this.tabBodies.get(tabKey)?.toggle(active);
		}
		if (key === 'conversations') this.conversations.onShow();
		if (key === 'tasks') this.tasks.onShow();
		if (key === 'account') {
			this.account.render();
			this.account.onShow();
		}
	}

	/** Opens the Conversations tab on one conversation (from a task, for example). */
	async showConversation(id: string): Promise<void> {
		this.selectTab('conversations');
		await this.conversations.show(id);
	}

	private onConnectionChanged(): void {
		const wasUsable = this.statusEl.hasClass('is-connected');
		this.renderStatus();
		if (this.tab === 'account') this.account.render();
		// The key was just added or fixed: load what could not be loaded before.
		if (!wasUsable && this.plugin.connection.status === 'connected') {
			this.conversations.onShow();
			if (this.tab === 'tasks') this.tasks.onShow();
		}
	}

	private renderStatus(): void {
		const state = this.plugin.connection;
		this.statusEl.empty();
		this.statusEl.className = `fieldy-panel-status is-${state.status}`;
		const dot = this.statusEl.createSpan({ cls: 'fieldy-dot' });
		setTooltip(dot, state.status === 'connected' ? 'Connected' : state.status === 'checking' ? 'Checking' : 'Not connected');
		this.statusEl.createSpan({ cls: 'fieldy-panel-status-text', text: connectionLabel(state) });
		this.requestsEl = this.statusEl.createSpan({ cls: 'fieldy-panel-requests' });
		this.renderRequestCount();
		iconButton(this.statusEl, 'refresh-ccw', 'Check the connection now', () => void this.plugin.testConnection());
	}

	/** Requests in the last minute against the configured limit. */
	private renderRequestCount(): void {
		if (!this.requestsEl) return;
		const count = this.plugin.requestsLastMinute;
		const limit = this.plugin.rateLimitPerMinute;
		this.requestsEl.setText(`${count}/${limit} req/min`);
		this.requestsEl.toggleClass('is-busy', count >= limit);
		setTooltip(this.requestsEl, `${count} request${count === 1 ? '' : 's'} to Fieldy in the last minute (limit ${limit}, set in the plugin settings)`);
	}

	private renderSyncLine(): void {
		this.syncEl.empty();
		const text = this.syncEl.createSpan({ cls: 'fieldy-panel-sync-text' });
		if (this.plugin.engine.isRunning) {
			text.setText('Syncing… (progress in the status bar)');
		} else {
			const last = this.plugin.syncState.lastRun;
			if (!last) text.setText('Not synced yet');
			else {
				const c = last.counts;
				const parts = [`Last sync ${moment(last.finishedAt).fromNow()}`];
				if (last.fatal) parts.push('failed');
				else {
					if (c.created) parts.push(`${c.created} new`);
					if (c.updated) parts.push(`${c.updated} updated`);
					if (c.failed) parts.push(`${c.failed} failed`);
				}
				text.setText(parts.join(' · '));
				setTooltip(text, `${moment(last.finishedAt).format('YYYY-MM-DD HH:mm')}`);
			}
		}
		const buttons = this.syncEl.createDiv({ cls: 'fieldy-panel-sync-buttons' });
		const edited = this.plugin.syncState.edited().length;
		if (edited > 0) {
			// Informational, not a warning: edited notes are the user's choice.
			iconButton(buttons, 'pencil', `${edited} edited note${edited === 1 ? '' : 's'}, kept as you wrote ${edited === 1 ? 'it' : 'them'}`, () =>
				new EditedNotesModal(this.app, this.plugin).open(),
			);
		}
		iconButton(buttons, 'refresh-cw', 'Sync now (new and changed conversations in your sync window)', () => void this.plugin.runSync('manual'));
		iconButton(buttons, 'download', 'Import conversations…', () => new ImportModal(this.app, this.plugin).open());
	}
}
