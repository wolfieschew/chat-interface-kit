import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https, { type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import {
	encryptCredentials,
	decryptCredentials,
	REMEMBER_SECONDS
} from '../src/lib/server/provider/credentials.ts';
import {
	isPublicAddress,
	normalizeBaseUrl,
	validateProviderInput
} from '../src/lib/server/provider/validation.ts';
import {
	fetchProviderModels,
	parseModelList,
	resolvePublicAddresses
} from '../src/lib/server/provider/client.ts';
import { readProviderInput, requireSameOrigin } from '../src/lib/server/provider/http.ts';
import { ProviderError, providerFailure } from '../src/lib/server/provider/errors.ts';

afterEach(() => mock.restoreAll());

describe('public provider URLs', () => {
	it('normalizes the API root without adding or duplicating an API version', () => {
		assert.equal(
			normalizeBaseUrl(' https://API.provider.com/v1/// '),
			'https://api.provider.com/v1'
		);
		assert.equal(normalizeBaseUrl('https://api.provider.com/api'), 'https://api.provider.com/api');
		assert.equal(normalizeBaseUrl('https://api.provider.com.'), 'https://api.provider.com');
	});
	for (const url of [
		'http://api.provider.com/v1',
		'https://localhost',
		'https://api.local',
		'https://internal',
		'https://user:password@api.provider.com',
		'https://api.provider.com?api_key=secret',
		'https://api.provider.com/#fragment',
		'https://2130706433',
		'https://0x7f000001',
		'https://[::ffff:127.0.0.1]',
		'https://[::1]',
		'https://api.provider.com\\@localhost'
	]) {
		it(`rejects unsafe URL ${url}`, () =>
			assert.throws(() => normalizeBaseUrl(url), ProviderError));
	}
	for (const address of [
		'0.0.0.0',
		'127.0.0.2',
		'10.1.2.3',
		'172.31.255.255',
		'192.168.0.1',
		'100.64.0.1',
		'169.254.169.254',
		'192.0.2.1',
		'198.51.100.1',
		'203.0.113.1',
		'224.0.0.1',
		'240.0.0.1',
		'::',
		'::1',
		'fc00::1',
		'fe80::1',
		'fec0::1',
		'ff02::1',
		'::ffff:8.8.8.8',
		'64:ff9b::a00:1',
		'2001:db8::1',
		'2002:7f00:1::',
		'4000::1'
	]) {
		it(`blocks non-public address ${address}`, () => assert.equal(isPublicAddress(address), false));
	}
	it('allows global IPv4 and IPv6 addresses', () => {
		assert.equal(isPublicAddress('8.8.8.8'), true);
		assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
	});
	it('rejects a hostname if any DNS answer is private', async () => {
		await assert.rejects(
			resolvePublicAddresses(
				new URL('https://api.provider.com'),
				AbortSignal.timeout(1000),
				async () => [
					{ address: '8.8.8.8', family: 4 },
					{ address: '10.0.0.1', family: 4 }
				]
			),
			{ code: 'private_address' }
		);
	});
	it('retains only validated DNS answers for connection pinning', async () => {
		assert.deepEqual(
			await resolvePublicAddresses(
				new URL('https://api.provider.com'),
				AbortSignal.timeout(1000),
				async () => [
					{ address: '2606:4700:4700::1111', family: 6 },
					{ address: '8.8.8.8', family: 4 }
				]
			),
			[
				{ address: '8.8.8.8', family: 4 },
				{ address: '2606:4700:4700::1111', family: 6 }
			]
		);
	});
	it('rejects private IP literals even when DNS resolution is skipped', async () => {
		await assert.rejects(
			resolvePublicAddresses(new URL('https://127.0.0.1'), AbortSignal.timeout(1000)),
			{ code: 'private_address' }
		);
	});
	it('rejects header injection and oversized credentials', () => {
		for (const apiKey of ['', 'key\r\nX-Injected: value', 'x'.repeat(1025)])
			assert.throws(
				() =>
					validateProviderInput({ baseUrl: 'https://api.provider.com/v1', apiKey, remember: true }),
				ProviderError
			);
	});
});

describe('encrypted credentials', () => {
	const secret = randomBytes(32).toString('base64');
	const now = Date.now();
	const credentials = {
		providerId: 'custom' as const,
		baseUrl: 'https://api.provider.com/v1',
		apiKey: 'test-key-never-returned-to-the-client',
		remember: true,
		expiresAt: now + REMEMBER_SECONDS * 1000
	};
	it('encrypts the key and verifies expiry on round trip', () => {
		const token = encryptCredentials(credentials, secret);
		assert.ok(!token.includes(credentials.apiKey));
		assert.deepEqual(decryptCredentials(token, secret, now), credentials);
		assert.equal(decryptCredentials(token, secret, credentials.expiresAt), null);
	});
	it('uses a unique nonce for every encryption', () =>
		assert.notEqual(
			encryptCredentials(credentials, secret),
			encryptCredentials(credentials, secret)
		));
	it('rejects tampering and the wrong encryption key', () => {
		const token = encryptCredentials(credentials, secret);
		const parts = token.split('.');
		const encrypted = Buffer.from(parts[2], 'base64url');
		encrypted[0] ^= 1;
		parts[2] = encrypted.toString('base64url');
		assert.equal(decryptCredentials(parts.join('.'), secret, now), null);
		assert.equal(decryptCredentials(token, randomBytes(32).toString('base64'), now), null);
	});
	it('rejects malformed tokens and unconfigured servers', () => {
		assert.equal(decryptCredentials('v1.invalid.token', secret), null);
		assert.throws(() => encryptCredentials(credentials, undefined), {
			code: 'server_not_configured'
		});
		assert.throws(() => encryptCredentials(credentials, 'not-an-encryption-key'), {
			code: 'server_not_configured'
		});
	});
});

describe('provider responses', () => {
	it('deduplicates, sorts, and normalizes model identifiers', () => {
		assert.deepEqual(
			parseModelList(
				Buffer.from(
					JSON.stringify({
						data: [
							{ id: 'z-model', owned_by: 'provider' },
							{ id: 'a-model', name: 'A model' },
							{ id: 'z-model', owned_by: 'provider' },
							{ id: '' },
							{}
						]
					})
				)
			),
			[
				{ id: 'a-model', name: 'A model' },
				{ id: 'z-model', name: 'z-model', ownedBy: 'provider' }
			]
		);
	});
	it('allows an empty accessible model list', () =>
		assert.deepEqual(parseModelList(Buffer.from('{"data":[]}')), []));
	it('reads vision capability from provider model metadata', () => {
		const body = JSON.stringify({
			data: [
				{ id: 'with-flag', vision: true },
				{ id: 'no-flag', vision: false },
				{
					id: 'with-modalities',
					modalities: { input: ['text', 'image'], output: ['text'] }
				},
				{ id: 'text-only-modalities', modalities: { input: ['text'] } },
				{ id: 'openrouter-style', architecture: { input_modalities: ['image', 'text'] } },
				{
					id: 'contradicted',
					vision: false,
					modalities: { input: ['text', 'image'] }
				},
				{ id: 'unknown-capability' }
			]
		});
		const byId = new Map(parseModelList(Buffer.from(body)).map((model) => [model.id, model]));
		assert.equal(byId.get('with-flag')?.vision, true);
		assert.equal(byId.get('no-flag')?.vision, false);
		assert.equal(byId.get('with-modalities')?.vision, true);
		assert.equal(byId.get('text-only-modalities')?.vision, false);
		assert.equal(byId.get('openrouter-style')?.vision, true);
		assert.equal(byId.get('contradicted')?.vision, true);
		assert.equal(byId.get('unknown-capability')?.vision, undefined);
	});
	it('rejects malformed and incompatible model responses', () => {
		for (const body of ['not json', '{}', '{"data":[{"id":null}]}'])
			assert.throws(() => parseModelList(Buffer.from(body)), { code: 'invalid_models' });
	});

	function mockProvider(status: number, body: string) {
		let captured: { url?: URL; options?: RequestOptions } = {};
		mock.method(
			https,
			'request',
			(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
				captured = { url, options };
				const request = new EventEmitter() as ClientRequest;
				request.end = (() => {
					queueMicrotask(() => {
						const stream = new PassThrough();
						const response = Object.assign(stream, {
							statusCode: status
						}) as unknown as IncomingMessage;
						callback(response);
						if (!stream.destroyed) stream.end(body);
					});
					return request;
				}) as ClientRequest['end'];
				return request;
			}
		);
		return () => captured;
	}
	it('uses exactly the models path and never returns credentials', async () => {
		const captured = mockProvider(200, '{"data":[{"id":"real-model"}]}');
		const models = await fetchProviderModels({
			baseUrl: 'https://8.8.8.8/v1/',
			apiKey: 'test-secret'
		});
		assert.equal(captured().url?.pathname, '/v1/models');
		assert.equal(
			(captured().options?.headers as Record<string, string>).Authorization,
			'Bearer test-secret'
		);
		assert.equal(captured().options?.agent, false);
		assert.ok(captured().options?.lookup);
		assert.ok(!JSON.stringify(models).includes('test-secret'));
	});
	it('does not follow redirects or include upstream error bodies', async () => {
		mockProvider(302, 'test-secret');
		await assert.rejects(
			fetchProviderModels({ baseUrl: 'https://8.8.8.8/v1', apiKey: 'test-secret' }),
			{
				code: 'provider_redirect'
			}
		);
	});
	it('reports rejected credentials without reflecting the key', async () => {
		mockProvider(401, 'test-secret');
		await assert.rejects(
			fetchProviderModels({ baseUrl: 'https://8.8.8.8/v1', apiKey: 'test-secret' }),
			{
				code: 'provider_unauthorized'
			}
		);
	});
	it('bounds upstream response size', async () => {
		mockProvider(200, 'x'.repeat(2 * 1024 * 1024 + 1));
		await assert.rejects(
			fetchProviderModels({ baseUrl: 'https://8.8.8.8/v1', apiKey: 'test-secret' }),
			{
				code: 'response_too_large'
			}
		);
	});
});

describe('request boundary', () => {
	it('preserves provider errors across development module reloads', async () => {
		const reloaded = await import(
			new URL('../src/lib/server/provider/errors.ts?reload-test', import.meta.url).href
		);
		const error = new reloaded.ProviderError(
			503,
			'server_not_configured',
			'Provider connections are not configured on this server.'
		);
		assert.equal(error instanceof ProviderError, false);
		const response = providerFailure(error);
		assert.equal(response.status, 503);
		assert.equal((await response.json()).error.code, 'server_not_configured');
	});
	it('rejects cross-site and missing origins', () => {
		for (const origin of ['https://attacker.com', ''])
			assert.throws(
				() =>
					requireSameOrigin(
						new Request('https://chat.example/api/provider', {
							method: 'POST',
							headers: { origin }
						}),
						new URL('https://chat.example/api/provider')
					),
				{ code: 'invalid_origin' }
			);
	});
	it('accepts JSON requests from the application origin', async () => {
		const request = new Request('https://chat.example/api/provider', {
			method: 'POST',
			headers: { origin: 'https://chat.example', 'Content-Type': 'application/json' },
			body: '{"baseUrl":"https://api.provider.com/v1"}'
		});
		requireSameOrigin(request, new URL(request.url));
		assert.deepEqual(await readProviderInput(request), { baseUrl: 'https://api.provider.com/v1' });
	});
	it('limits JSON body size', async () => {
		await assert.rejects(
			readProviderInput(
				new Request('https://chat.example/api/provider', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: 'x'.repeat(8193)
				})
			),
			{ code: 'request_too_large' }
		);
	});
	it('never exposes internal error details', async () => {
		const log = mock.method(console, 'error', () => {});
		const response = providerFailure(new Error('test-secret in an internal stack'));
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.ok(!(await response.text()).includes('test-secret'));
		assert.ok(
			!JSON.stringify(log.mock.calls.map((call) => call.arguments)).includes('test-secret')
		);
	});
});
