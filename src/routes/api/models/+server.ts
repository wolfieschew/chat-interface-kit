import type { RequestHandler } from './$types';
import { fetchProviderModels } from '#lib/server/provider/client.ts';
import { ProviderError, providerFailure } from '#lib/server/provider/errors.ts';
import { privateHeaders } from '#lib/server/provider/http.ts';
import {
	clearProviderSession,
	publicProviderStatus,
	requireProviderSession
} from '#lib/server/provider/session.ts';

export const GET: RequestHandler = async ({ cookies, request }) => {
	try {
		const credentials = requireProviderSession(cookies);
		const models = await fetchProviderModels(credentials, request.signal);
		return Response.json(
			{ provider: publicProviderStatus(credentials), models },
			{ headers: privateHeaders }
		);
	} catch (error) {
		if (ProviderError.is(error) && error.code === 'provider_unauthorized')
			clearProviderSession(cookies);
		return providerFailure(error);
	}
};
