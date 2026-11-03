import { Modal, moment, Setting, type App } from 'obsidian';
import type { FieldyConversation } from '../api/types';
import { displayTitle } from '../markdown/ConversationRenderer';
import { describeMatches } from '../privacy/privacy';
import { HISTORY_START_ISO } from '../utils/dates';
import { describeError, isCancellation } from '../utils/errors';
import { sanitizeFolderPath } from '../utils/paths';
import type FieldySyncPlugin from '../main';

type RangePreset = '3' | '7' | '14' | '30' | '90' | '365' | 'all' | 'custom';
type LocalStatus = 'new' | 'imported' | 'deleted' | 'edited' | 'paused' | 'locked' | 'private';

interface Row {
	conversation: FieldyConversation;
	status: LocalStatus;
	/** Which privacy filters match (status `private`). */
	privateReason?: string;
}

/** Rows that can never be imported. */
function blocked(row: Row): boolean {
	return row.status === 'locked' || row.status === 'private';
}

const STATUS_LABEL: Record<LocalStatus, string> = {
	new: 'New',
	imported: 'Imported',
	deleted: 'Deleted from vault',
	edited: 'Edited by you',
	paused: 'Paused',
	locked: 'Locked by plan',
	private: 'Private',
};

const PAGE = 200;

/**
 * Lets the user pick a date range, review the matching conversations with
 * their local status, filter and select them, and import them into a chosen
 * folder. Loading is cancelled when the dialog closes; the import itself
 * runs in the background with progress in the status bar.
 */
export class ImportModal extends Modal {
	private preset: RangePreset = '30';
	private from = '';
	private to = '';
	private folder: string;
	private onlyNew = true;
	private filter = '';
	private rows: Row[] = [];
	private readonly selected = new Set<string>();
	private shown = PAGE;
	private loader: AbortController | null = null;

