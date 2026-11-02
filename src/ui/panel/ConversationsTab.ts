import { Component, ConfirmationModal, debounce, MarkdownRenderer, MarkdownView, Menu, moment, Notice, setIcon, setTooltip } from 'obsidian';
import type { RestoreChoice } from '../../sync/SyncEngine';
import { RECORDING_SOURCES, type FieldyConversation, type Page, type RecordingSource, type TaskStatus } from '../../api/types';
import {
	detailsLines,
	displayTitle,
	locationText,
	metadataLines,
	quoteLines,
	SNIPPET_LABELS,
	summaryLines,
	type SnippetKind,
} from '../../markdown/ConversationRenderer';
import { sleep } from '../../utils/async';
import { durationMinutes, formatDuration, HISTORY_START_ISO } from '../../utils/dates';
import { describeError, isCancellation } from '../../utils/errors';
import { FIELDY_REFERRAL_URL } from '../../settings/settings';
import type { LocalStatus } from '../../main';
import { obsidianEventLine, obsidianTaskLine } from '../../markdown/obsidianTasks';
import { readTasksFormat, tasksPluginEnabled } from '../tasksPlugin';
import { copyToClipboard, insertIntoLastNote } from './editorActions';
import type { FieldyView } from './FieldyView';
import {
	activeFilterCount,
	emptyFilters,
	filterOptions,
	matchesFilters,
	nextContentRule,
	TIME_OF_DAY_LABELS,
	type PanelFilters,
	type RowStatus,
	type TimeOfDay,
} from './filters';
import {
	conversationIndicators,
	INDICATOR_ICONS,
	INDICATOR_NAMES,
	INDICATOR_ORDER,
	mapLinks,
	SOURCE_ICONS,
	SOURCE_LABELS,
	sourceIndicator,
	type Indicator,
	type IndicatorKey,
} from './indicators';

/** What clicking each card icon copies, as named in its tooltip and menu. */
const INDICATOR_COPY_NAMES: Record<IndicatorKey, string> = {
	brief: 'the overview',
	summary: 'the summary',
	details: 'the full memory content',
	tasks: 'the tasks',
	quotes: 'the quotes',
	link: 'the share link',
	location: 'the location',
	calendar: 'the calendar event',
};

interface SyncedSets {
	created: ReadonlySet<string>;
	updated: ReadonlySet<string>;
}

type RangeKey = 'today' | '3' | '7' | '14' | '30' | '90' | '365' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = {
	today: 'Today',
	'3': 'Last 3 days',
	'7': 'Last 7 days',
	'14': 'Last 14 days',
	'30': 'Last 30 days',
	'90': 'Last 90 days',
	'365': 'Last 12 months',
	all: 'Entire history',
};

const STATUS_LABELS: Record<RowStatus, string> = {
	imported: 'In vault',
	new: 'Not imported',
	edited: 'Edited',
	paused: 'Paused',
	deleted: 'Deleted from vault',
	locked: 'Locked',
};

const STATUS_HINTS: Record<RowStatus, string> = {
	imported: 'This conversation has a note in your vault.',
	new: 'No note yet. Use the note button to create one, or insert pieces into any note.',
	edited: 'You changed this note in Obsidian, so sync leaves it as you wrote it. Expanding it here shows the Fieldy version; the ↺ button brings it back into the note.',
	paused: 'This note has fieldy_sync: false, so it is never updated.',
	deleted: 'A note was imported before and later deleted. Creating it again is possible.',
	locked: 'Outside your Fieldy plan\'s history window: Fieldy does not provide its content.',
};

const SNIPPET_ICONS: Record<SnippetKind, string> = {
	overview: 'info',
	summary: 'align-left',
	details: 'file-text',
	tasks: 'list-checks',
	quotes: 'quote',
	transcript: 'message-square-text',
	full: 'files',
};

const SNIPPET_ORDER: SnippetKind[] = ['summary', 'tasks', 'quotes', 'transcript', 'details', 'overview', 'full'];
const TRANSCRIPT_PREVIEW_LINES = 60;
/** Background share-link checks: one every 2 s (at most 30 per minute), pausing while busy. */
const LINK_CHECK_SPACING_MS = 2_000;
const LINK_CHECK_BACKOFF_MS = 5_000;
/** Cards drawn at a time; more are added as the list is scrolled to its end. */
const RENDER_BATCH = 100;
const SEARCH_DELAY_MS = 150;

/**
 * Makes a card element act as a button: click (or Enter/Space) runs `onClick`,
 * right-click runs `onMenu`. Events stop here, so the card does not open or close.
 */
function actionable(el: HTMLElement, onClick: () => void, onMenu?: (evt: MouseEvent) => void): void {
	el.addClass('is-actionable');
	el.addEventListener('click', (evt) => {
		evt.stopPropagation();
		onClick();
	});
	el.addEventListener('keydown', (evt) => {
		if (evt.key !== 'Enter' && evt.key !== ' ') return;
		evt.preventDefault();
		evt.stopPropagation();
		onClick();
	});
	if (onMenu) {
		el.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onMenu(evt);
		});
	}
}

/** The panel's message while no API key is set, with the referral link for people without Fieldy. */
export function noKeyMessage(el: HTMLElement, purpose: string): void {
	el.setText(`Add your Fieldy API key in the plugin settings to ${purpose}. No Fieldy account yet? `);
	el.createEl('a', { text: 'Get Fieldy with $30 off', href: FIELDY_REFERRAL_URL, attr: { target: '_blank', rel: 'noopener noreferrer' } });
	el.appendText(' (the developer\'s referral link).');
}

export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLButtonElement {
	const button = parent.createEl('button', { cls: 'clickable-icon fieldy-icon-button', attr: { 'aria-label': label } });
	setIcon(button, icon);
	setTooltip(button, label);
	button.addEventListener('click', (evt) => {
		evt.stopPropagation();
		onClick(evt);
	});
	return button;
}

/**
 * Browse Fieldy conversations and pick exactly what you need from each one:
 * open or create its note, or copy/insert any single piece (summary, tasks,
 * quotes, transcript...) without running a sync.
 */
