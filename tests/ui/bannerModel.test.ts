import { describe, expect, it } from 'vitest';
import { blockMeta, composeBlock } from '../../src/markdown/managedBlock';
import { blockLayout, blockStatus } from '../../src/ui/bannerModel';

const INNER = '# Title\n\n## Summary\n\nText.';
const yamlFor = (inner: string) => {
	const meta = blockMeta(inner, 'abcdef123456');
	return `fieldy_id: c1\nfieldy_hash: "${meta.hash}"\nfieldy_src: "${meta.source}"\n`;
};

describe('blockLayout', () => {
	it('finds the markers and the first and last content lines', () => {
		const lines = ['---', 'fieldy_id: c1', '---', 'Mine', '%% fieldy:begin %%', '', '# Title', 'Text.', '', '%% fieldy:end %%', 'More of mine'];
		expect(blockLayout(lines)).toEqual({ begin: 4, end: 9, first: 6, last: 7 });
	});

	it('recognises CRLF lines', () => {
		const lines = ['%% fieldy:begin %%\r', 'Text\r', '%% fieldy:end %%\r'];
		expect(blockLayout(lines)).toEqual({ begin: 0, end: 2, first: 1, last: 1 });
	});

	it('gives up on missing, repeated or reversed markers', () => {
		expect(blockLayout(['Just text'])).toBeNull();
		expect(blockLayout(['%% fieldy:begin %%', 'a', '%% fieldy:begin %%', '%% fieldy:end %%'])).toBeNull();
		expect(blockLayout(['%% fieldy:end %%', '%% fieldy:begin %%'])).toBeNull();
		expect(blockLayout(['%% fieldy:begin %%', '', '%% fieldy:end %%'])).toEqual({ begin: 0, end: 2, first: null, last: null });
	});
});

describe('blockStatus', () => {
	const body = `${composeBlock(INNER)}\n\nMy notes\n`;

	it('is synced while the section matches its hash, whatever happens outside it', () => {
		expect(blockStatus(body, yamlFor(INNER), false)).toBe('synced');
		expect(blockStatus(`${body}More notes of mine.\n`, yamlFor(INNER), false)).toBe('synced');
	});

	it('turns edited as soon as the section changes', () => {
		expect(blockStatus(body.replace('Text.', 'My text.'), yamlFor(INNER), false)).toBe('edited');
	});

	it('reports paused notes, and nothing when the markers are gone', () => {
		expect(blockStatus(body, yamlFor(INNER), true)).toBe('paused');
		expect(blockStatus('No markers here', yamlFor(INNER), false)).toBeNull();
	});
});
