// The SDK's own export map guards this now — see @adbls/sdk/server.

import { createAdibilisClient, type AdibilisClient } from '@adbls/sdk/server';

// Fail with a clear message rather than emitting 401s at runtime.
function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set — copy .env.example to .env.local and fill it in`);
    }
    return value;
}

let client: AdibilisClient | null = null;

/**
 * Built lazily, on first request — deliberately not at module scope.
 *
 * Next evaluates route modules during `next build` to collect page data, so a client constructed
 * at module scope makes the build itself require production credentials. That would mean secrets
 * in CI just to compile. Reading the environment on first use keeps the build secret-free while
 * still failing loudly the first time a request actually needs the key.
 */
export function adibilis(): AdibilisClient {
    if (!client) {
        client = createAdibilisClient({
            baseUrl: required('ADIBILIS_BASE_URL'),
            apiKey: required('ADIBILIS_API_KEY'),
        });
    }
    return client;
}
