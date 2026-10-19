import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';
import { CUSTOMER_SESSION_COOKIE, MAX_SESSION_TOKEN_LENGTH } from './session.js';
import type { CustomerPage, CustomerSubscription, CustomerSubscriptionDetail, CustomerTransaction } from './types.js';

const SESSION_HEADER = 'X-Customer-Session';
const SUBSCRIPTION_PATH = '/api/customer/subscription';
const MAX_PAGE_SIZE = 200;

/** What `customerFromCookies` reads: Next's `cookies()` and `request.cookies`, or any store with the same `get`. */
export interface CookieReader {
    get(name: string): { value: string } | undefined;
}

export interface CustomerPageOptions {
    /** Zero-based. */
    page?: number;
    /** 1 to 200; core's default is 20. */
    pageSize?: number;
}

export interface CustomerTransactionQuery extends CustomerPageOptions {
    /** Only this subscription's paid periods (404 when it is not the customer's). */
    subscriptionId?: number;
}

const IdModel = z.number().int().positive();
const PageModel = z.object({
    page: z.number().int().min(0).optional(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
const TransactionQueryModel = PageModel.extend({ subscriptionId: IdModel.optional() });

function subscriptionPath(id: number): string {
    return `${SUBSCRIPTION_PATH}/${IdModel.parse(id)}`;
}

function withQuery(path: string, query: Record<string, number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
    }
    const search = params.toString();
    return search ? `${path}?${search}` : path;
}

function cookieValue(header: string, name: string): string | undefined {
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
    }
    return undefined;
}

/**
 * The signed-in customer's side of core, built per request by `customerFromCookies`. Every call carries the session (header
 * `X-Customer-Session`, never a URL) and the visitor's address; core resolves the customer from the session and answers 404 for
 * any id that is not theirs. The session token lives in a private field: it is not enumerable, not serialised, not logged.
 *
 * Every call: 401 `CUSTOMER_SESSION_INVALID` (expired, revoked, or no longer a customer — sign in again), 404
 * `SHOP_MODULE_DISABLED`, 429 `TOO_MANY_REQUESTS` (reads 60, changes 10, card calls 5 per visitor a minute).
 */
export class CustomerClient {
    readonly #client: AdibilisClient;
    readonly #sessionToken: string;
    readonly #options: ShopCallOptions;

    constructor(client: AdibilisClient, sessionToken: string, options: ShopCallOptions) {
        this.#client = client;
        this.#sessionToken = sessionToken;
        this.#options = options;
    }

    #init(): { headers: Record<string, string> } {
        return { headers: { ...shopCallHeaders(this.#options), [SESSION_HEADER]: this.#sessionToken } };
    }

    /** The subscriptions the customer pays for, newest first; abandoned checkouts are not among them. */
    async listSubscriptions(options: CustomerPageOptions = {}): Promise<CustomerPage<CustomerSubscription>> {
        const init = this.#init();
        return this.#client.get(withQuery(SUBSCRIPTION_PATH, PageModel.parse(options)), init);
    }

    /** One subscription with its upcoming deliveries and the card on file. 404 `SUBSCRIPTION_NOT_FOUND` when it is not theirs. */
    async getSubscription(id: number): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        return this.#client.get(subscriptionPath(id), init);
    }

    /** Paid subscription periods and paid one-time orders, newest first. */
    async listTransactions(query: CustomerTransactionQuery = {}): Promise<CustomerPage<CustomerTransaction>> {
        const init = this.#init();
        return this.#client.get(withQuery('/api/customer/transaction', TransactionQueryModel.parse(query)), init);
    }

    /** Ends the session in core; answers the same for a session that is gone already. Clear the cookie as well, always. */
    async logout(): Promise<void> {
        const init = this.#init();
        await this.#client.delete<null>('/api/customer/session', init);
    }
}

/**
 * The customer behind the request's session cookie, or `null` without one — then send them to your sign-in page. Makes no
 * request: an expired or revoked session shows as 401 `CUSTOMER_SESSION_INVALID` on the first call. `cookies` is a cookie store
 * (`await cookies()` in Next) or a raw `Cookie` header.
 */
export function customerFromCookies(
    client: AdibilisClient,
    cookies: CookieReader | string | null | undefined,
    options: ShopCallOptions
): CustomerClient | null {
    const raw = typeof cookies === 'string' ? cookieValue(cookies, CUSTOMER_SESSION_COOKIE) : cookies?.get(CUSTOMER_SESSION_COOKIE)?.value;
    const token = raw?.trim();
    return token && token.length <= MAX_SESSION_TOKEN_LENGTH ? new CustomerClient(client, token, options) : null;
}
