import { describe, expect, it } from 'vitest';
import {
	activeFilterCount,
	dayKey,
	emptyFilters,
	filterOptions,
	matchesFilters,
	nextContentRule,
	timeOfDay,
	type PanelFilters,
} from '../../src/ui/panel/filters';
import { conversationIndicators } from '../../src/ui/panel/indicators';
import { makeConversation } from '../helpers/fixtures';

/** Local wall-clock time as ISO, so the tests do not depend on the time zone. */
const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0).toISOString();
const address = (text: string) => ({ address: text, street: null, streetNumber: null, city: null, zip: null, country: null, placeId: null, coordinates: null });
const filters = (patch: Partial<PanelFilters>): PanelFilters => ({ ...emptyFilters(), ...patch });

describe('panel filters', () => {
	const c = makeConversation('c', {
		startTime: local(2026, 10, 28, 9),
		speakers: ['Alice', 'Bob'],
		summary: 'Has one',
		quotes: [],
		location: address('1 Main St'),
	});
	const icons = conversationIndicators(c, 2, undefined);

	it('passes everything when no filter is set', () => {
		expect(activeFilterCount(emptyFilters())).toBe(0);
		expect(matchesFilters(c, icons, 'new', emptyFilters())).toBe(true);
	});

	it('cycles icon rules any → has → lacks → any', () => {
		expect(nextContentRule(undefined)).toBe('has');
		expect(nextContentRule('has')).toBe('lacks');
		expect(nextContentRule('lacks')).toBeUndefined();
	});

	it('filters on the content icons', () => {
		expect(matchesFilters(c, icons, 'new', filters({ content: { summary: 'has' } }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ content: { summary: 'lacks' } }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ content: { quotes: 'lacks', tasks: 'has' } }))).toBe(true);
	});

	it('lets an icon that is still being checked pass neither rule', () => {
		expect(matchesFilters(c, icons, 'new', filters({ content: { link: 'has' } }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ content: { link: 'lacks' } }))).toBe(false);
	});

	it('filters on date, time of day, speaker, location and note status', () => {
		expect(matchesFilters(c, icons, 'new', filters({ day: '2026-10-28' }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ day: '2026-10-29' }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ timeOfDay: 'morning' }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ timeOfDay: 'evening' }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ speaker: 'Bob' }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ speaker: 'Carol' }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ location: '1 Main St' }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ location: 'Elsewhere' }))).toBe(false);
		expect(matchesFilters(c, icons, 'imported', filters({ status: 'imported' }))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ status: 'imported' }))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ source: 'phone' }), new Set(['phone', 'wearable']))).toBe(true);
		expect(matchesFilters(c, icons, 'new', filters({ source: 'desktop' }), new Set(['phone']))).toBe(false);
		expect(matchesFilters(c, icons, 'new', filters({ source: 'phone' }))).toBe(false);
		expect(activeFilterCount(filters({ day: '2026-10-28', speaker: 'Bob', content: { quotes: 'has' } }))).toBe(3);
	});

	it('splits the day into four periods', () => {
		expect(timeOfDay(local(2026, 1, 1, 5))).toBe('morning');
		expect(timeOfDay(local(2026, 1, 1, 12))).toBe('afternoon');
		expect(timeOfDay(local(2026, 1, 1, 17))).toBe('evening');
		expect(timeOfDay(local(2026, 1, 1, 22))).toBe('night');
		expect(timeOfDay(local(2026, 1, 1, 2))).toBe('night');
		expect(dayKey(local(2026, 3, 4, 23))).toBe('2026-03-04');
	});

	it('offers each day (newest first), speaker and location once', () => {
		const other = makeConversation('d', { startTime: local(2026, 10, 30, 15), speakers: ['bob', 'Alice', ' '], location: null });
		expect(filterOptions([c, other])).toEqual({
			days: ['2026-10-30', '2026-10-28'],
			speakers: ['Alice', 'Bob', 'bob'],
			locations: ['1 Main St'],
		});
	});
});
