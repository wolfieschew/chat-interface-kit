import type { Conversation, Message } from './types.ts';

const DB_NAME = 'chatui';
const DB_VERSION = 1;
const STORE = 'conversations';

const DAY_MS = 86_400_000;

export function conversationGroup(updatedAt: number, now = Date.now()): Conversation['group'] {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	if (updatedAt >= today.getTime()) return 'Today';
	if (updatedAt >= today.getTime() - 6 * DAY_MS) return 'Previous 7 days';
	return 'Older';
}

function open(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	return new Promise((resolve) => {
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE))
				request.result.createObjectStore(STORE, { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});
}


export async function loadConversations(): Promise<Conversation[] | null> {
	const db = await open();
	if (!db) return null;
	try {
		const records = await new Promise<unknown[]>((resolve, reject) => {
			const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		return records
			.map(sanitizeConversation)
			.filter((conversation): conversation is Conversation => conversation !== null)
			.sort((a, b) => b.updatedAt - a.updatedAt);
	} catch {
		return null;
	} finally {
		db.close();
	}
}

export async function saveConversation(conversation: Conversation): Promise<boolean> {
	const db = await open();
	if (!db) return false;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).put(conversation);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}

export async function deleteConversation(id: string): Promise<boolean> {
	const db = await open();
	if (!db) return false;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).delete(id);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}


export function sanitizeConversation(value: unknown): Conversation | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' && record.id ? record.id : null;
	if (!id || !Array.isArray(record.messages)) return null;
	const updatedAt =
		typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
			? record.updatedAt
			: Date.now();
	const messages = record.messages
		.filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
		.map((raw) => {
			const message: Message = {
				id: typeof raw.id === 'string' ? raw.id : '',
				role: raw.role === 'assistant' ? 'assistant' : 'user',
				content: typeof raw.content === 'string' ? raw.content : '',
				// An interrupted stream must not restore as still generating.
				status: raw.status === 'stopped' || raw.status === 'streaming' ? 'stopped' : 'complete'
			};
			if (typeof raw.error === 'string' && raw.error) message.error = raw.error;
			return message;
		})
		.filter((message) => message.id && (message.content || message.error));
	return {
		id,
		title: typeof record.title === 'string' ? record.title : '',
		group: conversationGroup(updatedAt),
		messages,
		updatedAt
	};
}
