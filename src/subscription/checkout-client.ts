import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { AdibilisApiError } from '../client/errors.js';
import { compareDecimal, formatDecimal, parseDecimal, roundHalfUp } from './decimal.js';
import { dynamicUnitAmount } from './pricing.js';
import { isIsoDate, isWellFormedPattern } from './schedule.js';
import type { SubscriptionCheckoutPreview, SubscriptionCheckoutStarted, SubscriptionCheckoutStatus } from './types.js';
import { SubscriptionCheckoutRequestModel } from './wire.js';
import type { DynamicSubscriptionRequest, SubscriptionCheckoutRequest as WireCheckoutRequest } from './wire.js';

/**
 * A subscription checkout as the shop builds it. `configuration` may be the shop's own object (the SDK serializes it) or a
 * string holding a JSON object; core stores it verbatim and hands it back to the portal.
 */
export type SubscriptionCheckoutRequest = Omit<WireCheckoutRequest, 'preview' | 'expectedAmount' | 'configuration'> & {
    configuration?: Record<string, unknown> | string | null;
};

/** A real checkout always carries the first charge the shop showed — the preview's `amount`. */
export type SubscriptionCheckoutStartRequest = SubscriptionCheckoutRequest & { expectedAmount: number };

export interface ShopCallOptions {
    /** The visitor's IP address as your server saw it: core rate-limits checkouts and status reads per visitor with it. */
    clientIp: string;
}

export const SHOP_CLIENT_IP_HEADER = 'X-Shop-Client-Ip';

const CHECKOUT_PATH = '/api/subscription/checkout';
const CONFLICT_RETRY_DELAY_MS = 250;
const MAX_IP_LENGTH = 45;
const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_CHARS = /^[0-9a-fA-F:][0-9a-fA-F:.]*$/;
const MAPPED_IPV4 = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/;
const MIN_UNIT_AMOUNT = parseDecimal('0.01');

/**
 * The address core will honour in `X-Shop-Client-Ip`, or `null` for one it would ignore. Core accepts only an IPv4 or IPv6
 * literal of at most 45 characters and reads an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`, what a dual-stack Node server
 * reports for an IPv4 visitor) as no IPv6 address at all, so that form is sent as the plain IPv4 address.
 */
export function ipLiteralOf(value: string): string | null {
    const ip = value.trim();
    if (ip.length === 0 || ip.length > MAX_IP_LENGTH) return null;
    if (IPV4.test(ip)) return ip;
    if (!ip.includes(':') || !IPV6_CHARS.test(ip)) return null;
    let host: string;
    try {
        host = new URL(`http://[${ip}]/`).hostname;
    } catch {
        return null;
    }
    const mapped = MAPPED_IPV4.exec(host);
    if (!mapped) return ip;
    const high = parseInt(mapped[1] ?? '0', 16);
    const low = parseInt(mapped[2] ?? '0', 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

const ShopCallOptionsModel = z.object({
    clientIp: z.string().transform((value, ctx) => {
        const ip = ipLiteralOf(value);
        if (ip === null) {
            ctx.addIssue({ code: 'custom', message: "clientIp must be the visitor's IP address (IPv4 or IPv6 literal), not a host name or a forwarded-for list" });
            return z.NEVER;
        }
        return ip;
    }),
});

/** The `X-Shop-Client-Ip` header of a shop call; throws a ZodError for an address core would ignore. */
export function shopCallHeaders(options: ShopCallOptions): Record<string, string> {
    return { [SHOP_CLIENT_IP_HEADER]: ShopCallOptionsModel.parse(options).clientIp };
}

function initOf(options: ShopCallOptions): { headers: Record<string, string> } {
    return { headers: shopCallHeaders(options) };
}

export function isJsonObject(text: string): boolean {
    try {
        const value: unknown = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    } catch {
        return false;
    }
}

/** Core's own checks on a checkout's terms (`SubscriptionCheckoutTerms`), so a mistake is a ZodError here and not a 400. */
function checkTerms(request: WireCheckoutRequest, ctx: z.RefinementCtx): void {
    if ((request.planId == null) === (request.dynamic == null)) {
        ctx.addIssue({ code: 'custom', path: ['planId'], message: 'Send exactly one of planId and dynamic' });
    }
    if (!isWellFormedPattern(request.schedule)) {
        ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'The schedule carries fields its kind does not allow, or misses one it needs' });
    }
    if (request.configuration != null && request.configuration.trim() !== '' && !isJsonObject(request.configuration)) {
        ctx.addIssue({ code: 'custom', path: ['configuration'], message: 'configuration must be a JSON object' });
    }
    if (request.startDate != null && !isIsoDate(request.startDate)) {
        ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'startDate must be an ISO date (YYYY-MM-DD)' });
    }
    if (request.dynamic != null) {
        checkDynamic(request.dynamic, ctx);
    }
}

