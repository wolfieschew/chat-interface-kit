import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';
import { PROVIDER_COOKIE_SECRET } from '$app/env/private';
import type { ProviderStatus } from '../../types.js';
import {
	assertCookieSecret,
	decryptCredentials,
	encryptCredentials,
	REMEMBER_SECONDS,
	SESSION_SECONDS,
	type Credentials
} from './credentials.ts';
import { ProviderError } from './errors.ts';

const COOKIE_NAME = dev ? 'chatui_provider' : '__Host-chatui_provider';
const cookieOptions = { path: '/', httpOnly: true, secure: !dev, sameSite: 'strict' as const };

export const disconnectedProvider: ProviderStatus = {
	connected: false,
	providerId: null,
	baseUrl: null,
	remember: false,
	expiresAt: null
};

export function assertSessionConfigured() {
	assertCookieSecret(PROVIDER_COOKIE_SECRET);
}

export function clearProviderSession(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, cookieOptions);
}

export function readProviderSession(cookies: Cookies): Credentials | null {
	const token = cookies.get(COOKIE_NAME);
	if (!token) return null;
	const credentials = decryptCredentials(token, PROVIDER_COOKIE_SECRET);
	if (!credentials) clearProviderSession(cookies);
	return credentials;
}

export function requireProviderSession(cookies: Cookies): Credentials {
	const credentials = readProviderSession(cookies);
	if (!credentials)
		throw new ProviderError(401, 'provider_not_connected', 'Connect a provider in Settings first.');
	return credentials;
}

export function publicProviderStatus(credentials: Credentials | null): ProviderStatus {
	return credentials
		? {
				connected: true,
				providerId: credentials.providerId ?? 'custom',
				baseUrl: credentials.baseUrl,
				remember: credentials.remember,
				expiresAt: credentials.expiresAt
			}
		: { ...disconnectedProvider };
}

export function saveProviderSession(
	cookies: Cookies,
	input: Omit<Credentials, 'expiresAt'>
): ProviderStatus {
	const credentials: Credentials = {
		...input,
		expiresAt: Date.now() + (input.remember ? REMEMBER_SECONDS : SESSION_SECONDS) * 1000
	};
	const token = encryptCredentials(credentials, PROVIDER_COOKIE_SECRET);
	cookies.set(COOKIE_NAME, token, {
		...cookieOptions,
		...(input.remember ? { maxAge: REMEMBER_SECONDS } : {})
	});
	return publicProviderStatus(credentials);
}
