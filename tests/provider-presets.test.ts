import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import dns from 'node:dns/promises';
import https, { type RequestOptions } from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { providers } from '../src/lib/providers.ts';
import { validateProviderInput } from '../src/lib/server/provider/validation.ts';
import { modelListRequest, parseModelPage } from '../src/lib/server/provider/adapters.ts';
import { fetchProviderModels } from '../src/lib/server/provider/client.ts';
import { decryptCredentials, encryptCredentials } from '../src/lib/server/provider/credentials.ts';

afterEach(() => {
	mock.restoreAll();
	syncBuiltinESMExports();
});

describe('provider presets', () => {
	it('offers the three official providers and a custom option', () => {
		assert.deepEqual(
			providers.map((provider) => provider.name),
			['OpenAI', 'Google', 'Anthropic', 'Custom Provider']
		);
	});
	it('uses server-owned URLs for official providers even if the client supplies another URL', () => {
		for (const preset of providers.filter((provider) => provider.id !== 'custom')) {
			const input = validateProviderInput({
				providerId: preset.id,
				baseUrl: 'https://attacker.com',
				apiKey: 'test-key',
				remember: true
			});
			assert.equal(input.providerId, preset.id);
			assert.equal(input.baseUrl, preset.baseUrl);
		}
	});
	it('keeps legacy requests and custom URLs compatible', () => {
		const input = validateProviderInput({
			baseUrl: 'https://gateway.provider.com/v1/',
			apiKey: 'test-key',
			remember: false
		});
		assert.equal(input.providerId, 'custom');
		assert.equal(input.baseUrl, 'https://gateway.provider.com/v1');
	});
	it('rejects unknown provider identifiers', () => {
		for (const providerId of ['unsupported', '__proto__', null, 4])
			assert.throws(
				() => validateProviderInput({ providerId, apiKey: 'test-key', remember: true }),
				{ code: 'invalid_provider' }
			);
	});
	it('sends OpenAI keys as bearer credentials to the official models endpoint', () => {
		const request = modelListRequest({ providerId: 'openai', baseUrl: '', apiKey: 'test-key' });
		assert.equal(request.target.href, 'https://api.openai.com/v1/models');
		assert.equal(request.headers.Authorization, 'Bearer test-key');
	});
	it('sends Google keys in a header, not in URLs or bearer credentials', () => {
		const request = modelListRequest(
			{ providerId: 'google', baseUrl: '', apiKey: 'test-key' },
			'opaque+cursor'
		);
		assert.equal(request.target.origin, 'https://generativelanguage.googleapis.com');
		assert.equal(request.target.pathname, '/v1beta/models');
		assert.equal(request.target.searchParams.get('pageToken'), 'opaque+cursor');
		assert.equal(request.headers['x-goog-api-key'], 'test-key');
		assert.equal(request.headers.Authorization, undefined);
		assert.ok(!request.target.href.includes('test-key'));
	});
	it('sends Anthropic authentication and the supported API version', () => {
		const request = modelListRequest(
			{ providerId: 'anthropic', baseUrl: '', apiKey: 'test-key' },
			'last-model'
		);
		assert.equal(request.target.origin, 'https://api.anthropic.com');
		assert.equal(request.target.pathname, '/v1/models');
		assert.equal(request.target.searchParams.get('after_id'), 'last-model');
		assert.equal(request.headers.Authorization, 'Bearer test-key');
		assert.equal(request.headers['anthropic-version'], '2026-10-21');
	});
	it('preserves the provider selection in encrypted cookies', () => {
		const secret = randomBytes(32).toString('base64');
		for (const preset of providers) {
			const credentials = {
				providerId: preset.id,
				baseUrl: preset.baseUrl ?? 'https://gateway.provider.com/v1',
				apiKey: 'test-key',
				remember: false,
				expiresAt: Date.now() + 60_000
			};
			assert.deepEqual(
				decryptCredentials(encryptCredentials(credentials, secret), secret),
				credentials
			);
		}
	});
	it('restores existing cookies as Custom Provider without losing credentials', () => {
		const secret = randomBytes(32).toString('base64');
		const legacy = {
			baseUrl: 'https://gateway.provider.com/v1',
			apiKey: 'legacy-key',
			remember: true,
			expiresAt: Date.now() + 60_000
		};
		assert.deepEqual(decryptCredentials(encryptCredentials(legacy, secret), secret), {
			...legacy,
			providerId: 'custom'
		});
	});
});

