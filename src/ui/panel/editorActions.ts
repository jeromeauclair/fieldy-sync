import { MarkdownView, Notice, type App } from 'obsidian';
import { describeError } from '../../utils/errors';

/** Shows a short message; the side panel shows its own inside itself, elsewhere an Obsidian notice. */
export type Notify = (text: string, kind?: 'info' | 'error') => void;

const notice: Notify = (text) => void new Notice(text);

/**
 * Inserts Markdown at the cursor of the note the user was last editing. The
 * panel has focus when its buttons are clicked, so the most recent leaf of
 * the main area is used rather than the active one. Uses the Editor API so
 * cursor, selection and undo history behave normally.
 */
export function insertIntoLastNote(app: App, markdown: string, what: string, notify: Notify = notice): boolean {
	const leaf = app.workspace.getMostRecentLeaf();
	const view = leaf?.view instanceof MarkdownView ? leaf.view : null;
	if (!leaf || !view) {
		notify('Open a note first: the text goes where you were last typing.', 'error');
		return false;
	}
	const editor = view.editor;
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	let prefix = '';
	if (line.trim() !== '') {
		// Never split the user's line: continue after it, as a new block.
		editor.setCursor({ line: cursor.line, ch: line.length });
		prefix = '\n\n';
	} else if (cursor.line > 0 && editor.getLine(cursor.line - 1).trim() !== '') {
		// Keep a blank line between the previous block and the inserted one.
		prefix = '\n';
	}
	editor.replaceSelection(`${prefix}${markdown.trimEnd()}\n`);
	app.workspace.setActiveLeaf(leaf, { focus: true });
	notify(`${what} inserted into "${view.file?.basename ?? 'the note'}".`);
	return true;
}

export async function copyToClipboard(text: string, what: string, notify: Notify = notice): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		notify(`${what} copied to the clipboard.`);
	} catch (err) {
		notify(describeError(err), 'error');
	}
}
