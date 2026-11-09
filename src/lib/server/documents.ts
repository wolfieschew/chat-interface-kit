import {
	documentExtension,
	documentMime,
	MAX_DOCUMENT_BYTES,
	MAX_DOCUMENT_TEXT_CHARS
} from '../documents.ts';
import type { MessageDocument } from '../types.ts';
import { ProviderError } from './provider/errors.ts';

const MAX_PDF_PAGES = 100;
const MAX_SHEETS = 20;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 100;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

function invalid(
	message = 'The file could not be read. Check that it is valid and not password-protected.'
) {
	return new ProviderError(400, 'invalid_document', message);
}

async function checkArchive(data: Buffer, requiredEntry: string): Promise<void> {
	const { fromBuffer } = await import('yauzl');
	await new Promise<void>((resolve, reject) => {
		fromBuffer(data, { lazyEntries: true }, (error, zip) => {
			if (error || !zip) return reject(invalid());
			let size = 0;
			let entries = 0;
			let found = false;
			const fail = () => {
				zip.close();
				reject(invalid('The document archive is invalid or too large.'));
			};
			zip.on('error', fail);
			zip.on('entry', (entry) => {
				size += entry.uncompressedSize;
				if (++entries > 1000 || size > MAX_UNCOMPRESSED_BYTES || entry.generalPurposeBitFlag & 1)
					return fail();
				if (entry.fileName === requiredEntry) found = true;
				zip.readEntry();
			});
			zip.on('end', () => (found ? resolve() : reject(invalid())));
			zip.readEntry();
		});
	});
}

export async function extractDocument(name: string, data: Buffer): Promise<MessageDocument> {
	const mime = documentMime(name);
	if (!mime || !name || name.length > 255 || /[\x00-\x1f]/.test(name))
		throw new ProviderError(
			415,
			'unsupported_document',
			'Choose a PDF, Word, Excel, ODS, CSV, or TSV file.'
		);
	if (!data.length || data.length > MAX_DOCUMENT_BYTES)
		throw new ProviderError(
			413,
			'document_too_large',
			'Each document must be non-empty and 4 MB or smaller.'
		);
	const extension = documentExtension(name);
	const zip = data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
	const ole = data
		.subarray(0, 8)
		.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
	try {
		let text: string;
		if (extension === 'pdf') {
			if (data.subarray(0, 5).toString() !== '%PDF-') throw invalid();
			const { PDFParse } = await import('pdf-parse');
			const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false });
			try {
				const info = await parser.getInfo();
				if (info.total > MAX_PDF_PAGES) throw invalid('Choose a PDF with 100 pages or fewer.');
				const result = await parser.getText({ pageJoiner: '' });
				text = result.pages.map((page) => page.text).join('\n\n');
			} finally {
				await parser.destroy();
			}
		} else if (extension === 'doc' || extension === 'docx') {
			if (extension === 'docx') {
				if (!zip) throw invalid();
				await checkArchive(data, 'word/document.xml');
			} else if (!ole) throw invalid();
			const { default: WordExtractor } = await import('word-extractor');
			const document = await new WordExtractor().extract(data);
			text = [
				document.getBody(),
				document.getFootnotes(),
				document.getEndnotes(),
				document.getTextboxes({ includeHeadersAndFooters: false })
			]
				.filter(Boolean)
				.join('\n\n');
		} else {
			if (extension === 'xlsx' || extension === 'ods') {
				if (!zip) throw invalid();
				await checkArchive(data, extension === 'xlsx' ? 'xl/workbook.xml' : 'content.xml');
			} else if (extension === 'xls' && !ole) throw invalid();
			const { read, utils } = await import('xlsx');
			const csv = extension === 'csv' || extension === 'tsv';
			const input = csv ? new TextDecoder('utf-8', { fatal: true }).decode(data) : data;
			if (typeof input === 'string' && input.includes('\0')) throw invalid();
			const workbook = read(input, {
				type: csv ? 'string' : 'buffer',
				raw: true,
				sheetRows: MAX_ROWS + 1,
				...(extension === 'tsv' ? { FS: '\t' } : {})
			});
			if (workbook.SheetNames.length > MAX_SHEETS)
				throw invalid('Choose a spreadsheet with 20 sheets or fewer.');
			text = workbook.SheetNames.map((sheetName) => {
				const sheet = workbook.Sheets[sheetName];
				const ref = sheet['!fullref'] ?? sheet['!ref'];
				if (!ref) return '';
				const range = utils.decode_range(ref);
				if (range.e.r >= MAX_ROWS || range.e.c >= MAX_COLUMNS)
					throw invalid('Each sheet must have at most 2,000 rows and 100 columns.');
				const rows = utils.sheet_to_csv(sheet, { FS: '\t', blankrows: false }).trim();
				return rows ? `Sheet: ${sheetName}\n${rows}` : '';
			})
				.filter(Boolean)
				.join('\n\n');
		}
		text = text.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
		if (!text)
			throw invalid(
				extension === 'pdf'
					? 'This PDF has no readable text. Scanned PDFs need OCR before attaching.'
					: 'This document has no readable text or cells.'
			);
		if (text.length > MAX_DOCUMENT_TEXT_CHARS)
			throw invalid(
				'The document contains too much text. Attach a smaller section (up to 48,000 characters).'
			);
		return { name, mime, size: data.length, text };
	} catch (error) {
		if (ProviderError.is(error)) throw error;
		throw invalid();
	}
}
