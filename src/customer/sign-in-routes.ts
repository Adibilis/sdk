import { ZodError } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { AdibilisApiError } from '../client/errors.js';
import { clientIpOf, publicOrigin } from '../request/request.js';
import type { CustomerLoginPurpose } from '../subscription/wire.js';
import { customerFromCookies } from './customer-client.js';
import { languageOf } from './language.js';
import { customerRefusalOf } from './refusal.js';
import { cookieValue, customerEmailCookie, exchangeLoginToken, expiredSignInCookies, requestLoginLink } from './session.js';
import type { SignInNotice } from './sign-in-notice.js';

/** Where the sign-in pages and routes live on the site; every path is site-relative. */
export interface SignInPaths {
    /** The page with the address form; it posts to the `login` handler. */
    login: string;
    /** The page the mailed link ends on; it posts to the `session` handler. */
    continue: string;
    /** The `callback` handler, the address core mails. */
    callback: string;
    /** The `session` handler, and the handoff cookie's `Path`. */
    session: string;
    /** Where a sign-in without a return path ends. */
    signedIn: string;
    /** Where the `logout` handler ends. */
    signedOut: string;
}

export interface SignInRoutesOptions {
    /** The site's API client, created per request so the WEBSITE key is read only when a handler runs. */
    client: () => AdibilisClient;
    /** Names the site in the mail; core's organization name when absent. */
    shopName?: string | null;
    /** `'RESOURCES'` for a resources site; absent is the shop sign-in. */
    purpose?: CustomerLoginPurpose | null;
    /** The site's language (`de`, `de-CH`), used for the mail when the form sends none core knows. */
    language?: string | null;
    paths?: Partial<SignInPaths>;
    /** Narrows the return paths the SDK accepts; it receives path and query (`/resource/12?x=1`). Absent, every well-formed one passes. */
    acceptsReturnPath?: (path: string) => boolean;
    /** False answers every handler with 404. */
    enabled?: () => boolean;
    /** Receives every message the handlers write; none carries an address or a token. */
    log?: (message: string) => void;
}

export interface SignInRoutes {
    /** POST: the address form. */
    login: (request: Request) => Promise<Response>;
    /** GET: the mailed link. Parks the token in a cookie and calls nothing in core. */
    callback: (request: Request) => Promise<Response>;
    /** POST: the continue page. Spends the parked token. */
    session: (request: Request) => Promise<Response>;
    /** POST: ends the session in core and in the browser. */
    logout: (request: Request) => Promise<Response>;
    /** GET: where a page sends a visitor whose session core refused; clears the cookies. */
    expired: (request: Request) => Promise<Response>;
}

const DEFAULT_PATHS: SignInPaths = {
    login: '/account/login',
    continue: '/account/continue',
    callback: '/account/callback',
    session: '/api/account/session',
    signedIn: '/account',
    signedOut: '/account/logout',
};
// Printable ASCII only: a character above U+00FF in a Location header throws.
const RETURN_PATH = /^\/(?!\/)[\x21-\x7e]{0,511}$/;
const LOGIN_COOKIE = 'adbl_login';
const LOGIN_LINK_SECONDS = 15 * 60;
const LOGIN_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_EMAIL_LENGTH = 254;
const OWN_NAVIGATION: ReadonlySet<string> = new Set(['same-origin', 'none']);

type Query = Record<string, string | null>;

function withQuery(path: string, query: Query): string {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
        if (value !== null) params.set(name, value);
    }
    const search = params.toString();
    return search === '' ? path : `${path}?${search}`;
}

function respond(status: number, location: string | null, cookies: readonly string[] = []): Response {
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    if (location !== null) headers.set('Location', location);
    for (const cookie of cookies) headers.append('Set-Cookie', cookie);
    return new Response(null, { status, headers });
}

const seeOther = (path: string, query: Query, cookies: readonly string[] = []) => respond(303, withQuery(path, query), cookies);

async function formOf(request: Request): Promise<FormData> {
    try {
        return await request.formData();
    } catch {
        return new FormData();
    }
}

function field(form: FormData, name: string): string | null {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
}

function isLoginToken(value: string | null | undefined): value is string {
    return typeof value === 'string' && LOGIN_TOKEN.test(value);
}

function isOwnNavigation(request: Request): boolean {
    const site = request.headers.get('sec-fetch-site');
    return site === null || OWN_NAVIGATION.has(site);
}

function failureOf(error: unknown): string {
    const code = customerRefusalOf(error)?.code;
    if (code !== undefined) return code;
    if (error instanceof AdibilisApiError) return `HTTP ${error.status}`;
    return error instanceof Error ? error.message : 'unknown error';
}

function allowedOriginsSetting(error: unknown): string | null {
    switch (customerRefusalOf(error)?.code) {
        case 'SHOP_ORIGIN_NOT_ALLOWED':
            return 'SHOP_ALLOWED_ORIGINS';
        case 'RESOURCES_ORIGIN_NOT_ALLOWED':
            return 'RESOURCES_ALLOWED_ORIGINS';
        default:
            return null;
    }
}

const isStatus = (error: unknown, status: number) => error instanceof AdibilisApiError && error.status === status;

const expiredCookieHeaders = () => expiredSignInCookies().map((cookie) => cookie.header);

