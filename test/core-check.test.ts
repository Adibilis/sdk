import { describe, expect, it, vi } from 'vitest';
import { checkCore } from '../src/status/core-check';
import { createAdibilisClient } from '../src/client/api-client';

const clientWith = (fetchMock: typeof fetch) =>
    createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

const answer = (status: number) =>
    new Response(status === 200 ? JSON.stringify({ status: 'ok' }) : '', {
        status,
        headers: { 'content-type': 'application/json' },
    });

describe('checkCore', () => {
    it('reports ok for a 200 and hits the ping endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(answer(200));

        const result = await checkCore(clientWith(fetchMock as unknown as typeof fetch));

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/ping');
    });

    // The whole point of the endpoint: a rotated key is a different incident from a dead core,
    // and the caller must be able to tell them apart without parsing a message.
    it('reports 401 rather than throwing when the key was rotated', async () => {
        const fetchMock = vi.fn().mockResolvedValue(answer(401));

        const result = await checkCore(clientWith(fetchMock as unknown as typeof fetch));

        expect(result).toMatchObject({ ok: false, status: 401 });
    });

    it('reports status 0 when nothing answers at all', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

        const result = await checkCore(clientWith(fetchMock as unknown as typeof fetch));

        expect(result).toMatchObject({ ok: false, status: 0 });
    });

    it('gives up after the timeout instead of hanging the health route', async () => {
        const fetchMock = vi.fn((_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            })
        );

        const result = await checkCore(clientWith(fetchMock as unknown as typeof fetch), { timeoutMs: 20 });

        expect(result).toMatchObject({ ok: false, status: 0 });
    });

    it('passes a real AbortSignal so the default budget applies', async () => {
        const fetchMock = vi.fn().mockResolvedValue(answer(200));

        await checkCore(clientWith(fetchMock as unknown as typeof fetch));

        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
});
