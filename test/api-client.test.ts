import { describe, expect, it, vi } from 'vitest';
import { AdibilisApiError, createAdibilisClient } from '../src/client/api-client';

const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createAdibilisClient', () => {
    it('sends the api key in X-API-Secret-Key', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ ok: true }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'secret', fetch: fetchMock });

        await client.get('/api/shop/holidays');

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/shop/holidays');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('secret');
    });

    it('strips a trailing slash from baseUrl', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({}));
        const client = createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock });

        await client.get('/api/shop/holidays');

        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/shop/holidays');
    });

    it('posts json with the right content type', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ id: 1 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await client.post('/api/payment/checkout', { total: 42 });

        const [, init] = fetchMock.mock.calls[0];
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ total: 42 }));
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('throws AdibilisApiError carrying status and parsed body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'nope' }), { status: 403, headers: { 'content-type': 'application/json' } })
        );
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(client.get('/api/shop/holidays')).rejects.toMatchObject({
            name: 'AdibilisApiError',
            status: 403,
            body: { error: 'nope' },
        });
    });

    it('never puts the api key in the error message', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'super-secret', fetch: fetchMock });

        const error = await client.get('/x').catch((e: AdibilisApiError) => e);

        expect(JSON.stringify({ message: error.message, body: error.body })).not.toContain('super-secret');
    });

    it('rejects an empty api key at construction', () => {
        expect(() => createAdibilisClient({ baseUrl: 'https://core.test', apiKey: '' })).toThrow(/apiKey/);
    });
});
