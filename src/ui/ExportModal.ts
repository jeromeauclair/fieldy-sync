import { Modal, moment, Notice, Setting, TFile, type App } from 'obsidian';
import { TASK_STATUSES, type FieldyTask } from '../api/types';
import { EXPORT_FORMATS, renderExport, type ExportFormat, type ExportItem } from '../export/exportFormats';
import type FieldySyncPlugin from '../main';
import { ObsidianNoteStore } from '../sync/ObsidianNoteStore';
import { HISTORY_START_ISO } from '../utils/dates';
import { describeError, isCancellation } from '../utils/errors';
import { joinVaultPath, sanitizeFolderPath } from '../utils/paths';

const DEFAULT_EXPORT_FOLDER = 'Fieldy/Exports';

type RangePreset = 'all' | '3' | '7' | '14' | '30' | '90' | '365' | 'custom';

/**
 * Exports Fieldy conversations (the whole history or a date range, with or
 * without brief ones) to one file in the vault: Markdown, JSON, CSV or plain
 * text. Tasks are included; transcripts on request (one extra request per
 * conversation). Closing the dialog cancels a running export.
 */
export class ExportModal extends Modal {
	private preset: RangePreset = 'all';
	private from = '';
	private to = '';
	private includeBrief = true;
	private includeTranscripts = false;
	private format: ExportFormat = 'markdown';
	private folder: string;
	private running: AbortController | null = null;

