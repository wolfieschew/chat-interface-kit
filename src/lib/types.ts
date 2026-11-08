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

export type PreviewModel = {
	id: string;
	name: string;
	description: string;
};
