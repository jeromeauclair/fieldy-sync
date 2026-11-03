import { ConfirmationModal, debounce, Menu, Modal, moment, Notice, Setting, setIcon, setTooltip, type App } from 'obsidian';
import type { FieldyTask, TaskChanges, TaskStatus } from '../../api/types';
import { taskLine } from '../../markdown/ConversationRenderer';
import { obsidianTaskLine, type TasksFormat } from '../../markdown/obsidianTasks';
import { inlineText } from '../../markdown/sanitize';
import { sleep } from '../../utils/async';
import { describeError, isCancellation } from '../../utils/errors';
import { readTasksFormat, tasksPluginEnabled } from '../tasksPlugin';
import { iconButton, noKeyMessage } from './ConversationsTab';
import { copyToClipboard, insertIntoLastNote } from './editorActions';
import { nextContentRule, type ContentRule } from './filters';
import type { FieldyView } from './FieldyView';

type TaskFilter = 'open' | 'completed' | 'dismissed';
type Grouping = 'due' | 'conversation' | 'none';

const FILTER_LABELS: Record<TaskFilter, string> = {
	open: 'Open tasks',
	completed: 'Completed tasks',
	dismissed: 'Dismissed tasks',
};

const GROUPING_LABELS: Record<Grouping, string> = {
	due: 'Group by due date',
	conversation: 'Group by conversation',
	none: 'No groups',
};

/** Icons of the filter row, matching the Conversations tab's icon filters. */
const FILTER_ICONS: Record<TaskFilter, string> = {
	open: 'circle',
	completed: 'circle-check',
	dismissed: 'circle-slash',
};

const GROUPING_ICONS: Record<Grouping, string> = {
	due: 'calendar-clock',
	conversation: 'messages-square',
	none: 'list',
};

const OPEN: readonly TaskStatus[] = ['new', 'approved'];
const DISMISSED: readonly TaskStatus[] = ['rejected', 'skipped', 'cancelled', 'expired'];

const FILTER_STATUSES: Record<TaskFilter, readonly TaskStatus[]> = {
	open: OPEN,
	completed: ['completed'],
	dismissed: DISMISSED,
};

/** Background privacy checks: one conversation every 1.5 s, pausing while a sync runs or requests queue up. */
const PRIVACY_SPACING_MS = 1_500;
const PRIVACY_BACKOFF_MS = 5_000;
const TASK_FILTERS = Object.keys(FILTER_LABELS) as TaskFilter[];

const STATUS_ICONS: Record<TaskStatus, string> = {
	new: 'circle',
	approved: 'circle-dot',
	completed: 'circle-check',
	rejected: 'circle-x',
	skipped: 'circle-slash',
	cancelled: 'circle-x',
	expired: 'clock',
};

type DueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';

const DUE_GROUP_LABELS: Record<DueGroup, string> = {
	overdue: 'Overdue',
	today: 'Due today',
	week: 'Next 7 days',
	later: 'Later',
	none: 'No due date',
};

function dueGroup(task: FieldyTask): DueGroup {
	if (!task.date) return 'none';
	const due = moment(task.date).startOf('day');
	const today = moment().startOf('day');
	if (due.isBefore(today)) return 'overdue';
	if (due.isSame(today)) return 'today';
	if (due.diff(today, 'days') <= 7) return 'week';
	return 'later';
}

const isOpen = (task: FieldyTask) => OPEN.includes(task.status);

/** Tasks drawn at a time. */
const RENDER_BATCH = 100;
const SEARCH_DELAY_MS = 150;

/**
 * All Fieldy action items in one place, independent of notes: filter and
 * group them, mark them done, reopen, edit or cancel them in Fieldy, jump to
 * the conversation they came from, and insert or copy them as Markdown
 * checklists or, when the Obsidian Tasks plugin is enabled, as Tasks items.
 * Changes are only ever sent to Fieldy when the user clicks.
 */
