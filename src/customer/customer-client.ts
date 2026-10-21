import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { configurationString, isJsonObject, shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';
import { parseDecimal } from '../subscription/decimal.js';
import { isIsoDate, isWellFormedPattern } from '../subscription/schedule.js';
import {
    CustomerCancelRequestModel,
    CustomerConfigurationRequestModel,
    CustomerDeliveryPersonChangeRequestModel,
    CustomerPauseRequestModel,
    CustomerPaymentMethodRequestModel,
    CustomerPlanChangeRequestModel,
    CustomerScheduleRequestModel,
} from '../subscription/wire.js';
import type { CustomerDeliveryPersonRequest, SchedulePattern } from '../subscription/wire.js';
import { CUSTOMER_SESSION_COOKIE, MAX_SESSION_TOKEN_LENGTH } from './session.js';
import { AdibilisApiError } from '../client/errors.js';
import type {
    CustomerInvoicePdf,
    CustomerPage,
    CustomerPaymentMethodSetup,
    CustomerPaymentMethodUpdate,
    CustomerSubscription,
    CustomerSubscriptionDetail,
    CustomerTransaction,
} from './types.js';

const SESSION_HEADER = 'X-Customer-Session';
const SUBSCRIPTION_PATH = '/api/customer/subscription';
const MAX_PAGE_SIZE = 200;
const SESSION_TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_SESSION_TOKEN_LENGTH}}$`);
const PDF = 'application/pdf';

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

/** Who receives the deliveries from now on; matched to an existing contact or created, the billing person is never changed. */
export type CustomerDeliveryPerson = CustomerDeliveryPersonRequest;

export interface CustomerConfigurationChange {
    /** Your configuration object (the SDK serializes it) or a JSON-object string; `null` or absent keeps the stored one. */
    configuration?: Record<string, unknown> | string | null;
    /** What orders, mails and the ERP show, at most 500 characters; always replaced. */
    configurationText: string;
    /**
     * A dynamic subscription's new price per delivery — `Number(dynamicUnitAmount(lines))` of the changed configuration; core
     * re-prices the period at the same interval and prorates the difference. Ignored on a plan-based subscription.
     */
    unitAmount?: number | null;
}

export interface CustomerSubscriptionChanges {
    planId?: number;
    schedule?: SchedulePattern;
    configuration?: CustomerConfigurationChange;
    deliveryPerson?: CustomerDeliveryPerson;
}

export type CustomerSubscriptionChangePart = 'plan' | 'schedule' | 'configuration' | 'deliveryPerson';

/**
 * `updateSubscription` stopped at `failed` (`cause` is the error of that call; `customerRefusalOf` reads it when core answered).
 * The parts in `applied` are in effect; `detail` is the subscription after the last of them, `null` when none was.
 *
 * `outcome` says what is known about `failed` itself:
 * - `'refused'`: core answered 400, 404 or 409, except `CONCURRENT_UPDATE_CONFLICT` and `PAYMENT_PROVIDER_ERROR` — the part is
 *   not in effect.
 * - `'unknown'`: anything else — `CONCURRENT_UPDATE_CONFLICT` (Stripe has the change), `PAYMENT_PROVIDER_ERROR` (a Stripe
 *   timeout or connection error; Stripe may have applied it), a 5xx or proxy answer (504 and the like), a network error or timeout. The part may be in effect: re-read the subscription before showing it as failed or offering
 *   the change again.
 */
export class SubscriptionUpdateError extends Error {
    override readonly name = 'SubscriptionUpdateError';
    readonly outcome: 'refused' | 'unknown';

    constructor(
        readonly failed: CustomerSubscriptionChangePart,
        readonly applied: CustomerSubscriptionChangePart[],
        readonly detail: CustomerSubscriptionDetail | null,
        override readonly cause: unknown
    ) {
        super(`Subscription update stopped at ${failed}${applied.length > 0 ? ` after ${applied.join(', ')}` : ''}`);
        this.outcome = isRefusal(cause) ? 'refused' : 'unknown';
    }
}

function isRefusal(cause: unknown): boolean {
    if (!(cause instanceof AdibilisApiError) || ![400, 404, 409].includes(cause.status)) return false;
    const errorList = (cause.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    if (errorList == null || typeof errorList !== 'object') return true;
    return !('CONCURRENT_UPDATE_CONFLICT' in errorList || 'PAYMENT_PROVIDER_ERROR' in errorList);
}

interface PortalRequest {
    path: string;
    body: unknown;
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
    let found: string | undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator > 0 && part.slice(0, separator).trim() === name) found = part.slice(separator + 1).trim();
    }
    return found;
}

function filenameOf(disposition: string | null): string | null {
    const extended = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(disposition ?? '')?.[1];
    if (extended !== undefined) {
        try {
            return decodeURIComponent(extended);
        } catch {
            // a malformed escape: fall back to the plain parameter
        }
    }
    const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(disposition ?? '')?.[1];
    if (quoted !== undefined) return quoted.replace(/\\(.)/g, '$1');
    return /filename\s*=\s*([^;\s"]+)/i.exec(disposition ?? '')?.[1] ?? null;
}

function invoicePdfOf(response: Response, invoiceId: number): CustomerInvoicePdf {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.split(';')[0]?.trim().toLowerCase() !== PDF) {
        void response.body?.cancel();
        throw new Error(`Core answered ${contentType || 'without a content type'} for invoice ${invoiceId}, not a PDF`);
    }
    const disposition = response.headers.get('content-disposition');
    const filename = filenameOf(disposition) ?? `${invoiceId}.pdf`;
    return {
        body: response.body ?? new Blob().stream(),
        contentType: PDF,
        filename,
        headers: {
            'Content-Type': PDF,
            'Content-Disposition': disposition ?? `inline; filename="${invoiceId}.pdf"`,
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': "default-src 'none'",
            'X-Content-Type-Options': 'nosniff',
        },
    };
}

const MIN_UNIT_AMOUNT = 0.01;
const PlanChangeModel = CustomerPlanChangeRequestModel.extend({ planId: IdModel });
const ScheduleChangeModel = CustomerScheduleRequestModel.superRefine((request, ctx) => {
    if (!isWellFormedPattern(request.schedule)) {
        ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'The schedule carries fields its kind does not allow, or misses one it needs' });
    }
});
const ConfigurationChangeModel = CustomerConfigurationRequestModel.superRefine((request, ctx) => {
    if (request.configuration != null && request.configuration.trim() !== '' && !isJsonObject(request.configuration)) {
        ctx.addIssue({ code: 'custom', path: ['configuration'], message: 'configuration must be a JSON object' });
    }
    if (request.unitAmount != null && (request.unitAmount < MIN_UNIT_AMOUNT || parseDecimal(request.unitAmount).scale > 2)) {
        ctx.addIssue({ code: 'custom', path: ['unitAmount'], message: 'unitAmount must be at least 0.01, with at most two decimals' });
    }
});
const PauseModel = CustomerPauseRequestModel.superRefine((request, ctx) => {
    if (!isIsoDate(request.resumesAt)) {
        ctx.addIssue({ code: 'custom', path: ['resumesAt'], message: 'resumesAt must be an ISO date (YYYY-MM-DD)' });
    }
});

function planChange(id: number, planId: number): PortalRequest {
    return { path: `${subscriptionPath(id)}/plan`, body: PlanChangeModel.parse({ planId }) };
}

function scheduleChange(id: number, schedule: SchedulePattern): PortalRequest {
    return { path: `${subscriptionPath(id)}/schedule`, body: ScheduleChangeModel.parse({ schedule }) };
}

function configurationChange(id: number, change: CustomerConfigurationChange): PortalRequest {
    const body = ConfigurationChangeModel.parse({ ...change, configuration: configurationString(change.configuration) });
    return { path: `${subscriptionPath(id)}/configuration`, body };
}

function deliveryPersonChange(id: number, deliveryPerson: CustomerDeliveryPerson): PortalRequest {
    return { path: `${subscriptionPath(id)}/delivery-person`, body: CustomerDeliveryPersonChangeRequestModel.parse({ deliveryPerson }) };
}

/**
 * The signed-in customer's side of core, built per request by `customerFromCookies`. Every call carries the session (header
 * `X-Customer-Session`, never a URL) and the visitor's address; core resolves the customer from the session and answers 404 for
 * any id that is not theirs. The session token lives in a private field: it is not enumerable, not serialised, not logged.
 *
 * Every call: 401 `CUSTOMER_SESSION_INVALID` (expired, revoked, or no longer a customer — sign in again), 404
 * `SHOP_MODULE_DISABLED`, 429 `TOO_MANY_REQUESTS` (reads 60, changes 10, invoice PDFs 10, card calls 5 per visitor a minute).
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

    #init(): { headers: Record<string, string>; cache: 'no-store' } {
        return { headers: { ...shopCallHeaders(this.#options), [SESSION_HEADER]: this.#sessionToken }, cache: 'no-store' };
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

    /**
     * The PDF of core's invoice behind a transaction row (`transaction.invoiceId`), for a route of the shop to stream to the
     * browser; core keeps no public URL for it. Never cached: the answer carries `Cache-Control: private, no-store`. 404
     * `INVOICE_NOT_FOUND` for an invoice that is not in the customer's own transactions (another customer's answers the same),
     * 429 beyond 10 PDFs per visitor a minute. Rejects with an `Error` when core answers 200 with something other than a PDF.
     */
    async invoicePdf(invoiceId: number): Promise<CustomerInvoicePdf> {
        const init = this.#init();
        const id = IdModel.parse(invoiceId);
        const response = await this.#client.download(`/api/customer/invoice/${id}/pdf`, {
            ...init,
            headers: { ...init.headers, Accept: `${PDF}, application/json` },
        });
        return invoicePdfOf(response, id);
    }

    /**
     * Moves a plan-based subscription to another listed plan of the same billing interval and currency (`plansForChange`); Stripe
     * prorates the difference onto the next invoice, and a plan with a fixed rhythm brings its own schedule. Answers the
     * subscription as it is now, like every change below. 404 `SHOP_SUBSCRIPTION_PLAN_NOT_FOUND`, 400
     * `SUBSCRIPTION_BILLING_INTERVAL_CHANGE` / `SUBSCRIPTION_SCHEDULE_NOT_ALLOWED`, 409 `SUBSCRIPTION_ACTION_NOT_ALLOWED` (`DYNAMIC`).
     */
    async changePlan(id: number, planId: number): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const { path, body } = planChange(id, planId);
        return this.#client.patch(path, body, init);
    }

    /**
     * A new delivery rhythm within `scheduleDefinition`; planned deliveries are re-planned from today, ordered ones stay. On a
     * dynamic subscription the period price follows the number of weekdays and the billing interval may not change. 400
     * `SUBSCRIPTION_SCHEDULE_NOT_ALLOWED` / `SUBSCRIPTION_BILLING_INTERVAL_CHANGE` — `scheduleChangeOf` answers both beforehand.
     */
    async changeSchedule(id: number, schedule: SchedulePattern): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const { path, body } = scheduleChange(id, schedule);
        return this.#client.patch(path, body, init);
    }

    /** The shop's configuration again, and on a dynamic subscription its new price per delivery. 400 `SUBSCRIPTION_CONFIGURATION_INVALID`. */
    async changeConfiguration(id: number, change: CustomerConfigurationChange): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const { path, body } = configurationChange(id, change);
        return this.#client.patch(path, body, init);
    }

    /** Who receives the deliveries. A delivered subscription needs an address with a country (400 `SUBSCRIPTION_DELIVERY_ADDRESS_REQUIRED`). */
    async changeDeliveryPerson(id: number, deliveryPerson: CustomerDeliveryPerson): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const { path, body } = deliveryPersonChange(id, deliveryPerson);
        return this.#client.patch(path, body, init);
    }

    /**
     * Several changes in one go, sent one after another in core's order — plan, schedule, configuration, delivery person — after
     * every part was checked locally. Core applies each on its own: when it refuses one, the call rejects with a
     * `SubscriptionUpdateError` naming what was applied before. Prefer the single `change…` calls where a form changes one thing.
     */
    async updateSubscription(id: number, changes: CustomerSubscriptionChanges): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const requests: [CustomerSubscriptionChangePart, PortalRequest][] = [];
        if (changes.planId !== undefined) requests.push(['plan', planChange(id, changes.planId)]);
        if (changes.schedule !== undefined) requests.push(['schedule', scheduleChange(id, changes.schedule)]);
        if (changes.configuration !== undefined) requests.push(['configuration', configurationChange(id, changes.configuration)]);
        if (changes.deliveryPerson !== undefined) requests.push(['deliveryPerson', deliveryPersonChange(id, changes.deliveryPerson)]);
        if (requests.length === 0) throw new RangeError('updateSubscription needs at least one change');
        const applied: CustomerSubscriptionChangePart[] = [];
        let detail: CustomerSubscriptionDetail | null = null;
        for (const [part, { path, body }] of requests) {
            try {
                detail = await this.#client.patch<CustomerSubscriptionDetail>(path, body, init);
            } catch (error) {
                throw new SubscriptionUpdateError(part, [...applied], detail, error);
            }
            applied.push(part);
        }
        return detail as CustomerSubscriptionDetail;
    }

    /**
     * `atPeriodEnd: true` ends the subscription when the paid period ends (deliveries continue until then; `reactivate` takes it
     * back); `false` ends it now (planned deliveries are cancelled, ordered ones still arrive).
     */
    async cancel(id: number, options: { atPeriodEnd: boolean }): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const body = CustomerCancelRequestModel.parse({ atPeriodEnd: options.atPeriodEnd });
        return this.#client.post(`${subscriptionPath(id)}/cancel`, body, init);
    }

    /** "Keep my subscription": withdraws a cancellation at period end. 409 `SUBSCRIPTION_ACTION_NOT_ALLOWED` (`NOT_CANCELLING`). */
    async reactivate(id: number): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        return this.#client.post(`${subscriptionPath(id)}/reactivate`, undefined, init);
    }

    /**
     * Pauses billing and deliveries until `resumesAt` (`YYYY-MM-DD`, tomorrow to 365 days ahead in core's time zone —
     * `resumeDateRange(todayIn())`); the deliveries before it are skipped. 400 `SUBSCRIPTION_PAUSE_DATE_INVALID` (with `latest`),
     * 409 `SUBSCRIPTION_ACTION_NOT_ALLOWED` (`CANCELLING`, `PAST_DUE`).
     */
    async pause(id: number, options: { resumesAt: string }): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        const body = PauseModel.parse({ resumesAt: options.resumesAt });
        return this.#client.post(`${subscriptionPath(id)}/pause`, body, init);
    }

    /** Ends a pause now; the deliveries the pause skipped come back. 409 `SUBSCRIPTION_ACTION_NOT_ALLOWED` (`NOT_PAUSED`). */
    async resume(id: number): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        return this.#client.post(`${subscriptionPath(id)}/resume`, undefined, init);
    }

    /** Skips one upcoming delivery while its `skippable` is true. 409 `SUBSCRIPTION_DELIVERY_NOT_SKIPPABLE`, 404 `SUBSCRIPTION_DELIVERY_NOT_FOUND`. */
    async skipDelivery(id: number, deliveryId: number): Promise<CustomerSubscriptionDetail> {
        const init = this.#init();
        return this.#client.post(`${subscriptionPath(id)}/delivery/${IdModel.parse(deliveryId)}/skip`, undefined, init);
    }

    /**
     * Opens a card change: a Stripe SetupIntent on the subscription's account for the browser's Payment Element, which confirms
     * it with `stripe.confirmSetup`. Call it when the customer clicks "Change card", not on page load: 10 per customer an hour,
     * 5 card calls per visitor a minute (429 `TOO_MANY_REQUESTS` beyond either). 409 `SUBSCRIPTION_PAYMENT_METHOD_UNAVAILABLE`
     * when the subscription has no card to change.
     */
    async beginPaymentMethodUpdate(id: number): Promise<CustomerPaymentMethodSetup> {
        const init = this.#init();
        return this.#client.post(`${subscriptionPath(id)}/payment-method`, undefined, init);
    }

    /**
     * After `stripe.confirmSetup` succeeded: core re-reads the SetupIntent at Stripe, makes its card the subscription's, and on a
     * past-due subscription retries the unpaid invoices. `setupIntentId` is the intent's id (`seti_...`), never its client secret.
     * 400 `SUBSCRIPTION_SETUP_INTENT_INVALID` for an intent that is not confirmed or not this subscription's. Never retried.
     * 400 `PAYMENT_PROVIDER_ERROR` does not guarantee the card is unchanged: Stripe may have applied part of the change before
     * it failed, so re-read the subscription (`paymentMethod`) before telling the customer the old card is still on file.
     *
     * The new card is saved in every case below; `retry` only says what happened to the overdue invoices:
     * - `NOT_NEEDED`: nothing was overdue. Show "card updated".
     * - `PAID`: the overdue charge went through. Show "card updated and payment received"; the subscription status follows
     *   within moments, so refetch it rather than assuming `ACTIVE`.
     * - `PROCESSING`: Stripe is still settling the charge. Show "payment is being processed" and refetch the subscription later.
     * - `DECLINED`: the new card was refused for the overdue invoice. Show the failure and offer `hostedInvoiceUrl` so the
     *   customer can pay on Stripe's page or try another card.
     * - `UNCONFIRMED`: the card is saved but the charge outcome is unknown. Do not claim success or failure; offer
     *   `hostedInvoiceUrl` to check or pay, and refetch the subscription.
     */
    async confirmPaymentMethod(id: number, setupIntentId: string): Promise<CustomerPaymentMethodUpdate> {
        const init = this.#init();
        const path = `${subscriptionPath(id)}/payment-method`;
        return this.#client.patch(path, CustomerPaymentMethodRequestModel.parse({ setupIntentId }), init);
    }

    /**
     * Ends the session in core; answers the same for a session that is gone already. Clear the cookie as well, always. It can
     * still be refused: 404 `SHOP_MODULE_DISABLED`, 429 `TOO_MANY_REQUESTS` (shared with sign-ins, 30 per visitor a minute) —
     * clear the cookie anyway.
     */
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
    return token && SESSION_TOKEN_SHAPE.test(token) ? new CustomerClient(client, token, options) : null;
}
