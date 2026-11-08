import type { IncomingMessage } from 'node:http';
import type { LookupAddress } from 'node:dns';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { resolvePublicAddresses, statusError } from './client.ts';
import type { ModelConnection } from './adapters.ts';
import { ProviderError } from './errors.ts';
import { resolveProviderBaseUrl } from './validation.ts';
import type { ProviderId } from '../../providers.ts';
import { SseDecoder } from '../../sse.ts';
import {
	MAX_IMAGES_PER_MESSAGE,
	MAX_IMAGE_BYTES,
	MAX_IMAGE_TOTAL_BYTES,
	imageByteLength,
	isBase64Image,
	isImageMime
} from '../../images.ts';

export type ChatImageInput = { mime: string; data: string };
export type ChatMessageInput = {
	role: 'user' | 'assistant';
	content: string;
	images?: ChatImageInput[];
};
export type ChatCompletionInput = {
	model: string;
	systemPrompt?: string;
	messages: ChatMessageInput[];
};

const MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_SYSTEM_CHARS = 8 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4096;

export function chatCompletionRequest(
	connection: ModelConnection,
	input: ChatCompletionInput
): { target: URL; headers: Record<string, string>; body: string } {
	const providerId = connection.providerId ?? 'custom';
	let target: URL;
	let payload: Record<string, unknown>;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'text/event-stream',
		'Accept-Encoding': 'identity'
	};
	const systemPrompt = input.systemPrompt?.trim() || undefined;
	if (providerId === 'google') {
		target = new URL(
			`${resolveProviderBaseUrl(providerId, connection.baseUrl)}/models/${input.model}:streamGenerateContent?alt=sse`
		);
		headers['x-goog-api-key'] = connection.apiKey;
		payload = {
			contents: input.messages.map((message) => ({
				role: message.role === 'assistant' ? 'model' : 'user',
				parts: [
					...(message.images ?? []).map((image) => ({
						inlineData: { mimeType: image.mime, data: image.data }
					})),
					...(message.content.trim() ? [{ text: message.content }] : [])
				]
			})),
			...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {})
		};
	} else if (providerId === 'anthropic') {
		target = new URL(`${resolveProviderBaseUrl(providerId, connection.baseUrl)}/messages`);
		headers.Authorization = `Bearer ${connection.apiKey}`;
		headers['anthropic-version'] = '2026-10-21';
		payload = {
			model: input.model,
			max_tokens: MAX_TOKENS,
			stream: true,
			messages: input.messages.map((message) =>
				message.images?.length
					? {
							role: message.role,
							content: [
								...message.images.map((image) => ({
									type: 'image' as const,
									source: { type: 'base64' as const, media_type: image.mime, data: image.data }
								})),
								...(message.content.trim()
									? [{ type: 'text' as const, text: message.content }]
									: [])
							]
						}
					: message
			),
			...(systemPrompt ? { system: systemPrompt } : {})
		};
	} else {
		target = new URL(`${resolveProviderBaseUrl(providerId, connection.baseUrl)}/chat/completions`);
		headers.Authorization = `Bearer ${connection.apiKey}`;
		payload = {
			model: input.model,
			stream: true,
			messages: [
				...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
				...input.messages.map((message) =>
					message.images?.length
						? {
								role: message.role,
								content: [
									...message.images.map((image) => ({
										type: 'image_url' as const,
										image_url: { url: `data:${image.mime};base64,${image.data}` }
									})),
									...(message.content.trim()
										? [{ type: 'text' as const, text: message.content }]
										: [])
								]
							}
						: message
				)
			]
		};
	}
	return { target, headers, body: JSON.stringify(payload) };
}

