import { RangeSetBuilder, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
	ConfirmationModal,
	editorInfoField,
	editorLivePreviewField,
	getFrontMatterInfo,
	MarkdownView,
	Menu,
	moment,
	Notice,
	parseYaml,
	setIcon,
	setTooltip,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import { ID_KEY, SYNCED_KEY } from '../markdown/ConversationRenderer';
import type FieldySyncPlugin from '../main';
import { isSyncPaused } from '../sync/SyncEngine';
import { describeError, isCancellation } from '../utils/errors';
import { BANNER_HINTS, BANNER_LABELS, blockLayout, blockStatus, type BannerStatus, type BlockLayout } from './bannerModel';

/**
 * Shows the Fieldy section's markers as status banners (begin and end): in
 * Live Preview through an editor extension, in reading view through a
 * post-processor. The note text is not changed; source mode, other apps and
 * the plugin being off all still show the plain comment markers.
 *
 * Everything shown is read from the note text itself, frontmatter included,
 * never from the metadata cache: the cache can lag behind a note that has just
 * been opened, which showed the raw markers first and then made the note jump.
 */
export function registerNoteBanner(plugin: FieldySyncPlugin): void {
	plugin.registerEditorExtension(bannerViewPlugin(plugin));
	plugin.registerMarkdownPostProcessor((el, ctx) => readingViewBanner(plugin, el, ctx));

	applyBannerColors(plugin);
	plugin.register(() => document.body.setCssProps(Object.fromEntries(COLOR_VARS.map((v) => [v, '']))));
	let shown = plugin.settings.showNoteBanner;
	// A sync can make a note private (or public again): rebuild the banners' status.
	plugin.registerEvent(
		plugin.events.on('sync-finished', () => {
			settingsRevision++;
			plugin.app.workspace.updateOptions();
		}),
	);
	plugin.registerEvent(
		plugin.events.on('settings-changed', () => {
			applyBannerColors(plugin);
			// Date format, on/off: cached banner models are rebuilt on the next editor update.
			settingsRevision++;
			if (plugin.settings.showNoteBanner === shown) {
				plugin.app.workspace.updateOptions();
				return;
			}
			shown = plugin.settings.showNoteBanner;
			refreshAllBanners(plugin);
		}),
	);
}

/** Bumped on every settings change, so cached banner models are rebuilt. */
let settingsRevision = 0;

const COLOR_VARS = [
	'--fieldy-banner-synced',
	'--fieldy-banner-edited',
	'--fieldy-banner-paused',
	'--fieldy-banner-synced-dark',
	'--fieldy-banner-edited-dark',
	'--fieldy-banner-paused-dark',
] as const;

/** Custom banner colours as CSS variables on the body; cleared to fall back to the theme's. */
function applyBannerColors(plugin: FieldySyncPlugin): void {
	const s = plugin.settings;
	const custom = s.bannerColors === 'custom';
	const values = [s.bannerColorSynced, s.bannerColorEdited, s.bannerColorPaused, s.bannerColorSyncedDark, s.bannerColorEditedDark, s.bannerColorPausedDark];
	document.body.setCssProps(Object.fromEntries(COLOR_VARS.map((v, i) => [v, custom ? (values[i] ?? '') : ''])));
}

/** Redraws banners everywhere, after the setting is switched on or off. */
function refreshAllBanners(plugin: FieldySyncPlugin): void {
	plugin.app.workspace.updateOptions();
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
	});
}

interface BannerModel {
	id: string;
	status: BannerStatus;
	syncedAt: string | null;
	/** Which privacy filters match (status `private`). */
	privateReason?: string;
}

/**
 * Everything the banner shows, read from the note text alone (its own
 * frontmatter included). Not waiting for the metadata cache lets the banner
 * be there on the first draw, instead of the raw markers then a jump.
 * Null for notes that are not Fieldy notes or whose markers are broken.
 */
