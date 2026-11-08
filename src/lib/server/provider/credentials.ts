import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ProviderError } from './errors.ts';
import { isProviderId, type ProviderId } from '../../providers.ts';

export const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_SECONDS = 24 * 60 * 60;
const COOKIE_VERSION = 'v1';
const CONTEXT = Buffer.from('chatui:provider:v1');

export type Credentials = {
	providerId?: ProviderId;
	baseUrl: string;
	apiKey: string;
	remember: boolean;
	expiresAt: number;
};

function decodeSecret(secret: string | undefined): Buffer {
	if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
		throw new ProviderError(
			503,
			'server_not_configured',
			'Provider connections are not configured on this server.'
		);
	}
	const key = Buffer.from(secret, 'base64');
	if (key.length !== 32)
		throw new ProviderError(
			503,
			'server_not_configured',
			'Provider connections are not configured on this server.'
		);
	return key;
}

export function assertCookieSecret(secret: string | undefined): void {
	decodeSecret(secret);
}

export function encryptCredentials(credentials: Credentials, secret: string | undefined): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', decodeSecret(secret), iv);
	cipher.setAAD(CONTEXT);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(credentials), 'utf8'),
		cipher.final()
	]);
	const token = [
		COOKIE_VERSION,
		iv.toString('base64url'),
		ciphertext.toString('base64url'),
		cipher.getAuthTag().toString('base64url')
	].join('.');
	if (token.length > 3500)
		throw new ProviderError(400, 'credentials_too_large', 'The base URL or API key is too long.');
	return token;
}

export function decryptCredentials(
	token: string,
	secret: string | undefined,
	now = Date.now()
): Credentials | null {
	const key = decodeSecret(secret);
	if (token.length > 3500) return null;
	try {
		const parts = token.split('.');
		if (
			parts.length !== 4 ||
			parts[0] !== COOKIE_VERSION ||
			parts.slice(1).some((part) => !/^[\w-]+$/.test(part))
		)
			return null;
		const iv = Buffer.from(parts[1], 'base64url');
		const tag = Buffer.from(parts[3], 'base64url');
		if (iv.length !== 12 || tag.length !== 16) return null;
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAAD(CONTEXT);
		decipher.setAuthTag(tag);
		const value = JSON.parse(
			Buffer.concat([
				decipher.update(Buffer.from(parts[2], 'base64url')),
				decipher.final()
			]).toString('utf8')
		);
		if (
			!value ||
			typeof value.baseUrl !== 'string' ||
			typeof value.apiKey !== 'string' ||
			!value.apiKey ||
			typeof value.remember !== 'boolean' ||
			!Number.isSafeInteger(value.expiresAt) ||
			value.expiresAt <= now ||
			value.expiresAt > now + REMEMBER_SECONDS * 1000
		)
			return null;
		const providerId = value.providerId === undefined ? 'custom' : value.providerId;
		if (!isProviderId(providerId)) return null;
		return {
			providerId,
			baseUrl: value.baseUrl,
			apiKey: value.apiKey,
			remember: value.remember,
			expiresAt: value.expiresAt
		};
	} catch {
		return null;
	}
}
