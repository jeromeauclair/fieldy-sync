/**
 * The Fieldy Sync visual signature: a worn pendant that holds a note, over a
 * deck line and a faint line. Geometry matches graphics/svg/mark.svg
 * (viewBox 0 0 32 32); keep both in sync.
 *
 * - registerFieldyIcon() adds the mark to Obsidian's icon set (ribbon, view
 *   tab, settings tab), monochrome like the Lucide icons around it.
 * - createBrandMark() draws the mark in the plugin's own UI, with the note and
 *   deck in the theme accent; as a button it animates on hover (the pendant
 *   swings on its cord and the note redraws; see .fieldy-brand in styles.css).
 */
import { addIcon } from 'obsidian';

export const FIELDY_ICON_ID = 'fieldy-sync';

const CORD = 'M14.9 6 C14 3.5 13 2 11.8 0.6 M17.1 6 C18 3.5 19 2 20.2 0.6';
const RING = 'M16 5.4 A2.6 2.6 0 1 1 15.99 5.4';
const BODY = 'M16 10.6 A6 6 0 1 1 15.99 10.6';
const NOTE = 'M13.8 13.6 H16.4 L18.3 15.5 V19.6 H13.8 Z';
const DECK = 'M4 26.5 H28';
const LINE = 'M4 30 H18';

/** Inner SVG for addIcon(), on Obsidian's 0 0 100 100 icon grid. Pure string, unit-testable. */
export function fieldyIconSvg(): string {
	return (
		'<g transform="scale(3.125)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
		`<path d="${CORD}" stroke-width="1.6" opacity="0.55"/>` +
		`<path d="${RING}" stroke-width="1.9"/>` +
		`<path d="${BODY}" stroke-width="2.4"/>` +
		`<path d="${NOTE}" stroke-width="1.4"/>` +
		`<path d="${DECK}" stroke-width="2.6"/>` +
		`<path d="${LINE}" stroke-width="1.8" opacity="0.55"/>` +
		'</g>'
	);
}

/** Call once in onload(), before anything uses FIELDY_ICON_ID. */
export function registerFieldyIcon(): void {
	addIcon(FIELDY_ICON_ID, fieldyIconSvg());
}

interface MarkPart {
	d: string;
	width: number;
	/** 'pendant' parts swing together on hover; 'base' parts stay put. */
	group: 'pendant' | 'base';
	faint?: boolean;
	/** Extra class; the note and the deck take the theme accent in CSS. */
	cls?: string;
}

/** The coloured mark's parts, in drawing order. Exported for tests. */
export const BRAND_MARK_PARTS: readonly MarkPart[] = [
	{ d: CORD, width: 1.6, group: 'pendant', faint: true },
	{ d: RING, width: 1.9, group: 'pendant' },
	{ d: BODY, width: 2.4, group: 'pendant' },
	{ d: NOTE, width: 1.4, group: 'pendant', cls: 'fieldy-brand-note' },
	{ d: DECK, width: 2.6, group: 'base', cls: 'fieldy-brand-deck' },
	{ d: LINE, width: 1.8, group: 'base', faint: true },
];

export interface BrandMarkOptions {
	size?: number;
	/** Tooltip and aria-label; also the accessible name when clickable. */
	title: string;
	/** When set, the mark is a button and this runs on click. */
	onclick?: () => void;
	cls?: string;
}

/** Append the brand mark to `parent`; returns the created element. */
export function createBrandMark(parent: HTMLElement, opts: BrandMarkOptions): HTMLElement {
	const el = parent.createEl(opts.onclick ? 'button' : 'span', {
		cls: `fieldy-brand${opts.cls ? ` ${opts.cls}` : ''}`,
		attr: { title: opts.title, 'aria-label': opts.title },
	});
	const size = String(opts.size ?? 18);
	const svg = el.createSvg('svg', {
		cls: 'fieldy-brand-svg',
		attr: { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' },
	});
	const groups = {
		pendant: svg.createSvg('g', { cls: 'fieldy-brand-pendant' }),
		base: svg.createSvg('g', { cls: 'fieldy-brand-base' }),
	};
	for (const part of BRAND_MARK_PARTS) {
		const attr: Record<string, string> = {
			d: part.d,
			fill: 'none',
			stroke: 'currentColor',
			'stroke-width': String(part.width),
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
		};
		if (part.faint) attr.opacity = '0.55';
		groups[part.group].createSvg('path', { cls: part.cls, attr });
	}
	if (opts.onclick) {
		el.addClass('is-clickable');
		el.addEventListener('click', () => opts.onclick?.());
	}
	return el;
}
