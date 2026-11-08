import { SseDecoder } from '#lib/sse.js';
import { ProviderRequestError } from '#lib/provider-client.js';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatStreamInput = {
	model: string;
	systemPrompt?: string;
	messages: ChatTurn[];
};


export async function streamChat(
	input: ChatStreamInput,
	handlers: { signal: AbortSignal; ondelta: (text: string) => void }
): Promise<void> {
	let response: Response;
	try {
		response = await fetch('/api/chat', {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input),
			signal: handlers.signal
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new ProviderRequestError(
			0,
			'network_error',
			'The connection failed. Check your network and try again.'
		);
	}
	if (!response.ok) {
		let code = 'request_failed';
		let message = 'The request could not be completed.';
		try {
			const data = await response.json();
			code = data.error?.code ?? code;
			message = data.error?.message ?? message;
		} catch {
			
		}
		throw new ProviderRequestError(response.status, code, message);
	}
	if (!response.body)
		throw new ProviderRequestError(
			response.status,
			'invalid_response',
			'The server returned an unexpected response. Please try again.'
		);
	const reader = response.body.getReader();
	const events = new SseDecoder();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			await readEvents(events.push(decoder.decode(value, { stream: true })), handlers);
		}
		await readEvents(events.push(decoder.decode()).concat(events.flush()), handlers);
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
}

async function readEvents(
	payloads: string[],
	handlers: { signal: AbortSignal; ondelta: (text: string) => void }
): Promise<void> {
	for (const payload of payloads) {
		if (payload === '[DONE]') return;
		const event = parseStreamEvent(payload);
		if ('error' in event) throw new ProviderRequestError(0, event.error.code, event.error.message);
		handlers.ondelta(event.text);
	}
}

type StreamEvent = { text: string } | { error: { code: string; message: string } };

function parseStreamEvent(payload: string): StreamEvent {
	try {
		const value = JSON.parse(payload);
		const event = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
		if (event && typeof event.text === 'string') return { text: event.text };
		const failure =
			event?.error && typeof event.error === 'object'
				? (event.error as Record<string, unknown>)
				: null;
		if (failure)
			return {
				error: {
					code: String(failure.code ?? 'request_failed'),
					message: String(failure.message ?? 'The request could not be completed.')
				}
			};
	} catch {
		
	}
	throw new ProviderRequestError(
		0,
		'invalid_response',
		'The server returned an unexpected response. Please try again.'
	);
}
