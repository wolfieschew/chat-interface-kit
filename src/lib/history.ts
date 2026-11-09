import type { Conversation, Message, MessageImage } from './types.ts';
import {
	isMessageDocument,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_DOCUMENT_TOTAL_CHARS
} from './documents.ts';
import {
	MAX_IMAGES_PER_MESSAGE,
	MAX_IMAGE_BYTES,
	imageByteLength,
	isBase64Image,
	isImageMime
} from './images.ts';

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

export async function clearConversations(): Promise<boolean> {
	const db = await open();
	if (!db) return false;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).clear();
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

export async function storageEstimate(): Promise<{
	usage: number | null;
	quota: number | null;
} | null> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
	try {
		const { usage, quota } = await navigator.storage.estimate();
		return { usage: usage ?? null, quota: quota ?? null };
	} catch {
		return null;
	}
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const rounded = unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
	return `${rounded} ${units[unit]}`;
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
				status: raw.status === 'stopped' || raw.status === 'streaming' ? 'stopped' : 'complete'
			};
			if (typeof raw.error === 'string' && raw.error) message.error = raw.error;
			const images = sanitizeImages(raw.images);
			if (images.length) message.images = images;
			let chars = 0;
			if (message.role === 'user' && Array.isArray(raw.documents)) {
				const documents = raw.documents
					.filter(isMessageDocument)
					.slice(0, MAX_ATTACHMENTS_PER_MESSAGE - images.length)
					.filter((document) => (chars += document.text.length) <= MAX_DOCUMENT_TOTAL_CHARS)
					.map(({ name, mime, size, text }) => ({ name, mime, size, text }));
				if (documents.length) message.documents = documents;
			}
			return message;
		})
		.filter(
			(message) =>
				message.id &&
				(message.content || message.error || message.images?.length || message.documents?.length)
		);
	return {
		id,
		title: typeof record.title === 'string' ? record.title : '',
		group: conversationGroup(updatedAt),
		messages,
		updatedAt
	};
}

function sanitizeImages(value: unknown): MessageImage[] {
	if (!Array.isArray(value)) return [];
	const images: MessageImage[] = [];
	for (const raw of value) {
		if (images.length >= MAX_IMAGES_PER_MESSAGE) break;
		const image = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
		if (
			image &&
			isImageMime(image.mime) &&
			isBase64Image(image.data) &&
			imageByteLength(image.data) <= MAX_IMAGE_BYTES
		)
			images.push({
				name: typeof image.name === 'string' && image.name ? image.name : 'image',
				mime: image.mime as string,
				data: image.data as string
			});
	}
	return images;
}
