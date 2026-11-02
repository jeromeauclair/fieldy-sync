import { moment, Notice } from 'obsidian';
import type { FieldyMemoryTemplate } from '../../api/types';
import { connectionLabel } from '../../connection';
import { EditedNotesModal } from '../EditedNotesModal';
import { ExportModal } from '../ExportModal';
import { ImportModal } from '../ImportModal';
import { formatSyncSummary } from '../summary';
import { describeError, isCancellation } from '../../utils/errors';
import { copyToClipboard } from './editorActions';
import type { FieldyView } from './FieldyView';

function templateText(template: FieldyMemoryTemplate): string {
	const lines = [`# ${template.emoji ? `${template.emoji} ` : ''}${template.title}`];
	if (template.description) lines.push('', template.description);
	if (template.prompt) lines.push('', '## Prompt', '', template.prompt);
	for (const section of template.sections) lines.push('', `## ${section.title}`, '', section.prompt);
	return lines.join('\n');
}

/**
 * Account and plugin information: connection details, sync status with the
 * main actions, and reference data from Fieldy (speaker profiles and memory
 * templates).
 */
export class AccountTab {
	private profilesEl: HTMLElement | null = null;
	private templatesEl: HTMLElement | null = null;
	private loaded = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly view: FieldyView,
	) {}

	private get plugin() {
		return this.view.plugin;
	}

	render(): void {
		this.root.empty();
		const card = (title: string) => {
			const el = this.root.createDiv({ cls: 'fieldy-card' });
			el.createDiv({ cls: 'fieldy-card-title', text: title });
			return el;
		};

		// Connection
		const connection = card('Connection');
		const state = this.plugin.connection;
		connection.createDiv({ cls: `fieldy-card-line fieldy-state-${state.status}`, text: connectionLabel(state) });
		if (state.checkedAt) connection.createDiv({ cls: 'fieldy-muted', text: `Last checked ${moment(state.checkedAt).fromNow()}` });
		connection.createDiv({ cls: 'fieldy-muted', text: `Request budget: ${this.plugin.rateLimitPerMinute} per minute (Fieldy allows 100).` });
		const connectionActions = connection.createDiv({ cls: 'fieldy-card-actions' });
		connectionActions.createEl('button', { text: 'Check connection' }).addEventListener('click', () => void this.plugin.testConnection());

		// Sync
		const sync = card('Sync');
		const last = this.plugin.syncState.lastRun;
		sync.createDiv({
			cls: 'fieldy-card-line',
			text: last ? `${moment(last.finishedAt).format('YYYY-MM-DD HH:mm')}: ${formatSyncSummary(last)}` : 'No sync has run yet on this device.',
		});
		const records = this.plugin.syncState.entries();
		const edited = this.plugin.syncState.edited().length;
		sync.createDiv({
			cls: 'fieldy-muted',
			text: `${records.filter(([, r]) => r.status !== 'deleted').length} notes tracked · ${edited} edited by you · sync window: last ${this.plugin.settings.syncWindowDays} days`,
		});
		const syncActions = sync.createDiv({ cls: 'fieldy-card-actions' });
		const syncButton = syncActions.createEl('button', { text: this.plugin.engine.isRunning ? 'Syncing…' : 'Sync now', cls: 'mod-cta' });
		syncButton.disabled = this.plugin.engine.isRunning;
		syncButton.addEventListener('click', () => void this.plugin.runSync('manual'));
		syncActions.createEl('button', { text: 'Import conversations…' }).addEventListener('click', () => new ImportModal(this.view.app, this.plugin).open());
		const review = syncActions.createEl('button', { text: `Edited notes (${edited})` });
		review.disabled = edited === 0;
		review.addEventListener('click', () => new EditedNotesModal(this.view.app, this.plugin).open());
		syncActions.createEl('button', { text: 'Copy diagnostics' }).addEventListener('click', () => void this.plugin.copyDiagnostics());

		// Export
		const exportCard = card('Export');
		exportCard.createDiv({
			cls: 'fieldy-muted',
			text: 'Save your conversations, with their tasks and optionally their transcripts, to one file in your vault: Markdown, JSON, CSV or plain text. The whole history or a date range, with or without brief conversations.',
		});
		exportCard
			.createDiv({ cls: 'fieldy-card-actions' })
			.createEl('button', { text: 'Export conversations…' })
			.addEventListener('click', () => new ExportModal(this.view.app, this.plugin).open());

		// Reference data from Fieldy (read-only here; managed in the Fieldy app)
		const profiles = card('Speaker profiles');
		profiles.createDiv({ cls: 'fieldy-muted', text: 'People you named in Fieldy. Transcripts use these names when Fieldy recognises the speaker.' });
		this.profilesEl = profiles.createDiv();
		const templates = card('Memory templates');
		templates.createDiv({
			cls: 'fieldy-muted',
			text: 'The summary styles defined in Fieldy. Create and edit them in the Fieldy app; this list shows them as they are now. Open one to read or copy its instructions.',
		});
		templates.createDiv({
			cls: 'fieldy-muted',
			text: 'Fieldy uses a template when it writes a conversation\'s summary. Editing a template does not change notes already in your vault: a note updates when the conversation itself changes in Fieldy (for example after you regenerate it in the app).',
		});
		this.templatesEl = templates.createDiv();
		templates
			.createDiv({ cls: 'fieldy-card-actions' })
			.createEl('button', { text: 'Reload profiles and templates' }).addEventListener('click', () => {
			// The panel keeps them while it is open; this fetches them again (two requests).
			this.view.data.forgetLists();
			void this.renderReference();
		});
		void this.renderReference();
	}

	onShow(): void {
		if (!this.loaded) void this.renderReference();
	}

	private async renderReference(): Promise<void> {
		const profilesEl = this.profilesEl;
		const templatesEl = this.templatesEl;
		if (!profilesEl || !templatesEl) return;
		if (!this.plugin.hasApiKey()) {
			profilesEl.setText('Connect your API key to load this.');
			templatesEl.setText('Connect your API key to load this.');
			return;
		}
		profilesEl.setText('Loading…');
		templatesEl.setText('Loading…');
		try {
			const [profiles, templates] = await Promise.all([this.view.data.speakerProfiles(), this.view.data.templates()]);
			this.loaded = true;
			profilesEl.empty();
			if (profiles.length === 0) profilesEl.createSpan({ cls: 'fieldy-muted', text: 'No speaker profiles yet.' });
			const chips = profilesEl.createDiv({ cls: 'fieldy-chips' });
			for (const profile of profiles) {
				const chip = chips.createSpan({ cls: 'fieldy-chip', text: profile.name });
				if (profile.color && /^#[0-9a-f]{3,8}$/i.test(profile.color)) chip.setCssProps({ '--fieldy-chip-color': profile.color });
			}
			if (profiles.length > 0) {
				profilesEl
					.createEl('button', { text: 'Copy names' })
					.addEventListener('click', () => void copyToClipboard(profiles.map((p) => p.name).join('\n'), 'Speaker names'));
			}

			templatesEl.empty();
			if (templates.length === 0) templatesEl.createSpan({ cls: 'fieldy-muted', text: 'No memory templates.' });
			for (const template of templates) {
				const details = templatesEl.createEl('details', { cls: 'fieldy-template' });
				const summary = details.createEl('summary', { text: `${template.emoji ? `${template.emoji} ` : ''}${template.title}` });
				if (template.updatedAt) summary.createSpan({ cls: 'fieldy-muted fieldy-template-updated', text: ` · updated ${moment(template.updatedAt).fromNow()}` });
				if (template.description) details.createDiv({ cls: 'fieldy-muted', text: template.description });
				if (template.prompt) details.createDiv({ cls: 'fieldy-template-prompt', text: template.prompt });
				for (const section of template.sections) {
					details.createDiv({ cls: 'fieldy-template-section', text: section.title });
					if (section.prompt) details.createDiv({ cls: 'fieldy-template-prompt', text: section.prompt });
				}
				details
					.createEl('button', { text: 'Copy template' })
					.addEventListener('click', () => void copyToClipboard(templateText(template), 'Template'));
			}
		} catch (err) {
			if (isCancellation(err)) return;
			const message = describeError(err);
			profilesEl.setText(message);
			templatesEl.setText(message);
			new Notice(message);
		}
	}
}
