import { describe, expect, it } from 'vitest';
import { conversationIndicators, INDICATOR_ORDER, mapLinks } from '../../src/ui/panel/indicators';
import { makeConversation } from '../helpers/fixtures';

const states = (list: ReturnType<typeof conversationIndicators>) => Object.fromEntries(list.map((i) => [i.key, i.state]));

describe('conversationIndicators', () => {
	it('lists every indicator in a fixed order', () => {
		expect(conversationIndicators(makeConversation('c'), 0, false).map((i) => i.key)).toEqual(INDICATOR_ORDER);
	});

	it('marks what a rich conversation contains', () => {
		const rich = makeConversation('c', {
			type: 'BRIEF',
			summary: 'Short summary',
			content: 'Longer memory content',
			quotes: [{ text: 'Ship it', context: null }],
			calendarEventId: 'evt-1',
			location: { address: '1 Main St', street: null, streetNumber: null, city: null, zip: null, country: null, placeId: null, coordinates: null },
		});
		const list = conversationIndicators(rich, 3, true);
		expect(states(list)).toEqual({
			brief: 'on',
			summary: 'on',
			details: 'on',
			tasks: 'on',
			quotes: 'on',
			link: 'on',
			location: 'on',
			calendar: 'on',
		});
		expect(list.find((i) => i.key === 'tasks')?.label).toBe('Has 3 tasks');
		expect(list.find((i) => i.key === 'location')?.label).toBe('Recorded at 1 Main St');
	});

	it('greys out what is missing', () => {
		const bare = makeConversation('c', { type: 'FULL', summary: '  ', content: null, quotes: [], calendarEventId: null, location: null });
		expect(states(conversationIndicators(bare, 0, false))).toEqual({
			brief: 'off',
			summary: 'off',
			details: 'off',
			tasks: 'off',
			quotes: 'off',
			link: 'off',
			location: 'off',
			calendar: 'off',
		});
	});

	it('shows tasks and share links as unknown until they have been checked', () => {
		const list = conversationIndicators(makeConversation('c'), undefined, undefined);
		expect(list.find((i) => i.key === 'tasks')).toMatchObject({ state: 'unknown', label: 'Checking tasks…' });
		expect(list.find((i) => i.key === 'link')).toMatchObject({ state: 'unknown', label: 'Checking for a share link…' });
	});

	it('does not count memory content that only repeats the summary', () => {
		const same = makeConversation('c', { summary: 'Same text', content: 'Same text' });
		expect(conversationIndicators(same, 0, false).find((i) => i.key === 'details')?.state).toBe('off');
	});
});

describe('mapLinks', () => {
	const place = { address: null, street: null, streetNumber: null, city: null, zip: null, country: null, placeId: null, coordinates: null };

	it('uses coordinates when Fieldy has them', () => {
		const links = mapLinks({ ...place, coordinates: { latitude: 45.5, longitude: -73.6 } });
		expect(links?.google).toBe('https://www.google.com/maps/search/?api=1&query=45.5,-73.6');
		expect(links?.osm).toContain('mlat=45.5&mlon=-73.6');
	});

	it('falls back to the address, and to nothing without one', () => {
		expect(mapLinks({ ...place, address: '1 Rue Sainte-Catherine, Montréal' })?.google).toBe(
			`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('1 Rue Sainte-Catherine, Montréal')}`,
		);
		expect(mapLinks(place)).toBeNull();
		expect(mapLinks(null)).toBeNull();
	});
});