export function validateChatInput(value: unknown): ChatCompletionInput {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ProviderError(400, 'invalid_request', 'Enter a message to send.');
	const input = value as Record<string, unknown>;
	if (typeof input.model !== 'string' || !MODEL_PATTERN.test(input.model))
		throw new ProviderError(400, 'invalid_model', 'Choose a supported model.');
	if (
		!Array.isArray(input.messages) ||
		!input.messages.length ||
		input.messages.length > MAX_MESSAGES
	)
		throw new ProviderError(400, 'invalid_request', 'Enter a message to send.');
	let systemPrompt: string | undefined;
	if (input.systemPrompt !== undefined && input.systemPrompt !== null) {
		if (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > MAX_SYSTEM_CHARS)
			throw new ProviderError(400, 'invalid_system_prompt', 'The system prompt is too long.');
		if (input.systemPrompt.trim()) systemPrompt = input.systemPrompt;
	}
	const messages = input.messages.map((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new ProviderError(
				400,
				'invalid_request',
				'The conversation contains an invalid message.'
			);
		const message = raw as Record<string, unknown>;
		const images = validateImages(message.images, message.role);
		if (
			(message.role !== 'user' && message.role !== 'assistant') ||
			typeof message.content !== 'string' ||
			(!message.content.trim() && !images?.length) ||
			message.content.length > MAX_MESSAGE_CHARS
		)
			throw new ProviderError(
				400,
				'invalid_request',
				'The conversation contains an invalid message.'
			);
		return {
			role: message.role as 'user' | 'assistant',
			content: message.content,
			...(images ? { images } : {})
		};
	});
	if (messages[messages.length - 1].role !== 'user')
		throw new ProviderError(400, 'invalid_request', 'The conversation must end with your message.');
	return { model: input.model, ...(systemPrompt ? { systemPrompt } : {}), messages };
}

function validateImages(value: unknown, role: unknown): ChatImageInput[] | undefined {
	if (value === undefined || value === null) return undefined;
	const invalid = () =>
		new ProviderError(400, 'invalid_image', 'Attached images are not valid or too large.');
	if (!Array.isArray(value) || value.length > MAX_IMAGES_PER_MESSAGE || role !== 'user')
		throw invalid();
	let totalBytes = 0;
	const images = value.map((raw) => {
		const image = asRecord(raw);
		if (!image || !isImageMime(image.mime) || !isBase64Image(image.data)) throw invalid();
		const bytes = imageByteLength(image.data);
		if (bytes > MAX_IMAGE_BYTES) throw invalid();
		totalBytes += bytes;
		return { mime: image.mime as string, data: image.data as string };
	});
	if (totalBytes > MAX_IMAGE_TOTAL_BYTES) throw invalid();
	return images.length ? images : undefined;
}

export function parseChatEvent(payload: string, providerId: ProviderId): string {
	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		throw invalidStream();
	}
	const event = asRecord(value);
	if (!event) throw invalidStream();
	if ('error' in event) throw providerEventError(event.error);
	if (providerId === 'anthropic') {
		if (event.type !== 'content_block_delta') return '';
		const delta = asRecord(event.delta);
		return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '';
	}
	if (providerId === 'google') {
		const feedback = asRecord(event.promptFeedback);
		if (asText(feedback?.blockReason))
			throw new ProviderError(
				400,
				'provider_blocked',
				'The provider blocked this request. Adjust the prompt and try again.'
			);
		const candidate = asArray(event.candidates)[0];
		const parts = asArray(asRecord(asRecord(candidate)?.content)?.parts);
		return parts.map((part) => asText(asRecord(part)?.text)).join('');
	}
	const choice = asArray(event.choices)[0];
	const delta = asRecord(asRecord(choice)?.delta);
	return asText(delta?.content);
}

function invalidStream(): ProviderError {
	return new ProviderError(
		502,
		'invalid_stream',
		'The provider returned an unreadable response stream.'
	);
}

