import { ConfirmationModal, moment, Notice, Platform, PluginSettingTab, setIcon, type App, type Setting, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { RECORDING_SOURCES } from '../api/types';
import { connectionLabel } from '../connection';
import { renderTranscript } from '../markdown/TranscriptRenderer';
import { EditedNotesModal } from '../ui/EditedNotesModal';
import { describeError } from '../utils/errors';
import { applyFilenamePattern, joinVaultPath, sanitizeFolderPath, subfolderFor } from '../utils/paths';
import type FieldySyncPlugin from '../main';
import { AUTO_SYNC_OPTIONS, FIELDY_REFERRAL_URL, ISSUES_URL, SYNC_WINDOW_OPTIONS, type FieldySyncSettings } from './settings';

const SUPPORT_URL = 'https://buymeacoffee.com/jeromeauclair';
const API_KEY_DOCS_URL = 'https://fieldyai.github.io/docs/public-api.md';
const MOMENT_DOCS_URL = 'https://momentjs.com/docs/#/displaying/format/';

/** Settings stored as numbers but edited through dropdowns (which use strings). */
const NUMERIC_DROPDOWNS = new Set<keyof FieldySyncSettings>(['syncWindowDays', 'autoSyncMinutes']);

const DOCS_URL = 'https://github.com/jeromeauclair/fieldy-sync/blob/main/docs';
const GUIDE_URL = `${DOCS_URL}/guide.md`;
const REFERENCE_URL = `${DOCS_URL}/reference.md`;

type Part = string | { link: string; href: string } | { code: string } | { strong: string };

/** Builds a description from short paragraphs; each paragraph is a list of text, links, code or bold parts. */
function help(...paragraphs: Part[][]): DocumentFragment {
	const frag = createFragment();
	paragraphs.forEach((parts, index) => {
		if (index > 0) frag.createEl('br');
		const block = frag.createSpan({ cls: index > 0 ? 'fieldy-help-more' : 'fieldy-help' });
		for (const part of parts) {
			if (typeof part === 'string') block.appendText(part);
			else if ('link' in part) block.createEl('a', { text: part.link, href: part.href, attr: { target: '_blank', rel: 'noopener noreferrer' } });
			else if ('code' in part) block.createEl('code', { text: part.code });
			else block.createEl('strong', { text: part.strong });
		}
	});
	return frag;
}

const formatDate = (iso: string, format: string) => moment(iso).format(format);

export class FieldySettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: FieldySyncPlugin,
	) {
		super(app, plugin);
		this.icon = 'mic';
	}

	override getControlValue(key: string): unknown {
		const value = (this.plugin.settings as unknown as Record<string, unknown>)[key];
		return NUMERIC_DROPDOWNS.has(key as keyof FieldySyncSettings) ? String(value) : value;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		await this.plugin.updateSetting(key as keyof FieldySyncSettings, value);
		this.refreshDomState();
	}

	/** One banner state's custom colours: one for light mode, one for dark mode. */
	private bannerColorRow(name: string, desc: string, light: keyof FieldySyncSettings, dark: keyof FieldySyncSettings): SettingDefinition {
		const s = () => this.plugin.settings;
		return {
			name,
			desc,
			aliases: ['color', 'colour', 'dark mode', 'light mode'],
			visible: () => s().showNoteBanner && s().bannerColors === 'custom',
			render: (setting: Setting) => {
				for (const [label, key] of [
					['Light', light],
					['Dark', dark],
				] as const) {
					setting.controlEl.createSpan({ cls: 'fieldy-color-label', text: label });
					setting.addColorPicker((picker) =>
						picker.setValue(String(s()[key])).onChange(async (value) => {
							await this.plugin.updateSetting(key, value);
						}),
					);
				}
			},
		};
	}

	/** A read-only row whose text follows the current settings. */
	private livePreview(name: string, desc: string, compute: () => string, multiline = false): SettingDefinition {
		return {
			name,
			desc,
			searchable: false,
			render: (setting: Setting) => {
				setting.settingEl.addClass('fieldy-preview-row');
				const out = setting.descEl.createDiv({ cls: multiline ? 'fieldy-preview fieldy-preview-multiline' : 'fieldy-preview' });
				const update = () => {
					try {
						out.setText(compute());
					} catch {
						out.setText('Invalid format.');
					}
				};
				update();
				const ref = this.plugin.events.on('settings-changed', update);
				return () => this.plugin.events.offref(ref);
			},
		};
	}

	private fileNamePreview(): string {
		const s = this.plugin.settings;
		const startTime = moment().hour(14).minute(5).second(0).toISOString();
		const sample = { title: 'Weekly sync with Acme', startTime, id: '2f0c6d2e-1b7a' };
		const folder = joinVaultPath(sanitizeFolderPath(s.folder), subfolderFor(s.subfolders, startTime, formatDate, s.subfolderFormat));
		return `${joinVaultPath(folder, applyFilenamePattern(s.filenamePattern, sample, s.filenameDateFormat, formatDate))}.md`;
	}

	private folderPreview(): string {
		const s = this.plugin.settings;
		const folder = joinVaultPath(sanitizeFolderPath(s.folder), subfolderFor(s.subfolders, new Date().toISOString(), formatDate, s.subfolderFormat));
		return `${folder || '(vault root)'}/`;
	}

	private datePreview(): string {
		const s = this.plugin.settings;
		const now = new Date().toISOString();
		const property = s.frontmatterDates === 'iso' ? now : formatDate(now, 'YYYY-MM-DDTHH:mm:ss');
		return `In notes: ${formatDate(now, s.noteDateFormat)}\nIn properties: fieldy_start: ${property}`;
	}

	private peoplePreview(): string {
		const index = this.plugin.peopleIndex();
		const lines = [`${index.noteCount} people note${index.noteCount === 1 ? '' : 's'}, ${index.targets.size} name${index.targets.size === 1 ? '' : 's'} and aliases to match.`];
		if (index.ambiguous.size > 0) {
			lines.push('Not linked, because they match several notes:');
			for (const [name, paths] of [...index.ambiguous].slice(0, 10)) lines.push(`- ${name}: ${paths.join(', ')}`);
			if (index.ambiguous.size > 10) lines.push(`- …and ${index.ambiguous.size - 10} more`);
		}
		return lines.join('\n');
	}

	private transcriptPreview(): string {
		const s = this.plugin.settings;
		const start = moment().hour(14).minute(0).second(0).millisecond(0);
		const at = (seconds: number) => start.clone().add(seconds, 's').toISOString();
		const segment = (id: string, seconds: number, speaker: string, text: string) => ({
			id,
			text,
			timestamp: at(seconds),
			speaker,
			speakerProfileId: null,
			start: null,
			end: null,
			createdAt: null,
			recordingSource: null,
		});
		const lines = renderTranscript(
			[
				segment('1', 4, 'Alex', 'Thanks for joining. Shall we start with the budget?'),
				segment('2', 9, 'Alex', 'We have two options.'),
				segment('3', 15, 'Sam', 'Let us go with the annual plan.'),
			],
			{ format: s.transcriptFormat, timestampStyle: s.timestampStyle, conversationStart: start.toISOString(), formatDate, speakerNames: new Map() },
		);
		const body = s.collapseTranscript ? ['> [!quote]- Show transcript', ...lines.map((l) => (l === '' ? '>' : `> ${l}`))] : lines;
		return body.join('\n');
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const s = () => this.plugin.settings;
		return [
			{
				name: 'Mobile: not tested yet',
				searchable: false,
				visible: () => Platform.isMobile,
				desc: help([
					'Fieldy Sync works on phones and tablets but has not been tested there yet; full mobile support is planned for version 1.2. If something looks wrong, please report it on ',
					{ link: 'GitHub', href: ISSUES_URL },
					' and attach the report from Diagnostics (Edited notes and troubleshooting page).',
				]),
				render: (setting: Setting) => {
					setting.settingEl.addClass('fieldy-mobile-note');
				},
			},
			{
				name: 'How Fieldy Sync works',
				searchable: false,
				desc: help(
					['Each Fieldy conversation becomes one note with its summary, tasks, quotes and transcript.'],
					[
						{ strong: 'Getting started: ' },
						'1. add your API key under ',
						{ strong: 'Connection' },
						', 2. select ',
						{ strong: 'Test connection' },
						', 3. run ',
						{ strong: 'Sync now' },
						' (ribbon icon or command palette), or open the side panel to pick conversations one by one.',
					],
					[
						{ strong: 'Your edits are safe: ' },
						'the plugin only updates the section between the ',
						{ code: '%% fieldy:begin %%' },
						' and ',
						{ code: '%% fieldy:end %%' },
						' markers, shown as banners in the note, and you can write anywhere else freely. If you change something inside that section, the note becomes your edited version: sync leaves it exactly as you wrote it. The original stays in Fieldy, and you can view it or bring it back from the banner, the side panel or "Edited notes".',
					],
					[
						{ strong: 'Documentation: ' },
						'the ',
						{ link: 'user guide', href: GUIDE_URL },
						' (panel, banners, dashboards, Dataview, export) and the ',
						{ link: 'reference', href: REFERENCE_URL },
						' (every setting, how sync works, troubleshooting).',
					],
				),
				render: (setting: Setting) => {
					setting.settingEl.addClass('fieldy-intro');
				},
			},
			{
				type: 'page',
				name: 'Connection',
				desc: 'Your Fieldy API key and connection check.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'API key',
								aliases: ['token', 'secret', 'credentials', 'password'],
								desc: help(
									['Your personal key lets the plugin read your Fieldy conversations. Click the field to pick a saved secret or create a new one, then paste your key into it.'],
									[
										'Get a key in the Fieldy app under ',
										{ strong: 'Settings → Developer Settings' },
										' (it is shown only once, so copy it right away). ',
										{ link: 'Fieldy documentation', href: API_KEY_DOCS_URL },
									],
									['The key is kept in Obsidian\'s secret storage. This plugin only remembers the secret\'s name, so the key never appears in your settings file, your notes or any log.'],
								),
								control: { type: 'secret', key: 'apiKeySecretId' },
							},
							{
								name: 'No Fieldy account yet?',
								searchable: false,
								visible: () => !this.plugin.hasApiKey(),
								desc: help([
									'Fieldy Sync needs a Fieldy account and a Fieldy device or app. ',
									{ link: 'Get Fieldy with $30 off', href: FIELDY_REFERRAL_URL },
									' (the developer\'s referral link). This note disappears once a key is set.',
								]),
							},
							{
								name: 'Test connection',
								aliases: ['status', 'check'],
								desc: help([
									'Checks your key with one small request and shows which Fieldy account it belongs to. Use it after adding or changing the key, or when syncing fails.',
								]),
								render: (setting: Setting) => {
									const status = setting.descEl.createDiv({ cls: 'fieldy-connection-status' });
									const show = () => {
										const state = this.plugin.connection;
										status.setText(connectionLabel(state));
										status.toggleClass('mod-success', state.status === 'connected');
										status.toggleClass('mod-warning', state.status === 'error' || state.status === 'not-configured');
									};
									show();
									setting.addButton((button) =>
										button.setButtonText('Test connection').onClick(async () => {
											button.setDisabled(true);
											await this.plugin.testConnection();
											button.setDisabled(false);
										}),
									);
									const ref = this.plugin.events.on('connection-changed', show);
									// Show a real status right away instead of "not checked yet".
									if (this.plugin.connection.status === 'unknown' && this.plugin.hasApiKey()) void this.plugin.testConnection();
									return () => this.plugin.events.offref(ref);
								},
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Sync',
				desc: 'What each sync looks at, and when it runs.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Import new conversations during sync',
								desc: help(
									['On: every sync also creates notes for conversations that do not have one yet.'],
									['Off: sync only updates the notes you already have. Add new ones yourself with "Import conversations" or from the side panel.'],
								),
								control: { type: 'toggle', key: 'importNewOnSync' },
							},
							{
								name: 'Sync window',
								aliases: ['period', 'days', 'history'],
								desc: help(
									['How far back each sync looks, by the date a conversation started. Conversations in this period are checked for new or changed content every time; older ones are left alone.'],
									['A longer window catches late changes in Fieldy but makes each sync slower. To bring in older history once, use "Import conversations".'],
								),
								control: { type: 'dropdown', key: 'syncWindowDays', options: SYNC_WINDOW_OPTIONS },
							},
							{
								name: 'Recording source',
								aliases: ['pendant', 'wearable', 'phone', 'desktop'],
								desc: help(
									['Sync only conversations recorded by one device (the pendant, the phone app or the desktop app), and use only that device\'s transcript. "All sources" combines everything.'],
									['Changing it refreshes the unedited notes in your sync window on the next sync.'],
								),
								control: {
									type: 'dropdown',
									key: 'recordingSource',
									options: { all: 'All sources', ...Object.fromEntries(RECORDING_SOURCES.map((r) => [r, r.charAt(0).toUpperCase() + r.slice(1)])) },
								},
							},
							{
								name: 'Include brief conversations',
								desc: help(['Fieldy marks very short recordings as brief. Turn this off to skip them during sync; you can still import one by hand.']),
								control: { type: 'toggle', key: 'includeBrief' },
							},
							{
								name: 'Sync on startup',
								desc: help(['Runs a sync about 10 seconds after Obsidian opens, so your notes are up to date when you start working. Does nothing if no API key is set.']),
								control: { type: 'toggle', key: 'syncOnStartup' },
							},
							{
								name: 'Automatic sync',
								aliases: ['interval', 'schedule', 'periodic'],
								desc: help(
									['Syncs regularly while Obsidian is open. Syncs never overlap and always stay within Fieldy\'s rate limit.'],
									['"Off" means you sync yourself, with the ribbon icon, the status bar or the "Sync now" command.'],
								),
								control: { type: 'dropdown', key: 'autoSyncMinutes', options: AUTO_SYNC_OPTIONS },
							},
							{
								name: 'Re-create deleted notes',
								desc: help(
									['Off (recommended): if you delete an imported note, sync respects that and does not bring it back.'],
									['On: deleted notes are imported again by the next sync. Either way, you can re-import a single conversation from the import dialog or the side panel.'],
								),
								control: { type: 'toggle', key: 'recreateDeleted' },
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Folders and file names',
				desc: 'Where new notes go and how they are named.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Folder',
								desc: help(
									['Where new conversation notes are created.'],
									['Changing it only affects notes created from now on. Existing notes stay where they are and keep syncing, even if you move or rename them.'],
								),
								control: { type: 'folder', key: 'folder', placeholder: 'Fieldy', validate: (v) => (v.trim() === '' ? 'Choose a folder.' : undefined) },
							},
							{
								name: 'Subfolders',
								desc: help(['Groups new notes into folders by conversation date. Helpful if you record a lot. Existing notes are not moved.']),
								control: {
									type: 'dropdown',
									key: 'subfolders',
									options: {
										none: 'None',
										year: 'By year (Fieldy/2026)',
										'year-month': 'By month, one level (Fieldy/2026-10)',
										month: 'By year, then month (Fieldy/2026/2026-10)',
										week: 'By year, then week (Fieldy/2026/2026-W44)',
										day: 'By year, month, then day (Fieldy/2026/2026-10/2026-10-29)',
										custom: 'Custom format…',
									},
								},
							},
							{
								name: 'Subfolder format',
								desc: help(
									['A ', { link: 'Moment.js date format', href: MOMENT_DOCS_URL }, '; each "/" starts a subfolder. Put literal text in square brackets.'],
									['Example: ', { code: 'YYYY/[Q]Q' }, ' gives Fieldy/2026/Q4.'],
								),
								visible: () => s().subfolders === 'custom',
								control: { type: 'text', key: 'subfolderFormat', placeholder: 'YYYY/MM' },
							},
							this.livePreview('Folder preview', 'A conversation recorded today goes to:', () => this.folderPreview()),
							{
								name: 'File name pattern',
								aliases: ['filename', 'naming'],
								desc: help(
									[
										'How new notes are named. Tokens: ',
										{ code: '{date}' },
										' conversation date, ',
										{ code: '{time}' },
										' start time, ',
										{ code: '{title}' },
										' Fieldy title, ',
										{ code: '{id}' },
										' short conversation ID.',
									],
									['Characters that are not allowed in file names are replaced automatically, and " (2)", " (3)"… is added when a name is taken. Existing notes are never renamed.'],
								),
								control: {
									type: 'text',
									key: 'filenamePattern',
									placeholder: '{date} - {title}',
									validate: (v) => (/\{(title|id|date|time)\}/i.test(v) ? undefined : 'Include at least one token, for example {title}.'),
								},
							},
							{
								name: 'File name date format',
								desc: help([
									'How ',
									{ code: '{date}' },
									' is written, in ',
									{ link: 'Moment.js format', href: MOMENT_DOCS_URL },
									'. Examples: ',
									{ code: 'YYYY-MM-DD' },
									' → 2026-10-29, ',
									{ code: 'DD.MM.YYYY' },
									' → 29.10.2026.',
								]),
								control: { type: 'text', key: 'filenameDateFormat', placeholder: 'YYYY-MM-DD' },
							},
							this.livePreview('Example file name', 'A conversation titled "Weekly sync with Acme" today at 14:05 would be saved as:', () => this.fileNamePreview()),
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Note content',
				desc: 'The sections synced notes contain.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'What goes into a note',
								searchable: false,
								desc: help([
									'Choose the sections synced notes contain (tasks have their own page). Sections Fieldy has no data for are always left out. Changes apply to new notes, and to unedited notes in your sync window on the next sync.',
								]),
							},
							{ name: 'Summary', desc: help(['Fieldy\'s AI summary of the conversation.']), control: { type: 'toggle', key: 'includeSummary' } },
							{
								name: 'Full memory content',
								aliases: ['details'],
								desc: help(['The complete write-up produced with your Fieldy memory template, when it says more than the summary. Shown under "Details".']),
								control: { type: 'toggle', key: 'includeDetails' },
							},
							{ name: 'Quotes', desc: help(['Notable quotes Fieldy picked out, with their context.']), control: { type: 'toggle', key: 'includeQuotes' } },
							{
								name: 'Transcript',
								desc: help(['The word-for-word transcript. It needs one extra request per new or changed conversation; turn it off for shorter notes and faster syncs.']),
								control: { type: 'toggle', key: 'includeTranscript' },
							},
							{
								name: 'Share links',
								desc: help([
									'Lists the links you created in the Fieldy app to share this conversation. Needs one extra request per updated note, and the list is refreshed only when the note updates.',
								]),
								control: { type: 'toggle', key: 'includeShareLinks' },
							},
							{
								name: 'Section banner',
								aliases: ['markers', 'fieldy:begin', 'status'],
								desc: help(
									[
										'Shows the start of the Fieldy section as a small banner, with its state (synced, edited or paused), when it was last synced and quick actions, and its end as a divider. Live Preview and reading view only.',
									],
									['Display only: the note itself still contains the plain ', { code: '%% fieldy:begin %%' }, ' and ', { code: '%% fieldy:end %%' }, ' markers, visible in source mode.'],
								),
								control: { type: 'toggle', key: 'showNoteBanner' },
							},
							{
								name: 'Banner colours',
								aliases: ['color', 'colour', 'theme'],
								desc: help(['Use the theme\'s blue, orange and grey for synced, edited and paused sections, or choose your own, with separate colours for light and dark mode.']),
								visible: () => s().showNoteBanner,
								control: { type: 'dropdown', key: 'bannerColors', options: { theme: 'Theme colours', custom: 'Custom colours' } },
							},
							this.bannerColorRow('Synced colour', 'Banners of sections kept up to date from Fieldy.', 'bannerColorSynced', 'bannerColorSyncedDark'),
							this.bannerColorRow('Edited colour', 'Banners of sections you changed.', 'bannerColorEdited', 'bannerColorEditedDark'),
							this.bannerColorRow('Paused colour', 'Banners of notes with fieldy_sync: false.', 'bannerColorPaused', 'bannerColorPausedDark'),
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Tasks',
				desc: 'Fieldy action items in your notes.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Tasks',
								aliases: ['action items', 'to-do', 'todo'],
								desc: help(['Action items from the conversation, as checkboxes. Ticking a box in Obsidian is safe: it never counts as an edit and is kept when the note updates.']),
								control: { type: 'toggle', key: 'includeTasks' },
							},
							{
								name: 'Completed tasks',
								desc: help(['Also list tasks already done in Fieldy (shown ticked).']),
								visible: () => s().includeTasks,
								control: { type: 'toggle', key: 'includeCompletedTasks' },
							},
							{
								name: 'Dismissed tasks',
								desc: help(['Also list tasks that were rejected, skipped, cancelled or expired in Fieldy (shown as [-]).']),
								visible: () => s().includeTasks,
								control: { type: 'toggle', key: 'includeDismissedTasks' },
							},
							{
								name: 'Due dates as Dataview fields',
								aliases: ['dataview', 'due'],
								desc: help([
									'Writes a task\'s due date as [due:: 2026-11-05] instead of (due 2026-11-05), so the Dataview plugin can sort and filter Fieldy tasks by due date. Off by default; notes update at their next sync.',
								]),
								visible: () => s().includeTasks,
								control: { type: 'toggle', key: 'dataviewTaskFields' },
							},
							{
								name: 'Mark ticked tasks as completed in Fieldy',
								aliases: ['two-way', 'push'],
								desc: help(
									['Optional, off by default. When you tick an open task in a note, the next sync also marks it completed in Fieldy.'],
									['Apart from the task changes you make yourself in the side panel\'s Tasks tab, this is the only change the plugin makes in your Fieldy account. It never deletes tasks and never edits conversations.'],
								),
								visible: () => s().includeTasks,
								control: { type: 'toggle', key: 'pushTaskCompletion' },
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Transcript',
				desc: 'How transcripts are written.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Transcript format',
								desc: help(
									[{ strong: 'Timestamped, with speakers: ' }, 'one line per speaker turn, with the time and the speaker\'s name.'],
									[{ strong: 'Timestamped segments: ' }, 'one line per short segment, with its time but without names.'],
									[{ strong: 'Readable paragraphs: ' }, 'each speaker\'s turn as a paragraph, without times. Best for reading.'],
								),
								control: {
									type: 'dropdown',
									key: 'transcriptFormat',
									options: { 'timestamped-speaker': 'Timestamped, with speakers', timestamped: 'Timestamped segments', paragraphs: 'Readable paragraphs' },
								},
							},
							{
								name: 'Transcript timestamps',
								desc: help(['"Time of day" shows when something was said (14:05:12). "Time since start" counts from the beginning of the conversation (05:12), handy for long recordings.']),
								visible: () => s().transcriptFormat !== 'paragraphs',
								control: { type: 'dropdown', key: 'timestampStyle', options: { clock: 'Time of day (14:05:12)', elapsed: 'Time since start (05:12)' } },
							},
							{
								name: 'Collapse transcript',
								desc: help(['Puts the transcript in a folded callout so long transcripts do not fill the note. Click it to unfold.']),
								control: { type: 'toggle', key: 'collapseTranscript' },
							},
							this.livePreview('Transcript preview', 'A short sample written with the options above (Markdown as stored in the note):', () => this.transcriptPreview(), true),
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Properties, tags and dates',
				desc: 'Note properties, tags, aliases and date formats.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Date format in notes',
								desc: help(['How dates appear inside notes, for example on the "When" line. Same Moment.js format as above.']),
								control: { type: 'text', key: 'noteDateFormat', placeholder: 'YYYY-MM-DD HH:mm' },
							},
							{
								name: 'Property dates',
								aliases: ['frontmatter', 'yaml'],
								desc: help([
									'Format of date properties such as fieldy_start. "Local time" is recognised by Obsidian as a date & time property, so it can be sorted and filtered in Bases. "ISO 8601" keeps Fieldy\'s exact UTC values.',
								]),
								control: { type: 'dropdown', key: 'frontmatterDates', options: { local: 'Local time (2026-10-29T14:05:00)', iso: 'ISO 8601 from Fieldy (UTC)' } },
							},
							this.livePreview('Date preview', 'With the formats above, the current date and time looks like this:', () => this.datePreview(), true),
							{
								name: 'Speakers property',
								desc: help(['Adds fieldy_speakers, the list of people in the conversation, to the note\'s properties. Useful for search, Bases and Dataview.']),
								control: { type: 'toggle', key: 'fmSpeakers' },
							},
							{ name: 'Keywords property', desc: help(['Adds fieldy_keywords, the topics Fieldy detected.']), control: { type: 'toggle', key: 'fmKeywords' } },
							{ name: 'Location property', desc: help(['Adds fieldy_location, the address where the conversation was recorded, when Fieldy knows it.']), control: { type: 'toggle', key: 'fmLocation' } },
							{ name: 'Template property', desc: help(['Adds fieldy_template, the name of the Fieldy memory template used for the summary.']), control: { type: 'toggle', key: 'fmTemplate' } },
							{
								name: 'Tags',
								desc: help(['Tags added to every new note, separated by commas, without "#". They are only added when a note is created; after that, the note\'s tags are entirely yours.']),
								control: { type: 'text', key: 'tags', placeholder: 'fieldy' },
							},
							{
								name: 'Add keywords as tags',
								desc: help(['Also turns Fieldy\'s keywords into tags when a note is created, for example "Project Apollo" → #project-apollo.']),
								control: { type: 'toggle', key: 'keywordTags' },
							},
							{
								name: 'Add title as alias',
								desc: help(['Adds the conversation title as an alias when a note is created, so you can link to it by title even though its file name starts with the date.']),
								control: { type: 'toggle', key: 'titleAlias' },
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'People',
				desc: 'Link speakers to your people notes.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Link speakers to people notes',
								desc: help(
									['Turns speaker names into links to your notes about those people, so each person\'s note lists their conversations in its backlinks.'],
									[
										'A name links when it matches a note\'s name or one of its ',
										{ code: 'aliases' },
										', ignoring case. Names with no matching note stay plain text, and no notes are created. A name that matches several notes is not linked.',
									],
								),
								control: { type: 'toggle', key: 'linkSpeakers' },
							},
							{
								name: 'People folder',
								desc: help(['Only notes in this folder (and its subfolders) count as people. Leave empty to use the whole vault.']),
								visible: () => s().linkSpeakers,
								control: { type: 'folder', key: 'peopleFolder', placeholder: 'People' },
							},
							{
								name: 'Link speakers in the transcript',
								desc: help(['Also links the speaker labels in the transcript. Off by default: a long conversation would add one link per speaker turn.']),
								visible: () => s().linkSpeakers,
								control: { type: 'toggle', key: 'linkTranscriptSpeakers' },
							},
							{
								name: 'Create notes for new speakers',
								desc: help(
									['When a speaker has no note yet, sync creates an empty one in the people folder (or in "People" if none is set), so every person gets linked. Off: only people who already have a note are linked.'],
									['Generic labels such as "Unknown" or "Speaker A" never get a note. Notes are only created for conversations that have, or get, a note.'],
								),
								visible: () => s().linkSpeakers,
								control: { type: 'toggle', key: 'createSpeakerNotes' },
							},
							{
								...this.livePreview('People found', 'What the people folder currently provides:', () => this.peoplePreview(), true),
								visible: () => s().linkSpeakers,
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Advanced',
				desc: 'Requests, notifications and logging.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Request timeout',
								desc: help(['Seconds to wait for Fieldy before giving up on a request (5–300). Increase it on slow or unstable connections.']),
								control: { type: 'number', key: 'requestTimeoutSeconds', min: 5, max: 300, step: 1 },
							},
							{
								name: 'Retries',
								desc: help([
									'How many times a failed request (network trouble, timeout, temporary Fieldy error) is tried again, waiting a little longer each time. 0 turns retrying off. When Fieldy\'s rate limit is reached, the plugin waits for Fieldy\'s cooldown instead.',
								]),
								control: { type: 'number', key: 'maxRetries', min: 0, max: 10, step: 1 },
							},
							{
								name: 'Request budget',
								aliases: ['rate limit'],
								desc: help([
									'The most requests the plugin sends per minute. Fieldy allows 100 per key; keep some headroom if you also use the same key elsewhere. A lower budget only makes large imports take longer.',
								]),
								control: { type: 'slider', key: 'requestsPerMinute', min: 10, max: 95, step: 5, displayFormat: (v) => `${v}/min` },
							},
							{
								name: 'Notifications for automatic syncs',
								desc: help([
									'Manual syncs always show a summary. Choose how much automatic syncs tell you. Notes you edited are never reported as a problem.',
								]),
								control: { type: 'dropdown', key: 'notices', options: { changes: 'When something changed or failed', errors: 'Only on problems', all: 'After every sync' } },
							},
							{
								name: 'Status bar indicator',
								desc: help(['Shows sync progress and the last result at the bottom of the window (desktop only). Click it to sync.']),
								control: { type: 'toggle', key: 'showStatusBar' },
							},
							{
								name: 'Debug logging',
								desc: help(['Writes technical details of each request to the developer console, to help diagnose problems. Your API key is never logged.']),
								control: { type: 'toggle', key: 'debugLogging' },
							},
						],
					},
				],
			},
			{
				type: 'page',
				name: 'Edited notes and troubleshooting',
				desc: 'Review edited notes, copy diagnostics or reset sync state.',
				items: [
					{
						type: 'group',
						items: [
							{
								name: 'Edited notes',
								aliases: ['conflicts', 'restore', 'original'],
								desc: help([
									'Notes you changed inside their Fieldy section. Sync leaves them as you wrote them. From this list you can view the original Fieldy version or bring it back into a note.',
								]),
								render: (setting: Setting) => {
									setting.addButton((button) => button.setButtonText('Review').onClick(() => new EditedNotesModal(this.app, this.plugin).open()));
								},
							},
							{
								name: 'Keep the transcript in your edited copy',
								aliases: ['keep my edits', 'restore', 'transcript'],
								desc: help(
									['When you restore the Fieldy version and keep your edits, your edited version is copied below the Fieldy section. Turn this off to leave its Transcript section out of that copy: the restored Fieldy section above already has the transcript.'],
									['Leave it on if you edited the transcript itself, or those edits are lost.'],
								),
								control: { type: 'toggle', key: 'keepTranscriptInEditedCopy' },
							},
							{
								name: 'Diagnostics',
								desc: help(['Copies the plugin version, your settings and sync counts, ready to paste into a bug report. Contains no API key, no note content and no conversation titles.']),
								render: (setting: Setting) => {
									setting.addButton((button) =>
										button.setButtonText('Copy diagnostics').onClick(async () => {
											await this.plugin.copyDiagnostics();
										}),
									);
								},
							},
							{
								name: 'Reset sync state',
								desc: help(
									['Makes the plugin forget what it has synced. Use it if syncing seems confused.'],
									['Your notes are not changed and no duplicates are created, because notes are recognised by their fieldy_id. Notes you deleted may be imported again by the next sync.'],
								),
								render: (setting: Setting) => {
									setting.addButton((button) =>
										button
											.setButtonText('Reset')
											.setDestructive()
											.onClick(() => this.confirmReset()),
									);
								},
							},
						],
					},
				],
			},
			{
				type: 'group',
				cls: 'fieldy-support-group',
				items: [
					{
						name: 'Support Fieldy Sync',
						desc: 'If this plugin saves you time, you can support its continued development.',
						searchable: false,
						render: (setting: Setting) => {
							setting.settingEl.addClass('fieldy-support-card');
							const link = setting.controlEl.createEl('a', {
								href: SUPPORT_URL,
								cls: 'fieldy-support-button',
								attr: { target: '_blank', rel: 'noopener noreferrer' },
							});
							setIcon(link.createSpan({ cls: 'fieldy-support-icon' }), 'coffee');
							link.createSpan({ text: 'Buy me a coffee' });
						},
					},
				],
			},
		];
	}

	private confirmReset(): void {
		new ConfirmationModal(this.app)
			.setTitle('Reset sync state?')
			.setContent('The plugin will forget what it has synced. Your notes are not changed. Notes you deleted may be imported again by the next sync.')
			.addButton((button) =>
				button
					.setButtonText('Reset')
					.setDestructive()
					.setCta()
					.onClick(async () => {
						try {
							await this.plugin.resetSyncState();
							new Notice('Sync state was reset. Your notes were not changed.');
						} catch (err) {
							new Notice(describeError(err));
						}
					}),
			)
			.addCancelButton()
			.open();
	}
}
