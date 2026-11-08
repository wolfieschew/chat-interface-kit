import { ProviderError } from './errors.ts';

export const privateHeaders = { 'Cache-Control': 'no-store' };

export function requireSameOrigin(request: Request, url: URL): void {
	if (
		request.headers.get('origin') !== url.origin ||
		request.headers.get('sec-fetch-site') === 'cross-site'
	) {
		throw new ProviderError(403, 'invalid_origin', 'This request must come from the application.');
	}
}

export async function readProviderInput(request: Request, maxBytes = 8192): Promise<unknown> {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		throw new ProviderError(415, 'invalid_content_type', 'Send provider settings as JSON.');
	const reader = request.body?.getReader();
	if (!reader) throw new ProviderError(400, 'invalid_request', 'Enter your provider settings.');
	let bytes = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new ProviderError(413, 'request_too_large', 'The request payload is too large.');
			}
			chunks.push(value);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		} catch {
			throw new ProviderError(400, 'invalid_request', 'The provider settings could not be read.');
		}
	} finally {
		reader.releaseLock();
	}
}