function providerEventError(value: unknown): ProviderError {
	const detail = asRecord(value);
	const message = asText(detail?.message).trim().slice(0, 300);
	return new ProviderError(
		502,
		'provider_error',
		message
			? `The provider returned an error: ${message}`
			: 'The provider returned an error while streaming. Please try again.'
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
function asText(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export async function openChatStream(
	connection: ModelConnection,
	input: ChatCompletionInput,
	signal: AbortSignal
): Promise<AsyncGenerator<string, void, void>> {
	const providerId = connection.providerId ?? 'custom';
	const { target, headers, body } = chatCompletionRequest(connection, input);
	const addresses = await resolvePublicAddresses(target, signal);
	const { response, refreshIdle, cleanup, timedOut } = await openChatConnection(
		target,
		headers,
		body,
		addresses,
		signal,
		providerId
	);
	return iterateChatResponse(response, refreshIdle, cleanup, timedOut, providerId);
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

async function openChatConnection(
	target: URL,
	headers: Record<string, string>,
	body: string,
	addresses: LookupAddress[],
	signal: AbortSignal,
	providerId: ProviderId
): Promise<{
	response: IncomingMessage;
	refreshIdle: () => void;
	cleanup: () => void;
	timedOut: () => boolean;
}> {
	const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
		if (options.all) callback(null, addresses);
		else callback(null, addresses[0].address, addresses[0].family);
	};
	const controller = new AbortController();
	let timedOut = false;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const refreshIdle = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, IDLE_TIMEOUT_MS);
	};
	const onAbort = () => controller.abort();
	if (signal.aborted) onAbort();
	else signal.addEventListener('abort', onAbort, { once: true });
	const cleanup = () => {
		clearTimeout(idleTimer);
		signal.removeEventListener('abort', onAbort);
	};
	refreshIdle();
	const response = await new Promise<IncomingMessage>((resolve, reject) => {
		const request = https.request(
			target,
			{ method: 'POST', agent: false, signal: controller.signal, lookup: pinnedLookup, headers },
			(upstream) => {
				if ((upstream.statusCode ?? 502) !== 200) {
					const failure = statusError(upstream.statusCode ?? 502, providerId);
					upstream.destroy();
					cleanup();
					reject(failure);
					return;
				}
				resolve(upstream);
			}
		);
		request.on('error', (error) => {
			cleanup();
			if (isAbortError(error)) {
				reject(
					timedOut
						? new ProviderError(
								504,
								'provider_timeout',
								'The provider took too long to respond. Please try again.'
							)
						: error
				);
				return;
			}
			reject(
				new ProviderError(
					502,
					'provider_unavailable',
					'A secure connection to the provider could not be established.'
				)
			);
		});
		request.end(body);
	});
	return { response, refreshIdle, cleanup, timedOut: () => timedOut };
}

async function* iterateChatResponse(
	response: IncomingMessage,
	refreshIdle: () => void,
	cleanup: () => void,
	timedOut: () => boolean,
	providerId: ProviderId
): AsyncGenerator<string, void, void> {
	const decoder = new SseDecoder();
	const textDecoder = new TextDecoder();
	let bytes = 0;
	const read = (payload: string): string | undefined =>
		payload === '[DONE]' ? undefined : parseChatEvent(payload, providerId);
	try {
		for await (const chunk of response) {
			refreshIdle();
			bytes += chunk.length;
			if (bytes > MAX_STREAM_BYTES)
				throw new ProviderError(
					502,
					'response_too_large',
					'The provider response is too large. Please start a shorter conversation.'
				);
			for (const payload of decoder.push(textDecoder.decode(chunk, { stream: true }))) {
				const text = read(payload);
				if (text === undefined) return;
				if (text) yield text;
			}
		}
		for (const payload of decoder.push(textDecoder.decode()).concat(decoder.flush())) {
			const text = read(payload);
			if (text === undefined) return;
			if (text) yield text;
		}
	} catch (error) {
		if (isAbortError(error)) {
			if (timedOut())
				throw new ProviderError(
					504,
					'provider_timeout',
					'The provider stopped responding before the answer finished.'
				);
			return;
		}
		throw error;
	} finally {
		cleanup();
	}
}
