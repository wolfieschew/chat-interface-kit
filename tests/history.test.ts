import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	conversationGroup,
	deleteConversation,
	loadConversations,
	sanitizeConversation,
	saveConversation
} from '../src/lib/history.ts';

const DAY = 86_400_000;

describe('conversation history groups', () => {
	const now = new Date(2026, 10, 8, 15, 30).getTime();
	it('groups conversations by recency', () => {
		assert.equal(conversationGroup(now, now), 'Today');
		assert.equal(conversationGroup(new Date(2026, 10, 8, 0, 0).getTime(), now), 'Today');
		assert.equal(
			conversationGroup(new Date(2026, 10, 7, 23, 59).getTime(), now),
			'Previous 7 days'
		);
		assert.equal(conversationGroup(now - 6 * DAY, now), 'Previous 7 days');
		assert.equal(conversationGroup(now - 8 * DAY, now), 'Older');
	});
	it('handles future timestamps from clock skew as today', () => {
		assert.equal(conversationGroup(now + 60_000, now), 'Today');
	});
});

describe('stored conversation sanitizing', () => {
	const valid = {
		id: 'chat-1',
		title: 'Hello',
		group: 'Today',
		updatedAt: Date.now(),
		messages: [
			{ id: 'm1', role: 'user', content: 'Hi', status: 'complete' },
			{ id: 'm2', role: 'assistant', content: 'Hello!', status: 'streaming' }
		]
	};
	it('keeps valid records and recomputes the group', () => {
		const conversation = sanitizeConversation(valid);
		assert.ok(conversation);
		assert.equal(conversation.title, 'Hello');
		assert.equal(conversation.group, 'Today');
		// An interrupted stream must not restore as still streaming.
		assert.equal(conversation.messages[1].status, 'stopped');
	});
	it('rejects records without identity or messages', () => {
		for (const value of [null, 'text', [], {}, { id: 'x' }, { id: '', messages: [] }])
			assert.equal(sanitizeConversation(value), null);
	});
	it('falls back to safe values for damaged fields', () => {
		const conversation = sanitizeConversation({
			id: 'chat-2',
			title: 42,
			group: 'Yesterday',
			updatedAt: 'soon',
			messages: [
				null,
				{ role: 'system', content: 'drop' },
				{ id: 'm1', role: 'assistant', content: 42 },
				{ id: 'm2', role: 'assistant', content: 'kept', error: 'boom' }
			]
		});
		assert.ok(conversation);
		assert.equal(conversation.title, '');
		assert.equal(typeof conversation.updatedAt, 'number');
		assert.deepEqual(
			conversation.messages.map((message) => message.id),
			['m2']
		);
		assert.equal(conversation.messages[0].error, 'boom');
	});
	it('preserves stopped conversations and errored empty answers', () => {
		const conversation = sanitizeConversation({
			id: 'chat-3',
			title: 'Stopped',
			updatedAt: Date.now(),
			messages: [
				{ id: 'm1', role: 'user', content: 'Hi', status: 'stopped' },
				{ id: 'm2', role: 'assistant', content: '', error: 'Key rejected', status: 'stopped' }
			]
		});
		assert.ok(conversation);
		assert.deepEqual(
			conversation.messages.map((message) => message.status),
			['stopped', 'stopped']
		);
		assert.equal(conversation.messages[1].error, 'Key rejected');
	});
});

describe('storage fallback without IndexedDB', () => {
	it('reports unavailable storage instead of throwing', async () => {
		assert.equal(await loadConversations(), null);
		assert.equal(
			await saveConversation({
				id: 'chat-1',
				title: 'Hello',
				group: 'Today',
				updatedAt: Date.now(),
				messages: []
			}),
			false
		);
		assert.equal(await deleteConversation('chat-1'), false);
	});
});
