import { describe, expect, it } from 'vitest';
import {
	computeStats,
	parseFieldyQuery,
	parsePeriod,
	selectConversations,
	selectTasks,
	speakerLabel,
	tasksInSection,
	type ConversationRecord,
} from '../../src/markdown/fieldyQuery';

// Wednesday 2026-11-04 15:00 local time.
const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

const conv = (path: string, start: number, overrides: Partial<ConversationRecord> = {}): ConversationRecord => ({
	path,
	title: path,
	start,
	minutes: 30,
	speakers: [],
	kind: 'full',
	location: null,
	...overrides,
});

describe('parsePeriod', () => {
	it('understands named periods relative to now (weeks start on Monday)', () => {
		expect(parsePeriod('today', NOW)).toMatchObject({ from: local(2026, 11, 4), to: local(2026, 11, 5) });
		expect(parsePeriod('yesterday', NOW)).toMatchObject({ from: local(2026, 11, 3), to: local(2026, 11, 4) });
		expect(parsePeriod('This Week', NOW)).toMatchObject({ from: local(2026, 11, 2), to: local(2026, 11, 9) });
		expect(parsePeriod('last week', NOW)).toMatchObject({ from: local(2026, 10, 26), to: local(2026, 11, 2) });
		expect(parsePeriod('this month', NOW)).toMatchObject({ from: local(2026, 11, 1), to: local(2026, 12, 1) });
		expect(parsePeriod('last month', NOW)).toMatchObject({ from: local(2026, 10, 1), to: local(2026, 11, 1) });
		expect(parsePeriod('all', NOW)).toMatchObject({ from: null, to: null });
	});

	it('understands day counts and dates, and rejects nonsense', () => {
		expect(parsePeriod('3 days', NOW)).toMatchObject({ from: NOW - 3 * 86_400_000, to: null, label: 'last 3 days' });
		expect(parsePeriod('last 14 days', NOW)?.label).toBe('last 14 days');
		expect(parsePeriod('2026-10-01 to 2026-10-31', NOW)).toMatchObject({ from: local(2026, 10, 1), to: local(2026, 11, 1) });
		expect(parsePeriod('2026-10-05', NOW)).toMatchObject({ from: local(2026, 10, 5), to: local(2026, 10, 6) });
		expect(parsePeriod('2026-02-30', NOW)).toBeNull();
		expect(parsePeriod('2026-10-31 to 2026-10-01', NOW)).toBeNull();
		expect(parsePeriod('soon', NOW)).toBeNull();
	});
});

describe('parseFieldyQuery', () => {
	it('defaults to conversations of the last 7 days', () => {
		expect(parseFieldyQuery('', NOW)).toMatchObject({ show: 'conversations', periodLabel: 'last 7 days', limit: 50, errors: [] });
	});

	it('reads options, ignores comments and reports mistakes without failing', () => {
		const q = parseFieldyQuery('show: tasks  # what to list\nperiod: this month\nspeaker: Marie\ntasks: done\nlimit: 5\ncolour: red\nsort: sideways', NOW);
		expect(q).toMatchObject({ show: 'tasks', periodLabel: 'this month', speaker: 'Marie', tasks: 'done', limit: 5 });
		expect(q.errors).toHaveLength(2);
		expect(q.errors[0]).toContain('Unknown option "colour"');
	});

	it('looks at all time for tasks unless a period is given', () => {
		expect(parseFieldyQuery('show: tasks', NOW)).toMatchObject({ from: null, periodLabel: 'all time' });
	});
});

describe('selection and stats', () => {
	const a = conv('a', local(2026, 11, 3, 9), { speakers: ['[[People/Marie Tremblay|Marie Tremblay]]', 'Unknown'], minutes: 45 });
	const b = conv('b', local(2026, 11, 4, 10), { speakers: ['Paul'], kind: 'brief', minutes: 1 });
	const c = conv('c', local(2026, 10, 1, 10), { speakers: ['Marie Tremblay'], minutes: 90 });

	it('filters by period, kind and part of a speaker name, and sorts', () => {
		const q = parseFieldyQuery('period: 7 days', NOW);
		expect(selectConversations([a, b, c], q).map((x) => x.path)).toEqual(['b', 'a']);
		expect(selectConversations([a, b, c], parseFieldyQuery('period: all\nspeaker: marie\nsort: longest', NOW)).map((x) => x.path)).toEqual(['c', 'a']);
		expect(selectConversations([a, b, c], parseFieldyQuery('period: all\nkind: full\nsort: oldest', NOW)).map((x) => x.path)).toEqual(['c', 'a']);
	});

	it('reads tasks of the Fieldy section only, with their due dates in any format', () => {
		const lines = [
			'- [ ] my own task',
			'%% fieldy:begin %%',
			'- [ ] Send the offer (due 2026-11-10) %%fieldy-task:t1%%',
			'- [x] Book the room [due:: 2026-11-01] %%fieldy-task:t2%%',
			'- [-] Old idea (cancelled) %%fieldy-task:t3%%',
			'- [ ] Call back 📅 2026-11-05',
			'%% fieldy:end %%',
		];
		const tasks = tasksInSection(lines, 1, 6, a);
		expect(tasks.map((t) => [t.text, t.status, t.due])).toEqual([
			['Send the offer', ' ', '2026-11-10'],
			['Book the room', 'x', '2026-11-01'],
			['Old idea (cancelled)', '-', null],
			['Call back', ' ', '2026-11-05'],
		]);
		expect(selectTasks(tasks, parseFieldyQuery('show: tasks', NOW)).map((t) => t.text)).toEqual(['Call back', 'Send the offer']);
		expect(selectTasks(tasks, parseFieldyQuery('show: tasks\ntasks: all', NOW))).toHaveLength(4);
	});

	it('computes totals, busiest days and top named speakers', () => {
		const stats = computeStats([a, b, c], tasksInSection(['%% fieldy:begin %%', '- [ ] x', '- [x] y', '%% fieldy:end %%'], 0, 3, a));
		expect(stats).toMatchObject({ conversations: 3, minutes: 136, averageMinutes: 45, days: 3, openTasks: 1, doneTasks: 1 });
		expect(stats.longest?.path).toBe('c');
		expect(stats.topSpeakers).toEqual([
			{ name: 'Marie Tremblay', count: 2 },
			{ name: 'Paul', count: 1 },
		]);
		expect(stats.busiestDays[0]).toMatchObject({ day: '2026-10-01', minutes: 90 });
	});

	it('shows link labels as names', () => {
		expect(speakerLabel('[[People/Marie|Marie T.]]')).toBe('Marie T.');
		expect(speakerLabel('[[People/Marie]]')).toBe('Marie');
		expect(speakerLabel(' Paul ')).toBe('Paul');
	});
});

describe('query presets', () => {
	it('offers only fieldy blocks that parse without errors', async () => {
		const { QUERY_PRESETS } = await import('../../src/markdown/queryPresets');
		for (const preset of QUERY_PRESETS.filter((p) => p.engine === 'fieldy')) {
			const body = preset.block.split('\n').slice(1, -1).join('\n');
			expect(parseFieldyQuery(body, NOW).errors, preset.name).toEqual([]);
		}
	});
});
