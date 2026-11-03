import { describe, expect, it } from 'vitest';
import { describeTimeRules, inTimeRules, overlapsTimeRules, sanitizeTimeRules, type TimeRule } from '../../src/utils/timeRules';

/** A local time as ISO, so tests pass in every time zone. 2026-11-02 is a Monday. */
function local(day: number, hour: number, minute = 0): string {
	return new Date(2026, 10, day, hour, minute).toISOString();
}

const rule = (r: Partial<TimeRule>): TimeRule => ({ op: 'or', days: [], from: '', to: '', ...r });
const WEEKDAYS = [1, 2, 3, 4, 5];

describe('time rules', () => {
	it('matches days and hours of one rule', () => {
		const rules = [rule({ days: WEEKDAYS, from: '08:00', to: '18:00' })];
		expect(inTimeRules(local(2, 8, 0), rules)).toBe(true);
		expect(inTimeRules(local(2, 17, 59), rules)).toBe(true);
		expect(inTimeRules(local(2, 18, 0), rules)).toBe(false);
		expect(inTimeRules(local(7, 10, 0), rules)).toBe(false); // Saturday
	});

	it('treats empty days as every day and empty times as the whole day', () => {
		expect(inTimeRules(local(7, 3, 0), [rule({})])).toBe(true);
		expect(inTimeRules(local(7, 3, 0), [rule({ days: [6] })])).toBe(true);
		expect(inTimeRules(local(8, 3, 0), [rule({ days: [6] })])).toBe(false);
		expect(inTimeRules(local(2, 23, 0), [rule({ from: '22:00' })])).toBe(true);
		expect(inTimeRules(local(2, 21, 0), [rule({ from: '22:00' })])).toBe(false);
	});

	it('gives the late part of a night range to the day it started', () => {
		const rules = [rule({ days: [5], from: '22:00', to: '02:00' })];
		expect(inTimeRules(local(6, 23, 0), rules)).toBe(true); // Friday
		expect(inTimeRules(local(7, 1, 30), rules)).toBe(true); // Saturday night, from Friday
		expect(inTimeRules(local(6, 1, 30), rules)).toBe(false); // Friday morning belongs to Thursday
	});

	it('combines rows from top to bottom with or, and, except', () => {
		const work = rule({ days: WEEKDAYS, from: '08:00', to: '18:00' });
		const lunch = rule({ op: 'except', from: '12:00', to: '13:00' });
		expect(inTimeRules(local(2, 12, 30), [work, lunch])).toBe(false);
		expect(inTimeRules(local(2, 11, 0), [work, lunch])).toBe(true);
		const orSaturday = rule({ op: 'or', days: [6] });
		expect(inTimeRules(local(7, 12, 30), [work, lunch, orSaturday])).toBe(true);
		const andMornings = rule({ op: 'and', from: '06:00', to: '12:00' });
		expect(inTimeRules(local(2, 9, 0), [work, andMornings])).toBe(true);
		expect(inTimeRules(local(2, 15, 0), [work, andMornings])).toBe(false);
	});

	it('finds any moment of a conversation in the rules', () => {
		const lunch = [rule({ from: '12:00', to: '13:00' })];
		expect(overlapsTimeRules(local(2, 11, 30), local(2, 12, 10), lunch)).toBe(true);
		expect(overlapsTimeRules(local(2, 12, 50), local(2, 14, 0), lunch)).toBe(true);
		expect(overlapsTimeRules(local(2, 10, 0), local(2, 11, 59), lunch)).toBe(false);
		expect(overlapsTimeRules(local(2, 13, 0), local(2, 15, 0), lunch)).toBe(false);
		expect(overlapsTimeRules(local(2, 12, 30), null, lunch)).toBe(true);
	});

	it('describes the rules in words', () => {
		expect(describeTimeRules([rule({ days: WEEKDAYS, from: '08:00', to: '18:00' }), rule({ op: 'except', from: '12:00', to: '13:00' }), rule({ days: [0, 6] })])).toBe(
			'Mon–Fri 08:00–18:00, except every day 12:00–13:00, or Sat–Sun all day',
		);
		expect(describeTimeRules([rule({ days: [5], from: '22:00', to: '02:00' })])).toBe('Fri 22:00–02:00 (next day)');
	});

	it('repairs rules read from disk', () => {
		expect(sanitizeTimeRules([{ op: 'nope', days: [1, 1, 9, 'x'], from: '25:00', to: '13:30' }, 'junk'])).toEqual([{ op: 'or', days: [1], from: '', to: '13:30' }]);
		expect(sanitizeTimeRules('junk')).toEqual([]);
	});
});
