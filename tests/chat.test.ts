import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https, { type RequestOptions } from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import type { ClientRequest, IncomingMessage } from 'node:http';
import {
	chatCompletionRequest,
	validateChatInput,
	parseChatEvent,
	openChatStream,
	type ChatCompletionInput
} from '../src/lib/server/provider/chat.ts';
import { SseDecoder } from '../src/lib/sse.ts';

afterEach(() => {
	mock.restoreAll();
	syncBuiltinESMExports();
});

const messages = [{ role: 'user' as const, content: 'Hello' }];
const input: ChatCompletionInput = { model: 'gpt-x', messages };

describe('chat requests', () => {
	it('builds OpenAI-compatible chat requests with the system prompt first', () => {
		const { target, headers, body } = chatCompletionRequest(
			{ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-secret' },
			{ model: 'gpt-x', systemPrompt: 'Be brief.', messages }
		);
		assert.equal(target.href, 'https://api.openai.com/v1/chat/completions');
		assert.equal(headers.Authorization, 'Bearer test-secret');
		const payload = JSON.parse(body);
		assert.equal(payload.model, 'gpt-x');
		assert.equal(payload.stream, true);
		assert.deepEqual(payload.messages, [
			{ role: 'system', content: 'Be brief.' },
			{ role: 'user', content: 'Hello' }
		]);
	});
	it('uses the custom base URL for OpenAI-compatible providers', () => {
		const { target, headers } = chatCompletionRequest(
			{ providerId: 'custom', baseUrl: 'https://api.provider.com/v1', apiKey: 'key' },
			input
		);
		assert.equal(target.href, 'https://api.provider.com/v1/chat/completions');
		assert.equal(headers.Authorization, 'Bearer key');
	});
	it('builds Anthropic message requests with the system prompt at the top level', () => {
		const { target, headers, body } = chatCompletionRequest(
			{ providerId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key' },
			{ model: 'claude-x', systemPrompt: 'Be brief.', messages }
		);
		assert.equal(target.href, 'https://api.anthropic.com/v1/messages');
		assert.equal(headers['anthropic-version'], '2026-10-21');
		const payload = JSON.parse(body);
		assert.equal(payload.system, 'Be brief.');
		assert.equal(payload.max_tokens, 4096);
		assert.equal(payload.stream, true);
		assert.deepEqual(payload.messages, messages);
	});
	it('builds Google streaming requests with model roles and system instruction', () => {
		const { target, headers, body } = chatCompletionRequest(
			{
				providerId: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				apiKey: 'google-key'
			},
			{
				model: 'gemini-x',
				systemPrompt: 'Be brief.',
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi' },
					{ role: 'user', content: 'More' }
				]
			}
		);
		assert.equal(target.pathname, '/v1beta/models/gemini-x:streamGenerateContent');
		assert.equal(target.searchParams.get('alt'), 'sse');
		assert.equal(headers['x-goog-api-key'], 'google-key');
		assert.equal(headers.Authorization, undefined);
		const payload = JSON.parse(body);
		assert.deepEqual(
			payload.contents.map((item: { role: string }) => item.role),
			['user', 'model', 'user']
		);
		assert.deepEqual(payload.systemInstruction, { parts: [{ text: 'Be brief.' }] });
	});
});

describe('chat input validation', () => {
	it('accepts a user message and drops a blank system prompt', () => {
		assert.deepEqual(validateChatInput({ model: 'gpt-x', messages }), {
			model: 'gpt-x',
			messages
		});
		assert.deepEqual(validateChatInput({ model: 'gpt-x', systemPrompt: '   ', messages }), {
			model: 'gpt-x',
			messages
		});
	});
	it('rejects model identifiers that could escape the request path', () => {
		for (const model of ['../etc/passwd', 'model/name', 'a b', '', 'x'.repeat(129)])
			assert.throws(() => validateChatInput({ model, messages }), { code: 'invalid_model' });
	});
	it('rejects empty, oversized, or mistyped conversations', () => {
		for (const value of [
			{ model: 'gpt-x', messages: [] },
			{ model: 'gpt-x', messages: [{ role: 'system', content: 'x' }] },
			{ model: 'gpt-x', messages: [{ role: 'user', content: '   ' }] },
			{ model: 'gpt-x', messages: [{ role: 'assistant', content: 'x' }] },
			{ model: 'gpt-x', messages: [{ role: 'user', content: 'x'.repeat(64 * 1024 + 1) }] },
			{
				model: 'gpt-x',
				messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }))
			}
		])
			assert.throws(() => validateChatInput(value), { code: 'invalid_request' });
	});
	it('rejects an oversized system prompt', () => {
		assert.throws(
			() => validateChatInput({ model: 'gpt-x', systemPrompt: 'x'.repeat(8193), messages }),
			{ code: 'invalid_system_prompt' }
		);
	});
});

