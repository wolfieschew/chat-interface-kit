import type { RequestHandler } from './$types';
import { openChatStream, validateChatInput } from '#lib/server/provider/chat.ts';
import { ProviderError, providerFailure } from '#lib/server/provider/errors.ts';
import { privateHeaders, readProviderInput, requireSameOrigin } from '#lib/server/provider/http.ts';
import { assertSessionConfigured, requireProviderSession } from '#lib/server/provider/session.ts';

const MAX_CHAT_INPUT_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();

function aborted(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export const POST: RequestHandler = async ({ cookies, request, url }) => {
	try {
		requireSameOrigin(request, url);
		assertSessionConfigured();
		const credentials = requireProviderSession(cookies);
		const input = validateChatInput(await readProviderInput(request, MAX_CHAT_INPUT_BYTES));
		const events = await openChatStream(credentials, input, request.signal);
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (payload: string) =>
					controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
				try {
					for await (const text of events) send(JSON.stringify({ text }));
				} catch (error) {
					if (aborted(error) || request.signal.aborted) return;
					const failure = ProviderError.is(error)
						? error
						: new ProviderError(
								502,
								'provider_unavailable',
								'The provider connection was interrupted. Please try again.'
							);
					if (!ProviderError.is(error)) {
						console.error('[chat] Unexpected stream failure', {
							name: error instanceof Error ? error.name : typeof error,
							frames:
								error instanceof Error
									? error.stack
											?.split('\n')
											.filter((line) => /^\s+at /.test(line))
											.slice(0, 5)
									: undefined
						});
					}
					try {
						send(JSON.stringify({ error: { code: failure.code, message: failure.message } }));
					} catch {}
				} finally {
					try {
						send('[DONE]');
						controller.close();
					} catch {}
				}
			},
			cancel() {}
		});
		return new Response(stream, {
			headers: {
				...privateHeaders,
				'Content-Type': 'text/event-stream; charset=utf-8',
				'X-Accel-Buffering': 'no'
			}
		});
	} catch (error) {
		return providerFailure(error);
	}
};
