import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ProviderError } from './errors.ts';
import { getProvider, isProviderId, type ProviderId } from '../../providers.ts';

export const MAX_BASE_URL_LENGTH = 512;
export const MAX_API_KEY_LENGTH = 1024;

export function resolveProviderBaseUrl(providerId: ProviderId, baseUrl: unknown): string {
	return normalizeBaseUrl(providerId === 'custom' ? baseUrl : getProvider(providerId).baseUrl);
}

export function isPublicAddress(value: string): boolean {
	if (!isIP(value)) return false;
	const address = ipaddr.parse(value);
	return (
		address.range() === 'unicast' &&
		(address.kind() === 'ipv4' || (address.toByteArray()[0] & 0xe0) === 0x20)
	);
}

export function normalizeBaseUrl(value: unknown): string {
	const invalid = () =>
		new ProviderError(
			400,
			'invalid_base_url',
			'Enter a public HTTPS base URL, such as https://provider.com/v1.'
		);
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > MAX_BASE_URL_LENGTH ||
		/[\x00-\x20\x7f\\]/.test(value.trim())
	)
		throw invalid();
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw invalid();
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
		throw invalid();
	const hostname = url.hostname
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '')
		.toLowerCase();
	if (
		!hostname ||
		hostname === 'localhost' ||
		/\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(hostname)
	)
		throw invalid();
	if (isIP(hostname)) {
		if (!isPublicAddress(hostname)) throw invalid();
	} else if (!hostname.includes('.') || !/^[a-z0-9.-]+$/.test(hostname)) throw invalid();
	url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.href.replace(/\/$/, '');
}

export function validateApiKey(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.trim().length > MAX_API_KEY_LENGTH ||
		/[^\x21-\x7e]/.test(value.trim())
	) {
		throw new ProviderError(400, 'invalid_api_key', 'Enter a valid API key.');
	}
	return value.trim();
}

export function validateProviderInput(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ProviderError(400, 'invalid_request', 'Enter a base URL and API key.');
	const input = value as Record<string, unknown>;
	const providerId = input.providerId === undefined ? 'custom' : input.providerId;
	if (!isProviderId(providerId))
		throw new ProviderError(400, 'invalid_provider', 'Choose a supported provider.');
	if (typeof input.remember !== 'boolean')
		throw new ProviderError(400, 'invalid_request', 'Choose whether to remember this provider.');
	return {
		providerId,
		baseUrl: resolveProviderBaseUrl(providerId, input.baseUrl),
		apiKey: validateApiKey(input.apiKey),
		remember: input.remember
	};
}
