import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PROVIDER_COOKIE_SECRET: {
		description: 'A base64-encoded 32-byte key used to encrypt provider credential cookies.',
		schema: (value) => value
	}
});
