import { moment as obsidianMoment } from 'obsidian';

/**
 * Moment.js as bundled with Obsidian, typed with only the parts the plugin
 * uses, so type checks never depend on the separate "moment" package's
 * typings being installed.
 */

type Unit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type TimeUnit = Unit | `${Unit}s` | 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export interface Moment {
	format(format?: string): string;
	clone(): Moment;
	add(amount: number, unit: TimeUnit): Moment;
	subtract(amount: number, unit: TimeUnit): Moment;
	startOf(unit: TimeUnit): Moment;
	endOf(unit: TimeUnit): Moment;
	hour(value: number): Moment;
	minute(value: number): Moment;
	second(value: number): Moment;
	millisecond(value: number): Moment;
	isValid(): boolean;
	isSame(other: MomentInput, unit?: TimeUnit): boolean;
	isBefore(other: MomentInput, unit?: TimeUnit): boolean;
	isAfter(other: MomentInput, unit?: TimeUnit): boolean;
	diff(other: MomentInput, unit?: TimeUnit): number;
	from(other: MomentInput): string;
	fromNow(): string;
	toISOString(): string;
	valueOf(): number;
}

export type MomentInput = string | number | Date | Moment | null | undefined;

export const moment = obsidianMoment as unknown as (input?: MomentInput, format?: string, strict?: boolean) => Moment;