/**
 * The email-link sign-in as five route handlers: a Next satellite exports each one from its route file
 * (`export const POST = signIn.login;`). Every answer is a 303 to a site-relative path with `Cache-Control: private, no-store`,
 * and a return path (`next`) survives the round trip through the mail only when it is a well-formed path on this site.
 */
export function signInRoutes(options: SignInRoutesOptions): SignInRoutes {
    const paths: SignInPaths = { ...DEFAULT_PATHS, ...options.paths };
    const enabled = options.enabled ?? (() => true);
    const log = options.log ?? ((message: string) => console.error(message));

    const guarded =
        (handler: (request: Request) => Promise<Response> | Response) =>
        async (request: Request): Promise<Response> =>
            enabled() ? handler(request) : respond(404, null);

    const returnPath = (value: string | null): string | null => {
        if (value === null || !RETURN_PATH.test(value) || value.includes('\\')) return null;
        return !options.acceptsReturnPath || options.acceptsReturnPath(value) ? value : null;
    };

    const handoffCookie = (token: string, maxAge: number) =>
        `${LOGIN_COOKIE}=${token}; Path=${paths.session}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;

    const login = guarded(async (request) => {
        const form = await formOf(request);
        const next = returnPath(field(form, 'next'));
        const back = (query: Query) => seeOther(paths.login, { ...query, next });
        const email = (field(form, 'email') ?? '').trim();
        if (email === '' || email.length > MAX_EMAIL_LENGTH || !email.includes('@')) return back({ error: 'EMAIL_INVALID' });

        const origin = publicOrigin(request.headers, new URL(request.url).origin);
        const browserLanguage = request.headers.get('accept-language')?.split(/[,;]/)[0];
        const language = [field(form, 'language'), options.language, browserLanguage].find((locale) => languageOf(locale) !== null) ?? null;
        try {
            await requestLoginLink(
                options.client(),
                {
                    email,
                    returnUrl: withQuery(`${origin}${paths.callback}`, { next }),
                    language,
                    shopName: options.shopName ?? null,
                    purpose: options.purpose ?? null,
                },
                { clientIp: clientIpOf(request.headers) }
            );
            return back({ sent: '1' });
        } catch (error) {
            if (error instanceof ZodError) return back({ error: 'EMAIL_INVALID' });
            if (isStatus(error, 429)) return back({ error: 'TOO_MANY_REQUESTS' });
            const setting = allowedOriginsSetting(error);
            log(`[sign-in] login link refused: ${failureOf(error)}${setting === null ? '' : `; add ${origin} to core's ${setting}`}`);
            return back({ error: 'SIGN_IN_UNAVAILABLE' });
        }
    });

    const callback = guarded((request) => {
        const url = new URL(request.url);
        const token = url.searchParams.get('token');
        const next = returnPath(url.searchParams.get('next'));
        const response = isLoginToken(token)
            ? seeOther(paths.continue, { next }, [handoffCookie(token, LOGIN_LINK_SECONDS)])
            : seeOther(paths.login, { error: 'CUSTOMER_LOGIN_TOKEN_INVALID', next });
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    });

    const session = guarded(async (request) => {
        const next = returnPath(field(await formOf(request), 'next'));
        const token = cookieValue(request.headers.get('cookie') ?? '', LOGIN_COOKIE);
        const signInAgain = () => seeOther(paths.login, { error: 'CUSTOMER_LOGIN_TOKEN_INVALID', next }, [handoffCookie('', 0)]);
        const retry = (error: SignInNotice) => seeOther(paths.continue, { error, next });
        if (!isLoginToken(token)) return signInAgain();

        try {
            const { cookie, customer } = await exchangeLoginToken(options.client(), token, { clientIp: clientIpOf(request.headers) });
            const email = customerEmailCookie(customer.email, cookie.options.expires);
            return seeOther(next ?? paths.signedIn, {}, [cookie.header, email.header, handoffCookie('', 0)]);
        } catch (error) {
            const code = customerRefusalOf(error)?.code;
            if (code === 'CUSTOMER_LOGIN_TOKEN_INVALID') return signInAgain();
            if (isStatus(error, 429)) return retry('TOO_MANY_REQUESTS');
            if (code === undefined && isStatus(error, 401)) {
                log('[sign-in] core answered 401 without a session code: check the WEBSITE key');
            } else {
                log(`[sign-in] session exchange failed: ${failureOf(error)}`);
            }
            return retry('SIGN_IN_UNAVAILABLE');
        }
    });

    const logout = guarded(async (request) => {
        if (!isOwnNavigation(request)) return seeOther(paths.signedOut, {});
        try {
            await customerFromCookies(options.client(), request.headers.get('cookie'), { clientIp: clientIpOf(request.headers) })?.logout();
        } catch (error) {
            log(`[sign-in] logout failed: ${failureOf(error)}`);
        }
        return seeOther(paths.signedOut, {}, expiredCookieHeaders());
    });

    const expired = guarded((request) => {
        const next = returnPath(new URL(request.url).searchParams.get('next'));
        return seeOther(paths.login, { error: 'CUSTOMER_SESSION_INVALID', next }, isOwnNavigation(request) ? expiredCookieHeaders() : []);
    });

    return { login, callback, session, logout, expired };
}