export class ConversationsTab {
	private range: RangeKey = '7';
	private search = '';
	private filters: PanelFilters = emptyFilters();
	private filtersOpen = false;
	private items: FieldyConversation[] = [];
	private readonly byId = new Map<string, FieldyConversation>();
	/** Cards on screen, by conversation id, with what they were drawn from (redrawn only when that changes). */
	private readonly rowEls = new Map<string, HTMLElement>();
	private readonly rowKeys = new Map<string, string>();
	/** How many matching cards are drawn. */
	private shown = RENDER_BATCH;
	/** Share links are checked for cards that come into view, not for every loaded conversation. */
	private rowObserver: IntersectionObserver | null = null;
	private moreObserver: IntersectionObserver | null = null;
	private syncedCache: { run: unknown; sets: SyncedSets } | null = null;
	private readonly debouncedRender = debounce(() => this.renderList(), SEARCH_DELAY_MS, true);
	private pager: AsyncGenerator<Page<FieldyConversation>> | null = null;
	private exhausted = false;
	private loading = false;
	private loaded = false;
	private generation = 0;
	private paths = new Map<string, string>();
	private statuses = new Map<string, LocalStatus>();
	private readonly expanded = new Set<string>();
	private readonly bodies = new Map<string, Component>();
	/** Number of Fieldy tasks per conversation; undefined until loaded. */
	private taskCounts: Map<string, number> | undefined;
	/** Whether a conversation has an active share link; missing until checked. */
	private readonly linkStates = new Map<string, boolean>();
	private linkQueue: string[] = [];
	private linkPumping = false;
	private readonly indicatorEls = new Map<string, Map<IndicatorKey, HTMLElement>>();
	/** Where each conversation was recorded (Fieldy only filters by source, so it is looked up per source). */
	private readonly sources = new Map<string, Set<RecordingSource>>();
	/** Oldest start time whose recording sources are known; null when none are. */
	private sourcesCheckedFrom: string | null = null;
	private sourcesPumping = false;
	private readonly sourceEls = new Map<string, HTMLElement>();

	private listEl!: HTMLElement;
	private contentFiltersEl!: HTMLElement;
	private filterBarEl!: HTMLElement;
	private filterButton!: HTMLButtonElement;
	private footerEl!: HTMLElement;
	private infoEl!: HTMLElement;

	constructor(
		private readonly root: HTMLElement,
		private readonly view: FieldyView,
	) {}

	private get plugin() {
		return this.view.plugin;
	}

	render(): void {
		this.root.empty();
		const toolbar = this.root.createDiv({ cls: 'fieldy-panel-toolbar' });
		const select = toolbar.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Period' } });
		for (const [key, label] of Object.entries(RANGE_LABELS)) select.createEl('option', { value: key, text: label });
		select.value = this.range;
		select.addEventListener('change', () => {
			this.range = select.value as RangeKey;
			void this.reload();
		});
		const search = toolbar.createEl('input', { type: 'search', cls: 'fieldy-panel-search', placeholder: 'Search title, summary, people…' });
		search.value = this.search;
		search.addEventListener('input', () => {
			this.search = search.value.trim().toLowerCase();
			this.shown = RENDER_BATCH;
			this.debouncedRender();
		});
		this.filterButton = iconButton(toolbar, 'filter', 'Filters', () => {
			this.filtersOpen = !this.filtersOpen;
			this.renderFilterBar();
		});
		iconButton(toolbar, 'refresh-ccw', 'Reload from Fieldy', () => void this.reload());

		this.contentFiltersEl = this.root.createDiv({ cls: 'fieldy-filter-icons' });
		this.filterBarEl = this.root.createDiv({ cls: 'fieldy-filter-bar' });
		this.infoEl = this.root.createDiv({ cls: 'fieldy-panel-info' });
		this.forgetRows();
		this.listEl = this.root.createDiv({ cls: 'fieldy-conv-list' });
		this.footerEl = this.root.createDiv({ cls: 'fieldy-panel-footer' });
		this.observeRows();
		if (this.loaded) this.renderList();
		else void this.reload();
	}

	/** Called when the tab becomes visible. */
	onShow(): void {
		if (!this.loaded && !this.loading) void this.reload();
	}

	private rangeStart(): string {
		if (this.range === 'all') return HISTORY_START_ISO;
		if (this.range === 'today') return moment().startOf('day').toISOString();
		return moment().subtract(Number(this.range), 'days').toISOString();
	}

	async reload(): Promise<void> {
		this.generation++;
		this.items = [];
		this.byId.clear();
		this.exhausted = false;
		this.loaded = false;
		this.shown = RENDER_BATCH;
		this.expanded.clear();
		this.forgetRows();
		if (!this.plugin.hasApiKey()) {
			this.loaded = true;
			this.renderList();
			return;
		}
		const source = this.plugin.settings.recordingSource;
		this.pager = this.plugin.client.iterateConversations(
			{ startTime: this.rangeStart(), endTime: new Date().toISOString(), recordingSource: source === 'all' ? undefined : source },
			{ signal: this.view.data.signal },
		);
		this.linkQueue = [];
		this.sources.clear();
		this.sourcesCheckedFrom = null;
		void this.loadTaskCounts();
		await this.loadMore();
	}

	// ------------------------------------------------------ content icons

	private async loadTaskCounts(): Promise<void> {
		try {
			const tasks = await this.view.data.allTasks();
			const counts = new Map<string, number>();
			for (const task of tasks) {
				if (task.memoryId) counts.set(task.memoryId, (counts.get(task.memoryId) ?? 0) + 1);
			}
			this.taskCounts = counts;
			// An active tasks filter changes which cards match, not just their icons.
			if (this.filters.content.tasks) this.renderList();
			else for (const id of this.indicatorEls.keys()) this.updateIndicators(id);
		} catch {
			// Leave the task icons as "unknown"; the Tasks tab reports errors.
		}
	}

	/** Checks share links in the background, one at a time, without crowding out other requests. */
	private queueLinkChecks(ids: readonly string[], first = false): void {
		const pending = ids.filter((id) => !this.linkStates.has(id));
		const added = new Set(pending);
		if (first) this.linkQueue = [...pending, ...this.linkQueue.filter((id) => !added.has(id))];
		else {
			const queued = new Set(this.linkQueue);
			this.linkQueue.push(...pending.filter((id) => !queued.has(id)));
		}
		void this.pumpLinkChecks();
	}

	private async pumpLinkChecks(): Promise<void> {
		if (this.linkPumping) return;
		this.linkPumping = true;
		const signal = this.view.data.signal;
		try {
			while (this.linkQueue.length > 0 && !signal.aborted) {
				// Syncs and the user's own actions come first.
				if (this.plugin.engine.isRunning || this.plugin.rateLimiterBusy) {
					await sleep(LINK_CHECK_BACKOFF_MS, signal);
					continue;
				}
				const id = this.linkQueue.shift();
				if (!id || this.linkStates.has(id)) continue;
				try {
					const links = await this.view.data.sharables(id);
					this.linkStates.set(id, links.some((l) => l.enabled));
					if (this.filters.content.link) this.renderList();
					else this.updateIndicators(id);
				} catch (err) {
					// Stop on any failure (offline, invalid key...) instead of retrying every card.
					if (!isCancellation(err)) this.linkQueue = [];
					return;
				}
				await sleep(LINK_CHECK_SPACING_MS, signal);
			}
		} catch {
			// Cancelled because the panel closed.
		} finally {
			this.linkPumping = false;
		}
	}

