import type { ProviderConnection, ProviderStatus } from '#lib/types.js';
import type { ProviderId } from '#lib/providers.js';

export const emptyProvider: ProviderStatus = {
	connected: false,
	providerId: null,
	baseUrl: null,
	remember: false,
	expiresAt: null
};
export type ConnectProviderInput = {
	providerId: ProviderId;
	baseUrl?: string;
	apiKey: string;
	remember: boolean;
};

export class ProviderRequestError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function providerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new ProviderRequestError(
			0,
			'network_error',
			'The connection failed. Check your network and try again.'
		);
	}
	let data;
	try {
		data = await response.json();
	} catch {
		throw new ProviderRequestError(
			response.status,
			'invalid_response',
			'The server returned an unexpected response. Please try again.'
		);
	}
	if (!response.ok)
		throw new ProviderRequestError(
			response.status,
			data.error?.code ?? 'request_failed',
			data.error?.message ?? 'The request could not be completed.'
		);
	return data as T;
}

export function getProviderStatus(signal: AbortSignal) {
	return providerRequest<{ provider: ProviderStatus }>('/api/provider', { signal });
}

export function connectProvider(input: ConnectProviderInput, signal: AbortSignal) {
	return providerRequest<ProviderConnection>('/api/provider', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
		signal
	});
}

export function disconnectProvider(signal: AbortSignal) {
	return providerRequest<ProviderConnection>('/api/provider', { method: 'DELETE', signal });
}

export function getProviderModels(signal: AbortSignal) {
	return providerRequest<ProviderConnection>('/api/models', { signal });
}