export class TasksTab {
	/** Like the Conversations icons: only these, never these, or any (no entry). Open tasks by default. */
	private rules: Partial<Record<TaskFilter, ContentRule>> = { open: 'has' };
	private grouping: Grouping = 'due';
	private search = '';
	private tasks: FieldyTask[] = [];
	private loaded = false;
	private loading = false;
	private readonly pending = new Set<string>();
	/** How many tasks are drawn; completed tasks pile up over months, so the rest come in batches. */
	private shown = RENDER_BATCH;
	private readonly debouncedRender = debounce(() => this.renderList(), SEARCH_DELAY_MS, true);
	private paths = new Map<string, string>();
	/** Conversations to look up before their tasks can be shown (privacy filters). */
	private privacyQueue: string[] = [];
	private privacyPumping = false;
	private privacyFailed = false;
	/** Conversations Fieldy no longer has: their tasks have no conversation to keep private. */
	private readonly missingConversations = new Set<string>();
	private iconsEl!: HTMLElement;
	private listEl!: HTMLElement;
	private infoEl!: HTMLElement;
	private footerEl!: HTMLElement;

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
		const search = toolbar.createEl('input', { type: 'search', cls: 'fieldy-panel-search', placeholder: 'Search tasks…' });
		search.value = this.search;
		search.addEventListener('input', () => {
			this.search = search.value.trim().toLowerCase();
			this.shown = RENDER_BATCH;
			this.debouncedRender();
		});
		iconButton(toolbar, 'refresh-ccw', 'Reload tasks from Fieldy', () => void this.load(true));

		this.iconsEl = this.root.createDiv({ cls: 'fieldy-filter-icons' });

