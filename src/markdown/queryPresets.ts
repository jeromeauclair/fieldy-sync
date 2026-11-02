/** Ready-made queries the "Insert a Fieldy query" command offers. */
export interface QueryPreset {
	name: string;
	description: string;
	/** `fieldy` needs nothing else; `dataview` needs the Dataview plugin. */
	engine: 'fieldy' | 'dataview';
	/** The whole code block, fences included. */
	block: string;
}

const fieldy = (body: string) => ['```fieldy', body, '```'].join('\n');
const dataview = (body: string) => ['```dataview', body, '```'].join('\n');

export const QUERY_PRESETS: readonly QueryPreset[] = [
	{
		name: "This week's conversations",
		description: 'Fieldy block: a list of this week\'s conversations with date, length and people.',
		engine: 'fieldy',
		block: fieldy('show: conversations\nperiod: this week'),
	},
	{
		name: 'Open Fieldy tasks',
		description: 'Fieldy block: every open task from your Fieldy notes, soonest due first.',
		engine: 'fieldy',
		block: fieldy('show: tasks\ntasks: open'),
	},
	{
		name: 'Stats for this month',
		description: 'Fieldy block: conversations, time recorded, busiest days, people you talk with most, tasks.',
		engine: 'fieldy',
		block: fieldy('show: stats\nperiod: this month'),
	},
	{
		name: 'Conversations with someone',
		description: 'Fieldy block: conversations with one person (edit the name).',
		engine: 'fieldy',
		block: fieldy('show: conversations\nperiod: all\nspeaker: Name\nlimit: 20'),
	},
	{
		name: 'Dataview: conversations table',
		description: 'Dataview: the last 50 conversations with start, minutes and speakers.',
		engine: 'dataview',
		block: dataview(
			[
				'TABLE WITHOUT ID file.link AS "Conversation", fieldy_start AS "Start", fieldy_duration_minutes AS "Minutes", fieldy_speakers AS "Speakers"',
				'WHERE fieldy_id',
				'SORT fieldy_start DESC',
				'LIMIT 50',
			].join('\n'),
		),
	},
	{
		name: 'Dataview: open Fieldy tasks',
		description: 'Dataview: open tasks in Fieldy notes, grouped by conversation (set "Due dates as Dataview fields" to sort by due date).',
		engine: 'dataview',
		block: dataview(['TASK', 'WHERE fieldy_id AND !completed AND status = " "', 'SORT due ASC', 'GROUP BY file.link'].join('\n')),
	},
	{
		name: 'Dataview: minutes recorded per day',
		description: 'Dataview: conversations and minutes per day for the last 30 days.',
		engine: 'dataview',
		block: dataview(
			[
				'TABLE WITHOUT ID key AS "Day", length(rows) AS "Conversations", sum(rows.fieldy_duration_minutes) AS "Minutes"',
				'WHERE fieldy_id AND date(fieldy_start) >= date(today) - dur(30 days)',
				'GROUP BY dateformat(date(fieldy_start), "yyyy-MM-dd")',
				'SORT key DESC',
			].join('\n'),
		),
	},
];
