import { Modal, setIcon, type App } from 'obsidian';
import type FieldySyncPlugin from '../main';

/**
 * Notes imported before a privacy filter matched their conversation. Sync
 * keeps them exactly as they are and no longer updates them; this list lets
 * the user open them and delete them if they want them out of the vault.
 */
export class PrivateNotesModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: FieldySyncPlugin,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Notes of private conversations');
		this.modalEl.addClass('fieldy-private-modal');
		const { contentEl } = this;
		const records = this.plugin.syncState
			.privateNotes()
			.map(([, record]) => record)
			.sort((a, b) => b.startTime.localeCompare(a.startTime));
		if (records.length === 0) {
			contentEl.createEl('p', { cls: 'fieldy-muted', text: 'None. No note in your vault belongs to a private conversation.' });
			return;
		}
		contentEl.createEl('p', {
			text: this.plugin.settings.deletePrivateNotes
				? 'These notes were imported before a privacy filter matched their conversation. "Move notes of private conversations to the trash" is on, so the next sync moves them to the trash.'
				: 'These notes were imported before a privacy filter matched their conversation. Sync no longer updates them and does not delete them: open one to delete it yourself, or turn on "Move notes of private conversations to the trash".',
		});
		const list = contentEl.createDiv({ cls: 'fieldy-private-list' });
		for (const record of records) {
			const row = list.createDiv({ cls: 'fieldy-private-row' });
			const open = row.createEl('a', { cls: 'fieldy-private-path', text: record.path, href: '#' });
			open.addEventListener('click', (evt) => {
				evt.preventDefault();
				this.close();
				void this.plugin.openNote(record.path);
			});
			if (record.privateReason) {
				const reason = row.createDiv({ cls: 'fieldy-muted fieldy-private-reason' });
				setIcon(reason.createSpan({ cls: 'fieldy-private-icon' }), 'lock');
				reason.appendText(`Filter: ${record.privateReason}`);
			}
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