		this.infoEl = this.root.createDiv({ cls: 'fieldy-panel-info' });
		this.listEl = this.root.createDiv({ cls: 'fieldy-task-list' });
		this.footerEl = this.root.createDiv({ cls: 'fieldy-panel-footer' });
		this.renderList();
	}

	onShow(): void {
		if (!this.loaded && !this.loading) void this.load(false);
	}

	/** Settings changed: privacy filters may now hide other tasks. */
	onSettingsChanged(): void {
		if (!this.loaded) return;
		this.privacyFailed = false;
		this.queuePrivacyChecks();
		this.renderList();
	}

	/**
	 * Whether a task may be shown: tasks of private conversations never are,
	 * and while a conversation is not checked yet, its tasks wait.
	 */
	private taskPrivacy(task: FieldyTask): 'public' | 'private' | 'pending' {
		if (!task.memoryId || !this.plugin.privacy.active() || this.missingConversations.has(task.memoryId)) return 'public';
		const conversation = this.view.data.conversations.get(task.memoryId);
		return conversation ? this.plugin.privacy.check(conversation).state : 'pending';
	}

	/** Looks up, in the background, the conversations of tasks that wait for a privacy check. */
	private queuePrivacyChecks(): void {
		if (!this.plugin.privacy.active() || this.privacyFailed) return;
		const queued = new Set(this.privacyQueue);
		for (const task of this.tasks) {
			if (task.memoryId && !queued.has(task.memoryId) && this.taskPrivacy(task) === 'pending') {
				queued.add(task.memoryId);
				this.privacyQueue.push(task.memoryId);
			}
		}
		void this.pumpPrivacyChecks();
	}

	private async pumpPrivacyChecks(): Promise<void> {
		if (this.privacyPumping) return;
		this.privacyPumping = true;
		const signal = this.view.data.signal;
		const data = this.view.data;
		try {
			await this.plugin.privacy.prepare(signal);
			this.renderList();
			while (this.privacyQueue.length > 0 && !signal.aborted) {
				if (this.plugin.engine.isRunning || this.plugin.rateLimiterBusy) {
					await sleep(PRIVACY_BACKOFF_MS, signal);
					continue;
				}
				const id = this.privacyQueue.shift();
				if (!id) continue;
				let conversation = data.conversations.get(id);
				if (!conversation) {
					conversation = (await this.plugin.client.getConversation(id, { signal })) ?? undefined;
					if (conversation) data.remember([conversation]);
				}
				if (!conversation) this.missingConversations.add(id);
				else if (this.plugin.privacy.check(conversation).state === 'pending') await this.plugin.privacy.resolve(conversation, signal);
				this.plugin.reportRequestOutcome();
				this.renderList();
				await sleep(PRIVACY_SPACING_MS, signal);
			}
		} catch (err) {
			if (!isCancellation(err)) {
				this.plugin.reportRequestOutcome(err);
				this.privacyQueue = [];
				this.privacyFailed = true;
				this.renderList();
			}
		} finally {
			this.privacyPumping = false;
		}
	}

	async load(force: boolean): Promise<void> {
		if (!this.plugin.hasApiKey()) {
			this.renderList();
			return;
		}
		if (force) this.view.data.forgetLists();
		this.loading = true;
		this.renderList();
		try {
			const [tasks, paths] = await Promise.all([this.view.data.allTasks(), this.plugin.noteIndex()]);
			this.tasks = tasks;
			this.paths = paths;
			this.loaded = true;
			this.privacyFailed = false;
			this.queuePrivacyChecks();
		} catch (err) {
			if (!isCancellation(err)) new Notice(describeError(err));
		} finally {
			this.loading = false;
			this.renderList();
		}
	}

	// ------------------------------------------------------------ list

	private matchesSearch(task: FieldyTask): boolean {
		return !this.search || task.title.toLowerCase().includes(this.search) || this.sourceTitle(task).toLowerCase().includes(this.search);
	}

	/** The status groups the icons let through. */
	private shownFilters(): TaskFilter[] {
		const only = TASK_FILTERS.filter((key) => this.rules[key] === 'has');
		return (only.length > 0 ? only : TASK_FILTERS).filter((key) => this.rules[key] !== 'lacks');
	}

	private visible(): FieldyTask[] {
		const shown = this.shownFilters();
		const statuses = shown.flatMap((key) => FILTER_STATUSES[key]);
		const completedOnly = shown.length === 1 && shown[0] === 'completed';
		return this.tasks
			.filter((t) => statuses.includes(t.status) && this.taskPrivacy(t) === 'public' && this.matchesSearch(t))
			.sort((a, b) => {
				if (completedOnly) return (b.completionDate ?? '').localeCompare(a.completionDate ?? '');
				return (a.date ?? '￿').localeCompare(b.date ?? '￿') || a.title.localeCompare(b.title);
			});
	}

	private sourceTitle(task: FieldyTask): string {
		if (!task.memoryId) return '';
		const conversation = this.view.data.conversations.get(task.memoryId);
		if (conversation?.title) return conversation.title;
		const path = this.paths.get(task.memoryId);
		return path ? (path.split('/').pop() ?? path).replace(/\.md$/, '') : '';
	}

	/** Which tasks (with how many each) and how to group them, as icon toggles like the Conversations tab. */
	private renderFilterIcons(): void {
		const icons = this.iconsEl;
		icons.empty();
		for (const key of TASK_FILTERS) {
			const count = this.loaded ? this.tasks.filter((t) => FILTER_STATUSES[key].includes(t.status) && this.taskPrivacy(t) === 'public').length : null;
			const rule = this.rules[key];
			const name = `${FILTER_LABELS[key]}${count === null ? '' : ` (${count})`}`;
			const hint =
				rule === 'has' ? `${name}: only these (click to hide them)`
				: rule === 'lacks' ? `${name}: hidden (click for any)`
				: `${name}: any (click for only these)`;
			const button = iconButton(icons, FILTER_ICONS[key], hint, () => {
				const next = nextContentRule(this.rules[key]);
				if (next) this.rules[key] = next;
				else delete this.rules[key];
				this.shown = RENDER_BATCH;
				this.renderList();
			});
			button.addClass('fieldy-filter-icon', 'fieldy-filter-counted', rule === 'has' ? 'is-on' : rule === 'lacks' ? 'is-lacks' : 'is-any');
			button.setAttribute('aria-pressed', rule ? 'true' : 'false');
			if (count !== null) button.createSpan({ cls: 'fieldy-filter-count', text: String(count) });
		}
		icons.createSpan({ cls: 'fieldy-filter-sep' });
		for (const key of Object.keys(GROUPING_LABELS) as Grouping[]) {
			const on = this.grouping === key;
			const button = iconButton(icons, GROUPING_ICONS[key], GROUPING_LABELS[key], () => {
				this.grouping = key;
				this.renderList();
			});
			button.addClass('fieldy-filter-icon', on ? 'is-on' : 'is-any');
			button.setAttribute('aria-pressed', on ? 'true' : 'false');
		}
	}

	private groups(tasks: FieldyTask[]): [string, FieldyTask[]][] {
		if (this.grouping === 'none') return [['', tasks]];
		const map = new Map<string, FieldyTask[]>();
		if (this.grouping === 'due') {
			for (const key of Object.keys(DUE_GROUP_LABELS) as DueGroup[]) map.set(DUE_GROUP_LABELS[key], []);
			for (const task of tasks) map.get(DUE_GROUP_LABELS[dueGroup(task)])?.push(task);
		} else {
			for (const task of tasks) {
				const key = this.sourceTitle(task) || 'No conversation';
				const list = map.get(key);
				if (list) list.push(task);
				else map.set(key, [task]);
			}
		}
		return [...map].filter(([, list]) => list.length > 0);
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.renderFilterIcons();
		this.listEl.empty();
		this.infoEl.empty();
		this.footerEl.empty();
		if (!this.plugin.hasApiKey()) {
			noKeyMessage(this.infoEl, 'see your Fieldy tasks here');
			return;
		}
		if (this.loading) {
			this.infoEl.setText('Loading tasks from Fieldy…');
			return;
		}
		const tasks = this.visible();
		if (this.loaded && tasks.length === 0) {
			const shown = this.shownFilters();
			const what = shown.length === 1 ? `No ${FILTER_LABELS[shown[0] as TaskFilter].toLowerCase()}.` : 'No task matches these filters.';
			this.infoEl.setText(this.search ? 'No task matches your search.' : what);
		}
		this.renderPrivacyNote();
		// Group headings count every task in the group, drawn or not.
		let budget = this.shown;
		for (const [title, list] of this.groups(tasks)) {
			if (budget <= 0) break;
			if (title) {
				const heading = this.listEl.createDiv({ cls: 'fieldy-task-group', text: `${title} (${list.length})` });
				if (title === DUE_GROUP_LABELS.overdue) heading.addClass('is-overdue');
			}
			for (const task of list.slice(0, budget)) this.renderTask(task);
			budget -= list.length;
		}
		const hidden = tasks.length - this.shown;
		if (hidden > 0) {
			const more = this.listEl.createEl('button', { cls: 'fieldy-conv-more', text: `Show ${Math.min(RENDER_BATCH, hidden)} more (${hidden} not shown yet)` });
			more.addEventListener('click', () => {
				this.shown += RENDER_BATCH;
				this.renderList();
			});
		}
		if (tasks.length > 0) {
			this.footerEl.createSpan({ cls: 'fieldy-muted', text: `${tasks.length} task${tasks.length === 1 ? '' : 's'}` });
			const insertAll = this.footerEl.createEl('button', { text: 'Insert all…' });
			insertAll.addEventListener('click', (evt) => this.formatMenu(evt, tasks, 'insert'));
			const copyAll = this.footerEl.createEl('button', { text: 'Copy all…' });
			copyAll.addEventListener('click', (evt) => this.formatMenu(evt, tasks, 'copy'));
		}
	}

	/** How many tasks the privacy filters hide, or are still checking. */
	private renderPrivacyNote(): void {
		if (!this.loaded || !this.plugin.privacy.active()) return;
		const statuses = this.shownFilters().flatMap((key) => FILTER_STATUSES[key]);
		let hidden = 0;
		let waiting = 0;
		for (const task of this.tasks) {
			if (!statuses.includes(task.status)) continue;
			const state = this.taskPrivacy(task);
			if (state === 'private') hidden++;
			else if (state === 'pending') waiting++;
		}
		const parts: string[] = [];
		if (hidden > 0) parts.push(`${hidden} task${hidden === 1 ? '' : 's'} hidden: from private conversations.`);
		if (waiting > 0) {
			parts.push(
				this.privacyFailed
					? `${waiting} more hidden: their conversations could not be checked against your privacy filters (reload to try again).`
					: `Checking the privacy filters for ${waiting} more…`,
			);
		}
		if (parts.length > 0) this.infoEl.createDiv({ cls: 'fieldy-muted fieldy-task-privacy', text: parts.join(' ') });
	}

	private renderTask(task: FieldyTask): void {
		const busy = this.pending.has(task.id);
		const overdue = isOpen(task) && dueGroup(task) === 'overdue';
		const row = this.listEl.createDiv({ cls: `fieldy-task fieldy-task-${task.status}${busy ? ' is-busy' : ''}${overdue ? ' is-overdue' : ''}` });

		if (isOpen(task) || task.status === 'completed') {
			const done = task.status === 'completed';
			const check = row.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox fieldy-task-check' });
			check.checked = done;
			check.disabled = busy;
			const label = done ? 'Reopen in Fieldy' : 'Mark as done in Fieldy';
			check.setAttribute('aria-label', label);
			setTooltip(check, label);
			check.addEventListener('click', (evt) => {
				evt.preventDefault();
				void this.change(task, done ? { status: 'new' } : { status: 'completed', completionDate: new Date().toISOString() }, done ? 'Task reopened.' : 'Task marked as done.');
			});
		} else {
			const icon = row.createSpan({ cls: 'fieldy-task-icon' });
			setIcon(icon, STATUS_ICONS[task.status]);
			setTooltip(icon, `Dismissed in Fieldy (${task.status})`);
		}

		const main = row.createDiv({ cls: 'fieldy-task-main' });
		main.createDiv({ cls: 'fieldy-task-title', text: inlineText(task.title) || 'Untitled task' });
		const meta: string[] = [];
		if (task.date) meta.push(`${overdue ? 'Overdue: due' : 'Due'} ${moment(task.date).format('ddd D MMM YYYY')}`);
		if (task.status === 'completed' && task.completionDate) meta.push(`Done ${moment(task.completionDate).format('ddd D MMM YYYY')}`);
		if (DISMISSED.includes(task.status)) meta.push(task.status);
		const source = this.sourceTitle(task);
		if (source && this.grouping !== 'conversation') meta.push(`From: ${source}`);
		if (meta.length > 0) main.createDiv({ cls: 'fieldy-task-meta', text: meta.join(' · ') });

		// The same icon buttons as on conversation cards, below the text so long titles keep the width.
		const actions = main.createDiv({ cls: 'fieldy-task-actions' });
		if (!isOpen(task) && task.status !== 'completed') {
			iconButton(actions, 'rotate-ccw', 'Reopen in Fieldy', () => void this.change(task, { status: 'new' }, 'Task reopened.'));
		}
		iconButton(actions, 'pencil', 'Edit the title and due date in Fieldy…', () =>
			new EditTaskModal(this.view.app, task, (changes) => void this.change(task, changes, 'Task updated.')).open(),
		);
		if (isOpen(task)) iconButton(actions, 'circle-x', 'Cancel the task in Fieldy…', () => this.confirmCancel(task)).addClass('fieldy-icon-danger');
		const memoryId = task.memoryId;
		if (memoryId) {
			const path = this.paths.get(memoryId);
			if (path) iconButton(actions, 'file-text', 'Open the conversation note', () => void this.plugin.openNote(path));
			iconButton(actions, 'messages-square', 'Show the conversation in the panel', () => void this.view.showConversation(memoryId));
		}
		iconButton(actions, 'text-cursor-input', 'Insert into the note you are editing…', (evt) => this.formatMenu(evt, [task], 'insert'));
		iconButton(actions, 'copy', 'Copy…', (evt) => this.formatMenu(evt, [task], 'copy'));
		for (const button of actions.querySelectorAll('button')) button.disabled = busy;
	}

	// ---------------------------------------------------------- changes

	/** Sends one change to Fieldy, then shows the task as Fieldy returns it. */
	private async change(task: FieldyTask, changes: TaskChanges, done: string): Promise<void> {
		if (this.pending.has(task.id)) return;
		this.pending.add(task.id);
		this.renderList();
		try {
			const updated = (await this.plugin.client.updateTask(task.id, changes, { signal: this.view.data.signal })) ?? { ...task, ...changes };
			this.plugin.reportRequestOutcome();
			const index = this.tasks.findIndex((t) => t.id === task.id);
			if (index !== -1) this.tasks[index] = updated;
			await this.view.data.replaceTask(updated);
			const hasNote = task.memoryId ? this.paths.has(task.memoryId) : false;
			new Notice(hasNote ? `${done} Its note shows it after the next sync.` : done);
		} catch (err) {
			if (!isCancellation(err)) {
				this.plugin.reportRequestOutcome(err);
				new Notice(describeError(err));
			}
		} finally {
			this.pending.delete(task.id);
			this.renderList();
		}
	}

	private confirmCancel(task: FieldyTask): void {
		new ConfirmationModal(this.view.app)
			.setTitle('Cancel this task?')
			.setContent(`"${inlineText(task.title)}" will be marked as cancelled in Fieldy. You can reopen it later from "Dismissed tasks".`)
			.addButton((button) =>
				button
					.setButtonText('Cancel task')
					.setDestructive()
					.onClick(() => void this.change(task, { status: 'cancelled', cancellationDate: new Date().toISOString() }, 'Task cancelled.')),
			)
			.addCancelButton()
			.open();
	}

	// ----------------------------------------------------- insert / copy

	private markdown(tasks: readonly FieldyTask[], format: TasksFormat | null): string {
		const formatDate = (iso: string, f: string) => moment(iso).format(f);
		const today = new Date().toISOString();
		if (!format) return tasks.map((t) => taskLine(t, undefined, formatDate, false, this.plugin.settings.dataviewTaskFields)).join('\n');
		return tasks
			.map((t) => {
				const path = t.memoryId ? this.paths.get(t.memoryId) : undefined;
				const file = path ? this.view.app.vault.getFileByPath(path) : null;
				const link = file ? this.view.app.fileManager.generateMarkdownLink(file, '') : undefined;
				return obsidianTaskLine(t, format, formatDate, link, today);
			})
			.join('\n');
	}

	/** Checklist, or Obsidian Tasks items when that plugin is enabled. */
	private formatMenu(evt: MouseEvent, tasks: readonly FieldyTask[], mode: 'insert' | 'copy'): void {
		const what = tasks.length === 1 ? 'Task' : 'Tasks';
		const deliver = (format: TasksFormat | null) => {
			const text = this.markdown(tasks, format);
			if (mode === 'insert') insertIntoLastNote(this.view.app, text, what);
			else void copyToClipboard(text, what);
		};
		if (!tasksPluginEnabled(this.view.app)) {
			deliver(null);
			return;
		}
		new Menu()
			.addItem((item) =>
				item
					.setTitle('As Obsidian tasks, with dates and a link to the note')
					.setIcon('list-checks')
					// Read at click time, so the current Tasks settings are used.
					.onClick(() => void readTasksFormat(this.view.app).then(deliver)),
			)
			.addItem((item) => item.setTitle('As a plain checklist').setIcon('list-todo').onClick(() => deliver(null)))
			.showAtMouseEvent(evt);
	}
}

