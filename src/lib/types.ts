import type { ProviderId } from './providers.js';

export type Message = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	status?: 'streaming' | 'complete' | 'stopped';
};

export type Conversation = {
	id: string;
	title: string;
	group: 'Today' | 'Previous 7 days';
	icon: 'message' | 'code' | 'pen' | 'book';
	messages: Message[];
};

export type ProviderModel = {
	id: string;
	name: string;
	ownedBy?: string;
};

export type ProviderStatus = {
	connected: boolean;
	providerId: ProviderId | null;
	baseUrl: string | null;
	remember: boolean;
	expiresAt: number | null;
};

export type ProviderConnection = {
	provider: ProviderStatus;
	models: ProviderModel[];
};