describe('chat requests with images', () => {
	const image = { mime: 'image/png', data: 'iVBORw0KGgo=' };
	it('sends OpenAI image parts ahead of the text', () => {
		const { body } = chatCompletionRequest(
			{ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'key' },
			{ model: 'gpt-x', messages: [{ role: 'user', content: 'What is this?', images: [image] }] }
		);
		const payload = JSON.parse(body);
		assert.deepEqual(payload.messages[0].content, [
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } },
			{ type: 'text', text: 'What is this?' }
		]);
	});
	it('sends Anthropic image blocks ahead of the text', () => {
		const { body } = chatCompletionRequest(
			{ providerId: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key' },
			{ model: 'claude-x', messages: [{ role: 'user', content: 'What is this?', images: [image] }] }
		);
		const payload = JSON.parse(body);
		assert.deepEqual(payload.messages[0].content, [
			{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } },
			{ type: 'text', text: 'What is this?' }
		]);
	});
	it('sends Google inline data parts ahead of the text', () => {
		const { body } = chatCompletionRequest(
			{
				providerId: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				apiKey: 'key'
			},
			{ model: 'gemini-x', messages: [{ role: 'user', content: 'What is this?', images: [image] }] }
		);
		const payload = JSON.parse(body);
		assert.deepEqual(payload.contents[0].parts, [
			{ inlineData: { mimeType: 'image/png', data: image.data } },
			{ text: 'What is this?' }
		]);
	});
	it('sends image-only messages without an empty text part', () => {
		const { body } = chatCompletionRequest(
			{ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'key' },
			{ model: 'gpt-x', messages: [{ role: 'user', content: '', images: [image] }] }
		);
		const payload = JSON.parse(body);
		assert.deepEqual(payload.messages[0].content, [
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } }
		]);
	});
});

describe('chat input validation with images', () => {
	const image = { mime: 'image/png', data: 'iVBORw0KGgo=' };
	it('accepts image-only user messages and strips extra fields', () => {
		const validated = validateChatInput({
			model: 'gpt-x',
			messages: [{ role: 'user', content: '', images: [{ ...image, name: 'shot.png' }] }]
		});
		assert.deepEqual(validated.messages, [{ role: 'user', content: '', images: [image] }]);
	});
	it('rejects invalid, oversized, or misplaced images', () => {
		const tooBig = { mime: 'image/png', data: 'A'.repeat(2 * 1024 * 1024 * 2) };
		const cases = [
			{ images: [{ mime: 'text/html', data: 'aGk=' }] },
			{ images: [{ mime: 'image/png', data: 'not base64!' }] },
			{ images: [{ mime: 'image/png', data: 'aGk' }] },
			{ images: [tooBig] },
			{ images: Array.from({ length: 5 }, () => image) },
			{
				images: Array.from({ length: 4 }, () => tooBig)
			}
		];
		for (const images of cases)
			assert.throws(
				() =>
					validateChatInput({ model: 'gpt-x', messages: [{ role: 'user', content: 'x', images }] }),
				{ code: 'invalid_image' }
			);
		assert.throws(
			() =>
				validateChatInput({
					model: 'gpt-x',
					messages: [{ role: 'assistant', content: 'x', images: [image] }]
				}),
			{ code: 'invalid_image' }
		);
	});
	it('still rejects text-only messages without content', () => {
		assert.throws(
			() => validateChatInput({ model: 'gpt-x', messages: [{ role: 'user', content: '   ' }] }),
			{ code: 'invalid_request' }
		);
	});
});

