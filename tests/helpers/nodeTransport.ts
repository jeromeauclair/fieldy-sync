import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/api/transport';

/** `fetch`-based transport for live tests (Obsidian's requestUrl is unavailable in Node). */
export const nodeTransport: HttpTransport = async (request: HttpRequest): Promise<HttpResponse> => {
	const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return { status: response.status, headers, text: await response.text() };
};
