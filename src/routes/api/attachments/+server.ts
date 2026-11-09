import type { RequestHandler } from './$types';
import { MAX_DOCUMENT_BYTES } from '#lib/documents.ts';
import { extractDocument } from '#lib/server/documents.ts';
import { ProviderError, providerFailure } from '#lib/server/provider/errors.ts';
import { privateHeaders, readRequestBytes, requireSameOrigin } from '#lib/server/provider/http.ts';

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		requireSameOrigin(request, url);
		if (request.headers.get('content-type') !== 'application/octet-stream')
			throw new ProviderError(415, 'invalid_content_type', 'Send the document as a file.');
		let name: string;
		try {
			name = decodeURIComponent(request.headers.get('x-file-name') ?? '');
		} catch {
			throw new ProviderError(400, 'invalid_document', 'The file name is invalid.');
		}
		const data = await readRequestBytes(request, MAX_DOCUMENT_BYTES);
		const document = await extractDocument(name, data);
		return Response.json({ document }, { headers: privateHeaders });
	} catch (error) {
		return providerFailure(error);
	}
};