function bannerModel(plugin: FieldySyncPlugin, text: string): BannerModel | null {
	const info = getFrontMatterInfo(text);
	if (!info.exists) return null;
	const yaml = text.slice(info.from, info.to);
	if (!yaml.includes(ID_KEY)) return null;
	let frontmatter: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = parseYaml(yaml);
		if (typeof parsed === 'object' && parsed !== null) frontmatter = parsed as Record<string, unknown>;
	} catch {
		return null; // Invalid YAML: Obsidian does not read these properties either.
	}
	const rawId = frontmatter?.[ID_KEY];
	const id = typeof rawId === 'string' ? rawId.trim() : typeof rawId === 'number' ? String(rawId) : '';
	if (!id) return null;
	const status = blockStatus(text.slice(info.contentStart), yaml, isSyncPaused(frontmatter));
	if (!status) return null;
	const synced = frontmatter?.[SYNCED_KEY];
	const when = typeof synced === 'string' && moment(synced).isValid() ? moment(synced).format(plugin.settings.noteDateFormat) : null;
	const record = plugin.syncState.get(id);
	if (record?.status === 'private') return { id, status: 'private', syncedAt: when, privateReason: record.privateReason };
	return { id, status, syncedAt: when };
}

// ------------------------------------------------------------ banner DOM

function renderBanner(plugin: FieldySyncPlugin, model: BannerModel, position: 'begin' | 'end' = 'begin'): HTMLElement {
	const el = createDiv({ cls: `fieldy-banner is-${model.status}`, attr: { contenteditable: 'false' } });
	const icon = el.createSpan({ cls: 'fieldy-banner-icon' });
	setIcon(icon, position === 'begin' ? 'messages-square' : 'corner-left-up');
	el.createSpan({ cls: 'fieldy-banner-title', text: position === 'begin' ? 'Fieldy' : 'End of the Fieldy section' });
	const chip = el.createSpan({ cls: 'fieldy-banner-status', text: BANNER_LABELS[model.status] });
	setTooltip(chip, model.privateReason ? `${BANNER_HINTS[model.status]} Filter: ${model.privateReason}.` : BANNER_HINTS[model.status]);
	if (position === 'end') el.createSpan({ cls: 'fieldy-banner-meta', text: 'Your own notes go below' });
	else if (model.syncedAt) el.createSpan({ cls: 'fieldy-banner-meta', text: `Synced ${model.syncedAt}` });

	const actions = el.createSpan({ cls: 'fieldy-banner-actions' });
	const button = (iconName: string, label: string, onClick: (evt: MouseEvent) => void) => {
		const b = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
		setIcon(b, iconName);
		setTooltip(b, label);
		b.addEventListener('mousedown', (evt) => evt.preventDefault());
		b.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onClick(evt);
		});
	};
	button('panel-right', 'Show in the Fieldy panel', () => void plugin.showFieldyVersion(model.id));
	if (model.status === 'synced') button('refresh-cw', 'Refresh from Fieldy', () => void plugin.refreshNote(model.id));
	if (model.status === 'edited') button('rotate-ccw', 'Restore the Fieldy version…', (evt) => restoreMenu(plugin, model, evt));
	return el;
}

/** The closing banner: same colours and actions, marking where the user's own notes start. */
function renderEnd(plugin: FieldySyncPlugin, model: BannerModel): HTMLElement {
	const el = renderBanner(plugin, model, 'end');
	el.addClass('fieldy-banner-end');
	return el;
}

function restoreMenu(plugin: FieldySyncPlugin, model: BannerModel, evt: MouseEvent): void {
	const restore = async (choice: 'keep-both' | 'overwrite') => {
		try {
			await plugin.restoreFieldyVersion(model.id, choice);
			new Notice(choice === 'keep-both' ? 'Fieldy version restored; your edits are kept below it.' : 'Fieldy version restored.');
		} catch (err) {
			if (!isCancellation(err)) new Notice(describeError(err));
		}
	};
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle('Restore Fieldy version, keep my edits below it')
			.setIcon('copy-plus')
			.onClick(() => void restore('keep-both')),
	);
	menu.addItem((item) =>
		item
			.setTitle('Restore Fieldy version, discard my edits…')
			.setIcon('rotate-ccw')
			.setWarning(true)
			.onClick(() =>
				new ConfirmationModal(plugin.app)
					.setTitle('Discard your edits?')
					.setContent('The Fieldy section of this note will be replaced by the latest version from Fieldy, and your edits inside it will be lost. Text outside the Fieldy section is not affected.')
					.addButton((b) =>
						b
							.setButtonText('Restore and discard')
							.setDestructive()
							.setCta()
							.onClick(() => restore('overwrite')),
					)
					.addCancelButton()
					.open(),
			),
	);
	menu.showAtMouseEvent(evt);
}

