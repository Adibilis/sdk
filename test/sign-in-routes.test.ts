import { describe, expect, it, vi } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { signInRoutes } from '../src/customer/sign-in-routes';
import type { SignInRoutesOptions } from '../src/customer/sign-in-routes';

const ORIGIN = 'http://0.0.0.0:3000';
const HANDOFF = 'AbC_dEf-123';
const proxy = { 'x-forwarded-host': 'shop.example', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' };
const visitorHeader = { headers: { 'X-Shop-Client-Ip': '203.0.113.7' } };

const session = {
    sessionToken: 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc',
    expiresAt: '2026-11-18T09:30:00Z',
    customer: { firstname: 'Jane', lastname: 'Doe', email: 'jane@example.ch' },
};
const SESSION_COOKIE = `__Host-adbl_customer=${session.sessionToken}; Path=/; Expires=Wed, 18 Nov 2026 09:30:00 GMT; HttpOnly; Secure; SameSite=Lax`;
const EMAIL_COOKIE = '__Host-adbl_customer_email=jane%40example.ch; Path=/; Expires=Wed, 18 Nov 2026 09:30:00 GMT; HttpOnly; Secure; SameSite=Lax';
const HANDOFF_CLEARED = 'adbl_login=; Path=/api/account/session; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
const EXPIRED = [
    '__Host-adbl_customer=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    '__Host-adbl_customer_email=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
];

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() });

function setup(options: Partial<SignInRoutesOptions> = {}) {
    const client = mockClient();
    const factory = vi.fn(() => client);
    const log = vi.fn<(message: string) => void>();
    const routes = signInRoutes({ client: factory, log, acceptsReturnPath: (path) => path === '/resource/12', ...options });
    return { client, factory, log, routes };
}

const apiError = (status: number, errorList?: Record<string, unknown>) =>
    new AdibilisApiError(status, errorList ? { errorList } : null, '/api/customer/session');

function post(path: string, fields: Record<string, string> | string, headers: Record<string, string> = {}): Request {
    const body = typeof fields === 'string' ? fields : new URLSearchParams(fields);
    return new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers });
}

