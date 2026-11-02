import { describe, expect, it } from 'vitest';
import { DEFAULT_TASKS_FORMAT, obsidianEventLine, obsidianTaskLine, type TasksFormat } from '../../src/markdown/obsidianTasks';
import { parseTasksSettings, readTasksFormat, tasksPluginEnabled } from '../../src/ui/tasksPlugin';
import { formatUtc, makeTask } from '../helpers/fixtures';

const fmt = (patch: Partial<TasksFormat> = {}): TasksFormat => ({ ...DEFAULT_TASKS_FORMAT, ...patch });
const due = '2026-11-03T12:00:00.000Z';
const done = makeTask('t1', 'c1', 'completed', { title: 'Book', date: due, completionDate: '2026-11-01T09:00:00.000Z' });
const cancelled = makeTask('t2', 'c1', 'skipped', { title: 'Old idea', cancellationDate: '2026-10-20T09:00:00.000Z' });

describe('obsidianTaskLine', () => {
	it('writes open tasks with their due date in the emoji format', () => {
		expect(obsidianTaskLine(makeTask('t1', 'c1', 'new', { title: 'Send the quote', date: due }), fmt(), formatUtc)).toBe('- [ ] Send the quote 📅 2026-11-03');
		expect(obsidianTaskLine(makeTask('t1', 'c1', 'approved', { title: 'Call back' }), fmt(), formatUtc)).toBe('- [ ] Call back');
	});

	it('marks done and cancelled tasks with the default symbols and dates', () => {
		expect(obsidianTaskLine(done, fmt(), formatUtc)).toBe('- [x] Book 📅 2026-11-03 ✅ 2026-11-01');
		expect(obsidianTaskLine(cancelled, fmt(), formatUtc)).toBe('- [-] Old idea ❌ 2026-10-20');
	});

	it('uses the status symbols configured in the Tasks plugin', () => {
		const custom = fmt({ todoSymbol: ' ', doneSymbol: 'X', cancelledSymbol: '~' });
		expect(obsidianTaskLine(done, custom, formatUtc)).toBe('- [X] Book 📅 2026-11-03 ✅ 2026-11-01');
		expect(obsidianTaskLine(cancelled, custom, formatUtc)).toBe('- [~] Old idea ❌ 2026-10-20');
	});

	it('leaves out done, cancelled and created dates according to the Tasks settings', () => {
		const off = fmt({ setDoneDate: false, setCancelledDate: false });
		expect(obsidianTaskLine(done, off, formatUtc)).toBe('- [x] Book 📅 2026-11-03');
		expect(obsidianTaskLine(cancelled, off, formatUtc)).toBe('- [-] Old idea');
		const created = fmt({ setCreatedDate: true });
		expect(obsidianTaskLine(done, created, formatUtc, undefined, '2026-11-02T10:00:00.000Z')).toBe('- [x] Book ➕ 2026-11-02 📅 2026-11-03 ✅ 2026-11-01');
	});

	it('writes Dataview fields the way the Tasks plugin does (two spaces, plugin field order)', () => {
		expect(obsidianTaskLine(done, fmt({ style: 'dataview' }), formatUtc)).toBe('- [x] Book  [due:: 2026-11-03]  [completion:: 2026-11-01]');
		expect(obsidianTaskLine(cancelled, fmt({ style: 'dataview' }), formatUtc)).toBe('- [-] Old idea  [cancelled:: 2026-10-20]');
	});

	it('adds the global filter first and the note link before the metadata', () => {
		const task = makeTask('t1', 'c1', 'new', { title: 'Send it', date: due });
		expect(obsidianTaskLine(task, fmt({ globalFilter: '#task' }), formatUtc, '[[Kickoff]]')).toBe('- [ ] #task Send it [[Kickoff]] 📅 2026-11-03');
		const tagged = makeTask('t2', 'c1', 'new', { title: 'Already #task tagged' });
		expect(obsidianTaskLine(tagged, fmt({ globalFilter: '#task' }), formatUtc)).toBe('- [ ] Already #task tagged');
	});

	it('removes Tasks signifiers and inline fields from titles so they cannot fake metadata', () => {
		const sneaky = makeTask('t1', 'c1', 'new', { title: 'Pay 📅 2020-01-01 now [due:: 2020-01-01] ⏫' });
		expect(obsidianTaskLine(sneaky, fmt(), formatUtc)).toBe('- [ ] Pay 2020-01-01 now');
	});
});