	private customEls: HTMLElement[] = [];
	private statusEl!: HTMLElement;
	private exportButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly plugin: FieldySyncPlugin,
	) {
		super(app);
		this.folder = joinVaultPath(sanitizeFolderPath(plugin.settings.folder) || 'Fieldy', 'Exports');
		this.applyPreset();
	}

	override onOpen(): void {
		this.setTitle('Export Fieldy conversations');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Conversations')
			.setDesc('Conversations that started in this period.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ all: 'Entire history', '3': 'Last 3 days', '7': 'Last 7 days', '14': 'Last 14 days', '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last 12 months', custom: 'Date range' })
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
			.setName('Include brief conversations')
			.setDesc('Short conversations Fieldy marks as brief.')
			.addToggle((toggle) => toggle.setValue(this.includeBrief).onChange((value) => (this.includeBrief = value)));
		new Setting(contentEl)
			.setName('Include transcripts')
			.setDesc(`Slower: one request per conversation, so about ${this.plugin.rateLimitPerMinute} conversations a minute with your request budget.`)
			.addToggle((toggle) => toggle.setValue(this.includeTranscripts).onChange((value) => (this.includeTranscripts = value)));
		new Setting(contentEl)
			.setName('Format')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(Object.fromEntries(Object.entries(EXPORT_FORMATS).map(([key, f]) => [key, f.label])))
					.setValue(this.format)
					.onChange((value) => (this.format = value as ExportFormat)),
			);
		new Setting(contentEl)
			.setName('Folder')
			.setDesc('The export is saved as a new file in this vault folder.')
			.addText((text) => text.setPlaceholder(DEFAULT_EXPORT_FOLDER).setValue(this.folder).onChange((value) => (this.folder = value)));

		this.statusEl = contentEl.createDiv({ cls: 'fieldy-import-status' });
		const footer = new Setting(contentEl);
		footer.addButton((button) => button.setButtonText('Close').onClick(() => this.close()));
		footer.addButton((button) => {
			button
				.setButtonText('Export')
				.setCta()
				// The same button cancels a running export.
				.onClick(() => (this.running ? this.cancel() : void this.run()));
			this.exportButton = button.buttonEl;
		});
	}

	override onClose(): void {
		this.running?.abort();
		this.running = null;
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
		if (this.preset === 'all') return { startTime: HISTORY_START_ISO, endTime: new Date().toISOString() };
		const start = moment(this.from, 'YYYY-MM-DD', true);
		const end = moment(this.to, 'YYYY-MM-DD', true);
		if (!start.isValid() || !end.isValid() || start.isAfter(end)) return null;
		return { startTime: start.startOf('day').toISOString(), endTime: end.endOf('day').toISOString() };
	}

	private cancel(): void {
		this.running?.abort();
		this.running = null;
		this.status('Export cancelled. Nothing was saved.');
		this.setButton(false);
	}

	private setButton(running: boolean): void {
		this.exportButton.setText(running ? 'Cancel export' : 'Export');
		this.exportButton.toggleClass('mod-cta', !running);
		this.exportButton.toggleClass('mod-warning', running);
	}

	/** Transcripts cost one request each, within the request budget. */
	private timeLeft(transcripts: number): string {
		const minutes = Math.ceil(transcripts / Math.max(1, this.plugin.rateLimitPerMinute));
		return minutes <= 1 ? 'under a minute left' : `about ${minutes} minutes left`;
	}

	private status(text: string): void {
		this.statusEl.setText(text);
	}

	private async run(): Promise<void> {
		if (this.running) return;
		const range = this.range();
		if (!range) {
			this.status('Choose a valid date range (the start must not be after the end).');
			return;
		}
		if (!this.plugin.hasApiKey()) {
			this.status('Add your Fieldy API key in the plugin settings first.');
			return;
		}
		const controller = new AbortController();
		this.running = controller;
		const signal = controller.signal;
		this.setButton(true);
		const client = this.plugin.client;
		const settings = this.plugin.settings;
		try {
			this.status('Listing conversations…');
			const { items } = await client.listConversations(
				{ ...range, recordingSource: settings.recordingSource === 'all' ? undefined : settings.recordingSource },
				{ signal, onPage: (n) => this.status(`Listing conversations… ${n} so far`) },
			);
			const conversations = items
				.filter((c) => this.includeBrief || c.type.toUpperCase() !== 'BRIEF')
				.sort((a, b) => a.startTime.localeCompare(b.startTime));
			if (conversations.length === 0) {
				this.status('No conversations in this period.');
				return;
			}

			this.status('Loading tasks…');
			const byConversation = new Map<string, FieldyTask[]>();
			for (const task of await client.listTasksByStatuses(TASK_STATUSES, { signal })) {
				if (!task.memoryId) continue;
				const list = byConversation.get(task.memoryId);
				if (list) list.push(task);
				else byConversation.set(task.memoryId, [task]);
			}

			let speakerNames = new Map<string, string>();
			const exportItems: ExportItem[] = [];
			if (this.includeTranscripts) {
				speakerNames = new Map((await client.listSpeakerProfiles({ signal }).catch(() => [])).map((p) => [p.id, p.name]));
			}
			const withTranscript = this.includeTranscripts ? conversations.filter((c) => !c.locked).length : 0;
			let loaded = 0;
			let privateCount = 0;
			const privacy = this.plugin.privacy;
			await privacy.prepare(signal);
			for (const conversation of conversations) {
				let transcript = null;
				// Private conversations never leave Fieldy; an unknown one is checked first (its transcript is reused below).
				let verdict = privacy.check(conversation);
				if (verdict.state === 'pending') {
					this.status(`Checking privacy filters… ${exportItems.length + privateCount + 1} of ${conversations.length}`);
					const resolved = await privacy.resolve(conversation, signal);
					verdict = resolved.verdict;
					if (this.includeTranscripts && !conversation.locked) transcript = resolved.transcript;
				}
				if (verdict.state === 'private') {
					privateCount++;
					continue;
				}
				if (this.includeTranscripts && !conversation.locked && transcript) {
					loaded++;
				} else if (this.includeTranscripts && !conversation.locked) {
					this.status(`Loading transcripts… ${loaded + 1} of ${withTranscript} (${this.timeLeft(withTranscript - loaded)}). Cancel stops without saving.`);
					loaded++;
					transcript = await client.listTranscriptions(
						{
							startTime: conversation.startTime,
							endTime: conversation.endTime ?? new Date().toISOString(),
							conversationId: conversation.id,
							recordingSource: settings.recordingSource === 'all' ? undefined : settings.recordingSource,
						},
						{ signal },
					);
				}
				exportItems.push({ conversation, tasks: byConversation.get(conversation.id) ?? [], transcript });
			}
			this.plugin.reportRequestOutcome();
			if (exportItems.length === 0) {
				this.status('Every conversation in this period is private, so there is nothing to export.');
				return;
			}

			this.status('Writing the file…');
			const exportedAt = new Date().toISOString();
			const text = renderExport(this.format, exportItems, {
				info: { exportedAt, range: this.preset === 'all' ? null : range, includeBrief: this.includeBrief, includeTranscripts: this.includeTranscripts },
				settings,
				formatDate: (iso, format) => moment(iso).format(format),
				speakerNames,
			});
			const file = await this.write(text, exportedAt);
			const count = `${exportItems.length} conversation${exportItems.length === 1 ? '' : 's'}`;
			const leftOut = privateCount > 0 ? ` ${privateCount} private conversation${privateCount === 1 ? ' was' : 's were'} left out.` : '';
			this.status(`Exported ${count} to ${file.path}.${leftOut}`);
			new Notice(`Fieldy export saved: ${file.path}`);
			if (file.extension === 'md') await this.app.workspace.getLeaf(true).openFile(file);
		} catch (err) {
			if (isCancellation(err)) return;
			this.plugin.reportRequestOutcome(err);
			this.status(describeError(err));
		} finally {
			if (this.running === controller) {
				this.running = null;
				this.setButton(false);
			}
		}
	}

	/** A new file named after the export time; never overwrites one. */
	private async write(text: string, exportedAt: string): Promise<TFile> {
		const store = new ObsidianNoteStore(this.app);
		const folder = await store.ensureFolder(sanitizeFolderPath(this.folder) || DEFAULT_EXPORT_FOLDER);
		const extension = EXPORT_FORMATS[this.format].extension;
		const base = `Fieldy export ${moment(exportedAt).format('YYYY-MM-DD HHmm')}`;
		for (let n = 1; n < 100; n++) {
			const path = joinVaultPath(folder, `${base}${n === 1 ? '' : ` (${n})`}.${extension}`);
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			return this.app.vault.create(path, text);
		}
		throw new Error('No free file name for the export.');
	}
}
