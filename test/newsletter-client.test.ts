import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { subscribeNewsletter, type NewsletterSignupRequest } from '../src/shop/newsletter-client';

const visitor = { clientIp: '203.0.113.7' };
const visitorHeader = { headers: { 'X-Shop-Client-Ip': '203.0.113.7' } };
const signup: NewsletterSignupRequest = { firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com', consent: true };

const mockClient = () => ({ get: vi.fn(), post: vi.fn().mockResolvedValue(null), patch: vi.fn(), delete: vi.fn() });

function coreAnswering(response: Response) {
    const fetchMock = vi.fn().mockResolvedValue(response);
    return { fetchMock, client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }) };
}

describe('subscribeNewsletter', () => {
    it('posts the names, the address, the consent, the honeypot and the language with the visitor address', async () => {
        const client = mockClient();

        await expect(subscribeNewsletter(client, { ...signup, website: '', language: 'de' }, visitor)).resolves.toBeUndefined();

        expect(client.post).toHaveBeenCalledWith('/api/shop/newsletter', { ...signup, website: '', language: 'de' }, visitorHeader);
    });

    it('trims the names and the address', async () => {
        const client = mockClient();

        await subscribeNewsletter(client, { ...signup, firstname: ' Jane ', lastname: 'Doe ', email: ' jane@example.com ' }, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com' });
    });

    it('sends what core sees on the wire: path, headers and JSON body, without the absent optional fields', async () => {
        const { client, fetchMock } = coreAnswering(new Response(null, { status: 202 }));

        await expect(subscribeNewsletter(client, signup, visitor)).resolves.toBeUndefined();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/shop/newsletter');
        expect(init.method).toBe('POST');
        expect(init.headers).toMatchObject({ 'X-API-Secret-Key': 'k', 'X-Shop-Client-Ip': '203.0.113.7', 'Content-Type': 'application/json' });
        expect(JSON.parse(init.body)).toEqual(signup);
    });

    it('sends an IPv4-mapped IPv6 visitor address as the plain IPv4 address', async () => {
        const client = mockClient();

        await subscribeNewsletter(client, signup, { clientIp: '::ffff:203.0.113.7' });

        expect(client.post.mock.calls[0][2]).toEqual(visitorHeader);
    });

    it('passes a filled honeypot through verbatim, skipping every local check, so a bot gets core’s silent 202', async () => {
        const client = mockClient();
        const bot = { firstname: '', lastname: '', email: 'not-an-address', consent: false, website: 'https://spam.example' };

        await expect(subscribeNewsletter(client, bot as unknown as NewsletterSignupRequest, visitor)).resolves.toBeUndefined();

        expect(client.post).toHaveBeenCalledWith('/api/shop/newsletter', bot, visitorHeader);
    });

    it.each([
        ['a blank first name', { firstname: '  ' }],
        ['a blank last name', { lastname: '' }],
        ['an address that is none', { email: 'jane' }],
        ['consent other than true', { consent: false }],
    ])('refuses %s before any request', async (_name, change) => {
        const client = mockClient();

        await expect(subscribeNewsletter(client, { ...signup, ...change } as NewsletterSignupRequest, visitor)).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it.each([
        ['a forwarded-for list', '203.0.113.7, 10.0.0.1'],
        ['a host name', 'localhost'],
        ['nothing', ''],
    ])('refuses %s as the visitor address, honeypot or not', async (_name, clientIp) => {
        const client = mockClient();

        await expect(subscribeNewsletter(client, signup, { clientIp })).rejects.toBeInstanceOf(ZodError);
        await expect(subscribeNewsletter(client, { ...signup, website: 'x' }, { clientIp })).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a 400 with an AdibilisApiError carrying core’s validation body', async () => {
        const body = { code: 'VALIDATION_FAILED', violations: [{ field: 'email', code: 'Email' }] };
        const { client } = coreAnswering(
            new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } })
        );

        const error = await subscribeNewsletter(client, signup, visitor).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect(error).toMatchObject({ status: 400, body, path: '/api/shop/newsletter' });
    });

    it.each([429, 401, 403])('rejects a %i with an AdibilisApiError of that status', async (status) => {
        const { client } = coreAnswering(new Response(null, { status }));

        const error = await subscribeNewsletter(client, signup, visitor).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect(error).toMatchObject({ status, path: '/api/shop/newsletter' });
    });

    it('never puts the WEBSITE key into the error', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'secret-website-key', fetch: fetchMock });

        const error = await subscribeNewsletter(client, signup, visitor).catch((e: unknown) => e);

        expect(JSON.stringify(error)).not.toContain('secret-website-key');
        expect(String(error)).not.toContain('secret-website-key');
    });
});