describe('native provider model lists', () => {
	it('normalizes Google model names and excludes embedding-only models', () => {
		const page = parseModelPage(
			Buffer.from(
				JSON.stringify({
					models: [
						{
							name: 'models/gemini-chat',
							displayName: 'Gemini Chat',
							supportedGenerationMethods: ['generateContent', 'countTokens']
						},
						{
							name: 'models/embedding',
							displayName: 'Embedding',
							supportedGenerationMethods: ['embedContent']
						}
					],
					nextPageToken: 'next-page'
				})
			),
			'google'
		);
		assert.deepEqual(page, {
			models: [{ id: 'gemini-chat', name: 'Gemini Chat', ownedBy: 'Google' }],
			nextCursor: 'next-page'
		});
	});
	it('handles a Google page with no chat-capable models', () => {
		assert.deepEqual(
			parseModelPage(
				Buffer.from(
					'{"models":[{"name":"models/embedding","supportedGenerationMethods":["embedContent"]}]}'
				),
				'google'
			).models,
			[]
		);
	});
	it('normalizes Anthropic display names and pagination', () => {
		assert.deepEqual(
			parseModelPage(
				Buffer.from(
					'{"data":[{"id":"claude-model","display_name":"Claude Model"}],"has_more":true,"last_id":"claude-model"}'
				),
				'anthropic'
			),
			{
				models: [{ id: 'claude-model', name: 'Claude Model', ownedBy: 'Anthropic' }],
				nextCursor: 'claude-model'
			}
		);
	});
	it('rejects an incomplete Anthropic cursor instead of silently dropping models', () => {
		assert.throws(() => parseModelPage(Buffer.from('{"data":[],"has_more":true}'), 'anthropic'), {
			code: 'invalid_models'
		});
	});
	it('rejects incompatible provider responses', () => {
		assert.throws(() => parseModelPage(Buffer.from('{"data":[]}'), 'google'), {
			code: 'invalid_models'
		});
		assert.throws(() => parseModelPage(Buffer.from('{"models":[]}'), 'anthropic'), {
			code: 'invalid_models'
		});
	});

	function mockPages(pages: Array<{ status?: number; body: unknown }>) {
		mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
		syncBuiltinESMExports();
		const requests: Array<{ target: URL; options: RequestOptions }> = [];
		mock.method(
			https,
			'request',
			(target: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
				const page = pages[requests.length];
				if (!page) throw new Error('Unexpected extra model request');
				requests.push({ target, options });
				const request = new EventEmitter() as ClientRequest;
				request.end = (() => {
					queueMicrotask(() => {
						const stream = new PassThrough();
						const response = Object.assign(stream, {
							statusCode: page.status ?? 200
						}) as unknown as IncomingMessage;
						callback(response);
						if (!stream.destroyed) stream.end(JSON.stringify(page.body));
					});
					return request;
				}) as ClientRequest['end'];
				return request;
			}
		);
		return requests;
	}
	it('fetches every Google model page and keeps credentials on the official host', async () => {
		const requests = mockPages([
			{
				body: {
					models: [{ name: 'models/z-model', supportedGenerationMethods: ['generateContent'] }],
					nextPageToken: 'next-page'
				}
			},
			{
				body: {
					models: [{ name: 'models/a-model', supportedGenerationMethods: ['generateContent'] }]
				}
			}
		]);
		const models = await fetchProviderModels({
			providerId: 'google',
			baseUrl: 'https://attacker.com',
			apiKey: 'test-key'
		});
		assert.deepEqual(
			models.map((model) => model.id),
			['a-model', 'z-model']
		);
		assert.equal(requests.length, 2);
		assert.equal(requests[1].target.searchParams.get('pageToken'), 'next-page');
		for (const request of requests) {
			assert.equal(request.target.hostname, 'generativelanguage.googleapis.com');
			assert.ok(request.options.lookup);
		}
	});
	it('fetches every Anthropic model page', async () => {
		const requests = mockPages([
			{
				body: {
					data: [{ id: 'z-model', display_name: 'Z model' }],
					has_more: true,
					last_id: 'z-model'
				}
			},
			{
				body: {
					data: [{ id: 'a-model', display_name: 'A model' }],
					has_more: false,
					last_id: 'a-model'
				}
			}
		]);
		const models = await fetchProviderModels({
			providerId: 'anthropic',
			baseUrl: '',
			apiKey: 'test-key'
		});
		assert.deepEqual(
			models.map((model) => model.id),
			['a-model', 'z-model']
		);
		assert.equal(requests[1].target.searchParams.get('after_id'), 'z-model');
	});
	it('stops pagination if a provider repeats its cursor', async () => {
		mockPages([
			{ body: { models: [], nextPageToken: 'repeat' } },
			{ body: { models: [], nextPageToken: 'repeat' } }
		]);
		await assert.rejects(
			fetchProviderModels({ providerId: 'google', baseUrl: '', apiKey: 'test-key' }),
			{ code: 'invalid_models' }
		);
	});
	it('reports Google API key or restriction errors without leaking the key', async () => {
		mockPages([{ status: 400, body: { error: 'test-key' } }]);
		await assert.rejects(
			fetchProviderModels({ providerId: 'google', baseUrl: '', apiKey: 'test-key' }),
			{ status: 400, code: 'provider_bad_request' }
		);
	});
});