describe('chat stream events', () => {
	it('extracts OpenAI-compatible deltas and ignores usage-only chunks', () => {
		assert.equal(parseChatEvent('{"choices":[{"delta":{"content":"Hel"}}]}', 'openai'), 'Hel');
		assert.equal(parseChatEvent('{"choices":[{"delta":{}}]}', 'custom'), '');
		assert.equal(parseChatEvent('{"choices":[],"usage":{"total_tokens":3}}', 'openai'), '');
	});
	it('extracts Anthropic text deltas and ignores lifecycle events', () => {
		assert.equal(
			parseChatEvent(
				'{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
				'anthropic'
			),
			'Hi'
		);
		assert.equal(parseChatEvent('{"type":"ping"}', 'anthropic'), '');
		assert.equal(parseChatEvent('{"type":"message_stop"}', 'anthropic'), '');
	});
	it('extracts Google candidate text and ignores finish-only chunks', () => {
		assert.equal(
			parseChatEvent(
				'{"candidates":[{"content":{"parts":[{"text":"A"},{"text":"B"}]}}]}',
				'google'
			),
			'AB'
		);
		assert.equal(parseChatEvent('{"candidates":[{"finishReason":"STOP"}]}', 'google'), '');
	});
	it('surfaces provider error events', () => {
		for (const [payload, providerId] of [
			['{"error":{"message":"boom"}}', 'openai'],
			['{"type":"error","error":{"message":"boom"}}', 'anthropic'],
			['{"error":{"message":"quota exceeded"}}', 'google']
		] as const)
			assert.throws(() => parseChatEvent(payload, providerId), {
				code: 'provider_error',
				message: /boom|quota/
			});
	});
	it('rejects unreadable events and blocked Google prompts', () => {
		assert.throws(() => parseChatEvent('not json', 'openai'), { code: 'invalid_stream' });
		assert.throws(() => parseChatEvent('[]', 'openai'), { code: 'invalid_stream' });
		assert.throws(() => parseChatEvent('{"promptFeedback":{"blockReason":"SAFETY"}}', 'google'), {
			code: 'provider_blocked'
		});
	});
});

describe('SSE decoding', () => {
	it('reassembles events split across chunks', () => {
		const decoder = new SseDecoder();
		assert.deepEqual(decoder.push('data: {"a"'), []);
		assert.deepEqual(decoder.push(':1}\n\n'), ['{"a":1}']);
	});
	it('joins multi-line data and ignores other fields and comments', () => {
		const decoder = new SseDecoder();
		assert.deepEqual(
			decoder.push('event: delta\nid: 1\ndata: one\ndata: two\r\n\r\n: comment\n\n'),
			['one\ntwo']
		);
	});
	it('flushes a final event without a trailing blank line', () => {
		const decoder = new SseDecoder();
		assert.deepEqual(decoder.push('data: tail'), []);
		assert.deepEqual(decoder.flush(), ['tail']);
	});
});

