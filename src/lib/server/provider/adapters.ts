import type { ProviderModel } from '../../types.js';
import type { ProviderId } from '../../providers.ts';
import { resolveProviderBaseUrl } from './validation.ts';
import { ProviderError } from './errors.ts';

export type ModelConnection = { providerId?: ProviderId; baseUrl: string; apiKey: string };
export type ModelPage = { models: ProviderModel[]; nextCursor: string | null };

export function modelListRequest(connection: ModelConnection, cursor?: string) {
	const providerId = connection.providerId ?? 'custom';
	const target = new URL(`${resolveProviderBaseUrl(providerId, connection.baseUrl)}/models`);
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'Accept-Encoding': 'identity'
	};
	if (providerId === 'google') {
		headers['x-goog-api-key'] = connection.apiKey;
		if (cursor) target.searchParams.set('pageToken', cursor);
	} else {
		headers.Authorization = `Bearer ${connection.apiKey}`;
		if (providerId === 'anthropic') {
			// https://platform.claude.com/docs/en/api/versioning
			headers['anthropic-version'] = '2026-10-21';
			target.searchParams.set('limit', '1000');
			if (cursor) target.searchParams.set('after_id', cursor);
		}
	}
	return { target, headers };
}

function invalidModels(message = 'The provider returned an invalid model list.'): never {
	throw new ProviderError(502, 'invalid_models', message);
}

function modelText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === 'string' &&
		Boolean(value.trim()) &&
		value.length <= maxLength &&
		!/[\x00-\x1f\x7f]/.test(value)
	);
}

function cursorText(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	if (!modelText(value, 2048)) invalidModels('The provider returned an invalid pagination cursor.');
	return value;
}

export function parseModelPage(body: Buffer, providerId: ProviderId = 'custom'): ModelPage {
	let value: unknown;
	try {
		value = JSON.parse(body.toString('utf8'));
	} catch {
		invalidModels('The provider did not return a valid JSON model list.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidModels();
	const page = value as Record<string, unknown>;
	const rawModels = providerId === 'google' ? (page.models ?? []) : page.data;
	if (!Array.isArray(rawModels) || 'error' in page || (providerId === 'google' && 'data' in page))
		invalidModels();
	const models = new Map<string, ProviderModel>();
	let validIdentifiers = 0;
	for (const raw of rawModels) {
		if (!raw || typeof raw !== 'object') continue;
		const item = raw as Record<string, unknown>;
		const rawId = providerId === 'google' ? item.name : item.id;
		if (!modelText(rawId, 512)) continue;
		const id = providerId === 'google' ? rawId.trim().replace(/^models\//, '') : rawId.trim();
		if (!id) continue;
		validIdentifiers++;
		if (
			providerId === 'google' &&
			(!Array.isArray(item.supportedGenerationMethods) ||
				!item.supportedGenerationMethods.includes('generateContent'))
		)
			continue;
		const rawName =
			providerId === 'google'
				? item.displayName
				: providerId === 'anthropic'
					? item.display_name
					: item.name;
		const name = modelText(rawName, 256) ? rawName.trim() : id;
		const ownedBy =
			providerId === 'google'
				? 'Google'
				: providerId === 'anthropic'
					? 'Anthropic'
					: modelText(item.owned_by, 256)
						? item.owned_by
						: undefined;
		models.set(id, { id, name, ...(ownedBy ? { ownedBy } : {}) });
	}
	if (rawModels.length && !validIdentifiers)
		invalidModels('The provider returned no valid model identifiers.');
	let nextCursor: string | null = null;
	if (providerId === 'google') nextCursor = cursorText(page.nextPageToken);
	if (providerId === 'anthropic' && page.has_more === true) {
		nextCursor = cursorText(page.last_id);
		if (!nextCursor) invalidModels('The provider returned an incomplete pagination cursor.');
	}
	return { models: [...models.values()], nextCursor };
}

export function parseModelList(body: Buffer): ProviderModel[] {
	return parseModelPage(body).models.sort((a, b) => a.name.localeCompare(b.name));
}