	private sourcesOf(c: FieldyConversation): ReadonlySet<RecordingSource> | undefined {
		// With a recording-source setting, everything loaded comes from that source.
		const only = this.plugin.settings.recordingSource;
		if (only !== 'all') return new Set([only]);
		const known = this.sources.get(c.id);
		if (known) return known;
		return this.sourcesCheckedFrom !== null && c.startTime >= this.sourcesCheckedFrom ? new Set() : undefined;
	}

	/**
	 * Fieldy's conversations carry no source, but the list can be filtered by
	 * one: list the loaded period once per source (a page holds 50, so a week
	 * usually costs three requests), only for periods not checked yet.
	 */
	private async checkSources(): Promise<void> {
		if (this.plugin.settings.recordingSource !== 'all' || this.sourcesPumping || this.items.length === 0) return;
		const oldest = this.items.reduce((min, c) => (c.startTime < min ? c.startTime : min), this.items[0]?.startTime ?? '');
		if (this.sourcesCheckedFrom !== null && oldest >= this.sourcesCheckedFrom) return;
		const end = this.sourcesCheckedFrom ?? new Date().toISOString();
		const generation = this.generation;
		const signal = this.view.data.signal;
		this.sourcesPumping = true;
		try {
			for (const source of RECORDING_SOURCES) {
				while (this.plugin.engine.isRunning || this.plugin.rateLimiterBusy) await sleep(LINK_CHECK_BACKOFF_MS, signal);
				for await (const page of this.plugin.client.iterateConversations({ startTime: oldest, endTime: end, recordingSource: source, pageSize: 50 }, { signal })) {
					if (generation !== this.generation) return;
					for (const c of page.items) {
						const set = this.sources.get(c.id) ?? new Set<RecordingSource>();
						set.add(source);
						this.sources.set(c.id, set);
					}
				}
				this.plugin.reportRequestOutcome();
			}
			if (generation !== this.generation) return;
			this.sourcesCheckedFrom = oldest;
			if (this.filters.source) this.renderList();
			else for (const id of this.sourceEls.keys()) this.updateSource(id);
		} catch (err) {
			// Leave the icons as "checking"; a reload tries again.
			if (!isCancellation(err)) this.plugin.reportRequestOutcome(err);
			return;
		} finally {
			this.sourcesPumping = false;
		}
		// Older conversations were loaded meanwhile.
		void this.checkSources();
	}

	private updateSource(id: string): void {
		const el = this.sourceEls.get(id);
		const conversation = this.byId.get(id);
		if (!el || !conversation) return;
		const source = sourceIndicator(this.sourcesOf(conversation));
		el.empty();
		for (const icon of source.icons) setIcon(el.createSpan({ cls: 'fieldy-ind-source-icon' }), icon);
		el.removeClass('is-on', 'is-off', 'is-unknown');
		el.addClass(`is-${source.state}`);
		const sources = this.sourcesOf(conversation);
		const filterable = this.plugin.settings.recordingSource === 'all' && sources?.size === 1;
		const hint = filterable ? `${source.label}. Click to show only these (again for any source).` : source.label;
		el.setAttribute('aria-label', hint);
		setTooltip(el, hint);
	}

	private indicatorsFor(c: FieldyConversation): Indicator[] {
		return conversationIndicators(c, this.taskCounts?.get(c.id) ?? (this.taskCounts ? 0 : undefined), this.linkStates.get(c.id));
	}

	private renderIndicators(el: HTMLElement, c: FieldyConversation): void {
		const source = el.createSpan({ cls: 'fieldy-ind fieldy-ind-source', attr: { role: 'button', tabindex: '0' } });
		actionable(source, () => this.toggleSourceFilter(c));
		this.sourceEls.set(c.id, source);
		this.updateSource(c.id);
		const els = new Map<IndicatorKey, HTMLElement>();
		for (const indicator of this.indicatorsFor(c)) {
			const icon = el.createSpan({ cls: `fieldy-ind fieldy-ind-${indicator.key}`, attr: { role: 'button', tabindex: '0' } });
			setIcon(icon, indicator.icon);
			// The state is read at click time: tasks and share links are checked after the card is drawn.
			const current = () => this.indicatorsFor(c).find((i) => i.key === indicator.key) ?? indicator;
			actionable(
				icon,
				() => {
					const now = current();
					if (now.state === 'off') new Notice(now.label);
					else void this.deliverIndicator(c, now.key, 'copy');
				},
				(evt) => this.indicatorMenu(evt, c, current()),
			);
			els.set(indicator.key, icon);
		}
		this.indicatorEls.set(c.id, els);
		this.updateIndicators(c.id);
	}

	/** Refreshes one card's icons in place (no re-render, so open sections stay open). */
	private updateIndicators(id: string): void {
		const els = this.indicatorEls.get(id);
		const conversation = this.byId.get(id);
		if (!els || !conversation) return;
		for (const indicator of this.indicatorsFor(conversation)) {
			const el = els.get(indicator.key);
			if (!el) continue;
			el.removeClass('is-on', 'is-off', 'is-unknown');
			el.addClass(`is-${indicator.state}`);
			const hint = indicator.state === 'off' ? indicator.label : `${indicator.label}. Click to copy ${INDICATOR_COPY_NAMES[indicator.key]}; right-click for more.`;
			el.setAttribute('aria-label', hint);
			setTooltip(el, hint);
		}
	}

	private async loadMore(): Promise<void> {
		if (!this.pager || this.loading || this.exhausted) return;
		const generation = this.generation;
		this.loading = true;
		this.renderFooter();
		try {
			const next = await this.pager.next();
			if (generation !== this.generation) return;
			if (next.done) this.exhausted = true;
			else {
				const fresh = next.value.items.filter((c) => !this.byId.has(c.id));
				this.items.push(...fresh);
				for (const c of fresh) this.byId.set(c.id, c);
				this.view.data.remember(fresh);
				// The share-link filter needs every loaded card checked; otherwise only cards that come into view are.
				if (this.filters.content.link) this.queueLinkChecks(fresh.filter((c) => !c.locked).map((c) => c.id));
				void this.checkSources();
				if (!next.value.items.length) this.exhausted = true;
			}
			this.plugin.reportRequestOutcome();
			await this.refreshLocal(false);
		} catch (err) {
			if (generation !== this.generation || isCancellation(err)) return;
			this.plugin.reportRequestOutcome(err);
			this.infoEl.setText(describeError(err));
			this.exhausted = true;
		} finally {
			if (generation === this.generation) {
				this.loading = false;
				this.loaded = true;
				this.renderList();
			}
		}
	}

	/** Re-reads which conversations have notes (after syncs or vault changes). */
	async refreshLocal(render = true): Promise<void> {
		const ids = this.items.map((c) => c.id);
		({ statuses: this.statuses, paths: this.paths } = await this.plugin.localIndex(ids));
		if (render) this.renderList();
	}

