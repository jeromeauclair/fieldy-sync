import { describe, expect, it } from 'vitest';
import {
	BEGIN_MARKER,
	blockMeta,
	composeBlock,
	END_MARKER,
	hashBlock,
	initialBody,
	isModified,
	metaFromYaml,
	normaliseForHash,
	parseManagedBlock,
	replaceBlock,
	setMetaInYaml,
	taskStates,
	type BlockMeta,
} from '../../src/markdown/managedBlock';

const INNER = '# Title\n\n## Summary\n\nText.\n\n## Tasks\n\n- [ ] Call Sam %%fieldy-task:t1%%\n- [x] Done %%fieldy-task:t2%%';

function parsedOk(body: string, meta: BlockMeta | null = null) {
	const result = parseManagedBlock(body, meta);
	if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
	return result.block;
}

describe('managed block parsing', () => {
	it('writes short markers and round-trips content with its properties', () => {
		const body = initialBody(INNER);
		expect(body.split('\n')[0]).toBe(BEGIN_MARKER);
		const meta = blockMeta(INNER, 'abcdef123456');
		const block = parsedOk(body, meta);
		expect(block.inner).toBe(INNER);
		expect(block.before).toBe('');
		expect(block.after).toBe('\n\n');
		expect(block.meta).toEqual({ hash: hashBlock(INNER), source: 'abcdef123456' });
		expect(block.outdated).toBe(false);
		expect(isModified(block)).toBe(false);
	});

	it('reports missing and malformed markers', () => {
		expect(parseManagedBlock('Just my note').status).toBe('missing');
		const twice = `${composeBlock('a')}\n${composeBlock('b')}`;
		expect(parseManagedBlock(twice).status).toBe('malformed');
		expect(parseManagedBlock(`${END_MARKER}\nstuff`).status).toBe('malformed');
		expect(parseManagedBlock(`${END_MARKER}\n${BEGIN_MARKER}`).status).toBe('malformed');
	});

	it('tolerates CRLF line endings written by other editors', () => {
		const body = `Intro\r\n${composeBlock(INNER).replace(/\n/g, '\r\n')}\r\nOutro`;
		const block = parsedOk(body, blockMeta(INNER, 'abcdef123456'));
		expect(isModified(block)).toBe(false);
		expect(block.before).toBe('Intro\r\n');
		expect(block.after).toBe('\r\nOutro');
	});

	it('treats a block without properties as modified (cannot prove it is untouched)', () => {
		const block = parsedOk(composeBlock(INNER));
		expect(block.meta).toBeNull();
		expect(isModified(block)).toBe(true);
	});
});

describe('end marker layout', () => {
	it('gets a blank line before the end marker, so it is not read as part of a closing callout', () => {
		const callout = '# Title\n\n## Transcript\n\n> [!quote]- Show transcript\n> Hello';
		expect(composeBlock(callout)).toBe(`${BEGIN_MARKER}\n${callout}\n\n${END_MARKER}`);
		const tight = `${BEGIN_MARKER}\n${callout}\n${END_MARKER}\nMine`;
		const meta = blockMeta(callout, 'abcdef123456');
		const block = parsedOk(tight, meta);
		expect(block.outdated).toBe(true);
		expect(block.inner).toBe(callout);
		expect(isModified(block)).toBe(false);
		const rewritten = replaceBlock(block, block.inner);
		expect(rewritten).toBe(`${composeBlock(callout)}\nMine`);
		expect(parsedOk(rewritten, meta).outdated).toBe(false);
	});
});

describe('block properties in frontmatter', () => {
	const meta = { hash: '0012345678abcd', source: 'abcdef123456' };

	it('reads quoted and unquoted values, and ignores anything that is not a hash', () => {
		expect(metaFromYaml(`fieldy_id: c1\nfieldy_hash: "${meta.hash}"\nfieldy_src: ${meta.source}\n`)).toEqual(meta);
		expect(metaFromYaml(`fieldy_hash: '${meta.hash}'\nfieldy_src: '${meta.source}'`)).toEqual(meta);
		expect(metaFromYaml('fieldy_hash: nope\nfieldy_src: abcdef')).toBeNull();
	});

	it('changes only its own lines, quoting values', () => {
		const yaml = 'fieldy_id: c1\ntags:\n  - fieldy\nfieldy_hash: "aaaaaaaa"\nmine: keep # comment\n';
		const out = setMetaInYaml(yaml, meta);
		expect(out).toBe(`fieldy_id: c1\ntags:\n  - fieldy\nfieldy_hash: "${meta.hash}"\nmine: keep # comment\nfieldy_src: "${meta.source}"\n`);
		expect(metaFromYaml(out)).toEqual(meta);
		expect(setMetaInYaml(out, meta)).toBe(out);
	});

	it('keeps the YAML text trailing-newline convention', () => {
		expect(setMetaInYaml('', meta)).toBe(`fieldy_hash: "${meta.hash}"\nfieldy_src: "${meta.source}"\n`);
		expect(setMetaInYaml('a: 1', meta)).toBe(`a: 1\nfieldy_hash: "${meta.hash}"\nfieldy_src: "${meta.source}"`);
		expect(setMetaInYaml('a: 1\r\nb: 2\r\n', meta).startsWith('a: 1\r\nb: 2\r\n')).toBe(true);
	});
});

describe('change detection', () => {
	it('detects edits inside the block', () => {
		const block = parsedOk(initialBody(INNER), blockMeta(INNER, 'abcdef'));
		block.inner = block.inner.replace('Text.', 'Text, edited.');
		expect(isModified(block)).toBe(true);
	});

	it('ignores whitespace-only reformatting and checkbox state', () => {
		const hash = hashBlock(INNER);
		expect(hashBlock(`\n${INNER.replace(/\n/g, '  \r\n')}\n\n`)).toBe(hash);
		expect(hashBlock(INNER.replace('- [ ] Call Sam', '- [x] Call Sam'))).toBe(hash);
		expect(hashBlock(INNER.replace('- [x] Done', '- [ ] Done'))).toBe(hash);
		expect(normaliseForHash('- [/] partially')).toBe('- [ ] partially');
	});

	it('still detects edits to a task title', () => {
		expect(hashBlock(INNER.replace('Call Sam', 'Call Alex'))).not.toBe(hashBlock(INNER));
	});
});

describe('replacement', () => {
	it('replaces only the managed block and keeps user text byte for byte', () => {
		const userBefore = 'My intro paragraph.\n\n';
		const userAfter = '\n\n## My notes\n\n- remember this  \n';
		const body = `${userBefore}${composeBlock(INNER)}${userAfter}`;
		const block = parsedOk(body, blockMeta(INNER, 'aaaaaa'));
		const updated = replaceBlock(block, '# New title');
		expect(updated.startsWith(userBefore)).toBe(true);
		expect(updated.endsWith(userAfter)).toBe(true);
		const again = parsedOk(updated, blockMeta('# New title', 'bbbbbb'));
		expect(again.inner).toBe('# New title');
		expect(isModified(again)).toBe(false);
	});

	it('reads checkbox states by task id', () => {
		const states = taskStates(INNER.replace('- [ ] Call Sam', '- [/] Call Sam'));
		expect(states.get('t1')).toBe('/');
		expect(states.get('t2')).toBe('x');
		expect(taskStates('- [x] no id here').size).toBe(0);
	});
});