/** Title and due date of one task; only what changed is sent to Fieldy. */
class EditTaskModal extends Modal {
	constructor(
		app: App,
		private readonly task: FieldyTask,
		private readonly onSave: (changes: TaskChanges) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Edit task');
		let title = this.task.title;
		let due = this.task.date ? moment(this.task.date).format('YYYY-MM-DD') : '';
		new Setting(this.contentEl).setName('Title').addText((text) => {
			text.setValue(title).onChange((v) => (title = v));
			text.inputEl.addClass('fieldy-edit-task-title');
		});
		new Setting(this.contentEl)
			.setName('Due date')
			.setDesc(this.task.date ? 'Fieldy cannot remove a due date, only change it.' : 'Optional.')
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setValue(due).onChange((v) => (due = v));
			});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText('Save in Fieldy')
					.setCta()
					.onClick(() => {
						const changes: TaskChanges = {};
						const trimmed = title.trim();
						if (trimmed && trimmed !== this.task.title) changes.title = trimmed;
						const oldDue = this.task.date ? moment(this.task.date).format('YYYY-MM-DD') : '';
						// Noon local time, so the day stays the same in every time zone Fieldy may show it in.
						if (due && due !== oldDue) changes.date = moment(due, 'YYYY-MM-DD').hour(12).toISOString();
						this.close();
						if (Object.keys(changes).length > 0) this.onSave(changes);
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
