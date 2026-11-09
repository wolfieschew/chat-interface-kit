import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CFB, utils, write } from 'xlsx';
import {
	documentContext,
	documentMime,
	isMessageDocument,
	MAX_DOCUMENT_BYTES,
	MAX_DOCUMENT_TEXT_CHARS
} from '../src/lib/documents.ts';
import { extractDocument } from '../src/lib/server/documents.ts';
import { chatCompletionRequest, validateChatInput } from '../src/lib/server/provider/chat.ts';
import { sanitizeConversation } from '../src/lib/history.ts';
import { readRequestBytes } from '../src/lib/server/provider/http.ts';

const document = { name: 'report.pdf', mime: 'application/pdf', size: 100, text: 'Revenue: 42' };

function pdf(text: string): Buffer {
	const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
	];
	let content = '%PDF-1.4\n';
	const offsets = [0];
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(content));
		content += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const start = Buffer.byteLength(content);
	content += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
		.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
	return Buffer.from(content);
}

function docx(text: string): Buffer {
	const archive = CFB.utils.cfb_new();
	CFB.utils.cfb_add(
		archive,
		'[Content_Types].xml',
		Buffer.from(
			'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
		)
	);
	CFB.utils.cfb_add(
		archive,
		'word/document.xml',
		Buffer.from(
			`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
		)
	);
	return CFB.write(archive, { type: 'buffer', fileType: 'zip' }) as Buffer;
}

describe('document extraction', () => {
	it('reads real PDF text and rejects a PDF without text', async () => {
		assert.match((await extractDocument('report.pdf', pdf('Revenue: 42'))).text, /Revenue: 42/);
		await assert.rejects(extractDocument('scan.pdf', pdf('')), /OCR/);
	});
	it('reads real DOCX content', async () => {
		assert.equal((await extractDocument('report.docx', docx('Word content'))).text, 'Word content');
	});
	for (const format of ['xlsx', 'xls', 'ods'] as const) {
		it(`reads ${format} sheet names and cells`, async () => {
			const workbook = utils.book_new();
			utils.book_append_sheet(
				workbook,
				utils.aoa_to_sheet([
					['Item', 'Value'],
					['Revenue', 42]
				]),
				'Summary'
			);
			utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Cost', 10]]), 'Costs');
			const result = await extractDocument(
				`report.${format}`,
				write(workbook, { type: 'buffer', bookType: format })
			);
			assert.match(result.text, /Sheet: Summary\nItem\tValue\nRevenue\t42/);
			assert.match(result.text, /Sheet: Costs\nCost\t10/);
		});
	}
	it('reads CSV and TSV, including quoted cells and Unicode', async () => {
		assert.match(
			(await extractDocument('data.csv', Buffer.from('name,value\n"A, B",42\n日本,7'))).text,
			/A, B\t42/
		);
		assert.match(
			(await extractDocument('data.tsv', Buffer.from('name\tvalue\n日本\t7'))).text,
			/日本\t7/
		);
	});
	it('rejects unsupported, empty, oversized, corrupt, and mislabeled files', async () => {
		for (const name of ['x.exe', 'x.pdf', 'x.doc', 'x.docx', 'x.xlsx', 'x.xls', 'x.ods'])
			await assert.rejects(extractDocument(name, Buffer.from('not a document')));
		await assert.rejects(extractDocument('empty.csv', Buffer.alloc(0)));
		await assert.rejects(extractDocument('big.pdf', Buffer.alloc(MAX_DOCUMENT_BYTES + 1)));
		await assert.rejects(extractDocument('bad.csv', Buffer.from([0xff, 0xfe, 0])));
		await assert.rejects(extractDocument('bad.pdf', Buffer.from('%PDF-invalid')));
	});
	it('rejects excess text and oversized spreadsheet ranges without truncating', async () => {
		await assert.rejects(
			extractDocument('big.docx', docx('a'.repeat(MAX_DOCUMENT_TEXT_CHARS + 1))),
			/too much text/
		);
		const workbook = utils.book_new();
		utils.book_append_sheet(
			workbook,
			utils.aoa_to_sheet(Array.from({ length: 2001 }, () => ['a'])),
			'Long'
		);
		await assert.rejects(
			extractDocument('big.xlsx', write(workbook, { type: 'buffer', bookType: 'xlsx' })),
			/2,000 rows/
		);
	});
	it('rejects Office archives with excessive expanded sizes', async () => {
		const data = docx('hello');
		const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		assert.ok(central > 0);
		data.writeUInt32LE(40 * 1024 * 1024, central + 24);
		await assert.rejects(extractDocument('bomb.docx', data), /archive/);
	});
});

describe('document chat context and persistence', () => {
	it('recognizes formats with case-insensitive extensions', () => {
		assert.equal(documentMime('REPORT.PDF'), 'application/pdf');
		assert.equal(documentMime('report.doc'), 'application/msword');
		assert.equal(documentMime('report.exe'), undefined);
		assert.equal(documentMime('__proto__'), undefined);
	});
	it('validates user-only document messages and strips extra properties', () => {
		const result = validateChatInput({
			model: 'model',
			messages: [{ role: 'user', content: '', documents: [{ ...document, extra: 'drop' }] }]
		});
		assert.deepEqual(result.messages[0].documents, [document]);
		for (const invalid of [
			{ ...document, mime: 'text/html' },
			{ ...document, size: MAX_DOCUMENT_BYTES + 1 },
			{ ...document, text: '' },
			{ ...document, text: 'a'.repeat(MAX_DOCUMENT_TEXT_CHARS + 1) }
		]) {
			assert.equal(isMessageDocument(invalid), false);
			assert.throws(() =>
				validateChatInput({
					model: 'm',
					messages: [{ role: 'user', content: '', documents: [invalid] }]
				})
			);
		}
		assert.throws(() =>
			validateChatInput({
				model: 'm',
				messages: [
					{ role: 'assistant', content: 'hi', documents: [document] },
					{ role: 'user', content: 'next' }
				]
			})
		);
		assert.throws(() =>
			validateChatInput({
				model: 'm',
				messages: [{ role: 'user', content: '', documents: Array(5).fill(document) }]
			})
		);
		assert.throws(() =>
			validateChatInput({
				model: 'm',
				messages: [
					{
						role: 'user',
						content: '',
						documents: Array(3).fill({ ...document, text: 'a'.repeat(40_000) })
					}
				]
			})
		);
	});
	it('includes document text alongside images for every provider without leaking metadata', () => {
		for (const providerId of ['openai', 'google', 'anthropic', 'custom'] as const) {
			const input = validateChatInput({
				model: 'model',
				messages: [
					{
						role: 'user',
						content: 'Summarize',
						documents: [document],
						images: [{ mime: 'image/png', data: 'aGk=' }]
					}
				]
			});
			const payload = JSON.parse(
				chatCompletionRequest(
					{ providerId, baseUrl: 'https://example.com/v1', apiKey: 'key' },
					input
				).body
			);
			const message = (payload.contents ?? payload.messages)[0];
			const parts = message.parts ?? message.content;
			const text = parts.find((part: { text?: string }) => part.text)?.text;
			assert.equal(text, documentContext('Summarize', [document]));
			assert.equal(parts.length, 2);
			assert.equal(message.documents, undefined);
			assert.throws(() =>
				validateChatInput({
					model: 'm',
					messages: [
						{
							role: 'user',
							content: '',
							documents: Array(4).fill(document),
							images: [{ mime: 'image/png', data: 'aGk=' }]
						}
					]
				})
			);
		}
	});
	it('restores document-only history and discards invalid or excess documents', () => {
		const result = sanitizeConversation({
			id: 'chat',
			messages: [
				{
					id: 'user',
					role: 'user',
					content: '',
					documents: [document, { ...document, text: '' }, ...Array(5).fill(document)]
				}
			]
		});
		assert.equal(result?.messages.length, 1);
		assert.deepEqual(result.messages[0].documents, Array(4).fill(document));
		assert.equal(
			sanitizeConversation({
				id: 'chat',
				messages: [{ id: 'assistant', role: 'assistant', content: 'hello', documents: [document] }]
			})?.messages[0].documents,
			undefined
		);
	});
	it('enforces the upload byte limit on streamed bodies', async () => {
		await assert.rejects(
			readRequestBytes(new Request('https://example.com', { method: 'POST', body: 'abc' }), 2),
			{ code: 'request_too_large' }
		);
		assert.equal(
			(
				await readRequestBytes(
					new Request('https://example.com', { method: 'POST', body: 'abc' }),
					3
				)
			).toString(),
			'abc'
		);
	});
});
