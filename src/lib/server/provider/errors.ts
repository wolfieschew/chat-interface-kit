const PROVIDER_ERROR = Symbol.for('chatui.provider-error');

export class ProviderError extends Error {
	readonly [PROVIDER_ERROR] = true;
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ProviderError';
		this.status = status;
		this.code = code;
	}

	static is(error: unknown): error is ProviderError {
		return (
			typeof error === 'object' &&
			error !== null &&
			PROVIDER_ERROR in error &&
			error[PROVIDER_ERROR] === true
		);
	}
}

export function providerFailure(error: unknown): Response {
	if (!ProviderError.is(error)) {
		// Log call sites only; errors can otherwise include authorization headers or keys.
		console.error('[provider] Unexpected request failure', {
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
	const failure = ProviderError.is(error)
		? error
		: new ProviderError(
				502,
				'provider_unavailable',
				'The provider could not be reached. Please try again.'
			);
	return Response.json(
		{ error: { code: failure.code, message: failure.message } },
		{
			status: failure.status,
			headers: { 'Cache-Control': 'no-store' }
		}
	);
}
