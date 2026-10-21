import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';
import { CustomerLoginLinkRequestModel, CustomerSessionRequestModel } from '../subscription/wire.js';
import type { CorrespondenceLanguage, CustomerSessionResponse } from '../subscription/wire.js';
import type { CustomerProfile } from './types.js';

/** The cookie that carries the customer's portal session; `customerFromCookies` reads it. */
export const CUSTOMER_SESSION_COOKIE = '__Host-adbl_customer';
/** Core refuses a longer session token without a lookup. */
export const MAX_SESSION_TOKEN_LENGTH = 128;

const LANGUAGES: readonly CorrespondenceLanguage[] = ['DE', 'FR', 'IT', 'EN'];
const LOCALE = /^([a-z]{2})(?:[-_][a-z0-9_-]*)?$/i;

export interface CustomerLoginLinkRequest {
    email: string;
    /**
     * Your callback page, absolute (`https://shop.example/account/callback`). Its origin must be one of core's
     * `SHOP_ALLOWED_ORIGINS`; core appends `token` to it.
     */
    returnUrl: string;
    /** The visitor's locale (`de`, `de-CH`, `fr`): the mail is written in German, French, Italian or English, else in the customer's own language. */
    language?: string | null;
    /** Names the shop in the mail; core's organization name when absent. At most 80 characters. */
    shopName?: string | null;
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

function languageOf(locale: string | null | undefined): CorrespondenceLanguage | null {
    const code = LOCALE.exec(locale?.trim() ?? '')?.[1]?.toUpperCase();
    return LANGUAGES.find((language) => language === code) ?? null;
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

/**
 * Asks core to mail the customer a sign-in link to `returnUrl?token=…`, valid 15 minutes and usable as often as it is opened until
 * then. Core answers **202** for every address — a customer's, a stranger's, a staff member's — so the page always says "check
 * your inbox" and never reveals who is a customer. Only a customer with a paid order or subscription gets a mail; a new link
 * replaces the older ones not used yet.
 *
 * Refused: 400 `SHOP_ORIGIN_NOT_ALLOWED` (`returnUrl` outside core's allowed shop origins — a setup error), 429 beyond 5 links per
 * visitor a minute (or 120 per shop server; 5 an hour per address are dropped silently), 404 `SHOP_MODULE_DISABLED`.
 */
export async function requestLoginLink(client: AdibilisClient, request: CustomerLoginLinkRequest, options: ShopCallOptions): Promise<void> {
    const headers = shopCallHeaders(options);
    const payload = LoginLinkPayloadModel.parse({
        email: request.email.trim(),
        returnUrl: request.returnUrl,
        language: languageOf(request.language),
        shopName: request.shopName ?? null,
    });
    await client.post<null>('/api/customer/login-link', payload, { headers });
}

/**
 * Turns the mailed token into a 30-day portal session and returns the cookie that carries it. Core accepts a link every time
 * until it expires, each time with a new session, so a mail scanner that opens it first leaves it working for the customer. Call
 * this from a **POST** the continue page sends as soon as it loads, never while answering the GET of the link: the token is
 * then out of the address bar and the history before core sees it.
 *
 * 401 `CUSTOMER_LOGIN_TOKEN_INVALID` for an expired, replaced or unknown link (`customerRefusalOf`): offer a new one.
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