	/** Brings a conversation into view (used by the Tasks tab). */
	async show(conversationId: string): Promise<void> {
		let conversation = this.byId.get(conversationId) ?? this.view.data.conversations.get(conversationId);
		if (!conversation) {
			try {
				conversation = (await this.plugin.client.getConversation(conversationId, { signal: this.view.data.signal })) ?? undefined;
				this.plugin.reportRequestOutcome();
			} catch (err) {
				if (!isCancellation(err)) new Notice(describeError(err));
				return;
			}
		}
		if (!conversation) {
			new Notice('This conversation no longer exists in Fieldy.');
			return;
		}
		if (!this.byId.has(conversationId)) {
			this.items.unshift(conversation);
			this.byId.set(conversation.id, conversation);
			this.view.data.remember([conversation]);
			await this.refreshLocal(false);
		}
		this.search = '';
		this.filters = emptyFilters();
		this.expanded.add(conversationId);
		// Far down the list: draw enough cards to reach it.
		this.shown = Math.max(RENDER_BATCH, this.items.findIndex((c) => c.id === conversationId) + 1);
		this.render();
		this.listEl.querySelector(`[data-id="${CSS.escape(conversationId)}"]`)?.scrollIntoView({ block: 'start' });
	}

	private status(c: FieldyConversation): RowStatus {
		if (c.locked) return 'locked';
		return this.statuses.get(c.id) ?? 'new';
	}

	private matches(c: FieldyConversation): boolean {
		if (!matchesFilters(c, this.indicatorsFor(c), this.status(c), this.filters, this.sourcesOf(c))) return false;
		if (!this.search) return true;
		const haystack = [c.title, c.summary, ...c.keywords, ...c.speakers].join(' ').toLowerCase();
		return haystack.includes(this.search);
	}

	/** Unloads one card's body and forgets its elements (before it is redrawn or removed). */
	private dropRow(id: string): void {
		const body = this.bodies.get(id);
		if (body) this.view.removeChild(body);
		this.bodies.delete(id);
		this.indicatorEls.delete(id);
		this.sourceEls.delete(id);
		const el = this.rowEls.get(id);
		if (el) this.rowObserver?.unobserve(el);
		this.rowEls.delete(id);
		this.rowKeys.delete(id);
	}

	private forgetRows(): void {
		for (const id of [...this.rowEls.keys()]) this.dropRow(id);
		for (const component of this.bodies.values()) this.view.removeChild(component);
		this.bodies.clear();
		this.listEl?.empty();
	}

