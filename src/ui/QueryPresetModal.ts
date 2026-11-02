import { SuggestModal, type App } from 'obsidian';
import { QUERY_PRESETS, type QueryPreset } from '../markdown/queryPresets';
import { insertIntoLastNote } from './panel/editorActions';
import { pluginEnabled } from './tasksPlugin';

const DATAVIEW_ID = 'dataview';

/** Picks a ready-made ```fieldy``` block or Dataview query and inserts it at the cursor. */
export class QueryPresetModal extends SuggestModal<QueryPreset> {
	private readonly dataview: boolean;

	constructor(app: App) {
		super(app);
		this.dataview = pluginEnabled(app, DATAVIEW_ID);
		this.setPlaceholder('Insert a Fieldy query…');
	}

	override getSuggestions(query: string): QueryPreset[] {
		const q = query.trim().toLowerCase();
		return QUERY_PRESETS.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q));
	}

	override renderSuggestion(preset: QueryPreset, el: HTMLElement): void {
		el.createDiv({ text: preset.name });
		const note = preset.engine === 'dataview' && !this.dataview ? ' Needs the Dataview plugin, which is not enabled.' : '';
		el.createEl('small', { cls: 'fieldy-muted', text: preset.description + note });
	}

	override onChooseSuggestion(preset: QueryPreset): void {
		insertIntoLastNote(this.app, preset.block, preset.engine === 'dataview' ? 'Dataview query' : 'Fieldy query');
	}
}
