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

    it('patches json with the right content type and the key', async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ id: 9 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(client.patch('/api/customer/subscription/9/plan', { planId: 4 })).resolves.toEqual({ id: 9 });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/customer/subscription/9/plan');
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ planId: 4 }));
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
    });

    it('deletes without a body, keeps the call headers and reads an empty answer as null', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(client.delete('/api/customer/session', { headers: { 'X-Customer-Session': 'tok' } })).resolves.toBeNull();

        const [, init] = fetchMock.mock.calls[0];
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
        expect((init.headers as Record<string, string>)['X-Customer-Session']).toBe('tok');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
    });

    it('reads a 202 without a body as null', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(client.post('/api/customer/login-link', { email: 'jane@example.com' })).resolves.toBeNull();
    });

    it('downloads a file: the response untouched, its body unread, with the key', async () => {
        const pdf = new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-type': 'application/pdf' } });
        const fetchMock = vi.fn().mockResolvedValue(pdf);
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        const response = await client.download('/api/customer/invoice/5/pdf', { headers: { Accept: 'application/pdf' } });

        expect(response).toBe(pdf);
        expect(response.bodyUsed).toBe(false);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/customer/invoice/5/pdf');
        expect(init.method).toBe('GET');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
        expect((init.headers as Record<string, string>)['Accept']).toBe('application/pdf');
    });

    it('rejects a refused download like a refused read', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ errorList: { INVOICE_NOT_FOUND: [] } }), { status: 404, headers: { 'content-type': 'application/json' } })
        );
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(client.download('/api/customer/invoice/5/pdf')).rejects.toMatchObject({
            name: 'AdibilisApiError',
            status: 404,
            body: { errorList: { INVOICE_NOT_FOUND: [] } },
            path: '/api/customer/invoice/5/pdf',
        });
    });

    it('rejects an empty api key at construction', () => {
        expect(() => createAdibilisClient({ baseUrl: 'https://core.test', apiKey: '' })).toThrow(/apiKey/);
    });
});