function mockStream(status: number, chunks: string[], delay = 0) {
	mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
	syncBuiltinESMExports();
	let captured: { url?: URL; options?: RequestOptions; body?: string } = {};
	let upstream: PassThrough | undefined;
	mock.method(
		https,
		'request',
		(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
			captured = { url, options };
			const request = new EventEmitter() as ClientRequest;
			request.end = ((body?: string) => {
				captured.body = body;
				queueMicrotask(() => {
					const stream = new PassThrough();
					upstream = stream;
					const response = Object.assign(stream, {
						statusCode: status
					}) as unknown as IncomingMessage;
					callback(response);
					let index = 0;
					const writeNext = () => {
						if (stream.destroyed) return;
						if (index >= chunks.length) {
							stream.end();
							return;
						}
						stream.write(chunks[index++]);
						if (delay) setTimeout(writeNext, delay);
						else queueMicrotask(writeNext);
					};
					writeNext();
				});
				return request;
			}) as ClientRequest['end'];
			return request;
		}
	);
	return {
		captured: () => captured,
		destroy: (error: Error) => upstream?.destroy(error)
	};
}

const connection = {
	providerId: 'openai' as const,
	baseUrl: 'https://8.8.8.8/v1',
	apiKey: 'test-secret'
};

async function collect(stream: AsyncGenerator<string>) {
	const chunks: string[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

describe('chat streaming transport', () => {
	it('streams OpenAI-compatible deltas over the pinned HTTPS client', async () => {
		const handle = mockStream(200, [
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
			'data: [DONE]\n\n'
		]);
		const events = await openChatStream(connection, input, AbortSignal.timeout(5000));
		assert.deepEqual(await collect(events), ['Hel', 'lo']);
		assert.equal(handle.captured().url?.pathname, '/v1/chat/completions');
		assert.equal(
			(handle.captured().options?.headers as Record<string, string>).Authorization,
			'Bearer test-secret'
		);
		assert.equal(handle.captured().options?.agent, false);
		assert.ok(handle.captured().options?.lookup);
		assert.ok(handle.captured().body?.includes('"stream":true'));
		assert.ok(!handle.captured().body?.includes('test-secret'));
	});
	it('streams Google SSE deltas', async () => {
		const handle = mockStream(200, [
			'data: {"candidates":[{"content":{"parts":[{"text":"Bon"}]}}]}\n\n',
			'data: {"candidates":[{"content":{"parts":[{"text":"jour"}]}}]}\r\n\r\n'
		]);
		const events = await openChatStream(
			{ providerId: 'google', baseUrl: 'https://8.8.8.8/v1beta', apiKey: 'google-key' },
			input,
			AbortSignal.timeout(5000)
		);
		assert.deepEqual(await collect(events), ['Bon', 'jour']);
		assert.equal(handle.captured().url?.hostname, 'generativelanguage.googleapis.com');
		assert.equal(handle.captured().url?.pathname, '/v1beta/models/gpt-x:streamGenerateContent');
		assert.equal(handle.captured().url?.searchParams.get('alt'), 'sse');
	});
	it('maps upstream HTTP failures to provider errors before streaming', async () => {
		mockStream(401, []);
		await assert.rejects(openChatStream(connection, input, AbortSignal.timeout(5000)), {
			code: 'provider_unauthorized'
		});
	});
	it('surfaces provider error events mid-stream', async () => {
		mockStream(200, [
			'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
			'data: {"error":{"message":"boom"}}\n\n'
		]);
		const events = await openChatStream(connection, input, AbortSignal.timeout(5000));
		const received: string[] = [];
		await assert.rejects(
			async () => {
				for await (const text of events) received.push(text);
			},
			{ code: 'provider_error' }
		);
		assert.deepEqual(received, ['Hi']);
	});
	it('ends quietly when the consumer stops the stream', async () => {
		const handle = mockStream(
			200,
			[
				'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"B"}}]}\n\n'
			],
			5
		);
		const controller = new AbortController();
		const events = await openChatStream(connection, input, controller.signal);
		const received: string[] = [];
		for await (const text of events) {
			received.push(text);
			controller.abort();
			handle.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
		}
		assert.deepEqual(received, ['A']);
	});
});
