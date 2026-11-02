import { describe, expect, it } from 'vitest';
import {
	applyFilenamePattern,
	joinVaultPath,
	MAX_BASENAME_LENGTH,
	parentFolder,
	sanitizeFilename,
	sanitizeFolderPath,
	subfolderFor,
	UNTITLED,
	uniqueNotePath,
} from '../../src/utils/paths';
import { formatUtc } from '../helpers/fixtures';

describe('sanitizeFilename', () => {
	it('replaces characters that are illegal on Windows', () => {
		expect(sanitizeFilename('Q4: plan/budget\\draft|v2')).toBe('Q4 - plan - budget - draft - v2');
		expect(sanitizeFilename('What? "Really" <maybe> *now*')).toBe('What Really maybe now');
	});

	it('removes characters that break Obsidian links', () => {
		expect(sanitizeFilename('Issue #42 ^block [draft]')).toBe('Issue 42 block (draft)');
	});

	it('strips control characters and collapses whitespace', () => {
		expect(sanitizeFilename('Line one\nLine\ttwo\u0000end')).toBe('Line one Line two end');
	});

	it('removes leading dots and trailing dots or spaces', () => {
		expect(sanitizeFilename('...hidden')).toBe('hidden');
		expect(sanitizeFilename('ends with dots...  ')).toBe('ends with dots');
	});

	it('avoids Windows reserved device names', () => {
		expect(sanitizeFilename('CON')).toBe('CON_');
		expect(sanitizeFilename('lpt1')).toBe('lpt1_');
		// The extension does not make a device name safe on Windows.
		expect(sanitizeFilename('nul.txt')).toBe('nul_.txt');
		expect(sanitizeFilename('CON.tar.gz')).toBe('CON_.tar.gz');
		expect(sanitizeFilename('aux .md')).toBe('aux_ .md');
		expect(sanitizeFilename('Console')).toBe('Console');
		expect(sanitizeFilename('Conference')).toBe('Conference');
		expect(sanitizeFilename('com1x')).toBe('com1x');
	});

	it('falls back to a placeholder for empty or symbol-only titles', () => {
		expect(sanitizeFilename('')).toBe(UNTITLED);
		expect(sanitizeFilename(null)).toBe(UNTITLED);
		expect(sanitizeFilename('???')).toBe(UNTITLED);
		expect(sanitizeFilename(' / ')).toBe(UNTITLED);
	});

	it('truncates long titles without splitting characters', () => {
		const long = '😀'.repeat(150);
		const result = sanitizeFilename(long);
		expect(Array.from(result)).toHaveLength(MAX_BASENAME_LENGTH);
		expect(result).toBe('😀'.repeat(MAX_BASENAME_LENGTH));
		expect(sanitizeFilename(`${'a'.repeat(99)} b`)).toBe('a'.repeat(99));
	});

	it('keeps accented and non-Latin text', () => {
		expect(sanitizeFilename('Réunion d’équipe — 東京')).toBe('Réunion d’équipe — 東京');
	});
});

describe('sanitizeFolderPath', () => {
	it('normalises separators and drops traversal segments', () => {
		expect(sanitizeFolderPath('\\Fieldy\\Conversations\\')).toBe('Fieldy/Conversations');
		expect(sanitizeFolderPath('../../etc/./passwd')).toBe('etc/passwd');
		expect(sanitizeFolderPath('Fieldy//2026 ')).toBe('Fieldy/2026');
		expect(sanitizeFolderPath('')).toBe('');
		expect(sanitizeFolderPath('Notes: work')).toBe('Notes - work');
	});
});

describe('applyFilenamePattern', () => {
	const values = { title: 'Weekly sync: Acme', startTime: '2026-10-29T14:05:00.000Z', id: 'abcdef12-3456' };

	it('expands date, time, title and id tokens', () => {
		expect(applyFilenamePattern('{date} - {title}', values, 'YYYY-MM-DD', formatUtc)).toBe('2026-10-29 - Weekly sync - Acme');
		expect(applyFilenamePattern('{date} {time} {title} ({id})', values, 'YYYY-MM-DD', formatUtc)).toBe(
			'2026-10-29 14-05 Weekly sync - Acme (abcdef12)',
		);
	});

	it('cannot be used to inject folders', () => {
		const sneaky = { ...values, title: '../../.obsidian/plugins/evil' };
		const name = applyFilenamePattern('{title}', sneaky, 'YYYY-MM-DD', formatUtc);
		expect(name).not.toContain('/');
		expect(name).not.toMatch(/^\./);
		expect(applyFilenamePattern('{date}', values, 'DD/MM/YYYY', formatUtc)).toBe('29 - 10 - 2026');
	});

	it('uses a placeholder for missing titles', () => {
		expect(applyFilenamePattern('{date} - {title}', { ...values, title: null }, 'YYYY-MM-DD', formatUtc)).toBe(
			`2026-10-29 - ${UNTITLED}`,
		);
	});
});

describe('note paths', () => {
	it('builds year and month subfolders', () => {
		expect(subfolderFor('none', '2026-10-29T14:05:00Z', formatUtc)).toBe('');
		expect(subfolderFor('year', '2026-10-29T14:05:00Z', formatUtc)).toBe('2026');
		expect(subfolderFor('month', '2026-10-29T14:05:00Z', formatUtc)).toBe('2026/2026-10');
		expect(subfolderFor('year-month', '2026-10-29T14:05:00Z', formatUtc)).toBe('2026-10');
		expect(subfolderFor('week', '2026-10-29T14:05:00Z', formatUtc)).toBe('2026/2026-W44');
		expect(subfolderFor('week', '2026-12-31T10:00:00Z', formatUtc)).toBe('2026/2026-W53');
		expect(subfolderFor('day', '2026-10-29T14:05:00Z', formatUtc)).toBe('2026/2026-10/2026-10-29');
	});

	it('builds custom subfolders from a Moment format, with every segment made safe', () => {
		expect(subfolderFor('custom', '2026-10-29T14:05:00Z', formatUtc, 'YYYY/[Q]Q')).toBe('2026/Q4');
		expect(subfolderFor('custom', '2026-10-29T14:05:00Z', formatUtc, '../YYYY:MM')).toBe('2026 - 10');
		expect(subfolderFor('custom', '2026-10-29T14:05:00Z', formatUtc, '  ')).toBe('');
	});

	it('finds the first free name, case-insensitively', () => {
		const taken = new Set(['fieldy/a.md', 'fieldy/a (2).md']);
		expect(uniqueNotePath('Fieldy', 'A', (p) => taken.has(p.toLowerCase()))).toBe('Fieldy/A (3).md');
		expect(uniqueNotePath('', 'B', () => false)).toBe('B.md');
	});

	it('gives up with a filename-conflict error', () => {
		expect(() => uniqueNotePath('F', 'x', () => true, 5)).toThrow(expect.objectContaining({ kind: 'filename-conflict' }));
	});

	it('joins and splits vault paths', () => {
		expect(joinVaultPath('Fieldy', '', '2026/2026-10', 'a.md')).toBe('Fieldy/2026/2026-10/a.md');
		expect(parentFolder('Fieldy/2026/a.md')).toBe('Fieldy/2026');
		expect(parentFolder('a.md')).toBe('');
	});
});
