import { describe, expect, it } from 'vitest';
import { escapeLineStart, inlineText, lineText, markdownBlock, parseTagList, safeId, toTag } from '../../src/markdown/sanitize';

describe('inlineText', () => {
	it('neutralises HTML so no element can be created', () => {
		const out = inlineText('<img src=x onerror=alert(1)> <script>alert(1)</script>');
		expect(out).not.toMatch(/<[a-z/]/i);
		expect(out).toContain('&lt;img');
		expect(inlineText('a < b and c > d')).toBe('a < b and c > d');
	});

	it('breaks Obsidian comment delimiters and managed markers', () => {
		expect(inlineText('100%% sure')).not.toContain('%%');
		expect(inlineText('%% fieldy:end %%')).not.toContain('%%');
	});

	it('neutralises wikilinks and embeds', () => {
		const out = inlineText('see ![[secret.png]] and [[Private note]]');
		expect(out).not.toContain('[[');
		expect(out).not.toContain(']]');
	});

	it('flattens newlines and control characters', () => {
		expect(inlineText('one\r\ntwo\u0007\tthree')).toBe('one two three');
		expect(inlineText(null)).toBe('');
	});
});

describe('escapeLineStart / lineText', () => {
	it('escapes block syntax at the start of a line', () => {
		expect(escapeLineStart('# not a heading')).toBe('\\# not a heading');
		expect(escapeLineStart('> not a quote')).toBe('\\> not a quote');
		expect(escapeLineStart('- not a list')).toBe('\\- not a list');
		expect(escapeLineStart('1. not a list')).toBe('1\\. not a list');
		expect(escapeLineStart('```js')).toBe('\\```js');
		expect(escapeLineStart('| a | b |')).toBe('\\| a | b |');
		expect(escapeLineStart('---')).toBe('\\---');
		expect(escapeLineStart('plain words')).toBe('plain words');
		expect(escapeLineStart('#hashtag stays a tag')).toBe('#hashtag stays a tag');
	});

	it('combines inline sanitising with line-start escaping', () => {
		expect(lineText('# Big <b>news</b>')).toBe('\\# Big &lt;b>news&lt;/b>');
	});
});

describe('markdownBlock', () => {
	it('keeps Markdown formatting but demotes headings below the note sections', () => {
		const out = markdownBlock('# Overview\n\n- **Point** one\n\n## Detail\n###### Deep');
		expect(out).toBe('### Overview\n\n- **Point** one\n\n#### Detail\n###### Deep');
	});

	it('neutralises HTML, comments, embeds and script links', () => {
		const out = markdownBlock('<iframe src="x"></iframe>\n%% hidden %%\n![[embed]]\n[click](javascript:alert(1))');
		expect(out).not.toMatch(/<iframe/i);
		expect(out).not.toContain('%%');
		expect(out).not.toContain('![[');
		expect(out).toContain('](unsafe-javascript:');
	});

	it('turns image embeds into plain links so nothing loads or embeds automatically', () => {
		const out = markdownBlock('![x](Private/Passwords.md) and ![](https://tracker.example/p.gif)');
		expect(out).not.toMatch(/!\[/);
		expect(out).toContain('!\\[x](Private/Passwords.md)');
		expect(inlineText('see ![pic](https://x.example/a.png)')).not.toMatch(/!\[/);
	});

	it('defangs obsidian:// links and bare URIs', () => {
		const out = markdownBlock('[run](obsidian://advanced-uri?commandid=x) and obsidian://open?vault=v and [ok](https://fieldy.ai)');
		expect(out).not.toMatch(/\]\(obsidian:/i);
		expect(out).not.toMatch(/obsidian:\/\//i);
		expect(out).toContain('[ok](https://fieldy.ai)');
		expect(inlineText('obsidian://open?vault=x')).not.toContain('obsidian://');
	});

	it('closes an unbalanced code fence so it cannot swallow the rest of the note', () => {
		const out = markdownBlock('Before\n```\nunterminated');
		expect(out.match(/```/g)).toHaveLength(2);
	});

	it('defuses horizontal rules that could read as frontmatter fences', () => {
		expect(markdownBlock('a\n---\nb')).toBe('a\n\\---\nb');
	});

	it('normalises line endings and blank lines', () => {
		expect(markdownBlock('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
		expect(markdownBlock(null)).toBe('');
	});
});

describe('tags and ids', () => {
	it('converts keywords to valid tags', () => {
		expect(toTag('Project Apollo')).toBe('project-apollo');
		expect(toTag('#Q4/Planning')).toBe('q4/planning');
		expect(toTag('Café crème!')).toBe('café-crème');
		expect(toTag('2026')).toBeNull();
		expect(toTag('!!!')).toBeNull();
	});

	it('parses a comma or space separated tag list without duplicates', () => {
		expect(parseTagList('fieldy, meetings  fieldy #work')).toEqual(['fieldy', 'meetings', 'work']);
		expect(parseTagList('')).toEqual([]);
	});

	it('restricts marker ids to a safe alphabet', () => {
		expect(safeId('abc-123_DEF')).toBe('abc-123_DEF');
		expect(safeId('a%%b c')).toBe('abc');
	});
});
