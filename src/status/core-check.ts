import { AdibilisApiError } from '../client/errors.js';
import type { AdibilisClient } from '../client/api-client.js';

/** What a satellite learned about its link to core. Never carries a response body. */
export interface CoreCheck {
    /** True only for a 2xx answer: core is reachable AND this WEBSITE key is still valid. */
    ok: boolean;
    /**
     * The status core answered with, or 0 when no answer arrived at all (DNS, TLS, connection
     * refused, or the timeout below). 401 means the key was rotated or revoked — a different
     * problem from core being down, and worth telling apart in an alert.
     */
    status: number;
    /** Round trip in milliseconds, measured even for a failure. */
    latencyMs: number;
}

export interface CoreCheckOptions {
    /**
     * Budget for the whole round trip. The default is deliberately short: the caller is usually a
     * health route that something else is polling, and a health check that hangs is a health check
     * that reports nothing.
     */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Asks core whether it is there and whether this satellite's key still works.
 *
 * Unlike every other call in this SDK it **never throws**: it is meant to run inside a health
 * endpoint, where an exception would turn a legible "degraded" answer into a 500 that says nothing
 * about which of the two sides broke.
 *
 * Deliberately uncached. Whoever polls it decides how often core should be bothered — a cache
 * hidden in a library would make two callers with different needs fight over one interval.
 */
export async function checkCore(client: AdibilisClient, options: CoreCheckOptions = {}): Promise<CoreCheck> {
    const started = Date.now();
    try {
        await client.get<unknown>('/api/website/ping', {
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        return { ok: true, status: 200, latencyMs: Date.now() - started };
    } catch (error) {
        // An AdibilisApiError means core answered, and its status is the diagnosis. Anything else
        // (abort, DNS, TLS, refused socket) means nothing answered, which is status 0 by convention.
        const status = error instanceof AdibilisApiError ? error.status : 0;
        return { ok: false, status, latencyMs: Date.now() - started };
    }
}
