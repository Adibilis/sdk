import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';
import { CustomerLoginLinkRequestModel, CustomerSessionRequestModel } from '../subscription/wire.js';
import type { CustomerLoginPurpose, CustomerSessionResponse } from '../subscription/wire.js';
import { languageOf } from './language.js';
import type { CustomerProfile } from './types.js';

export { SESSION_HEADER } from './session-header.js';
/** The cookie that carries the customer's portal session; `customerFromCookies` and `customerSessionFromCookies` read it. */
export const CUSTOMER_SESSION_COOKIE = '__Host-adbl_customer';
/** Core refuses a longer session token without a lookup. */
export const MAX_SESSION_TOKEN_LENGTH = 128;
const SESSION_TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_SESSION_TOKEN_LENGTH}}$`);

/** What `customerFromCookies` reads: Next's `cookies()` and `request.cookies`, or any store with the same `get`. */
export interface CookieReader {
    get(name: string): { value: string } | undefined;
}

export function cookieValue(header: string, name: string): string | undefined {
    let found: string | undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator > 0 && part.slice(0, separator).trim() === name) found = part.slice(separator + 1).trim();
    }
    return found;
}

/**
 * The portal session token in the request's cookie, or `null` without a well-formed one. Makes no request. Pass it as
 * `customerSession` to the product and checkout calls so core prices for this customer; `cookies` is a cookie store
 * (`await cookies()` in Next) or a raw `Cookie` header.
 */
export function customerSessionFromCookies(cookies: CookieReader | string | null | undefined): string | null {
    const raw = typeof cookies === 'string' ? cookieValue(cookies, CUSTOMER_SESSION_COOKIE) : cookies?.get(CUSTOMER_SESSION_COOKIE)?.value;
    const token = raw?.trim();
    return token && SESSION_TOKEN_SHAPE.test(token) ? token : null;
}

/**
 * The cookie the sign-in routes set next to the session, holding the customer's address for "Signed in as" — so a sign-in link
 * sent as a lure shows whose account the visitor is in. Display only: it never authenticates anything.
 */
export const CUSTOMER_EMAIL_COOKIE = '__Host-adbl_customer_email';
const MAX_EMAIL_COOKIE_LENGTH = 255;
const EMAIL_SHAPE = /^[^\s<>"\\\u0000-\u001f\u007f�]+@[^\s<>"\\\u0000-\u001f\u007f�]+$/;

function percentDecoded(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}

/**
 * The signed-in customer's address for "Signed in as", or `null` without a well-formed session cookie or when the value is no
 * address. A raw `Cookie` header is percent-decoded; a cookie store's value is taken as it is, because Next's stores decode it.
 */
export function customerEmailFromCookies(cookies: CookieReader | string | null | undefined): string | null {
    if (customerSessionFromCookies(cookies) === null) return null;
    const value = typeof cookies === 'string' ? percentDecoded(cookieValue(cookies, CUSTOMER_EMAIL_COOKIE)) : cookies?.get(CUSTOMER_EMAIL_COOKIE)?.value;
    return value && value.length <= MAX_EMAIL_COOKIE_LENGTH && EMAIL_SHAPE.test(value) ? value : null;
}

export interface CustomerLoginLinkRequest {
    email: string;
    /**
     * Your callback page, absolute (`https://shop.example/account/callback`). Its origin must be one of core's
     * `SHOP_ALLOWED_ORIGINS` (`RESOURCES_ALLOWED_ORIGINS` with the `'RESOURCES'` purpose); core appends `token` to it.
     */
    returnUrl: string;
    /** The visitor's locale (`de`, `de-CH`, `fr`): the mail is written in German, French, Italian or English, else in the customer's own language. */
    language?: string | null;
    /** Names the shop in the mail; core's organization name when absent. At most 80 characters. */
    shopName?: string | null;
    /**
     * `'RESOURCES'` mails the resources sign-in to any contact, with `returnUrl`'s origin checked against core's
     * `RESOURCES_ALLOWED_ORIGINS`; absent or `'SHOP'` is the shop sign-in.
     */
    purpose?: CustomerLoginPurpose | null;
}

export interface CustomerSessionCookie {
    name: typeof CUSTOMER_SESSION_COOKIE;
    value: string;
    /** For `cookies().set(name, value, options)` in Next, or any cookie API that takes the same options. */
    options: { httpOnly: true; secure: true; sameSite: 'lax'; path: '/'; expires: Date };
    /** The same cookie as a `Set-Cookie` header value, for a server without a cookie API. */
    header: string;
}

export interface CustomerSignIn {
    customer: CustomerProfile;
    /** When the session ends: 30 days after sign-in, not extended by use. */
    expiresAt: string;
    /** Set it on the response, then redirect. It is the session — never send it anywhere else. */
    cookie: CustomerSessionCookie;
}

function isWebUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

const LoginLinkPayloadModel = CustomerLoginLinkRequestModel.superRefine((request, ctx) => {
    if (!isWebUrl(request.returnUrl)) {
        ctx.addIssue({ code: 'custom', path: ['returnUrl'], message: 'returnUrl must be the absolute http(s) URL of your callback page' });
    }
});

function sessionCookie(value: string, expires: Date): CustomerSessionCookie {
    return {
        name: CUSTOMER_SESSION_COOKIE,
        value,
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires },
        header: `${CUSTOMER_SESSION_COOKIE}=${value}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; Secure; SameSite=Lax`,
    };
}

/** The cookie that ends the portal session in the browser: set it on logout, and when core answers `CUSTOMER_SESSION_INVALID`. */
export function expiredCustomerSessionCookie(): CustomerSessionCookie {
    return sessionCookie('', new Date(0));
}

/** The session cookie or the display-email cookie, in the same two forms as `CustomerSessionCookie`. */
export interface SignInCookie {
    name: string;
    /** As the visitor will read it back; a cookie API that takes `options` encodes it on the wire itself. */
    value: string;
    options: CustomerSessionCookie['options'];
    /** The `Set-Cookie` header value, already percent-encoded. */
    header: string;
}

export function customerEmailCookie(email: string, expires: Date): SignInCookie {
    return {
        name: CUSTOMER_EMAIL_COOKIE,
        value: email,
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires },
        header: `${CUSTOMER_EMAIL_COOKIE}=${encodeURIComponent(email)}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; Secure; SameSite=Lax`,
    };
}

/** The session cookie and the display-email cookie, both expired: set them on logout and when the session is dead. */
export function expiredSignInCookies(): SignInCookie[] {
    return [expiredCustomerSessionCookie(), customerEmailCookie('', new Date(0))];
}

/**
 * Asks core to mail the customer a one-time sign-in link to `returnUrl?token=…`, valid 15 minutes. Core answers **202** for every
 * address — a customer's, a stranger's, a staff member's — so the page always says "check your inbox" and never reveals who is
 * a customer. Only a customer with a paid order or subscription gets a mail; a new link replaces the unused older ones.
 *
 * Refused: 400 `SHOP_ORIGIN_NOT_ALLOWED` (`returnUrl` outside core's allowed shop origins — a setup error), 429 beyond 5 links per
 * visitor a minute (or 120 per shop server; 5 an hour per address are dropped silently), 404 `SHOP_MODULE_DISABLED`. With the
 * `'RESOURCES'` purpose: 400 `RESOURCES_ORIGIN_NOT_ALLOWED` (`returnUrl` outside core's `RESOURCES_ALLOWED_ORIGINS`) and
 * 404 `RESOURCES_MODULE_DISABLED` instead.
 */
export async function requestLoginLink(client: AdibilisClient, request: CustomerLoginLinkRequest, options: ShopCallOptions): Promise<void> {
    const headers = shopCallHeaders(options);
    const payload = LoginLinkPayloadModel.parse({
        email: request.email.trim(),
        returnUrl: request.returnUrl,
        language: languageOf(request.language),
        shopName: request.shopName ?? null,
        purpose: request.purpose ?? null,
    });
    await client.post<null>('/api/customer/login-link', payload, { headers });
}

/**
 * Turns the mailed token into a 30-day portal session and returns the cookie that carries it. The link works once: any later
 * exchange — a reload, a second click, the link opened again after a logout — is refused. Call this from a **POST** the continue
 * page sends (as soon as it loads, or on a click), never while answering the GET of the link: mail scanners open links before
 * people do, and a GET that exchanged would spend the link on the scanner. A scanner that runs the page's script can still spend
 * it; the customer then asks for a new link.
 *
 * 401 `CUSTOMER_LOGIN_TOKEN_INVALID` for a used, expired, replaced or unknown link (`customerRefusalOf`): offer a new one.
 * 404 `CUSTOMER_SIGN_IN_DISABLED` once core's shop and resources modules are both off (core 1.9.32 and later).
 * 429 beyond 30 exchanges and logouts per visitor a minute.
 */
export async function exchangeLoginToken(client: AdibilisClient, token: string, options: ShopCallOptions): Promise<CustomerSignIn> {
    const headers = shopCallHeaders(options);
    const payload = CustomerSessionRequestModel.parse({ token: token.trim() });
    const session = await client.post<CustomerSessionResponse>('/api/customer/session', payload, { headers });
    const { firstname, lastname, email } = session.customer;
    return {
        customer: { firstname: firstname ?? null, lastname: lastname ?? null, email },
        expiresAt: session.expiresAt,
        cookie: sessionCookie(session.sessionToken, new Date(session.expiresAt)),
    };
}