const get = (pathAndQuery: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${pathAndQuery}`, { headers });

function expectRedirect(response: Response, location: string) {
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(location);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
}

const TAMPERED: readonly [string, string][] = [
    ['a protocol-relative path', '//evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a backslash', '/\\evil.example'],
    ['a non-ASCII character', '/ü'],
    ['a space', '/a b'],
    ['a control character', decodeURIComponent('/a%0d')],
    ['a path over 512 characters', `/${'a'.repeat(512)}`],
];

describe('login', () => {
    const fields = { email: ' jane@example.ch ', next: '/resource/12', language: 'de' };
    const login = (body: Record<string, string> | string, headers: Record<string, string> = proxy) => post('/api/account/login', body, headers);
    const resources = { purpose: 'RESOURCES', shopName: 'CODONIS Resources' } as const;

    it('requests the link for the public callback with the return path, and redirects to the sent notice', async () => {
        const { client, routes } = setup(resources);
        client.post.mockResolvedValue(null);

        const response = await routes.login(login(fields));

        expect(client.post).toHaveBeenCalledWith(
            '/api/customer/login-link',
            {
                email: 'jane@example.ch',
                returnUrl: 'https://shop.example/account/callback?next=%2Fresource%2F12',
                language: 'DE',
                shopName: 'CODONIS Resources',
                purpose: 'RESOURCES',
            },
            visitorHeader
        );
        expectRedirect(response, '/account/login?sent=1&next=%2Fresource%2F12');
    });

    it("takes the site's language when the form's is none core knows", async () => {
        const { client, routes } = setup({ language: 'fr' });
        client.post.mockResolvedValue(null);

        await routes.login(login({ ...fields, language: 'xx' }));

        expect(client.post.mock.calls[0][1]).toMatchObject({ language: 'FR' });
    });

    it("takes the browser's first language last, and leaves the language to core without one", async () => {
        const { client, routes } = setup();
        client.post.mockResolvedValue(null);

        await routes.login(login({ email: 'jane@example.ch' }, { ...proxy, 'accept-language': 'it-CH,de;q=0.8' }));
        await routes.login(login({ email: 'jane@example.ch' }, { ...proxy, 'accept-language': 'es-ES,de;q=0.8' }));

        expect(client.post.mock.calls[0][1]).toMatchObject({ language: 'IT', shopName: null, purpose: null });
        expect(client.post.mock.calls[1][1]).toMatchObject({ language: null });
    });

    it('uses the custom paths and falls back to the request origin without forwarded headers', async () => {
        const { client, routes } = setup({ paths: { login: '/sign-in', callback: '/sign-in/callback' } });
        client.post.mockResolvedValue(null);

        const response = await routes.login(login({ email: 'jane@example.ch' }, {}));

        expect(client.post.mock.calls[0][1]).toMatchObject({ returnUrl: `${ORIGIN}/sign-in/callback` });
        expect(client.post.mock.calls[0][2]).toEqual({ headers: { 'X-Shop-Client-Ip': '127.0.0.1' } });
        expectRedirect(response, '/sign-in?sent=1');
    });

    it.each(TAMPERED)('drops %s as the return path', async (_name, next) => {
        const { client, routes } = setup({ acceptsReturnPath: () => true });
        client.post.mockResolvedValue(null);

        const response = await routes.login(login({ ...fields, next }));

        expect(client.post.mock.calls[0][1]).toMatchObject({ returnUrl: 'https://shop.example/account/callback' });
        expectRedirect(response, '/account/login?sent=1');
    });

    it("drops a return path the site does not accept, query included", async () => {
        const accepted: string[] = [];
        const { client, routes } = setup({ acceptsReturnPath: (path) => accepted.push(path) > 0 && path === '/resource/12' });
        client.post.mockResolvedValue(null);

        const response = await routes.login(login({ ...fields, next: '/resource/12?x=1' }));

        expect(accepted).toEqual(['/resource/12?x=1']);
        expectRedirect(response, '/account/login?sent=1');
    });

    it('keeps any well-formed return path when the site sets no check', async () => {
        const { client, routes } = setup({ acceptsReturnPath: undefined });
        client.post.mockResolvedValue(null);

        const response = await routes.login(login({ ...fields, next: '/anything?x=1' }));

        expectRedirect(response, '/account/login?sent=1&next=%2Fanything%3Fx%3D1');
    });

    it.each([
        ['blank', '  '],
        ['without an @', 'jane.example.ch'],
        ['over 254 characters', `${'a'.repeat(244)}@example.ch`],
    ])('refuses an address that is %s before any core call', async (_name, email) => {
        const { client, factory, routes } = setup();

        const response = await routes.login(login({ ...fields, email }));

        expect(factory).not.toHaveBeenCalled();
        expect(client.post).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=EMAIL_INVALID&next=%2Fresource%2F12');
    });

    it('reads a body that is not a form as an empty form', async () => {
        const { client, routes } = setup();

        const response = await routes.login(login(JSON.stringify({ email: 'jane@example.ch' }), { ...proxy, 'content-type': 'application/json' }));

        expect(client.post).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=EMAIL_INVALID');
    });

    it('answers EMAIL_INVALID for an address the SDK refuses locally', async () => {
        const { client, routes } = setup();

        const response = await routes.login(login({ ...fields, email: 'jane@' }));

        expect(client.post).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=EMAIL_INVALID&next=%2Fresource%2F12');
    });

    it('reads a setup error the SDK refuses locally as SIGN_IN_UNAVAILABLE and logs the field, not the value', async () => {
        const { client, log, routes } = setup({ shopName: 'x'.repeat(81) });

        const response = await routes.login(login(fields));

        expect(client.post).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=SIGN_IN_UNAVAILABLE&next=%2Fresource%2F12');
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('invalid shopName');
        expect(log.mock.calls[0][0]).not.toContain('jane@example.ch');
        expect(log.mock.calls[0][0]).not.toContain('x'.repeat(81));
    });

    it('falls back to the request origin for a malformed forwarded host', async () => {
        const { client, routes } = setup();
        client.post.mockResolvedValue(null);

        const response = await routes.login(login(fields, { ...proxy, 'x-forwarded-host': 'a b' }));

        expect(client.post.mock.calls[0][1]).toMatchObject({ returnUrl: `${ORIGIN}/account/callback?next=%2Fresource%2F12` });
        expectRedirect(response, '/account/login?sent=1&next=%2Fresource%2F12');
    });

    it('passes the 429 on as TOO_MANY_REQUESTS', async () => {
        const { client, routes } = setup();
        client.post.mockRejectedValue(apiError(429, { TOO_MANY_REQUESTS: [] }));

        expectRedirect(await routes.login(login(fields)), '/account/login?error=TOO_MANY_REQUESTS&next=%2Fresource%2F12');
    });

    it.each([
        ['SHOP_ORIGIN_NOT_ALLOWED', "add https://shop.example to core's SHOP_ALLOWED_ORIGINS"],
        ['RESOURCES_ORIGIN_NOT_ALLOWED', "add https://shop.example to core's RESOURCES_ALLOWED_ORIGINS"],
    ])('answers SIGN_IN_UNAVAILABLE for %s and logs where to allow the origin', async (code, hint) => {
        const { client, log, routes } = setup();
        client.post.mockRejectedValue(apiError(400, { [code]: [] }));

        const response = await routes.login(login(fields));

        expectRedirect(response, '/account/login?error=SIGN_IN_UNAVAILABLE&next=%2Fresource%2F12');
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain(code);
        expect(log.mock.calls[0][0]).toContain(hint);
    });

    it.each([
        ['an outage', apiError(503)],
        ['a disabled module', apiError(404, { RESOURCES_MODULE_DISABLED: [] })],
        ['a network error', new TypeError('fetch failed')],
    ])('answers SIGN_IN_UNAVAILABLE for %s and logs it', async (_name, error) => {
        const { client, log, routes } = setup();
        client.post.mockRejectedValue(error);

        expectRedirect(await routes.login(login(fields)), '/account/login?error=SIGN_IN_UNAVAILABLE&next=%2Fresource%2F12');
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe('callback', () => {
    it('parks a usable token in the handoff cookie and redirects to the continue page without calling core', async () => {
        const { factory, routes } = setup();

        const response = await routes.callback(get(`/account/callback?token=${HANDOFF}&next=/resource/12`));

        expectRedirect(response, '/account/continue?next=%2Fresource%2F12');
        expect(response.headers.getSetCookie()).toEqual([`adbl_login=${HANDOFF}; Path=/api/account/session; Max-Age=900; Secure; HttpOnly; SameSite=Strict`]);
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(factory).not.toHaveBeenCalled();
    });

    it("scopes the handoff cookie to the session route's path", async () => {
        const { routes } = setup({ paths: { session: '/x/session' } });

        const response = await routes.callback(get(`/account/callback?token=${HANDOFF}`));

        expectRedirect(response, '/account/continue');
        expect(response.headers.getSetCookie()).toEqual([`adbl_login=${HANDOFF}; Path=/x/session; Max-Age=900; Secure; HttpOnly; SameSite=Strict`]);
    });

    it.each([
        ['a malformed token', '?token=a%20b'],
        ['a token over 128 characters', `?token=${'a'.repeat(129)}`],
        ['no token', ''],
    ])('sends %s to the login page with no cookie', async (_name, query) => {
        const { factory, routes } = setup();

        const response = await routes.callback(get(`/account/callback${query}`));

        expectRedirect(response, '/account/login?error=CUSTOMER_LOGIN_TOKEN_INVALID');
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(factory).not.toHaveBeenCalled();
    });

    it('keeps an accepted return path on the way to the login page', async () => {
        const { routes } = setup();

        expectRedirect(
            await routes.callback(get('/account/callback?token=a%20b&next=/resource/12')),
            '/account/login?error=CUSTOMER_LOGIN_TOKEN_INVALID&next=%2Fresource%2F12'
        );
    });
});

describe('session', () => {
    const exchange = (fields: Record<string, string> = {}, cookie: string | null = `theme=dark; adbl_login=${HANDOFF}`) =>
        post('/api/account/session', fields, { ...proxy, ...(cookie === null ? {} : { cookie }) });

    it('spends the parked token, sets the session and email cookies and returns to the accepted path', async () => {
        const { client, routes } = setup();
        client.post.mockResolvedValue(session);

        const response = await routes.session(exchange({ next: '/resource/12' }));

        expect(client.post).toHaveBeenCalledWith('/api/customer/session', { token: HANDOFF }, visitorHeader);
        expectRedirect(response, '/resource/12');
        expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE, EMAIL_COOKIE, HANDOFF_CLEARED]);
    });

    it('goes to the signed-in page without a return path', async () => {
        const { client, routes } = setup();
        client.post.mockResolvedValue(session);

        expectRedirect(await routes.session(exchange()), '/account');
    });

    it.each(TAMPERED)('goes to the signed-in page for %s', async (_name, next) => {
        const { client, routes } = setup({ acceptsReturnPath: () => true, paths: { signedIn: '/library' } });
        client.post.mockResolvedValue(session);

        expectRedirect(await routes.session(exchange({ next })), '/library');
    });

    it.each([
        ['no handoff cookie', null],
        ['a malformed handoff cookie', 'adbl_login=not-a-token!'],
    ])('sends %s to the login page, clears the cookie and calls nothing in core', async (_name, cookie) => {
        const { factory, routes } = setup();

        const response = await routes.session(exchange({ next: '/resource/12' }, cookie));

        expect(factory).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=CUSTOMER_LOGIN_TOKEN_INVALID&next=%2Fresource%2F12');
        expect(response.headers.getSetCookie()).toEqual([HANDOFF_CLEARED]);
    });

    it('sends a spent link to the login page and clears the cookie', async () => {
        const { client, routes } = setup();
        client.post.mockRejectedValue(apiError(401, { CUSTOMER_LOGIN_TOKEN_INVALID: [] }));

        const response = await routes.session(exchange());

        expectRedirect(response, '/account/login?error=CUSTOMER_LOGIN_TOKEN_INVALID');
        expect(response.headers.getSetCookie()).toEqual([HANDOFF_CLEARED]);
    });

    it('keeps the cookie on a 429 so a retry spends the same link', async () => {
        const { client, routes } = setup();
        client.post.mockRejectedValue(apiError(429, { TOO_MANY_REQUESTS: [] }));

        const response = await routes.session(exchange({ next: '/resource/12' }));

        expectRedirect(response, '/account/continue?error=TOO_MANY_REQUESTS&next=%2Fresource%2F12');
        expect(response.headers.getSetCookie()).toEqual([]);
    });

    it('reads a 401 without a session code as a wrong WEBSITE key, not a dead link', async () => {
        const { client, log, routes } = setup();
        client.post.mockRejectedValue(apiError(401));

        const response = await routes.session(exchange());

        expectRedirect(response, '/account/continue?error=SIGN_IN_UNAVAILABLE');
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('check the WEBSITE key');
    });

    it.each([
        ['an outage', apiError(503)],
        ['sign-in switched off', apiError(404, { CUSTOMER_SIGN_IN_DISABLED: [] })],
        ['a network error', new TypeError('fetch failed')],
    ])('keeps the cookie and logs %s', async (_name, error) => {
        const { client, log, routes } = setup();
        client.post.mockRejectedValue(error);

        const response = await routes.session(exchange({ next: '/resource/12' }));

        expectRedirect(response, '/account/continue?error=SIGN_IN_UNAVAILABLE&next=%2Fresource%2F12');
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe('logout', () => {
    const logout = (headers: Record<string, string>) =>
        post('/api/account/logout', '', { ...proxy, cookie: `__Host-adbl_customer=${session.sessionToken}`, ...headers });

    it.each([
        ['a same-origin POST', { 'sec-fetch-site': 'same-origin' }],
        ['a POST without fetch metadata', {}],
    ])('ends the session in core and expires both cookies for %s', async (_name, headers) => {
        const { client, routes } = setup();
        client.delete.mockResolvedValue(null);

        const response = await routes.logout(logout(headers));

        expect(client.delete).toHaveBeenCalledTimes(1);
        expect(client.delete.mock.calls[0][0]).toBe('/api/customer/session');
        expect(client.delete.mock.calls[0][1].headers).toMatchObject({ 'X-Customer-Session': session.sessionToken, 'X-Shop-Client-Ip': '203.0.113.7' });
        expectRedirect(response, '/account/logout');
        expect(response.headers.getSetCookie()).toEqual(EXPIRED);
    });

    it('logs and ignores a refused logout, and still expires both cookies', async () => {
        const { client, log, routes } = setup({ paths: { signedOut: '/bye' } });
        client.delete.mockRejectedValue(apiError(404, { CUSTOMER_SIGN_IN_DISABLED: [] }));

        const response = await routes.logout(logout({ 'sec-fetch-site': 'same-origin' }));

        expectRedirect(response, '/bye');
        expect(response.headers.getSetCookie()).toEqual(EXPIRED);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('CUSTOMER_SIGN_IN_DISABLED');
    });

    it('expires both cookies without calling core when there is no session', async () => {
        const { client, factory, routes } = setup();

        const response = await routes.logout(post('/api/account/logout', '', { 'sec-fetch-site': 'same-origin' }));

        expect(factory).not.toHaveBeenCalled();
        expect(client.delete).not.toHaveBeenCalled();
        expectRedirect(response, '/account/logout');
        expect(response.headers.getSetCookie()).toEqual(EXPIRED);
    });

    it.each(['cross-site', 'same-site'])('lets a %s POST change nothing', async (site) => {
        const { factory, routes } = setup();

        const response = await routes.logout(logout({ 'sec-fetch-site': site }));

        expect(factory).not.toHaveBeenCalled();
        expectRedirect(response, '/account/logout');
        expect(response.headers.getSetCookie()).toEqual([]);
    });
});

describe('expired', () => {
    it.each([
        ['a same-origin navigation', { 'sec-fetch-site': 'same-origin' }],
        ['a typed address', { 'sec-fetch-site': 'none' }],
        ['a request without fetch metadata', {}],
    ])('expires both cookies for %s and calls nothing in core', async (_name, headers) => {
        const { factory, routes } = setup();

        const response = await routes.expired(get('/api/account/expired?next=/resource/12', headers));

        expect(factory).not.toHaveBeenCalled();
        expectRedirect(response, '/account/login?error=CUSTOMER_SESSION_INVALID&next=%2Fresource%2F12');
        expect(response.headers.getSetCookie()).toEqual(EXPIRED);
    });

    it.each(['cross-site', 'same-site'])('sets no cookie for a %s request', async (site) => {
        const { routes } = setup();

        const response = await routes.expired(get('/api/account/expired', { 'sec-fetch-site': site }));

        expectRedirect(response, '/account/login?error=CUSTOMER_SESSION_INVALID');
        expect(response.headers.getSetCookie()).toEqual([]);
    });
});

describe('a site with sign-in switched off', () => {
    it('answers 404 with an empty body on every handler', async () => {
        const { factory, routes } = setup({ enabled: () => false });
        const requests = {
            login: post('/api/account/login', { email: 'jane@example.ch' }),
            callback: get(`/account/callback?token=${HANDOFF}`),
            session: post('/api/account/session', {}, { cookie: `adbl_login=${HANDOFF}` }),
            logout: post('/api/account/logout', '', { cookie: `__Host-adbl_customer=${session.sessionToken}` }),
            expired: get('/api/account/expired'),
        };

        for (const [name, request] of Object.entries(requests)) {
            const response = await routes[name as keyof typeof requests](request);
            expect(response.status, name).toBe(404);
            expect(await response.text(), name).toBe('');
            expect(response.headers.get('cache-control'), name).toBe('private, no-store');
            expect(response.headers.getSetCookie(), name).toEqual([]);
        }
        expect(factory).not.toHaveBeenCalled();
    });
});

describe('the log', () => {
    it('never carries the address or a token', async () => {
        const { client, log, routes } = setup();
        const failures = [apiError(400, { SHOP_ORIGIN_NOT_ALLOWED: [] }), apiError(401), apiError(503), new TypeError('fetch failed')];
        for (const failure of failures) {
            client.post.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
            client.delete.mockRejectedValueOnce(failure);
            await routes.login(post('/api/account/login', { email: 'jane@example.ch' }, proxy));
            await routes.session(post('/api/account/session', {}, { ...proxy, cookie: `adbl_login=${HANDOFF}` }));
            await routes.logout(post('/api/account/logout', '', { ...proxy, cookie: `__Host-adbl_customer=${session.sessionToken}` }));
        }

        expect(log.mock.calls.length).toBe(failures.length * 3);
        for (const [message] of log.mock.calls) {
            expect(message).not.toContain('jane@example.ch');
            expect(message).not.toContain(HANDOFF);
            expect(message).not.toContain(session.sessionToken);
        }
    });
});
