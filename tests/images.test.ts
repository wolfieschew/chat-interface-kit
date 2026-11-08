import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	imageByteLength,
	imageDataUrl,
	isBase64Image,
	isImageMime,
	MAX_IMAGE_BYTES
} from '../src/lib/images.ts';

describe('image attachments', () => {
	it('builds a data URL from the stored payload', () => {
		assert.equal(
			imageDataUrl({ name: 'a.png', mime: 'image/png', data: 'aGk=' }),
			'data:image/png;base64,aGk='
		);
	});
	it('measures decoded size including base64 padding', () => {
		assert.equal(imageByteLength('aGk='), 2);
		assert.equal(imageByteLength('aGVsbG8='), 5);
		assert.equal(imageByteLength('aGVsbG8h'), 6);
	});
	it('accepts only supported image types', () => {
		for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
			assert.equal(isImageMime(mime), true);
		for (const mime of ['image/svg+xml', 'text/html', 'image/bmp', 42, null])
			assert.equal(isImageMime(mime), false);
	});
	it('accepts only complete base64 payloads', () => {
		assert.equal(isBase64Image('aGVsbG8='), true);
		assert.equal(isBase64Image('aGVsbG8h'), true);
		for (const value of ['', 'aGk', 'aGk==', 'not base64!', 'aGk=extra', 7, null])
			assert.equal(isBase64Image(value), false);
	});
	it('keeps the size ceiling aligned with the documented 2 MB limit', () => {
		assert.equal(MAX_IMAGE_BYTES, 2 * 1024 * 1024);
	});
});
