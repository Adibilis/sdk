import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { exchangeLoginToken, expiredCustomerSessionCookie, requestLoginLink } from '../src/customer/session';

const visitor = { clientIp: '203.0.113.7' };
const visitorHeader = { headers: { 'X-Shop-Client-Ip': '203.0.113.7' } };
const link = { email: 'jane@example.com', returnUrl: 'https://shop.example/account/callback' };

const session = {
    sessionToken: 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc',
    expiresAt: '2026-11-18T09:30:00Z',
    customer: { firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com' },
};

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() });

describe('requestLoginLink', () => {
    it('posts the address, the callback, the mail language and the shop name with the visitor address', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(null);

        await expect(requestLoginLink(client, { ...link, language: 'de-CH', shopName: 'Oh! Blumen' }, visitor)).resolves.toBeUndefined();

        expect(client.post).toHaveBeenCalledWith(
            '/api/customer/login-link',
            { ...link, language: 'DE', shopName: 'Oh! Blumen' },
            visitorHeader
        );
    });

    it.each([
        ['fr', 'FR'],
        ['IT', 'IT'],
        ['en_GB', 'EN'],
        ['es', null],
        ['deutsch', null],
        [undefined, null],
    ])('sends the locale %s as the mail language %s', async (language, sent) => {
        const client = mockClient();
        client.post.mockResolvedValue(null);

        await requestLoginLink(client, { ...link, language }, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ language: sent });
    });

    it.each([
        ['a relative callback', { returnUrl: '/account/callback' }],
        ['a callback that is no web address', { returnUrl: 'javascript:alert(1)' }],
        ['an address that is none', { email: 'jane' }],
        ['a shop name over 80 characters', { shopName: 'x'.repeat(81) }],
    ])('refuses %s before any request', async (_name, change) => {
        const client = mockClient();

        await expect(requestLoginLink(client, { ...link, ...change }, visitor)).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('refuses a forwarded-for list as the visitor address', async () => {
        const client = mockClient();

        await expect(requestLoginLink(client, link, { clientIp: '203.0.113.7, 10.0.0.1' })).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('resolves on the 202 core answers for every address', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await expect(requestLoginLink(client, link, visitor)).resolves.toBeUndefined();
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/customer/login-link');
    });
});

describe('exchangeLoginToken', () => {
    it('posts the token with the visitor address and answers the customer and the session cookie', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(session);

        const signIn = await exchangeLoginToken(client, ' mailed-token ', visitor);

        expect(client.post).toHaveBeenCalledWith('/api/customer/session', { token: 'mailed-token' }, visitorHeader);
        expect(signIn.customer).toEqual(session.customer);
        expect(signIn.expiresAt).toBe(session.expiresAt);
        expect(signIn.cookie).toEqual({
            name: 'adbl_customer',
            value: session.sessionToken,
            options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date('2026-11-18T09:30:00Z') },
            header: `adbl_customer=${session.sessionToken}; Path=/; Expires=Wed, 18 Nov 2026 09:30:00 GMT; HttpOnly; Secure; SameSite=Lax`,
        });
    });

    it('carries the session token only inside the cookie', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(session);

        const { cookie, ...rest } = await exchangeLoginToken(client, 'mailed-token', visitor);

        expect(JSON.stringify(rest)).not.toContain(session.sessionToken);
        expect(cookie.value).toBe(session.sessionToken);
    });

    it('reads absent names as null', async () => {
        const client = mockClient();
        client.post.mockResolvedValue({ ...session, customer: { email: 'jane@example.com' } });

        await expect(exchangeLoginToken(client, 'mailed-token', visitor)).resolves.toMatchObject({
            customer: { firstname: null, lastname: null, email: 'jane@example.com' },
        });
    });

    it.each([
        ['blank', '  '],
        ['over 128 characters', 'x'.repeat(129)],
    ])('refuses a token that is %s before any request', async (_name, token) => {
        const client = mockClient();

        await expect(exchangeLoginToken(client, token, visitor)).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it("surfaces a spent link as core's 401", async () => {
        const client = mockClient();
        client.post.mockRejectedValue(
            new AdibilisApiError(401, { error: 'Unauthorized', errorList: { CUSTOMER_LOGIN_TOKEN_INVALID: [] } }, '/api/customer/session')
        );

        await expect(exchangeLoginToken(client, 'used', visitor)).rejects.toMatchObject({ status: 401 });
    });
});

describe('expiredCustomerSessionCookie', () => {
    it('clears the session cookie with the same attributes', () => {
        expect(expiredCustomerSessionCookie()).toEqual({
            name: 'adbl_customer',
            value: '',
            options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date(0) },
            header: 'adbl_customer=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
        });
    });
});