// ------------------------------------------------------------ Live Preview

class BannerWidget extends WidgetType {
	constructor(
		protected readonly plugin: FieldySyncPlugin,
		protected readonly model: BannerModel,
	) {
		super();
	}

	override eq(other: BannerWidget): boolean {
		if (other.constructor !== this.constructor) return false;
		const a = this.model;
		const b = other.model;
		return a.id === b.id && a.status === b.status && a.syncedAt === b.syncedAt;
	}

	toDOM(): HTMLElement {
		return renderBanner(this.plugin, this.model);
	}

	/** Close to the drawn height, so lines below are placed right before the banner is measured. */
	override get estimatedHeight(): number {
		return 36;
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

class EndWidget extends BannerWidget {
	override toDOM(): HTMLElement {
		return renderEnd(this.plugin, this.model);
	}
}

/** Layout and model of one note text; null model for non-Fieldy notes or broken markers. */
interface NoteBanners {
	layout: BlockLayout | null;
	model: BannerModel | null;
}

function analyse(plugin: FieldySyncPlugin, text: string): NoteBanners {
	const model = plugin.settings.showNoteBanner ? bannerModel(plugin, text) : null;
	return { model, layout: model ? blockLayout(text.split('\n')) : null };
}

/** Transactions that mean the user placed the cursor or typed (not Obsidian opening the note). */
const USER_EVENTS = ['select', 'input', 'delete', 'move', 'undo', 'redo'] as const;

function currentPath(view: EditorView): string | null {
	return view.state.field(editorInfoField, false)?.file?.path ?? null;
}

interface TaskIdRange {
	/** 1-based line number. */
	line: number;
	from: number;
	to: number;
}

const TASK_ID_MARKER = / ?%%fieldy-task:[A-Za-z0-9_-]+%%/g;

/** The hidden task id comments between two 1-based marker lines, with the space before each. */
function taskIdRanges(doc: Text, beginLine: number, endLine: number): TaskIdRange[] {
	const ranges: TaskIdRange[] = [];
	for (let n = beginLine + 1; n < endLine; n++) {
		const line = doc.line(n);
		if (!line.text.includes('%%fieldy-task:')) continue;
		for (const m of line.text.matchAll(TASK_ID_MARKER)) {
			ranges.push({ line: n, from: line.from + (m.index ?? 0), to: line.from + (m.index ?? 0) + m[0].length });
		}
	}
	return ranges;
}

/** Lines read looking for the end of the properties before giving up on the shortcut. */
const MAX_FRONTMATTER_LINES = 300;

/** False only when the note certainly has no `fieldy_id` property (no properties, or none naming it). */
function mayBeFieldyNote(doc: Text): boolean {
	if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return false;
	const last = Math.min(doc.lines, MAX_FRONTMATTER_LINES);
	for (let n = 2; n <= last; n++) {
		const text = doc.line(n).text;
		if (text.includes(ID_KEY)) return true;
		const trimmed = text.trimEnd();
		if (trimmed === '---' || trimmed === '...') return false;
	}
	return last < doc.lines; // Very long properties: let the full check decide.
}

function bannerViewPlugin(plugin: FieldySyncPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			/** Recomputed only when the text or the settings change, not on every cursor move. */
			private doc: Text | null = null;
			private revision = -1;
			private banners: NoteBanners = { layout: null, model: null };
			/** Where the hidden task ids sit, found once per document version (not on every cursor move). */
			private taskIds: TaskIdRange[] = [];
			/** The note shown in this editor; the editor is reused when another note is opened in its tab. */
			private path: string | null = null;
			/**
			 * Whether the user has placed the cursor themselves since the note was opened.
			 * Until then a marker line under the cursor (where Obsidian puts it on open)
			 * stays a banner, and the cursor is moved off it.
			 */
			private userMoved = false;
			private destroyed = false;

			constructor(view: EditorView) {
				this.path = currentPath(view);
				this.decorations = this.build(view);
				this.leaveMarkerLine(view);
			}

			update(update: ViewUpdate): void {
				const path = currentPath(update.view);
				const opened = path !== this.path;
				if (opened) {
					this.path = path;
					this.userMoved = false;
				}
				if (update.transactions.some((tr) => USER_EVENTS.some((e) => tr.isUserEvent(e)))) this.userMoved = true;
				// Scrolling, focus and resizing do not move the markers: keep the decorations (no relayout, no jump).
				const livePreviewToggled = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
				if (!opened && !update.docChanged && !update.selectionSet && !livePreviewToggled && this.revision === settingsRevision) return;
				this.decorations = this.build(update.view);
				if (!this.userMoved) this.leaveMarkerLine(update.view);
			}

			destroy(): void {
				this.destroyed = true;
			}

			private markerLines(view: EditorView): { begin: number; end: number } | null {
				const { layout, model } = this.banners;
				if (!layout || !model || !view.state.field(editorLivePreviewField, false)) return null;
				return { begin: layout.begin + 1, end: layout.end + 1 };
			}

			/**
			 * Moves a cursor Obsidian placed on a marker line to the start of the user's
			 * own notes, below the section, without scrolling. Typing on a hidden marker
			 * line would otherwise break the marker. Done after the update, as an editor
			 * update cannot dispatch another one.
			 */
			private leaveMarkerLine(view: EditorView): void {
				const lines = this.markerLines(view);
				if (!lines) return;
				const doc = view.state.doc;
				const head = doc.lineAt(view.state.selection.main.head).number;
				if (view.state.selection.ranges.length !== 1 || (head !== lines.begin && head !== lines.end)) return;
				if (lines.end >= doc.lines) return; // No line below the section to go to.
				const target = doc.line(lines.end + 1).from;
				window.setTimeout(() => {
					if (this.destroyed || this.userMoved || view.state.doc !== doc) return;
					view.dispatch({ selection: { anchor: target } });
				}, 0);
			}

			private build(view: EditorView): DecorationSet {
				const doc = view.state.doc;
				if (doc !== this.doc || this.revision !== settingsRevision) {
					this.doc = doc;
					this.revision = settingsRevision;
					// Most notes are not Fieldy notes: tell from the properties alone, without copying the whole text on every keystroke.
					this.banners = mayBeFieldyNote(doc) ? analyse(plugin, doc.toString()) : { layout: null, model: null };
					this.taskIds = this.banners.layout ? taskIdRanges(doc, this.banners.layout.begin + 1, this.banners.layout.end + 1) : [];
				}
				const lines = this.markerLines(view);
				const model = this.banners.model;
				if (!lines || !model) return Decoration.none;

				// Once the user puts the cursor on a marker line, it shows as plain text so it can be edited.
				const touched = (line: number) =>
					this.userMoved && view.state.selection.ranges.some((r) => doc.lineAt(r.from).number <= line && doc.lineAt(r.to).number >= line);
				const builder = new RangeSetBuilder<Decoration>();
				const begin = doc.line(lines.begin);
				const end = doc.line(lines.end);
				if (!touched(begin.number)) builder.add(begin.from, begin.to, Decoration.replace({ widget: new BannerWidget(plugin, model) }));
				// Hidden task ids (%%fieldy-task:…%%) are noise in Live Preview; shown again on the line being edited.
				for (const id of this.taskIds) if (!touched(id.line)) builder.add(id.from, id.to, Decoration.replace({}));
				if (!touched(end.number)) builder.add(end.from, end.to, Decoration.replace({ widget: new EndWidget(plugin, model) }));
				return builder.finish();
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

// ------------------------------------------------------------ reading view

/** One-entry cache: every section of a note is post-processed with the same full text. */
let cachedText: string | null = null;
let cachedRevision = -1;
let cached: NoteBanners = { layout: null, model: null };

function readingViewBanner(plugin: FieldySyncPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	if (!plugin.settings.showNoteBanner) return;
	const info = ctx.getSectionInfo(el);
	if (!info) return;
	if (info.text !== cachedText || cachedRevision !== settingsRevision) {
		cachedText = info.text;
		cachedRevision = settingsRevision;
		cached = analyse(plugin, info.text);
	}
	const { layout, model } = cached;
	if (!layout || !model || layout.first === null || layout.last === null) return;
	const inSection = (line: number) => info.lineStart <= line && line <= info.lineEnd;
	if (inSection(layout.first)) el.prepend(renderBanner(plugin, model));
	if (inSection(layout.last)) el.append(renderEnd(plugin, model));
}