	/** Watches cards coming into view (share-link checks) and the end of the list (draws the next batch). */
	private observeRows(): void {
		this.rowObserver?.disconnect();
		this.moreObserver?.disconnect();
		this.rowObserver = new IntersectionObserver((entries) => {
			const ids: string[] = [];
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const id = (entry.target as HTMLElement).dataset.id;
				const c = id ? this.byId.get(id) : undefined;
				if (c && !c.locked) ids.push(c.id);
				this.rowObserver?.unobserve(entry.target);
			}
			if (ids.length > 0) this.queueLinkChecks(ids);
		});
		this.moreObserver = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			this.shown += RENDER_BATCH;
			this.renderList();
		});
	}

	/** Stops watching (the panel closed). */
	disconnect(): void {
		this.rowObserver?.disconnect();
		this.moreObserver?.disconnect();
	}

	/** What a card shows besides its icons (which update in place); a change redraws it. */
	private rowKey(c: FieldyConversation, synced: SyncedSets): string {
		const mark = synced.created.has(c.id) ? 'new' : synced.updated.has(c.id) ? 'updated' : '';
		return [this.status(c), this.paths.get(c.id) ?? '', mark, this.expanded.has(c.id) ? 'open' : ''].join('|');
	}

	/** The last sync's created and updated ids as sets (rebuilt only when another sync finished). */
	private syncedSets(): SyncedSets {
		const lastRun = this.plugin.syncState.lastRun;
		if (!this.syncedCache || this.syncedCache.run !== lastRun) {
			this.syncedCache = { run: lastRun, sets: { created: new Set(lastRun?.createdIds), updated: new Set(lastRun?.updatedIds) } };
		}
		return this.syncedCache.sets;
	}

	/**
	 * Shows the matching cards in order. Cards already on screen are kept as
	 * they are (open sections and loaded transcripts too) unless what they
	 * show changed; only new ones are drawn.
	 */
	private renderList(): void {
		if (!this.listEl) return;
		this.infoEl.empty();
		this.renderFilterBar();
		if (!this.plugin.hasApiKey()) {
			this.forgetRows();
			noKeyMessage(this.infoEl, 'browse your conversations here');
			this.renderFooter();
			return;
		}
		const visible = this.items.filter((c) => this.matches(c));
		if (this.loaded && this.items.length === 0) {
			this.infoEl.setText(`No conversations in this period (${RANGE_LABELS[this.range].toLowerCase()}). Try a longer period.`);
		} else if (this.isFiltering() && visible.length === 0) {
			this.infoEl.setText('No loaded conversation matches your search and filters. Load older conversations to search further back.');
		} else if (this.isFiltering()) {
			this.infoEl.setText(`${visible.length} of ${this.items.length} loaded conversations match.`);
		}
		this.placeRows(visible.slice(0, this.shown));
		const hidden = visible.length - this.shown;
		if (hidden > 0) {
			const more = this.listEl.createEl('button', { cls: 'fieldy-conv-more', text: `Show ${Math.min(RENDER_BATCH, hidden)} more (${hidden} not shown yet)` });
			more.addEventListener('click', () => {
				this.shown += RENDER_BATCH;
				this.renderList();
			});
			this.moreObserver?.observe(more);
		}
		this.renderFooter();
	}

	/** Puts these cards in this order, reusing the ones already drawn. */
	private placeRows(rows: readonly FieldyConversation[]): void {
		this.moreObserver?.disconnect();
		this.listEl.querySelectorAll(':scope > .fieldy-conv-more').forEach((el) => el.remove());
		const wanted = new Set(rows.map((c) => c.id));
		for (const id of [...this.rowEls.keys()]) {
			if (wanted.has(id)) continue;
			this.rowEls.get(id)?.remove();
			this.dropRow(id);
		}
		const synced = this.syncedSets();
		let cursor: ChildNode | null = this.listEl.firstChild;
		for (const c of rows) {
			let el = this.rowEls.get(c.id);
			if (el && this.rowKeys.get(c.id) !== this.rowKey(c, synced)) {
				const old = el;
				this.dropRow(c.id);
				el = this.renderRow(c, old);
			} else if (!el) {
				el = this.renderRow(c);
			}
			if (el === cursor) cursor = el.nextSibling;
			else this.listEl.insertBefore(el, cursor);
		}
	}

	private isFiltering(): boolean {
		return this.search !== '' || activeFilterCount(this.filters) > 0;
	}

	/** Always-visible icon buttons matching the card icons: any → only with it → only without it. */
	private renderContentFilters(): void {
		if (!this.contentFiltersEl) return;
		const icons = this.contentFiltersEl;
		icons.empty();
		for (const key of INDICATOR_ORDER) {
			const rule = this.filters.content[key];
			const name = INDICATOR_NAMES[key];
			const hint =
				rule === 'has' ? `${name}: only with it (click for only without)`
				: rule === 'lacks' ? `${name}: only without it (click for any)`
				: `${name}: any (click for only with it)`;
			const button = iconButton(icons, INDICATOR_ICONS[key], hint, () => {
				const next = nextContentRule(this.filters.content[key]);
				if (next) this.filters.content[key] = next;
				else delete this.filters.content[key];
				// Filtering by share link needs every loaded conversation checked, not only those seen so far.
				if (key === 'link' && next) this.queueLinkChecks(this.items.filter((c) => !c.locked).map((c) => c.id));
				this.shown = RENDER_BATCH;
				this.renderList();
			});
			button.addClass('fieldy-filter-icon', `fieldy-ind-${key}`, rule === 'has' ? 'is-on' : rule === 'lacks' ? 'is-lacks' : 'is-any');
			button.setAttribute('aria-pressed', rule ? 'true' : 'false');
		}

		// Recorded with: one source at a time (click again for any). Pointless when sync is limited to one source.
		if (this.plugin.settings.recordingSource !== 'all') return;
		icons.createSpan({ cls: 'fieldy-filter-sep' });
		for (const source of RECORDING_SOURCES) {
			const on = this.filters.source === source;
			const name = `Recorded with: ${SOURCE_LABELS[source]}`;
			const button = iconButton(icons, SOURCE_ICONS[source], on ? `${name} (click for any source)` : `${name} (click to show only these)`, () => {
				this.filters.source = this.filters.source === source ? null : source;
				this.renderList();
			});
			button.addClass('fieldy-filter-icon', 'fieldy-ind-source', on ? 'is-on' : 'is-any');
			button.setAttribute('aria-pressed', on ? 'true' : 'false');
		}
	}

	/** Date, time, speaker, location and note status, behind the filter button. */
	private renderFilterBar(): void {
		if (!this.filterBarEl) return;
		this.renderContentFilters();
		const count = activeFilterCount(this.filters);
		// The icon filters are always on screen, so the button only counts the hidden ones.
		const hidden = count - Object.keys(this.filters.content).length - (this.filters.source !== null ? 1 : 0);
		const label = hidden > 0 ? `Filters (${hidden} active)` : 'Filters';
		this.filterButton.toggleClass('is-active', hidden > 0 || this.filtersOpen);
		this.filterButton.setAttribute('aria-label', label);
		this.filterButton.setAttribute('aria-expanded', String(this.filtersOpen));
		setTooltip(this.filterButton, label);
		this.filterBarEl.empty();
		this.filterBarEl.toggleClass('is-hidden', !this.filtersOpen);
		if (!this.filtersOpen) return;

		const options = filterOptions(this.items);
		const selects = this.filterBarEl.createDiv({ cls: 'fieldy-filter-selects' });
		const select = <T extends string>(label: string, any: string, choices: [T, string][], value: T | null, onChange: (value: T | null) => void) => {
			const el = selects.createEl('select', { cls: 'dropdown fieldy-filter-select', attr: { 'aria-label': label } });
			el.createEl('option', { value: '', text: any });
			// Keep a chosen value selectable even when no loaded conversation has it any more.
			if (value !== null && !choices.some(([v]) => v === value)) el.createEl('option', { value, text: value });
			for (const [v, text] of choices) el.createEl('option', { value: v, text });
			el.value = value ?? '';
			el.toggleClass('is-active', value !== null);
			setTooltip(el, label);
			el.addEventListener('change', () => {
				onChange(el.value === '' ? null : (el.value as T));
				this.renderList();
			});
		};
		select('Date', 'Any date', options.days.map((d) => [d, moment(d, 'YYYY-MM-DD').format('ddd D MMM YYYY')]), this.filters.day, (v) => (this.filters.day = v));
		select<TimeOfDay>('Time of day', 'Any time', Object.entries(TIME_OF_DAY_LABELS) as [TimeOfDay, string][], this.filters.timeOfDay, (v) => (this.filters.timeOfDay = v));
		select('Speaker', 'Any speaker', options.speakers.map((s) => [s, s]), this.filters.speaker, (v) => (this.filters.speaker = v));
		select('Location', 'Any location', options.locations.map((l) => [l, l]), this.filters.location, (v) => (this.filters.location = v));
		select<RowStatus>('Note status', 'Any status', Object.entries(STATUS_LABELS) as [RowStatus, string][], this.filters.status, (v) => (this.filters.status = v));

		if (count > 0) {
			const clear = selects.createEl('button', { cls: 'fieldy-filter-clear', text: 'Clear filters' });
			clear.addEventListener('click', () => {
				this.filters = emptyFilters();
				this.renderList();
			});
		}
	}

	private renderFooter(): void {
		if (!this.footerEl) return;
		this.footerEl.empty();
		if (this.loading) {
			this.footerEl.createSpan({ cls: 'fieldy-muted', text: 'Loading from Fieldy…' });
			return;
		}
		if (!this.plugin.hasApiKey()) return;
		this.footerEl.createSpan({
			cls: 'fieldy-muted',
			text: `${this.items.length} conversation${this.items.length === 1 ? '' : 's'} loaded, newest first.`,
		});
		if (!this.exhausted && this.items.length > 0) {
			const more = this.footerEl.createEl('button', { text: 'Load older conversations' });
			more.addEventListener('click', () => void this.loadMore());
		}
	}

	/** Renders one card at the end of the list, or in place of `replace`. */
	private renderRow(c: FieldyConversation, replace?: HTMLElement): HTMLElement {
		const status = this.status(c);
		const isOpen = this.expanded.has(c.id);
		const row = createDiv({ cls: `fieldy-conv${isOpen ? ' is-expanded' : ''}`, attr: { 'data-id': c.id } });
		if (replace) replace.replaceWith(row);
		else this.listEl.appendChild(row);
		const synced = this.syncedSets();
		this.rowEls.set(c.id, row);
		this.rowKeys.set(c.id, this.rowKey(c, synced));
		this.rowObserver?.observe(row);

		const header = row.createDiv({ cls: 'fieldy-conv-header', attr: { role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) } });
		const chevron = header.createSpan({ cls: 'fieldy-conv-chevron' });
		setIcon(chevron, isOpen ? 'chevron-down' : 'chevron-right');
		const main = header.createDiv({ cls: 'fieldy-conv-main' });
		main.createDiv({ cls: 'fieldy-conv-title', text: displayTitle(c) });
		const minutes = formatDuration(durationMinutes(c.startTime, c.endTime));
		const meta = [moment(c.startTime).format('ddd D MMM YYYY · HH:mm'), minutes ?? (c.endTime ? null : 'in progress')];
		if (c.speakers.length > 0) meta.push(c.speakers.length === 1 ? c.speakers[0] ?? '' : `${c.speakers.length} speakers`);
		main.createDiv({ cls: 'fieldy-conv-meta', text: meta.filter(Boolean).join(' · ') });
		const badge = header.createSpan({ cls: `fieldy-badge fieldy-badge-${status}`, text: STATUS_LABELS[status] });
		// Outlined when the last sync created or updated this note.
		const mark = synced.created.has(c.id) ? 'new' : synced.updated.has(c.id) ? 'updated' : null;
		if (mark) badge.addClass(`is-synced-${mark}`);
		const badgeHint = mark ? `${STATUS_HINTS[status]} ${mark === 'new' ? 'Created' : 'Updated'} by the last sync.` : STATUS_HINTS[status];
		const notePath = this.paths.get(c.id);
		if (notePath && status !== 'deleted') {
			// A badge of a conversation with a note opens it (without opening or closing the card).
			badge.addClass('is-clickable');
			badge.setAttrs({ role: 'button', tabindex: '0' });
			setTooltip(badge, `${badgeHint} Click to open the note.`);
			actionable(badge, () => void this.plugin.openNote(notePath));
		} else {
			setTooltip(badge, badgeHint);
		}
		const toggle = () => {
			if (this.expanded.has(c.id)) this.expanded.delete(c.id);
			else {
				this.expanded.add(c.id);
				if (!c.locked) this.queueLinkChecks([c.id], true);
			}
			this.rerenderRow(c, row, header);
		};
		header.addEventListener('click', toggle);
		header.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter' || evt.key === ' ') {
				evt.preventDefault();
				toggle();
			}
		});

		const footer = row.createDiv({ cls: 'fieldy-conv-footer' });
		// What the conversation contains, at a glance.
		this.renderIndicators(footer.createDiv({ cls: 'fieldy-indicators', attr: { role: 'list' } }), c);
		const actions = footer.createDiv({ cls: 'fieldy-conv-actions' });
		const path = this.paths.get(c.id);
		if (path) {
			iconButton(actions, 'file-text', 'Open the note', () => void this.plugin.openNote(path));
		} else if (status !== 'locked') {
			iconButton(actions, 'file-plus', 'Create a note for this conversation (same format as sync)', () => void this.createNote(c));
		}
		if (path && status === 'edited') {
			iconButton(actions, 'rotate-ccw', 'Restore the Fieldy version…', (evt) => this.restoreMenu(evt, c));
		} else if (path) {
			iconButton(actions, 'refresh-cw', 'Refresh the note from Fieldy', () => void this.plugin.refreshNote(c.id, c).then(() => this.refreshLocal()));
		}
		if (status !== 'locked') {
			iconButton(actions, 'text-cursor-input', 'Insert into the note you are editing…', (evt) => this.snippetMenu(evt, c, 'insert'));
			iconButton(actions, 'copy', 'Copy to the clipboard…', (evt) => this.snippetMenu(evt, c, 'copy'));
		} else {
			// Locked conversations have nothing else to copy.
			iconButton(actions, 'fingerprint', 'Copy the conversation ID', () => void copyToClipboard(c.id, 'Conversation ID'));
		}

		if (isOpen) this.renderBody(row.createDiv({ cls: 'fieldy-conv-body' }), c, status);
		return row;
	}

	/**
	 * Redraws only the toggled card and keeps its header exactly where it was
	 * on screen, so opening or closing a card never makes the list jump.
	 */
	private rerenderRow(c: FieldyConversation, row: HTMLElement, header: HTMLElement): void {
		const scroller = scrollParent(row);
		const before = header.getBoundingClientRect().top;
		this.dropRow(c.id);
		const fresh = this.renderRow(c, row);
		const freshHeader = fresh.querySelector<HTMLElement>('.fieldy-conv-header');
		if (!freshHeader) return;
		if (scroller) scroller.scrollTop += freshHeader.getBoundingClientRect().top - before;
		freshHeader.focus({ preventScroll: true });
	}

	private renderBody(body: HTMLElement, c: FieldyConversation, status: RowStatus): void {
		const component = new Component();
		this.view.addChild(component);
		this.bodies.set(c.id, component);
		const markdown = (el: HTMLElement, text: string) => void MarkdownRenderer.render(this.view.app, text, el, '', component);
		const section = (title: string) => {
			const el = body.createDiv({ cls: 'fieldy-section' });
			el.createDiv({ cls: 'fieldy-section-title', text: title });
			return el.createDiv({ cls: 'fieldy-section-content' });
		};

		const formatDate = (iso: string, format: string) => moment(iso).format(format);
		const meta = metadataLines(
			{ conversation: c, tasks: [], transcript: null, speakerNames: new Map(), templateName: null, shareLinks: [] },
			this.plugin.settings,
			formatDate,
		);
		if (status === 'edited') {
			body.createDiv({ cls: 'fieldy-edited-hint', text: 'Your note has your edits. Below is the original Fieldy version.' });
		}
		markdown(body.createDiv({ cls: 'fieldy-conv-details' }), meta.join('\n'));
		if (status === 'locked') {
			body.createDiv({ cls: 'fieldy-muted', text: STATUS_HINTS.locked });
			return;
		}

		const summary = summaryLines(c);
		if (summary.length > 0) markdown(section('Summary'), summary.join('\n'));
		const details = detailsLines(c);
		if (details.length > 0) markdown(section('Full memory content'), details.join('\n'));

		const tasksEl = section('Tasks');
		tasksEl.setText('Loading tasks…');
		void this.view.data
			.snippet(c, 'tasks', true)
			.then((tasks) => {
				tasksEl.empty();
				if (tasks) markdown(tasksEl, tasks);
				else tasksEl.createSpan({ cls: 'fieldy-muted', text: 'No tasks for this conversation.' });
			})
			.catch((err: unknown) => {
				if (!isCancellation(err)) tasksEl.setText(describeError(err));
			});

		const quotes = quoteLines(c);
		if (quotes.length > 0) markdown(section('Quotes'), quotes.join('\n'));

		const transcriptEl = section('Transcript');
		const toggle = transcriptEl.createEl('button', { text: 'Show transcript' });
		const content = transcriptEl.createDiv({ cls: 'fieldy-transcript-content' });
		let state: 'idle' | 'loading' | 'shown' | 'hidden' = 'idle';
		toggle.addEventListener('click', () => {
			// Loaded once; hiding and showing again does not fetch it again.
			if (state === 'shown' || state === 'hidden') {
				state = state === 'shown' ? 'hidden' : 'shown';
				content.toggle(state === 'shown');
				toggle.setText(state === 'shown' ? 'Hide transcript' : 'Show transcript');
				return;
			}
			if (state === 'loading') return;
			state = 'loading';
			toggle.disabled = true;
			content.empty();
			content.createSpan({ cls: 'fieldy-muted', text: 'Loading transcript…' });
			void this.view.data
				.snippet(c, 'transcript')
				.then((text) => {
					content.empty();
					toggle.disabled = false;
					if (!text) {
						toggle.remove();
						content.createSpan({ cls: 'fieldy-muted', text: 'Fieldy has no transcript for this conversation.' });
						return;
					}
					state = 'shown';
					toggle.setText('Hide transcript');
					const lines = text.split('\n');
					const preview = content.createDiv({ cls: 'fieldy-transcript' });
					markdown(preview, lines.slice(0, TRANSCRIPT_PREVIEW_LINES).join('\n'));
					if (lines.length > TRANSCRIPT_PREVIEW_LINES) {
						const all = content.createEl('button', { text: `Show the full transcript (${lines.length - TRANSCRIPT_PREVIEW_LINES} more lines)` });
						all.addEventListener('click', () => {
							all.remove();
							preview.empty();
							markdown(preview, text);
						});
					}
				})
				.catch((err: unknown) => {
					if (isCancellation(err)) return;
					state = 'idle';
					toggle.disabled = false;
					toggle.setText('Try again');
					content.empty();
					content.setText(describeError(err));
				});
		});
	}

	private snippetMenu(evt: MouseEvent, c: FieldyConversation, mode: 'insert' | 'copy'): void {
		const menu = new Menu();
		// Pieces the card icons show as missing are greyed out; unknown ones (still checking) stay offered.
		const states = new Map(this.indicatorsFor(c).map((i) => [i.key, i.state]));
		const missing = (kind: SnippetKind) => (kind === 'summary' || kind === 'details' || kind === 'tasks' || kind === 'quotes') && states.get(kind) === 'off';
		for (const kind of SNIPPET_ORDER) {
			const none = missing(kind);
			menu.addItem((item) =>
				item
					.setTitle(`${SNIPPET_LABELS[kind]}${none ? ' (none)' : ''}`)
					.setIcon(SNIPPET_ICONS[kind])
					.setDisabled(none)
					.onClick(() => void this.deliver(c, kind, mode)),
			);
			// Only offered while the Obsidian Tasks plugin is enabled.
			if (kind === 'tasks' && tasksPluginEnabled(this.view.app)) {
				menu.addItem((item) =>
					item
						.setTitle(`Tasks as Obsidian tasks${none ? ' (none)' : ''}`)
						.setIcon('list-checks')
						.setDisabled(none)
						.onClick(() => void this.deliverObsidianTasks(c, mode)),
				);
			}
		}
		menu.addSeparator();
		const path = this.paths.get(c.id);
		menu.addItem((item) =>
			item
				.setTitle(`${mode === 'insert' ? 'Link to its note' : 'Copy link to its note'}${path ? '' : ' (no note yet)'}`)
				.setIcon('link')
				.setDisabled(!path)
				.onClick(() => {
					if (path) this.deliverLink(path, mode);
				}),
		);
		// Greyed out once the background check found no active share link.
		const noLink = this.linkStates.get(c.id) === false;
		menu.addItem((item) =>
			item
				.setTitle(`Fieldy share link${noLink ? ' (none yet)' : ''}`)
				.setIcon('share-2')
				.setDisabled(noLink)
				.onClick(() => void this.deliverShareLink(c, mode)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Conversation ID')
				.setIcon('fingerprint')
				.onClick(() => void this.deliverText(c.id, 'Conversation ID', mode)),
		);
		menu.showAtMouseEvent(evt);
	}

	private async deliver(c: FieldyConversation, kind: SnippetKind, mode: 'insert' | 'copy'): Promise<void> {
		const label = SNIPPET_LABELS[kind];
		const notice = kind === 'transcript' || kind === 'full' ? new Notice('Fetching from Fieldy…', 0) : null;
		try {
			const markdown = await this.view.data.snippet(c, kind);
			if (!markdown.trim()) {
				new Notice(`Fieldy has no ${label.toLowerCase()} for this conversation.`);
				return;
			}
			if (mode === 'insert') insertIntoLastNote(this.view.app, markdown, label);
			else await copyToClipboard(markdown, label);
		} catch (err) {
			if (!isCancellation(err)) new Notice(describeError(err));
		} finally {
			notice?.hide();
		}
	}

	/** The conversation's tasks in the Tasks plugin's format (its current settings), with a link to the note. */
	private async deliverObsidianTasks(c: FieldyConversation, mode: 'insert' | 'copy'): Promise<void> {
		try {
			const format = await readTasksFormat(this.view.app);
			if (!format) return;
			const statuses: TaskStatus[] = ['new', 'approved', 'completed'];
			if (this.plugin.settings.includeDismissedTasks) statuses.push('rejected', 'skipped', 'cancelled', 'expired');
			const tasks = (await this.view.data.tasksFor(c.id)).filter((t) => statuses.includes(t.status));
			if (tasks.length === 0) {
				new Notice('Fieldy has no tasks for this conversation.');
				return;
			}
			const path = this.paths.get(c.id);
			const file = path ? this.view.app.vault.getFileByPath(path) : null;
			const link = file ? this.view.app.fileManager.generateMarkdownLink(file, '') : undefined;
			const formatDate = (iso: string, f: string) => moment(iso).format(f);
			const today = new Date().toISOString();
			const text = tasks.map((t) => obsidianTaskLine(t, format, formatDate, link, today)).join('\n');
			if (mode === 'insert') insertIntoLastNote(this.view.app, text, 'Tasks');
			else await copyToClipboard(text, 'Tasks');
		} catch (err) {
			if (!isCancellation(err)) new Notice(describeError(err));
		}
	}

	// ------------------------------------------------------- card icon actions

	/**
	 * What clicking a card icon copies (or, from its menu, inserts). Tasks and the
	 * calendar event use the Obsidian Tasks plugin's format while it is enabled,
	 * and this plugin's own format otherwise.
	 */
	private deliverIndicator(c: FieldyConversation, key: IndicatorKey, mode: 'insert' | 'copy', format: 'auto' | 'fieldy' = 'auto'): Promise<void> {
		const tasksFormat = format === 'auto' && tasksPluginEnabled(this.view.app);
		switch (key) {
			case 'brief':
				return this.deliver(c, 'overview', mode);
			case 'summary':
			case 'details':
			case 'quotes':
				return this.deliver(c, key, mode);
			case 'tasks':
				return tasksFormat ? this.deliverObsidianTasks(c, mode) : this.deliver(c, 'tasks', mode);
			case 'calendar':
				return this.deliverEvent(c, mode, tasksFormat);
			case 'location':
				return this.deliverText(locationText(c.location), 'Location', mode);
			case 'link':
				return this.deliverShareLink(c, mode);
		}
	}

	private async deliverText(text: string | null, label: string, mode: 'insert' | 'copy'): Promise<void> {
		if (!text?.trim()) {
			new Notice(`Fieldy has no ${label.toLowerCase()} for this conversation.`);
			return;
		}
		if (mode === 'insert') insertIntoLastNote(this.view.app, text, label);
		else await copyToClipboard(text, label);
	}

	private async deliverShareLink(c: FieldyConversation, mode: 'insert' | 'copy'): Promise<void> {
		const url = await this.plugin.shareLinkUrl(c.id);
		if (url) await this.deliverText(url, 'Share link', mode);
	}

	/** A link to the conversation's note, or nothing when it has none. */
	private noteLink(c: FieldyConversation): string | undefined {
		const path = this.paths.get(c.id);
		const file = path ? this.view.app.vault.getFileByPath(path) : null;
		return file ? this.view.app.fileManager.generateMarkdownLink(file, '') : undefined;
	}

	/** The meeting as one line: a Tasks plugin item scheduled on its day, or a plain list item with its time and place. */
	private async deliverEvent(c: FieldyConversation, mode: 'insert' | 'copy', tasksFormat: boolean): Promise<void> {
		if (!c.calendarEventId) {
			new Notice('This conversation is not linked to a calendar event.');
			return;
		}
		const link = this.noteLink(c);
		const formatDate = (iso: string, f: string) => moment(iso).format(f);
		let line: string;
		const format = tasksFormat ? await readTasksFormat(this.view.app) : null;
		if (format) {
			line = obsidianEventLine(displayTitle(c), c.startTime, format, formatDate, link, new Date().toISOString());
		} else {
			const start = moment(c.startTime);
			const end = c.endTime ? moment(c.endTime) : null;
			const when = `${start.format(this.plugin.settings.noteDateFormat)}${end?.isValid() ? `–${end.format(end.isSame(start, 'day') ? 'HH:mm' : this.plugin.settings.noteDateFormat)}` : ''}`;
			line = `- ${[displayTitle(c), when, locationText(c.location), link].filter(Boolean).join(' · ')}`;
		}
		await this.deliverText(line, 'Calendar event', mode);
	}

	/** Right-click menu of a card icon: copy, insert, and the other format when there is one. */
	private indicatorMenu(evt: MouseEvent, c: FieldyConversation, indicator: Indicator): void {
		const menu = new Menu();
		const name = INDICATOR_COPY_NAMES[indicator.key];
		if (indicator.state === 'off') {
			menu.addItem((item) => item.setTitle(indicator.label).setIcon(indicator.icon).setDisabled(true));
			menu.showAtMouseEvent(evt);
			return;
		}
		const both = (indicator.key === 'tasks' || indicator.key === 'calendar') && tasksPluginEnabled(this.view.app);
		menu.addItem((item) => item.setTitle(both ? `Copy ${name} as Obsidian Tasks` : `Copy ${name}`).setIcon('copy').onClick(() => void this.deliverIndicator(c, indicator.key, 'copy')));
		if (both) menu.addItem((item) => item.setTitle(`Copy ${name} as Fieldy Sync lines`).setIcon('copy').onClick(() => void this.deliverIndicator(c, indicator.key, 'copy', 'fieldy')));
		menu.addItem((item) =>
			item.setTitle(both ? `Insert ${name} as Obsidian Tasks` : `Insert ${name} into the note you are editing`).setIcon('text-cursor-input').onClick(() => void this.deliverIndicator(c, indicator.key, 'insert')),
		);
		if (both) menu.addItem((item) => item.setTitle(`Insert ${name} as Fieldy Sync lines`).setIcon('text-cursor-input').onClick(() => void this.deliverIndicator(c, indicator.key, 'insert', 'fieldy')));
		const maps = indicator.key === 'location' ? mapLinks(c.location) : null;
		if (maps) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle('Open in Google Maps').setIcon('map').onClick(() => window.open(maps.google)));
			menu.addItem((item) => item.setTitle('Open in OpenStreetMap').setIcon('map-pinned').onClick(() => window.open(maps.osm)));
		}
		if (indicator.key === 'link') {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle('Open the share link')
					.setIcon('external-link')
					.onClick(async () => {
						const url = await this.plugin.shareLinkUrl(c.id);
						if (url) window.open(url);
					}),
			);
		}
		menu.showAtMouseEvent(evt);
	}

	/** Recording source icon: click shows only conversations recorded the same way (again: any source). */
	private toggleSourceFilter(c: FieldyConversation): void {
		const sources = this.sourcesOf(c);
		const only = sources && sources.size === 1 ? [...sources][0] : undefined;
		if (!only || this.plugin.settings.recordingSource !== 'all') return;
		this.filters.source = this.filters.source === only ? null : only;
		this.renderList();
	}

	private deliverLink(path: string, mode: 'insert' | 'copy'): void {
		const file = this.view.app.vault.getFileByPath(path);
		if (!file) {
			new Notice('That note no longer exists.');
			return;
		}
		const target = this.view.app.workspace.getMostRecentLeaf()?.view;
		const sourcePath = target instanceof MarkdownView ? (target.file?.path ?? '') : '';
		const link = this.view.app.fileManager.generateMarkdownLink(file, sourcePath);
		if (mode === 'insert') insertIntoLastNote(this.view.app, link, 'Link');
		else void copyToClipboard(link, 'Link');
	}

	/** The two ways back to the Fieldy version of an edited note. */
	private restoreMenu(evt: MouseEvent, c: FieldyConversation): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Restore Fieldy version, keep my edits below it')
				.setIcon('copy-plus')
				.onClick(() => void this.restore(c, 'keep-both')),
		);
		menu.addItem((item) =>
			item
				.setTitle('Restore Fieldy version, discard my edits…')
				.setIcon('rotate-ccw')
				.setWarning(true)
				.onClick(() => this.confirmDiscard(c)),
		);
		menu.showAtMouseEvent(evt);
	}

	private async restore(c: FieldyConversation, choice: RestoreChoice): Promise<void> {
		try {
			await this.plugin.restoreFieldyVersion(c.id, choice);
			new Notice(choice === 'keep-both' ? 'Fieldy version restored; your edits are kept below it.' : 'Fieldy version restored.');
		} catch (err) {
			if (!isCancellation(err)) new Notice(describeError(err));
		}
		await this.refreshLocal();
	}

	private confirmDiscard(c: FieldyConversation): void {
		new ConfirmationModal(this.view.app)
			.setTitle('Discard your edits?')
			.setContent(`The Fieldy section of the note for "${displayTitle(c)}" will be replaced by the latest version from Fieldy, and your edits inside it will be lost. Text outside the Fieldy section is not affected.`)
			.addButton((button) =>
				button
					.setButtonText('Restore and discard')
					.setDestructive()
					.setCta()
					.onClick(() => this.restore(c, 'overwrite')),
			)
			.addCancelButton()
			.open();
	}

	private async createNote(c: FieldyConversation): Promise<void> {
		const summary = await this.plugin.importConversation(c);
		await this.refreshLocal();
		const path = this.paths.get(c.id);
		if (summary && summary.counts.created + summary.counts.updated + summary.counts.unchanged > 0 && path) {
			await this.plugin.openNote(path);
		}
	}
}

function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
	}
	return null;
}
