import { requestUrl } from 'obsidian';
import type { HttpRequest, HttpResponse, HttpTransport } from './transport';

/**
 * Transport backed by Obsidian's `requestUrl`, which works on desktop and
 * mobile and is not subject to CORS. `throw: false` makes every HTTP status
 * resolve so the client can map errors itself.
 */
export const obsidianTransport: HttpTransport = async (request: HttpRequest): Promise<HttpResponse> => {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		body: request.body,
		contentType: request.body !== undefined ? 'application/json' : undefined,
		throw: false,
	});
	let text = '';
	try {
		text = response.text;
	} catch {
		text = '';
	}
	return { status: response.status, headers: response.headers ?? {}, text };
};