describe('Tasks plugin settings', () => {
	const app = (enabled: boolean, data?: unknown) =>
		({
			plugins: {
				enabledPlugins: new Set(enabled ? ['obsidian-tasks-plugin'] : []),
				// The Tasks plugin has no settings property: its settings come from its data file.
				getPlugin: () => (enabled ? { loadData: () => Promise.resolve(data) } : null),
			},
		}) as never;

	it('is off when the Tasks plugin is not enabled', async () => {
		expect(tasksPluginEnabled(app(false))).toBe(false);
		expect(tasksPluginEnabled({} as never)).toBe(false);
		expect(await readTasksFormat(app(false))).toBeNull();
	});

	it('reads the saved settings through the plugin, with its defaults for anything missing', async () => {
		expect(tasksPluginEnabled(app(true))).toBe(true);
		expect(await readTasksFormat(app(true, null))).toEqual(DEFAULT_TASKS_FORMAT);
		expect(await readTasksFormat(app(true, { globalFilter: '#task' }))).toEqual({ ...DEFAULT_TASKS_FORMAT, globalFilter: '#task' });
	});

	it('uses the defaults when the settings cannot be read', async () => {
		const broken = { plugins: { enabledPlugins: new Set(['obsidian-tasks-plugin']), getPlugin: () => ({ loadData: () => Promise.reject(new Error('no')) }) } } as never;
		expect(await readTasksFormat(broken)).toEqual(DEFAULT_TASKS_FORMAT);
	});

	it('reads the format, global filter, date options and status symbols as the Tasks plugin stores them', () => {
		const settings = {
			taskFormat: 'dataview',
			globalFilter: '#todo',
			setCreatedDate: true,
			setDoneDate: false,
			setCancelledDate: false,
			statusSettings: {
				coreStatuses: [
					{ symbol: ' ', name: 'Todo', nextStatusSymbol: 'x', availableAsCommand: true, type: 'TODO' },
					{ symbol: 'X', name: 'Done', nextStatusSymbol: ' ', availableAsCommand: true, type: 'DONE' },
				],
				customStatuses: [
					{ symbol: '/', name: 'In Progress', nextStatusSymbol: 'X', availableAsCommand: true, type: 'IN_PROGRESS' },
					{ symbol: 'c', name: 'Cancelled', nextStatusSymbol: ' ', availableAsCommand: true, type: 'CANCELLED' },
					{ symbol: 'too long', name: 'Broken', nextStatusSymbol: ' ', availableAsCommand: false, type: 'CANCELLED' },
				],
			},
		};
		expect(parseTasksSettings(settings)).toEqual({
			style: 'dataview',
			globalFilter: '#todo',
			todoSymbol: ' ',
			doneSymbol: 'X',
			cancelledSymbol: 'c',
			setCreatedDate: true,
			setDoneDate: false,
			setCancelledDate: false,
		});
	});

	it('keeps the default cancelled symbol when no cancelled status is configured', () => {
		expect(parseTasksSettings({ statusSettings: { coreStatuses: [], customStatuses: [] } }).cancelledSymbol).toBe('-');
	});
});

describe('obsidianEventLine', () => {
	const start = '2026-10-01T14:00:00.000Z';

	it('schedules the meeting on its day, with the note link before the metadata', () => {
		expect(obsidianEventLine('Kickoff with Acme', start, fmt(), formatUtc, '[[Kickoff]]')).toBe('- [ ] Kickoff with Acme [[Kickoff]] ⏳ 2026-10-01');
		expect(obsidianEventLine('Kickoff', start, fmt({ style: 'dataview' }), formatUtc)).toBe('- [ ] Kickoff  [scheduled:: 2026-10-01]');
	});

	it('follows the global filter, created dates and status symbols, and strips signifiers from the title', () => {
		const format = fmt({ globalFilter: '#task', setCreatedDate: true, todoSymbol: '/' });
		expect(obsidianEventLine('Call 📅 2026-12-01', start, format, formatUtc, undefined, '2026-10-29T12:00:00.000Z')).toBe('- [/] #task Call 2026-12-01 ➕ 2026-10-29 ⏳ 2026-10-01');
	});
});
