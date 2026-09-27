import { AdibilisApiError } from './errors.js';

export interface AdibilisClientConfig {
    /** Base URL of the CORE instance, e.g. https://erp.example.ch — a trailing slash is fine. */
    baseUrl: string;
    /** The WEBSITE API key. Server-side only; never expose this to a browser bundle. */
    apiKey: string;
    /** Injectable for tests; defaults to the platform fetch. */
    fetch?: typeof fetch;
}

export interface AdibilisClient {
    get<T>(path: string, init?: RequestInit): Promise<T>;
    post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
}

/**
 * Server-side client for the Adibilis CORE API.
 *
 * It holds the WEBSITE key, so it must only ever be imported through `@adbls/sdk/server` —
 * from a route handler or a server component, never from a client component.
 */
export function createAdibilisClient(config: AdibilisClientConfig): AdibilisClient {
    if (!config.apiKey) {
        throw new Error('createAdibilisClient: apiKey is required');
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const doFetch = config.fetch ?? globalThis.fetch;

    async function request<T>(path: string, init: RequestInit): Promise<T> {
        const response = await doFetch(`${baseUrl}${path}`, {
            ...init,
            headers: {
                Accept: 'application/json',
                'X-API-Secret-Key': config.apiKey,
                ...(init.headers as Record<string, string> | undefined),
            },
        });

        const body = await parseBody(response);
        if (!response.ok) {
            // Only status, body and path — see AdibilisApiError on why the key never travels along.
            throw new AdibilisApiError(response.status, body, path);
        }
        return body as T;
    }

    return {
        get: (path, init) => request(path, { ...init, method: 'GET' }),
        post: (path, body, init) =>
            request(path, {
                ...init,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
                body: JSON.stringify(body),
            }),
    };
}

async function parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}