function checkDynamic(dynamic: DynamicSubscriptionRequest, ctx: z.RefinementCtx): void {
    if (compareDecimal(parseDecimal(dynamic.unitAmount), MIN_UNIT_AMOUNT) < 0) {
        ctx.addIssue({ code: 'custom', path: ['dynamic', 'unitAmount'], message: 'unitAmount must be at least 0.01' });
    }
    const vatRate = parseDecimal(dynamic.vatRate);
    if (dynamic.vatRate < 0 || dynamic.vatRate > 100 || vatRate.scale > 2) {
        ctx.addIssue({ code: 'custom', path: ['dynamic', 'vatRate'], message: 'vatRate must be a percentage from 0 to 100 with at most two decimals' });
    }
    dynamic.lineItems.forEach((line, index) => {
        if (line.productId != null || (line.kind != null && line.kind !== 'EXTERNAL_PRODUCT')) {
            ctx.addIssue({ code: 'custom', path: ['dynamic', 'lineItems', index], message: 'A dynamic subscription repeats EXTERNAL_PRODUCT lines without a productId only' });
        }
    });
    const unit = formatDecimal(roundHalfUp(parseDecimal(dynamic.unitAmount), 2));
    const total = dynamicUnitAmount(dynamic.lineItems);
    if (unit !== total) {
        ctx.addIssue({
            code: 'custom',
            path: ['dynamic', 'unitAmount'],
            message: `unitAmount ${unit} is not the lines' total ${total} (each line rounded half-up to cents, then summed)`,
        });
    }
}

const PreviewPayloadModel = SubscriptionCheckoutRequestModel.superRefine(checkTerms);
const StartPayloadModel = SubscriptionCheckoutRequestModel.extend({ expectedAmount: z.number() }).superRefine(checkTerms);

export function configurationString(configuration: SubscriptionCheckoutRequest['configuration']): string | null | undefined {
    return configuration !== null && typeof configuration === 'object' ? JSON.stringify(configuration) : configuration;
}

function payloadOf(request: SubscriptionCheckoutRequest, preview: boolean): Record<string, unknown> {
    return { ...request, configuration: configurationString(request.configuration), preview };
}

function isRetryableConflict(error: unknown): boolean {
    if (!(error instanceof AdibilisApiError) || error.status !== 409) return false;
    const errorList = (error.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    return errorList != null && 'CONCURRENT_UPDATE_CONFLICT' in errorList;
}

/**
 * Prices a subscription checkout exactly as `startSubscriptionCheckout` would charge its first period, and creates nothing.
 * Show `amount` (and `describeBilling(billingInterval, billingIntervalCount)`), mount Stripe Elements with `publishableKey`,
 * then start with `expectedAmount: preview.amount`. Validated and refused like the real checkout.
 */
export async function previewSubscriptionCheckout(
    client: AdibilisClient,
    request: SubscriptionCheckoutRequest,
    options: ShopCallOptions
): Promise<SubscriptionCheckoutPreview> {
    const init = initOf(options);
    const { expectedAmount: _ignored, ...payload } = PreviewPayloadModel.parse(payloadOf(request, true));
    return client.post<SubscriptionCheckoutPreview>(CHECKOUT_PATH, { ...payload, preview: true }, init);
}

/**
 * Opens the subscription in core and at Stripe and returns the secret the browser confirms: `secretKind` `PAYMENT` →
 * `stripe.confirmPayment` (the first period is charged now), `SETUP` → `stripe.confirmSetup` (a start date was chosen; the card
 * is saved and charged on that date) — see `confirmMethodOf`.
 *
 * Core checks `expectedAmount` before it creates anything: a different first charge is a 409 `SUBSCRIPTION_AMOUNT_CHANGED`
 * (`subscriptionCheckoutRefusalOf`). The same `(externalSource, externalRef)` resumes an unpaid checkout, but only with the same
 * terms — a changed cart needs a new reference (`subscriptionCheckoutRef`), otherwise 409 `SUBSCRIPTION_CHECKOUT_CHANGED`.
 * A 409 `CONCURRENT_UPDATE_CONFLICT` (a database lock lost to a parallel request) is retried once after 250 ms.
 */
export async function startSubscriptionCheckout(
    client: AdibilisClient,
    request: SubscriptionCheckoutStartRequest,
    options: ShopCallOptions
): Promise<SubscriptionCheckoutStarted> {
    const init = initOf(options);
    const payload = { ...StartPayloadModel.parse(payloadOf(request, false)), preview: false };
    try {
        return await client.post<SubscriptionCheckoutStarted>(CHECKOUT_PATH, payload, init);
    } catch (error) {
        if (!isRetryableConflict(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, CONFLICT_RETRY_DELAY_MS));
        return client.post<SubscriptionCheckoutStarted>(CHECKOUT_PATH, payload, init);
    }
}

/**
 * The subscription behind a shop reference, for the return page. While core still says `INCOMPLETE`, `firstPaymentStatus`
 * follows Stripe live: `SUCCEEDED` once the first charge (or, with a start date, the saved card) went through. `status` turns
 * `ACTIVE` only when core's webhook lands. **404** `SUBSCRIPTION_NOT_FOUND` for an unknown reference.
 *
 * A subscription with a trial and a confirmed setup reports `firstPaymentStatus` `SUCCEEDED` and `stripeStatus` `"trialing"`:
 * the card is saved, but no money has moved yet. Word the return page accordingly ("your subscription is set up"), not
 * "payment received".
 */
export async function getSubscriptionStatus(
    client: AdibilisClient,
    externalSource: string,
    externalRef: string,
    options: ShopCallOptions
): Promise<SubscriptionCheckoutStatus> {
    const init = initOf(options);
    const query = new URLSearchParams({ externalSource, externalRef });
    return client.get<SubscriptionCheckoutStatus>(`/api/subscription/status?${query}`, init);
}
