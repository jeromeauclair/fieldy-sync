/*
 * Every string that comes from the Fieldy API is untrusted. Obsidian renders
 * Markdown with embedded HTML, comments (`%%`), wikilinks and embeds, so the
 * helpers below neutralise the constructs that could inject markup, hide
 * content, break the managed-block markers or pull other vault files into a
 * note. They keep ordinary text readable in both source and reading views.
 */

/** HTML tag openers (`<b`, `</`, `<!--`, `<?`) become `&lt;` so no element is created. */
function neutraliseHtml(text: string): string {
	return text.replace(/<(?=[A-Za-z/!?])/g, '&lt;');
}

/** `%%` starts an Obsidian comment (and our markers); break the pair. */
function neutraliseComments(text: string): string {
	return text.replace(/%%/g, '%&#37;');
}

/** `[[` / `![[` would create links or embed vault files. */
function neutraliseWikilinks(text: string): string {
	return text.replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]');
}

/**
 * `![alt](target)` would embed a vault file or load a remote image (a
 * tracking pixel) whenever the note is viewed; escaping `![` keeps it a
 * plain, click-to-open link.
 */
function neutraliseEmbeds(text: string): string {
	return text.replace(/!\[/g, '!\\[');
}

/**
 * Links with script-capable schemes, and `obsidian://` URIs (which can
 * trigger app or plugin actions), are defanged.
 */
function neutraliseLinkSchemes(text: string): string {
	return text
		.replace(/\]\(\s*<?\s*(javascript|vbscript|data|file|obsidian):/gi, '](unsafe-$1:')
		.replace(/\bobsidian:\/\//gi, 'obsidian&#58;//');
}

function neutraliseAll(text: string): string {
	return neutraliseLinkSchemes(neutraliseEmbeds(neutraliseWikilinks(neutraliseComments(neutraliseHtml(text)))));
}

/** Removes control characters other than tab and newline. */
function stripControl(text: string): string {
	// eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
	return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function normaliseNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

/** Escapes characters that would start a block construct at the beginning of a line. */
export function escapeLineStart(line: string): string {
	const match = /^(\s*)(.*)$/s.exec(line);
	const indent = match?.[1] ?? '';
	const rest = match?.[2] ?? line;
	if (/^(#{1,6}(\s|$)|>|[-*+](\s|$)|\||```|~~~|={3,}\s*$|-{3,}\s*$)/.test(rest)) return `${indent}\\${rest}`;
	const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(rest);
	if (ordered) return `${indent}${ordered[1]}\\${rest.slice((ordered[1] ?? '').length)}`;
	return line;
}

/** Single-line plain text (titles, task titles, names, transcript segments). */
export function inlineText(text: string | null | undefined): string {
	if (!text) return '';
	const flat = stripControl(normaliseNewlines(text)).replace(/\s+/g, ' ').trim();
	return neutraliseAll(flat);
}

/** Plain text that starts a line (transcript paragraphs, quotes). */
export function lineText(text: string | null | undefined): string {
	return escapeLineStart(inlineText(text));
}

function demoteHeadings(text: string, levels: number): string {
	return text.replace(/^(\s{0,3})(#{1,6})(?=\s)/gm, (_m, indent: string, hashes: string) => `${indent}${'#'.repeat(Math.min(6, hashes.length + levels))}`);
}

function closeOpenFences(text: string): string {
	const fences = text.match(/^\s{0,3}(```|~~~)/gm) ?? [];
	return fences.length % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/**
 * Multi-line Markdown produced by Fieldy (summaries, memory content). Basic
 * Markdown formatting is kept; headings are demoted below the note's own
 * section headings; anything that could inject HTML, comments or embeds is
 * neutralised.
 */
export function markdownBlock(text: string | null | undefined, headingOffset = 2): string {
	if (!text) return '';
	let result = neutraliseAll(stripControl(normaliseNewlines(text)).trim());
	result = demoteHeadings(result, headingOffset);
	result = result.replace(/^(\s*)(-{3,}|={3,})\s*$/gm, '$1\\$2');
	result = closeOpenFences(result);
	return result.replace(/\n{3,}/g, '\n\n');
}

/**
 * Converts a keyword into an Obsidian tag (letters, digits, `_`, `-`, `/`;
 * not purely numeric). Returns null when nothing usable remains.
 */
export function toTag(keyword: string): string | null {
	const tag = keyword
		.normalize('NFC')
		.trim()
		.replace(/^#+/, '')
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}_\-/]/gu, '')
		.replace(/-{2,}/g, '-')
		.replace(/^[-/]+|[-/]+$/g, '');
	if (tag === '' || /^\d+$/.test(tag)) return null;
	return tag;
}

export function parseTagList(value: string): string[] {
	const tags: string[] = [];
	for (const part of value.split(/[,\s]+/)) {
		const tag = toTag(part);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	return tags;
}

/** Ids embedded in hidden markers are restricted to a safe alphabet. */
export function safeId(id: string): string {
	return id.replace(/[^A-Za-z0-9_-]/g, '');
}
