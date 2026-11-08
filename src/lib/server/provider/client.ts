import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { ProviderError } from './errors.ts';
import { isPublicAddress } from './validation.ts';
import { modelListRequest, parseModelPage, type ModelConnection } from './adapters.ts';
import type { ProviderId } from '../../providers.ts';
export { parseModelList } from './adapters.ts';
import type { ProviderModel } from '../../types.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
type Resolver = (
	hostname: string,
	options: { all: true; verbatim: true }
) => Promise<LookupAddress[]>;

export async function resolvePublicAddresses(
	url: URL,
	signal: AbortSignal,
	resolve: Resolver = dnsLookup
): Promise<LookupAddress[]> {
	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const family = isIP(hostname);
	if (family) {
		if (!isPublicAddress(hostname))
			throw new ProviderError(400, 'private_address', 'The provider must use a public IP address.');
		return [{ address: hostname, family }];
	}
	let onAbort: () => void = () => {};
	try {
		const addresses = await Promise.race([
			resolve(hostname, { all: true, verbatim: true }),
			new Promise<never>((_, reject) => {
				onAbort = () =>
					reject(
						new ProviderError(504, 'provider_timeout', 'The provider took too long to respond.')
					);
				if (signal.aborted) onAbort();
				else signal.addEventListener('abort', onAbort, { once: true });
			})
		]);
		if (
			!addresses.length ||
			addresses.length > 64 ||
			addresses.some((item) => !isPublicAddress(item.address) || isIP(item.address) !== item.family)
		) {
			throw new ProviderError(
				400,
				'private_address',
				'The provider must resolve only to public IP addresses.'
			);
		}
		return addresses.toSorted((a, b) => a.family - b.family);
	} catch (error) {
		if (ProviderError.is(error)) throw error;
		throw new ProviderError(
			502,
			'dns_failed',
			'The provider hostname could not be resolved. Check the base URL.'
		);
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

function statusError(status: number, providerId: ProviderId): ProviderError {
	if (status === 400 && providerId === 'google')
		return new ProviderError(
			400,
			'provider_bad_request',
			'Google rejected the request. Check your API key and its API restrictions.'
		);
	if (status >= 300 && status < 400)
		return new ProviderError(
			400,
			'provider_redirect',
			'Use the final API base URL. Provider redirects are not supported.'
		);
	if (status === 401 || status === 403)
		return new ProviderError(
			401,
			'provider_unauthorized',
			'The provider rejected this API key. Check the key and its permissions.'
		);
	if (status === 404)
		return new ProviderError(
			400,
			'models_not_found',
			'No model endpoint was found. Check whether your base URL needs /v1.'
		);
	if (status === 429)
		return new ProviderError(
			429,
			'provider_rate_limited',
			'The provider rate limit was reached. Please try again later.'
		);
	return new ProviderError(
		502,
		'provider_error',
		`The provider returned an error (${status}). Please try again.`
	);
}

export async function fetchProviderModels(
	connection: ModelConnection,
	requestSignal?: AbortSignal
): Promise<ProviderModel[]> {
	const providerId = connection.providerId ?? 'custom';
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const signal = requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
	const initial = modelListRequest(connection);
	const addresses = await resolvePublicAddresses(initial.target, signal);
	const models = new Map<string, ProviderModel>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	let remainingBytes = MAX_RESPONSE_BYTES;
	for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
		const { target, headers } = cursor ? modelListRequest(connection, cursor) : initial;
		const body = await requestModelPage(
			target,
			headers,
			addresses,
			signal,
			remainingBytes,
			providerId
		);
		remainingBytes -= body.length;
		const page = parseModelPage(body, providerId);
		for (const model of page.models) models.set(model.id, model);
		if (!page.nextCursor) return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
		if (cursors.has(page.nextCursor))
			throw new ProviderError(
				502,
				'invalid_models',
				'The provider repeated a model page. Please try again.'
			);
		cursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
	throw new ProviderError(502, 'invalid_models', 'The provider returned too many model pages.');
}

async function requestModelPage(
	target: URL,
	headers: Record<string, string>,
	addresses: LookupAddress[],
	signal: AbortSignal,
	maxBytes: number,
	providerId: ProviderId
): Promise<Buffer> {
	// Bind the actual connection to the checked DNS result to prevent DNS rebinding.
	const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
		if (options.all) callback(null, addresses);
		else callback(null, addresses[0].address, addresses[0].family);
	};
	const body = await new Promise<Buffer>((resolve, reject) => {
		const request = https.request(
			target,
			{
				method: 'GET',
				agent: false,
				signal,
				lookup: pinnedLookup,
				headers
			},
			(response) => {
				if (response.statusCode !== 200) {
					reject(statusError(response.statusCode ?? 502, providerId));
					response.destroy();
					return;
				}
				let bytes = 0;
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => {
					bytes += chunk.length;
					if (bytes > maxBytes) {
						reject(
							new ProviderError(502, 'response_too_large', 'The provider model list is too large.')
						);
						response.destroy();
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => resolve(Buffer.concat(chunks)));
				response.on('error', () =>
					reject(
						new ProviderError(
							502,
							'provider_unavailable',
							'The provider connection was interrupted. Please try again.'
						)
					)
				);
			}
		);
		request.on('error', () =>
			reject(
				signal.aborted
					? new ProviderError(
							504,
							'provider_timeout',
							'The provider took too long to respond. Please try again.'
						)
					: new ProviderError(
							502,
							'provider_unavailable',
							'A secure connection to the provider could not be established.'
						)
			)
		);
		request.end();
	});
	return body;
}
