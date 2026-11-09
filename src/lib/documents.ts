import type { MessageDocument } from './types.ts';

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_CHARS = 48_000;
export const MAX_DOCUMENT_TOTAL_CHARS = 96_000;
export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
	pdf: 'application/pdf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	csv: 'text/csv',
	tsv: 'text/tab-separated-values'
};
export const ATTACHMENT_ACCEPT =
	'image/png,image/jpeg,image/webp,image/gif,' +
	Object.keys(DOCUMENT_TYPES)
		.map((extension) => `.${extension}`)
		.join(',');

export function documentExtension(name: string): string {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

export function documentMime(name: string): string | undefined {
	const extension = documentExtension(name);
	return Object.hasOwn(DOCUMENT_TYPES, extension) ? DOCUMENT_TYPES[extension] : undefined;
}

export function isMessageDocument(value: unknown): value is MessageDocument {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const document = value as Record<string, unknown>;
	return (
		typeof document.name === 'string' &&
		document.name.length > 0 &&
		document.name.length <= 255 &&
		documentMime(document.name) === document.mime &&
		typeof document.size === 'number' &&
		Number.isInteger(document.size) &&
		document.size > 0 &&
		document.size <= MAX_DOCUMENT_BYTES &&
		typeof document.text === 'string' &&
		!!document.text.trim() &&
		document.text.length <= MAX_DOCUMENT_TEXT_CHARS
	);
}

export function documentContext(content: string, documents: MessageDocument[] = []): string {
	return [
		content,
		...documents.map(
			(document) => `Attached file: ${JSON.stringify(document.name)}\n${document.text}`
		)
	]
		.filter(Boolean)
		.join('\n\n');
}

export async function readDocumentFile(file: File, signal?: AbortSignal): Promise<MessageDocument> {
	if (!documentMime(file.name))
		throw new Error('Choose a PDF, Word, Excel, ODS, CSV, or TSV file.');
	if (!file.size || file.size > MAX_DOCUMENT_BYTES)
		throw new Error('Each document must be non-empty and 4 MB or smaller.');
	const response = await fetch('/api/attachments', {
		method: 'POST',
		credentials: 'same-origin',
		cache: 'no-store',
		signal,
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-File-Name': encodeURIComponent(file.name)
		},
		body: file
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error?.message ?? 'The document could not be read.');
	if (!isMessageDocument(result.document)) throw new Error('The document could not be read.');
	return result.document;
}
