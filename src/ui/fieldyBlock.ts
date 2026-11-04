import { debounce, MarkdownRenderChild, TFile, type App, type FrontMatterCache } from 'obsidian';
import { ID_KEY } from '../markdown/ConversationRenderer';
import {
	computeStats,
	parseFieldyQuery,
	QUERY_KEYS,
	selectConversations,
	selectTasks,
	speakerLabel,
	tasksInSection,
	type ConversationRecord,
	type FieldyQuery,
	type TaskRecord,
} from '../markdown/fieldyQuery';
import type FieldySyncPlugin from '../main';
import { formatDuration } from '../utils/dates';
import { blockLayout } from './bannerModel';
import { moment } from '../utils/moment';

/**
 * Registers the ```fieldy``` code block: lists conversations, tasks or stats
 * from the Fieldy notes in the vault, and redraws when those notes change.
 * Reads the vault only; never sends requests to Fieldy.
 */
export function registerFieldyBlock(plugin: FieldySyncPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('fieldy', (source, el, ctx) => {
		ctx.addChild(new FieldyBlock(plugin.app, source, el, ctx.sourcePath));
	});
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function conversationRecord(app: App, file: TFile, fm: FrontMatterCache): ConversationRecord {
	const heading = app.metadataCache.getFileCache(file)?.headings?.find((h) => h.level === 1)?.heading;
	const start = text(fm.fieldy_start);
	const minutes: unknown = fm.fieldy_duration_minutes;
	const speakers: unknown = fm.fieldy_speakers;
	return {
		path: file.path,
		title: heading ?? file.basename,
		start: start ? Date.parse(start) : NaN,
		minutes: typeof minutes === 'number' && Number.isFinite(minutes) ? minutes : null,
		speakers: Array.isArray(speakers) ? speakers.filter((s): s is string => typeof s === 'string') : [],
		kind: text(fm.fieldy_kind)?.toLowerCase() ?? 'full',
		location: text(fm.fieldy_location),
	};
}

/** Every Fieldy note in the vault, from the metadata cache (no file reads). */
function fieldyNotes(app: App): ConversationRecord[] {
	const records: ConversationRecord[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (fm?.[ID_KEY] === undefined) continue;
		records.push(conversationRecord(app, file, fm));
	}
	return records;
}

async function tasksOf(app: App, conversations: readonly ConversationRecord[]): Promise<TaskRecord[]> {
	const tasks: TaskRecord[] = [];
	for (const c of conversations) {
		const file = app.vault.getFileByPath(c.path);
		// Only notes whose cache lists tasks are read (Obsidian keeps their text cached).
		if (!file || !app.metadataCache.getFileCache(file)?.listItems?.some((i) => i.task !== undefined)) continue;
		const lines = (await app.vault.cachedRead(file)).split('\n');
		const layout = blockLayout(lines);
		if (layout) tasks.push(...tasksInSection(lines, layout.begin, layout.end, c));
	}
	return tasks;
}

const REFRESH_DELAY_MS = 750;

class FieldyBlock extends MarkdownRenderChild {
	private generation = 0;
	private readonly refresh = debounce(() => void this.render(), REFRESH_DELAY_MS, true);

	constructor(
		private readonly app: App,
		private readonly source: string,
		containerEl: HTMLElement,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	override onload(): void {
		this.containerEl.addClass('fieldy-block');
		void this.render();
		const isFieldy = (file: unknown) => file instanceof TFile && this.app.metadataCache.getFileCache(file)?.frontmatter?.[ID_KEY] !== undefined;
		this.registerEvent(this.app.metadataCache.on('changed', (file) => isFieldy(file) && this.refresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.refresh()));
		this.registerEvent(this.app.vault.on('rename', (file) => isFieldy(file) && this.refresh()));
	}

	private async render(): Promise<void> {
		const generation = ++this.generation;
		const query = parseFieldyQuery(this.source, Date.now());
		const conversations = selectConversations(fieldyNotes(this.app), query);
		const tasks = query.show === 'conversations' ? [] : await tasksOf(this.app, conversations);
		if (generation !== this.generation) return;

		const el = this.containerEl;
		el.empty();
		if (query.errors.length > 0) {
			const errors = el.createDiv({ cls: 'fieldy-block-errors' });
			for (const message of query.errors) errors.createDiv({ text: message });
			errors.createDiv({ cls: 'fieldy-muted', text: `Options: ${QUERY_KEYS.join(', ')}. Examples: "Dashboards" in the Fieldy Sync user guide.` });
		}
		if (query.show === 'stats') this.renderStats(el, query, conversations, tasks);
		else if (query.show === 'tasks') this.renderTasks(el, query, selectTasks(tasks, query));
		else this.renderConversations(el, query, conversations);
	}

	private link(parent: HTMLElement, path: string, label: string, line?: number): void {
		const a = parent.createEl('a', { cls: 'internal-link', text: label, attr: { href: path, 'data-href': path } });
		a.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(path, this.sourcePath, evt.ctrlKey || evt.metaKey, line === undefined ? undefined : { eState: { line } });
		});
	}

	private heading(el: HTMLElement, text: string): void {
		el.createDiv({ cls: 'fieldy-block-heading', text });
	}

	private more(el: HTMLElement, total: number, limit: number): void {
		if (total > limit) el.createDiv({ cls: 'fieldy-muted', text: `…and ${total - limit} more (raise "limit" to see them).` });
	}

	private renderConversations(el: HTMLElement, q: FieldyQuery, list: ConversationRecord[]): void {
		this.heading(el, `Fieldy conversations, ${q.periodLabel} (${list.length})`);
		if (list.length === 0) {
			el.createDiv({ cls: 'fieldy-muted', text: 'No Fieldy notes match.' });
			return;
		}
		const ul = el.createEl('ul', { cls: 'fieldy-block-list' });
		for (const c of list.slice(0, q.limit)) {
			const li = ul.createEl('li');
			this.link(li, c.path, c.title);
			const meta = [Number.isNaN(c.start) ? null : moment(c.start).format('ddd D MMM YYYY, HH:mm'), formatDuration(c.minutes)];
			const people = c.speakers.map(speakerLabel).filter((s) => s && s !== 'Unknown');
			if (people.length > 0) meta.push(people.slice(0, 3).join(', ') + (people.length > 3 ? ` +${people.length - 3}` : ''));
			li.createSpan({ cls: 'fieldy-muted', text: ` · ${meta.filter(Boolean).join(' · ')}` });
		}
		this.more(el, list.length, q.limit);
	}

	private renderTasks(el: HTMLElement, q: FieldyQuery, list: TaskRecord[]): void {
		const which = q.tasks === 'open' ? 'Open' : q.tasks === 'done' ? 'Completed' : 'All';
		this.heading(el, `${which} Fieldy tasks, ${q.periodLabel} (${list.length})`);
		if (list.length === 0) {
			el.createDiv({ cls: 'fieldy-muted', text: 'No Fieldy tasks match.' });
			return;
		}
		const ul = el.createEl('ul', { cls: 'contains-task-list fieldy-block-list' });
		const today = moment().format('YYYY-MM-DD');
		for (const t of list.slice(0, q.limit)) {
			const li = ul.createEl('li', { cls: 'task-list-item', attr: { 'data-task': t.status } });
			// Read-only here: ticking happens in the note itself (or in the Fieldy panel).
			const box = li.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox' });
			box.checked = t.status !== ' ';
			box.disabled = true;
			li.appendText(` ${t.text} `);
			if (t.due) li.createSpan({ cls: `fieldy-block-due${t.status === ' ' && t.due < today ? ' is-overdue' : ''}`, text: `due ${t.due}` });
			li.appendText(' · ');
			this.link(li, t.path, t.conversation.title, t.line);
		}
		this.more(el, list.length, q.limit);
	}

	private renderStats(el: HTMLElement, q: FieldyQuery, conversations: ConversationRecord[], tasks: TaskRecord[]): void {
		const s = computeStats(conversations, tasks);
		this.heading(el, `Fieldy stats, ${q.periodLabel}`);
		const grid = el.createDiv({ cls: 'fieldy-block-stats' });
		const tile = (value: string, label: string) => {
			const t = grid.createDiv({ cls: 'fieldy-block-tile' });
			t.createDiv({ cls: 'fieldy-block-value', text: value });
			t.createDiv({ cls: 'fieldy-muted', text: label });
		};
		tile(String(s.conversations), s.conversations === 1 ? 'conversation' : 'conversations');
		tile(s.conversations === 0 ? '0 min' : (formatDuration(s.minutes) ?? '0 min'), 'recorded');
		tile(s.averageMinutes !== null ? (formatDuration(s.averageMinutes) ?? '–') : '–', 'on average');
		tile(String(s.days), s.days === 1 ? 'day with conversations' : 'days with conversations');
		tile(String(s.openTasks), s.openTasks === 1 ? 'open task' : 'open tasks');
		tile(String(s.doneTasks), 'tasks done');

		if (s.longest) {
			const p = el.createDiv({ cls: 'fieldy-block-line' });
			p.appendText('Longest: ');
			this.link(p, s.longest.path, s.longest.title);
			p.appendText(` (${formatDuration(s.longest.minutes) ?? ''})`);
		}
		if (s.busiestDays.length > 0) {
			const p = el.createDiv({ cls: 'fieldy-block-line' });
			p.appendText(`Busiest days: ${s.busiestDays.map((d) => `${moment(d.day, 'YYYY-MM-DD').format('ddd D MMM')} (${formatDuration(d.minutes) ?? `${d.count}`})`).join(', ')}`);
		}
		if (s.topSpeakers.length > 0) {
			el.createDiv({ cls: 'fieldy-block-line', text: `Most often with: ${s.topSpeakers.map((p) => `${p.name} (${p.count})`).join(', ')}` });
		}
	}
}
