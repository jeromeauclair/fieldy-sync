/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import master from '../../graphics/svg/mark.svg?raw';
import { registeredIcons } from '../stubs/obsidian';
import { BRAND_MARK_PARTS, FIELDY_ICON_ID, fieldyIconSvg, registerFieldyIcon } from '../../src/ui/brandIcon';

const pathsOf = (svg: string): string[] => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);

describe('brand icon', () => {
	it('registers the mark under the plugin id', () => {
		registerFieldyIcon();
		expect(registeredIcons.get(FIELDY_ICON_ID)).toBe(fieldyIconSvg());
	});

	it('scales the 32-unit mark to the 100-unit icon grid and stays monochrome', () => {
		const svg = fieldyIconSvg();
		expect(svg).toContain('scale(3.125)');
		expect(svg).toContain('stroke="currentColor"');
		expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i);
	});

	it('uses the same geometry for the ribbon icon, the coloured mark and graphics/svg/mark.svg', () => {
		const parts = BRAND_MARK_PARTS.map((part) => part.d);
		expect(pathsOf(fieldyIconSvg())).toEqual(parts);
		expect(pathsOf(master)).toEqual(parts);
	});

	it('swings only the pendant and gives the accent to the note and the deck', () => {
		expect(BRAND_MARK_PARTS.filter((p) => p.group === 'pendant')).toHaveLength(4);
		expect(BRAND_MARK_PARTS.filter((p) => p.cls).map((p) => p.cls)).toEqual(['fieldy-brand-note', 'fieldy-brand-deck']);
	});
});
