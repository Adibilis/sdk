import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import {
    CUSTOMER_EMAIL_COOKIE,
    customerEmailFromCookies,
    customerSessionFromCookies,
    exchangeLoginToken,
    expiredCustomerSessionCookie,
    expiredSignInCookies,
    requestLoginLink,
} from '../src/customer/session';
import { customerSessionInit } from '../src/customer/session-header';

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
            { ...link, language: 'DE', shopName: 'Oh! Blumen', purpose: null },
            visitorHeader
        );
    });

    it('requestLoginLink sends the resources purpose', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(null);

        await requestLoginLink(client, { ...link, purpose: 'RESOURCES' }, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ purpose: 'RESOURCES' });
    });

    it('requestLoginLink leaves the purpose to core when absent', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(null);

        await requestLoginLink(client, link, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ purpose: null });
    });

    it('requestLoginLink rejects an unknown purpose locally', async () => {
        const client = mockClient();

        await expect(requestLoginLink(client, { ...link, purpose: 'BLOG' as never }, visitor)).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
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
            name: '__Host-adbl_customer',
            value: session.sessionToken,
            options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date('2026-11-18T09:30:00Z') },
            header: `__Host-adbl_customer=${session.sessionToken}; Path=/; Expires=Wed, 18 Nov 2026 09:30:00 GMT; HttpOnly; Secure; SameSite=Lax`,
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
            name: '__Host-adbl_customer',
            value: '',
            options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date(0) },
            header: '__Host-adbl_customer=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
        });
    });
});

describe('the __Host- cookie prefix requirements', () => {
    it('sets and clears the cookie with Secure and Path=/ and no Domain', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(session);
        const { cookie } = await exchangeLoginToken(client, 'mailed-token', visitor);

        for (const header of [cookie.header, expiredCustomerSessionCookie().header]) {
            expect(header.startsWith('__Host-adbl_customer=')).toBe(true);
            expect(header).not.toMatch(/Domain=/i);
            expect(header).toContain('; Path=/;');
            expect(header).toContain('; Secure');
        }
    });
});

describe('customerSessionFromCookies', () => {
    const cookie = (value: string) => `theme=dark; __Host-adbl_customer=${value}; b=2`;

    it('reads a well-formed token from a header or a cookie store', () => {
        expect(customerSessionFromCookies(cookie(session.sessionToken))).toBe(session.sessionToken);
        expect(customerSessionFromCookies({ get: () => ({ value: ` ${session.sessionToken} ` }) })).toBe(session.sessionToken);
    });

    it('answers null without the cookie', () => {
        expect(customerSessionFromCookies('theme=dark')).toBeNull();
        expect(customerSessionFromCookies(null)).toBeNull();
        expect(customerSessionFromCookies({ get: () => undefined })).toBeNull();
    });

    it('answers null for a malformed or too long token', () => {
        expect(customerSessionFromCookies(cookie('not a token!'))).toBeNull();
        expect(customerSessionFromCookies(cookie(''))).toBeNull();
        expect(customerSessionFromCookies(cookie('a'.repeat(129)))).toBeNull();
        expect(customerSessionFromCookies(cookie('a'.repeat(128)))).not.toBeNull();
    });
});

describe('customerEmailFromCookies', () => {
    const header = (email: string) => `__Host-adbl_customer=tok; __Host-adbl_customer_email=${email}`;
    const store = (values: Record<string, string>) => ({
        get: (name: string) => (name in values ? { value: values[name]! } : undefined),
    });

    it('reads the percent-encoded address from a raw Cookie header', () => {
        expect(customerEmailFromCookies(header('jane%40example.ch'))).toBe('jane@example.ch');
    });

    it('answers null without the session cookie', () => {
        expect(customerEmailFromCookies('__Host-adbl_customer_email=jane%40example.ch')).toBeNull();
        expect(customerEmailFromCookies(store({ [CUSTOMER_EMAIL_COOKIE]: 'jane@example.ch' }))).toBeNull();
        expect(customerEmailFromCookies(null)).toBeNull();
    });

    it.each([
        ['a broken percent-encoding', '%E0%A4%A'],
        ['a value that is no address', 'a<b@x'],
        ['a value over 255 characters', `${'a'.repeat(250)}%40example.ch`],
    ])('answers null for %s', (_name, value) => {
        expect(customerEmailFromCookies(header(value))).toBeNull();
    });

    it('takes a cookie store value as it is, without decoding it a second time', () => {
        const cookies = store({ '__Host-adbl_customer': 'tok', [CUSTOMER_EMAIL_COOKIE]: 'a+b%c@example.ch' });

        expect(customerEmailFromCookies(cookies)).toBe('a+b%c@example.ch');
    });
});

describe('expiredSignInCookies', () => {
    it('clears the session and the email cookie with the same attributes', () => {
        expect(expiredSignInCookies().map((cookie) => cookie.header)).toEqual([
            '__Host-adbl_customer=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
            '__Host-adbl_customer_email=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
        ]);
    });
});

describe('customerSessionInit', () => {
    it('is empty without a session and carries the header and no-store with one', () => {
        expect(customerSessionInit(null)).toEqual({});
        expect(customerSessionInit(undefined)).toEqual({});
        expect(customerSessionInit('tok')).toEqual({ headers: { 'X-Customer-Session': 'tok' }, cache: 'no-store' });
    });
});
