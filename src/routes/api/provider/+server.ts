import type { RequestHandler } from './$types';
import { fetchProviderModels } from '#lib/server/provider/client.ts';
import { providerFailure } from '#lib/server/provider/errors.ts';
import { privateHeaders, readProviderInput, requireSameOrigin } from '#lib/server/provider/http.ts';
import {
	assertSessionConfigured,
	clearProviderSession,
	publicProviderStatus,
	readProviderSession,
	saveProviderSession
} from '#lib/server/provider/session.ts';
import { validateProviderInput } from '#lib/server/provider/validation.ts';

export const GET: RequestHandler = ({ cookies }) => {
	try {
		return Response.json(
			{ provider: publicProviderStatus(readProviderSession(cookies)) },
			{ headers: privateHeaders }
		);
	} catch (error) {
		return providerFailure(error);
	}
};

export const POST: RequestHandler = async ({ cookies, request, url }) => {
	try {
		requireSameOrigin(request, url);
		assertSessionConfigured();
		const input = validateProviderInput(await readProviderInput(request));
		const models = await fetchProviderModels(input, request.signal);
		const provider = saveProviderSession(cookies, input);
		return Response.json({ provider, models }, { headers: privateHeaders });
	} catch (error) {
		return providerFailure(error);
	}
};

export const DELETE: RequestHandler = ({ cookies, request, url }) => {
	try {
		requireSameOrigin(request, url);
		clearProviderSession(cookies);
		return Response.json(
			{ provider: publicProviderStatus(null), models: [] },
			{ headers: privateHeaders }
		);
	} catch (error) {
		return providerFailure(error);
	}
};
