import { ConfirmationModal, Menu, Modal, moment, Notice, setIcon, setTooltip, type App } from 'obsidian';
import type { RestoreChoice } from '../sync/SyncEngine';
import type { SyncRecord } from '../sync/SyncState';
import { describeError } from '../utils/errors';
import { parentFolder } from '../utils/paths';
import type FieldySyncPlugin from '../main';

type SortKey = 'newest' | 'oldest' | 'title' | 'folder';

const SORT_LABELS: Record<SortKey, string> = {
	newest: 'Newest conversation first',
	oldest: 'Oldest conversation first',
	title: 'Title (A–Z)',
	folder: 'Folder',
};

/** Rows shown at once; "Show more" adds the next batch. */
const PAGE_SIZE = 50;

function titleOf(record: SyncRecord): string {
	return record.title || record.path;
}

/**
 * Notes the user changed inside their Fieldy section. They are the user's
 * edited versions: sync leaves them exactly as written. The original remains
 * in Fieldy; from here it can be viewed, or brought back into the note.
 * Built for long lists: search, sort, compact rows, paging and bulk actions.
 */
export class EditedNotesModal extends Modal {
	private search = '';
	private sort: SortKey = 'newest';
	private shown = PAGE_SIZE;
	private readonly selected = new Set<string>();
	private busy = false;
	private listEl!: HTMLElement;
	private barEl!: HTMLElement;

	constructor(
		app: App,
		private readonly plugin: FieldySyncPlugin,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Edited notes');
		this.modalEl.addClass('fieldy-edited-modal');
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private entries(): [string, SyncRecord][] {
		const query = this.search.toLowerCase();
		const list = this.plugin.syncState
			.edited()
			.filter(([, r]) => !query || `${r.title} ${r.path} ${r.editedReason ?? ''}`.toLowerCase().includes(query));
		const byTitle = (a: SyncRecord, b: SyncRecord) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
		const compare: Record<SortKey, (a: SyncRecord, b: SyncRecord) => number> = {
			newest: (a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''),
			oldest: (a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''),
			title: byTitle,
			folder: (a, b) => parentFolder(a.path).localeCompare(parentFolder(b.path)) || byTitle(a, b),
		};
		return list.sort(([, a], [, b]) => compare[this.sort](a, b));
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const total = this.plugin.syncState.edited().length;
		if (total === 0) {
			contentEl.createEl('p', {
				text: 'No edited notes. When you change a note inside its Fieldy section, it becomes your edited version: sync leaves it as you wrote it, and it is listed here. The original always stays in Fieldy.',
			});
			return;
		}
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'You changed these notes inside their Fieldy section, so sync leaves them exactly as you wrote them. The original is still in Fieldy: view it in the side panel, or bring it back into the note.',
		});

		const toolbar = contentEl.createDiv({ cls: 'fieldy-edited-toolbar' });
		const search = toolbar.createEl('input', { type: 'search', placeholder: 'Search title, folder or reason…', cls: 'fieldy-edited-search' });
		search.value = this.search;
		search.addEventListener('input', () => {
			this.search = search.value.trim();
			this.shown = PAGE_SIZE;
			this.renderList();
		});
		const sort = toolbar.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Sort' } });
		for (const [key, label] of Object.entries(SORT_LABELS)) sort.createEl('option', { value: key, text: label });
		sort.value = this.sort;
		sort.addEventListener('change', () => {
			this.sort = sort.value as SortKey;
			this.renderList();
		});

