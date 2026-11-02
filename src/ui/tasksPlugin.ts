import type { App } from 'obsidian';
import { DEFAULT_TASKS_FORMAT, type TasksFormat } from '../markdown/obsidianTasks';

const TASKS_PLUGIN_ID = 'obsidian-tasks-plugin';

interface TasksPluginInstance {
	loadData?: () => Promise<unknown>;
}

interface PluginRegistry {
	enabledPlugins?: Set<string>;
	getPlugin?: (id: string) => TasksPluginInstance | null;
}

function registry(app: App): PluginRegistry | undefined {
	return (app as unknown as { plugins?: PluginRegistry }).plugins;
}

/**
 * Whether the Obsidian Tasks plugin is installed and enabled. Obsidian has no
 * public API for other plugins, so `app.plugins` is read defensively:
 * anything unexpected means "not enabled".
 */
export function tasksPluginEnabled(app: App): boolean {
	return registry(app)?.enabledPlugins?.has(TASKS_PLUGIN_ID) === true;
}

/** Whether another community plugin (by id) is enabled; same defensive read. */
export function pluginEnabled(app: App, id: string): boolean {
	return registry(app)?.enabledPlugins?.has(id) === true;
}

type StatusType = 'TODO' | 'DONE' | 'IN_PROGRESS' | 'ON_HOLD' | 'CANCELLED' | 'NON_TASK' | 'EMPTY';

/** `statusSettings.coreStatuses` then `customStatuses`: `{ symbol, type, … }` as the Tasks plugin stores them. */
function statuses(settings: Record<string, unknown>): { symbol: string; type: StatusType }[] {
	const raw = settings.statusSettings;
	if (typeof raw !== 'object' || raw === null) return [];
	const groups = raw as { coreStatuses?: unknown; customStatuses?: unknown };
	const asList = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
	const list = [...asList(groups.coreStatuses), ...asList(groups.customStatuses)];
	return list.flatMap((s) => {
		if (typeof s !== 'object' || s === null) return [];
		const { symbol, type } = s as { symbol?: unknown; type?: unknown };
		// A checkbox holds exactly one character; anything else cannot be written as a status.
		return typeof symbol === 'string' && [...symbol].length === 1 && typeof type === 'string' ? [{ symbol, type: type as StatusType }] : [];
	});
}

/**
 * The Obsidian Tasks plugin's settings as they are now, or null when the
 * plugin is not enabled. The Tasks plugin keeps its settings in a module of
 * its own (not on the plugin object) and saves them to its data file on every
 * change, so they are read with the plugin's own `loadData()` each time.
 * Missing or unexpected values fall back to the Tasks plugin's defaults.
 */
export async function readTasksFormat(app: App): Promise<TasksFormat | null> {
	if (!tasksPluginEnabled(app)) return null;
	let raw: unknown = null;
	try {
		raw = await registry(app)?.getPlugin?.(TASKS_PLUGIN_ID)?.loadData?.();
	} catch {
		// Unreadable settings: use the defaults, like the Tasks plugin does.
	}
	return parseTasksSettings(raw);
}

/** Tasks plugin settings (`data.json`) → what decides how a task line is written. */
export function parseTasksSettings(raw: unknown): TasksFormat {
	const settings = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	const d = DEFAULT_TASKS_FORMAT;
	const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
	const list = statuses(settings);
	const symbolFor = (type: StatusType, fallback: string) => list.find((s) => s.type === type)?.symbol ?? fallback;
	return {
		style: settings.taskFormat === 'dataview' ? 'dataview' : 'emoji',
		globalFilter: typeof settings.globalFilter === 'string' ? settings.globalFilter : d.globalFilter,
		todoSymbol: symbolFor('TODO', d.todoSymbol),
		doneSymbol: symbolFor('DONE', d.doneSymbol),
		cancelledSymbol: symbolFor('CANCELLED', d.cancelledSymbol),
		setCreatedDate: bool(settings.setCreatedDate, d.setCreatedDate),
		setDoneDate: bool(settings.setDoneDate, d.setDoneDate),
		setCancelledDate: bool(settings.setCancelledDate, d.setCancelledDate),
	};
}
