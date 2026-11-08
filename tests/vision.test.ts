import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imageInputNotice, visionSupport } from '../src/lib/vision.ts';

describe('vision capability detection', () => {
	it('recognizes known vision-capable models', () => {
		for (const id of [
			'gpt-4o',
			'gpt-4o-mini-2024-07-18',
			'chatgpt-4o-latest',
			'gpt-4.1',
			'gpt-4-turbo-2024-04-09',
			'o3',
			'o4-mini',
			'claude-3-5-sonnet-20241022',
			'claude-opus-4-20250514',
			'gemini-1.5-flash',
			'gemini-2.0-flash-lite',
			'llama-3.2-90b-vision-instruct',
			'qwen2.5-vl-7b-instruct',
			'llava-1.5-7b',
			'my-gateway/gpt-4o'
		])
			assert.equal(visionSupport(id), 'yes', id);
	});
	it('recognizes known text-only models', () => {
		for (const id of [
			'gpt-3.5-turbo',
			'gpt-4-0613',
			'gpt-4-32k',
			'o1-mini',
			'o3-mini',
			'claude-2.1',
			'claude-instant-1.2',
			'gemini-1.0-pro',
			'text-embedding-3-small',
			'dall-e-3',
			'whisper-1'
		])
			assert.equal(visionSupport(id), 'no', id);
	});
	it('marks unrecognized models as unknown instead of guessing', () => {
		for (const id of ['some-provider/model-x', 'llama-3.1-8b-instruct', 'deepseek-chat'])
			assert.equal(visionSupport(id), 'unknown', id);
	});
	it('builds composer notices only for non-yes models', () => {
		assert.equal(imageInputNotice({ id: 'gpt-4o', name: 'GPT-4o' }), null);
		const blocked = imageInputNotice({ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' });
		assert.equal(blocked?.blocked, true);
		assert.match(blocked?.text ?? '', /GPT-3\.5 Turbo can't read images/);
		const cautious = imageInputNotice({ id: 'llama-3.1-8b-instruct' });
		assert.equal(cautious?.blocked, false);
		assert.match(cautious?.text ?? '', /may not support image input/);
	});
	it('prefers the provider-reported capability over the name heuristic', () => {
		// The name says text-only, the provider says vision: trust the provider.
		assert.equal(imageInputNotice({ id: 'mystery-model', vision: true }), null);
		const blocked = imageInputNotice({ id: 'gpt-4o', vision: false });
		assert.equal(blocked?.blocked, true);
	});
});
