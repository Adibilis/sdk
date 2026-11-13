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
    patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    delete<T>(path: string, init?: RequestInit): Promise<T>;
    /**
     * A GET whose answer is a file: core's `Response` as it arrived, its body not read yet, when core answers 2xx. Any other status
     * rejects with an `AdibilisApiError`, like `get`, except that a body which is not JSON is cancelled unread and the error carries
     * `body: null`: such a body can be the whole file (Spring answers an unsatisfiable range with 416 and the file).
     */
    download(path: string, init?: RequestInit): Promise<Response>;
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

    async function send(path: string, init: RequestInit, discardNonJsonError = false): Promise<Response> {
        const response = await doFetch(`${baseUrl}${path}`, {
            ...init,
            headers: {
                Accept: 'application/json',
                'X-API-Secret-Key': config.apiKey,
                ...(init.headers as Record<string, string> | undefined),
            },
        });

        if (!response.ok) {
            if (discardNonJsonError && !isJson(response)) {
                void response.body?.cancel();
                throw new AdibilisApiError(response.status, null, path);
            }
            // Only status, body and path — see AdibilisApiError on why the key never travels along.
            throw new AdibilisApiError(response.status, await parseBody(response), path);
        }
        return response;
    }

    async function request<T>(path: string, init: RequestInit): Promise<T> {
        return (await parseBody(await send(path, init))) as T;
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
        patch: (path, body, init) =>
            request(path, {
                ...init,
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
                body: JSON.stringify(body),
            }),
        delete: (path, init) => request(path, { ...init, method: 'DELETE' }),
        download: (path, init) => send(path, { ...init, method: 'GET' }, true),
    };
}

async function parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    return isJson(response) ? JSON.parse(text) : text;
}

function isJson(response: Response): boolean {
    return response.headers.get('content-type')?.includes('application/json') ?? false;
}
