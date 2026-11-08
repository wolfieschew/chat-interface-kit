import type { ProviderId } from './providers.js';

export type MessageImage = {
	name: string;
	mime: string;
	data: string;
};

export type Message = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	images?: MessageImage[];
	status?: 'streaming' | 'complete' | 'stopped';
	error?: string;
};

export type Conversation = {
	id: string;
	title: string;
	group: 'Today' | 'Previous 7 days' | 'Older';
	messages: Message[];
	updatedAt: number;
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