		this.barEl = contentEl.createDiv({ cls: 'fieldy-edited-bar' });
		this.listEl = contentEl.createDiv({ cls: 'fieldy-edited-list' });
		this.renderList();
		search.focus();
	}

	private renderList(): void {
		const entries = this.entries();
		const ids = new Set(entries.map(([id]) => id));
		for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
		this.renderBar(entries);

		this.listEl.empty();
		if (entries.length === 0) {
			this.listEl.createDiv({ cls: 'fieldy-muted', text: 'No edited note matches your search.' });
			return;
		}
		for (const [id, record] of entries.slice(0, this.shown)) this.renderRow(id, record);
		if (entries.length > this.shown) {
			const more = this.listEl.createEl('button', { cls: 'fieldy-edited-more', text: `Show ${Math.min(PAGE_SIZE, entries.length - this.shown)} more (${entries.length - this.shown} not shown)` });
			more.addEventListener('click', () => {
				this.shown += PAGE_SIZE;
				this.renderList();
			});
		}
	}

	/** Count, "select all" and the actions for the selected notes. */
	private renderBar(entries: [string, SyncRecord][]): void {
		this.barEl.empty();
		const total = this.plugin.syncState.edited().length;
		const all = this.barEl.createEl('input', { type: 'checkbox', attr: { 'aria-label': 'Select all matching notes' } });
		all.checked = entries.length > 0 && entries.every(([id]) => this.selected.has(id));
		all.indeterminate = !all.checked && this.selected.size > 0;
		all.disabled = this.busy || entries.length === 0;
		all.addEventListener('change', () => {
			if (all.checked) for (const [id] of entries) this.selected.add(id);
			else this.selected.clear();
			this.renderList();
		});
		const count = entries.length === total ? `${total} edited note${total === 1 ? '' : 's'}` : `${entries.length} of ${total} match`;
		this.barEl.createSpan({ cls: 'fieldy-edited-count', text: this.selected.size > 0 ? `${count} · ${this.selected.size} selected` : count });

		if (this.selected.size === 0) return;
		const restore = this.barEl.createEl('button', { cls: 'mod-cta', text: `Restore ${this.selected.size}…` });
		restore.disabled = this.busy;
		restore.addEventListener('click', (evt) => this.restoreMenu(evt, [...this.selected]));
		const clear = this.barEl.createEl('button', { text: 'Clear selection' });
		clear.disabled = this.busy;
		clear.addEventListener('click', () => {
			this.selected.clear();
			this.renderList();
		});
	}

	private renderRow(id: string, record: SyncRecord): void {
		const row = this.listEl.createDiv({ cls: 'fieldy-edited-item' });
		const check = row.createEl('input', { type: 'checkbox', attr: { 'aria-label': `Select ${titleOf(record)}` } });
		check.checked = this.selected.has(id);
		check.disabled = this.busy;
		check.addEventListener('change', () => {
			if (check.checked) this.selected.add(id);
			else this.selected.delete(id);
			this.renderBar(this.entries());
		});

		const main = row.createDiv({ cls: 'fieldy-edited-main' });
		const title = main.createEl('a', { cls: 'fieldy-edited-title', text: titleOf(record), href: '#' });
		setTooltip(title, `Open ${record.path}`);
		title.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(record.path, '', true);
		});
		const meta = [record.startTime ? moment(record.startTime).format('YYYY-MM-DD') : null, parentFolder(record.path) || '(vault root)'].filter(Boolean).join(' · ');
		main.createDiv({ cls: 'fieldy-edited-meta', text: meta });
		if (record.editedReason) main.createDiv({ cls: 'fieldy-edited-reason', text: record.editedReason });

		const actions = row.createDiv({ cls: 'fieldy-edited-actions' });
		const button = (icon: string, label: string, onClick: (evt: MouseEvent) => void) => {
			const el = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
			setIcon(el, icon);
			setTooltip(el, label);
			el.disabled = this.busy;
			el.addEventListener('click', onClick);
		};
		button('file-text', 'Open the note', () => void this.app.workspace.openLinkText(record.path, '', true));
		button('eye', 'Show the Fieldy version in the side panel, without changing your note', () => {
			this.close();
			void this.plugin.showFieldyVersion(id);
		});
		button('rotate-ccw', 'Restore the Fieldy version…', (evt) => this.restoreMenu(evt, [id]));
	}

	private restoreMenu(evt: MouseEvent, ids: string[]): void {
		const many = ids.length > 1;
		new Menu()
			.addItem((item) =>
				item
					.setTitle(many ? `Restore ${ids.length} notes, keep my edits below` : 'Restore Fieldy version, keep my edits below it')
					.setIcon('copy-plus')
					.onClick(() => void this.restore(ids, 'keep-both')),
			)
			.addItem((item) =>
				item
					.setTitle(many ? `Restore ${ids.length} notes, discard my edits…` : 'Restore Fieldy version, discard my edits…')
					.setIcon('rotate-ccw')
					.setWarning(true)
					.onClick(() => this.confirmDiscard(ids)),
			)
			.showAtMouseEvent(evt);
	}

	private confirmDiscard(ids: string[]): void {
		const single = ids.length === 1 ? new Map(this.plugin.syncState.edited()).get(ids[0] ?? '') : undefined;
		const what = single ? `"${titleOf(single)}"` : `${ids.length} notes`;
		new ConfirmationModal(this.app)
			.setTitle('Discard your edits?')
			.setContent(`The Fieldy section of ${what} will be replaced by the latest version from Fieldy, and your edits inside it will be lost. Text outside the Fieldy section is not affected.`)
			.addButton((button) =>
				button
					.setButtonText('Restore and discard')
					.setDestructive()
					.setCta()
					.onClick(() => this.restore(ids, 'overwrite')),
			)
			.addCancelButton()
			.open();
	}

	/** Restores one note after the other (each one asks Fieldy for the latest version). */
	private async restore(ids: string[], choice: RestoreChoice): Promise<void> {
		this.busy = true;
		this.renderList();
		const progress = ids.length > 1 ? new Notice(`Restoring 0 of ${ids.length}…`, 0) : null;
		let done = 0;
		const failures: string[] = [];
		for (const id of ids) {
			try {
				await this.plugin.restoreFieldyVersion(id, choice);
				done++;
				this.selected.delete(id);
			} catch (err) {
				failures.push(describeError(err));
			}
			progress?.setMessage(`Restoring ${done + failures.length} of ${ids.length}…`);
		}
		progress?.hide();
		const kept = choice === 'keep-both' ? '; your edits are kept below it' : '';
		if (failures.length === 0) new Notice(ids.length === 1 ? `Fieldy version restored${kept}.` : `${done} notes restored${kept ? '; your edits are kept below the Fieldy version' : ''}.`);
		else new Notice(`${done} restored, ${failures.length} failed (first: ${failures[0]}).`, 10_000);
		this.busy = false;
		this.render();
	}
}
