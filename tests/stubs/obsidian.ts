/*
 * Minimal stand-in for the `obsidian` module in unit tests. The real package
 * only ships type definitions. Only pure helpers used by tested modules are
 * implemented here; UI classes are intentionally absent.
 */
import momentLib from 'moment';

export const moment = momentLib;

const SPECIAL_SPACES = new RegExp('[\\u00A0\\u202F]', 'g');

export function normalizePath(path: string): string {
	let result = path.replace(/[\\/]+/g, '/').replace(SPECIAL_SPACES, ' ');
	result = result.replace(/^\/+|\/+$/g, '');
	result = result.normalize('NFC');
	return result === '' ? '/' : result;
}

export function requestUrl(): never {
	throw new Error('requestUrl must not be called from unit tests');
}
