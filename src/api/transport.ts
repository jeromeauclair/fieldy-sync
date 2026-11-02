export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface HttpRequest {
	url: string;
	method: HttpMethod;
	headers: Record<string, string>;
	body?: string;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

/**
 * Minimal HTTP abstraction so the client can be tested without Obsidian.
 * Implementations must resolve for every HTTP status and reject only on
 * transport failures (DNS, connection reset, offline...).
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export function getHeader(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) return value;
	}
	return undefined;
}
