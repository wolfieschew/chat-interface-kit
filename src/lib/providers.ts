export const providerIds = ['openai', 'google', 'anthropic', 'custom'] as const;
export type ProviderId = (typeof providerIds)[number];

export const providers: ReadonlyArray<{ id: ProviderId; name: string; baseUrl: string | null }> = [
	{ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
	{ id: 'google', name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
	{ id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
	{ id: 'custom', name: 'Custom Provider', baseUrl: null }
];

export function isProviderId(value: unknown): value is ProviderId {
	return typeof value === 'string' && providerIds.some((id) => id === value);
}

export function getProvider(id: ProviderId) {
	return providers.find((provider) => provider.id === id)!;
}