	private customEls: HTMLElement[] = [];
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private toolbarEl!: HTMLElement;
	private importButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly plugin: FieldySyncPlugin,
	) {
		super(app);
		this.folder = plugin.settings.folder;
		this.applyPreset();
	}

	override onOpen(): void {
		this.setTitle('Import Fieldy conversations');
		this.modalEl.addClass('fieldy-import-modal');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Date range')
			.setDesc('Conversations that started in this range.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'3': 'Last 3 days',
						'7': 'Last 7 days',
						'14': 'Last 14 days',
						'30': 'Last 30 days',
						'90': 'Last 90 days',
						'365': 'Last 12 months',
						all: 'Entire history',
						custom: 'Custom range',
					})
					.setValue(this.preset)
					.onChange((value) => {
						this.preset = value as RangePreset;
						this.applyPreset();
						this.toggleCustom();
					}),
			);

		const fromSetting = new Setting(contentEl).setName('From').addText((text) => {
			text.inputEl.type = 'date';
			text.setValue(this.from).onChange((value) => (this.from = value));
		});
		const toSetting = new Setting(contentEl).setName('To').addText((text) => {
			text.inputEl.type = 'date';
			text.setValue(this.to).onChange((value) => (this.to = value));
		});
		this.customEls = [fromSetting.settingEl, toSetting.settingEl];
		this.toggleCustom();

		new Setting(contentEl)
			.setName('Destination folder')
			.setDesc('New notes are created here. Existing notes stay where they are.')
			.addText((text) => text.setPlaceholder('Fieldy').setValue(this.folder).onChange((value) => (this.folder = value)));

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Find conversations')
				.setCta()
				.onClick(() => void this.load()),
		);

		this.statusEl = contentEl.createDiv({ cls: 'fieldy-import-status' });
		this.toolbarEl = contentEl.createDiv({ cls: 'fieldy-import-toolbar fieldy-hidden' });
		this.buildToolbar();
		this.listEl = contentEl.createDiv({ cls: 'fieldy-import-list' });

		const footer = new Setting(contentEl).setClass('fieldy-import-footer');
		footer.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
		footer.addButton((button) => {
			button
				.setButtonText('Import selected')
				.setCta()
				.setDisabled(true)
				.onClick(() => this.startImport());
			this.importButton = button.buttonEl;
		});
	}

	override onClose(): void {
		this.loader?.abort();
		this.loader = null;
		this.contentEl.empty();
	}

	private applyPreset(): void {
		if (this.preset === 'custom') return;
		const end = moment();
		this.to = end.format('YYYY-MM-DD');
		this.from = this.preset === 'all' ? moment(HISTORY_START_ISO).format('YYYY-MM-DD') : end.clone().subtract(Number(this.preset), 'days').format('YYYY-MM-DD');
	}

	private toggleCustom(): void {
		for (const el of this.customEls) el.toggleClass('fieldy-hidden', this.preset !== 'custom');
	}

	private range(): { startTime: string; endTime: string } | null {
		const start = moment(this.from, 'YYYY-MM-DD', true);
		const end = moment(this.to, 'YYYY-MM-DD', true);
		if (!start.isValid() || !end.isValid() || start.isAfter(end)) return null;
		return { startTime: start.startOf('day').toISOString(), endTime: end.endOf('day').toISOString() };
	}

	private buildToolbar(): void {
		const bar = this.toolbarEl;
		const search = bar.createEl('input', { type: 'search', placeholder: 'Filter by title…', cls: 'fieldy-import-filter' });
		search.addEventListener('input', () => {
			this.filter = search.value.trim().toLowerCase();
			this.shown = PAGE;
			this.renderList();
		});
		const onlyNewLabel = bar.createEl('label', { cls: 'fieldy-import-only-new' });
		const onlyNew = onlyNewLabel.createEl('input', { type: 'checkbox' });
		onlyNew.checked = this.onlyNew;
		onlyNewLabel.appendText(' Only show new');
		onlyNew.addEventListener('change', () => {
			this.onlyNew = onlyNew.checked;
			this.shown = PAGE;
			this.renderList();
		});
		bar.createEl('button', { text: 'Select all shown' }).addEventListener('click', () => {
			for (const row of this.visibleRows()) if (!blocked(row)) this.selected.add(row.conversation.id);
			this.renderList();
		});
		bar.createEl('button', { text: 'Select none' }).addEventListener('click', () => {
			this.selected.clear();
			this.renderList();
		});
	}

	private async load(): Promise<void> {
		const range = this.range();
		if (!range) {
			this.statusEl.setText('Choose a valid date range (the start must not be after the end).');
			return;
		}
		if (!this.plugin.hasApiKey()) {
			this.statusEl.setText('Add your Fieldy API key in the plugin settings first.');
			return;
		}
		this.loader?.abort();
		const loader = new AbortController();
		this.loader = loader;
		this.rows = [];
		this.selected.clear();
		this.renderList();
		this.statusEl.setText('Loading conversations from Fieldy…');
		try {
			const { items } = await this.plugin.client.listConversations(
				{ ...range, recordingSource: this.plugin.settings.recordingSource === 'all' ? undefined : this.plugin.settings.recordingSource },
				{ signal: loader.signal, onPage: (n) => this.statusEl.setText(`Loading conversations from Fieldy… ${n} so far`) },
			);
			if (loader.signal.aborted) return;
			const local = await this.plugin.localStatuses(items.map((c) => c.id));
			// Template filters need the template names; transcript filters are checked when importing.
			await this.plugin.privacy.prepare(loader.signal);
			this.rows = items
				.map((conversation): Row => {
					const privacy = this.plugin.privacy.check(conversation);
					if (privacy.state === 'private') return { conversation, status: 'private', privateReason: describeMatches(privacy.matches) };
					return { conversation, status: conversation.locked ? 'locked' : (local.get(conversation.id) ?? 'new') };
				})
				.sort((a, b) => Date.parse(b.conversation.startTime) - Date.parse(a.conversation.startTime));
			for (const row of this.rows) if (row.status === 'new') this.selected.add(row.conversation.id);
			this.toolbarEl.removeClass('fieldy-hidden');
			this.shown = PAGE;
			this.renderList();
		} catch (err) {
			if (isCancellation(err)) return;
			this.statusEl.setText(describeError(err));
		} finally {
			if (this.loader === loader) this.loader = null;
		}
	}

	private visibleRows(): Row[] {
		return this.rows.filter(
			(row) =>
				(!this.onlyNew || row.status === 'new' || row.status === 'deleted') &&
				(this.filter === '' || (row.status !== 'private' && displayTitle(row.conversation).toLowerCase().includes(this.filter))),
		);
	}

	private renderList(): void {
		this.listEl.empty();
		const counts = new Map<LocalStatus, number>();
		for (const row of this.rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
		if (this.rows.length > 0) {
			const parts = [...counts].map(([status, n]) => `${n} ${STATUS_LABEL[status].toLowerCase()}`);
			this.statusEl.setText(`${this.rows.length} conversations: ${parts.join(', ')}. ${this.selected.size} selected.`);
		}
		const visible = this.visibleRows();
		if (this.rows.length > 0 && visible.length === 0) {
			this.listEl.createDiv({ cls: 'fieldy-import-empty', text: 'No conversations match the current filter.' });
		}
		for (const row of visible.slice(0, this.shown)) this.renderRow(row);
		if (visible.length > this.shown) {
			const more = this.listEl.createEl('button', { cls: 'fieldy-import-more', text: `Show more (${visible.length - this.shown} remaining)` });
			more.addEventListener('click', () => {
				this.shown += PAGE;
				this.renderList();
			});
		}
		if (this.importButton) {
			this.importButton.disabled = this.selected.size === 0;
			this.importButton.setText(this.selected.size > 0 ? `Import ${this.selected.size} selected` : 'Import selected');
		}
	}

	private renderRow(row: Row): void {
		const id = row.conversation.id;
		const el = this.listEl.createEl('label', { cls: 'fieldy-import-row' });
		const checkbox = el.createEl('input', { type: 'checkbox' });
		checkbox.checked = this.selected.has(id);
		checkbox.disabled = blocked(row);
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selected.add(id);
			else this.selected.delete(id);
			this.renderList();
		});
		el.createSpan({ cls: 'fieldy-import-date', text: moment(row.conversation.startTime).format('YYYY-MM-DD HH:mm') });
		el.createSpan({
			cls: 'fieldy-import-title',
			text:
				row.status === 'private'
					? `${this.plugin.settings.showPrivateTitles ? displayTitle(row.conversation) : 'Private conversation'} (filter: ${row.privateReason ?? ''})`
					: displayTitle(row.conversation),
		});
		el.createSpan({ cls: `fieldy-badge fieldy-badge-${row.status}`, text: STATUS_LABEL[row.status] });
	}

	private startImport(): void {
		const conversations = this.rows.filter((r) => this.selected.has(r.conversation.id) && !blocked(r)).map((r) => r.conversation);
		if (conversations.length === 0) return;
		if (this.plugin.engine.isRunning) {
			this.plugin.notify('A Fieldy sync is already running. Try again when it finishes.');
			return;
		}
		const folder = sanitizeFolderPath(this.folder) || this.plugin.settings.folder;
		this.close();
		this.plugin.notify(`Importing ${conversations.length} Fieldy conversation${conversations.length === 1 ? '' : 's'}… Progress is shown in the status bar.`);
		void this.plugin.runSync('import', {
			conversations,
			onlyIds: new Set(conversations.map((c) => c.id)),
			createNew: true,
			recreateDeleted: true,
			folder,
		});
	}
}
