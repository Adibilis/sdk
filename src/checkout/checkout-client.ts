import { CheckoutRequestModel } from '@adbls/api-types';
import type { CheckoutRequest, CheckoutResponse, PaymentStatusResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';
import { AdibilisApiError } from '../client/errors.js';

export type { CheckoutRequest, CheckoutResponse, PaymentStatusResponse };

/** `CheckoutRequest` plus the grand total the shop showed — typed here until `@adbls/api-types` carries it. */
export type CheckoutStartRequest = Omit<CheckoutRequest, 'preview'> & {
    /** Core refuses with 409 `CHECKOUT_AMOUNT_CHANGED` when the invoice would total something else. */
    expectedAmount?: number;
};

/**
 * What a preview answers: the totals of a checkout that was never created. Every order field is
 * `null` — there is no order, invoice or client secret yet. `publishableKey` is the Stripe account
 * the currency routes to, which is what Elements in deferred mode needs before any order exists.
 */
export interface CheckoutPreview {
    orderId: null;
    orderNumber: null;
    orderStatus: null;
    clientSecret: null;
    invoiceId: null;
    hostedInvoiceUrl: null;
    invoicePdfUrl: null;
    publishableKey: string;
    /** Grand total in major units (`10.8`, not cents). */
    amount: number;
    taxAmount: number;
    /** The uniform VAT rate in percent, or `null` when the cart mixes rates. */
    vatRate: number | null;
    /** Lower-case ISO code, as Stripe wants it. */
    currency: string;
    preview: true;
}

/**
 * Creates the order in core and opens its Stripe invoice. The response carries everything the
 * browser needs to take the payment — `clientSecret` and `publishableKey` — and nothing it must
 * not have; the WEBSITE key stays on this side.
 *
 * Core is idempotent on `(order.externalSource, order.externalRef)`: sending the same pair again
 * resumes the existing order and its invoice — the new `order` payload is ignored, the stored one
 * is what gets paid — so a declined card followed by a retry never creates a second charge, and a
 * pair whose invoice is already paid is refused. Mint the reference once per cart, and mint a new
 * one when the cart changes.
 *
 * The payload is checked against the generated schema before it leaves the process, so most
 * structural mistakes surface as a `ZodError` here rather than a 400 round-trip. The schema is a
 * subset of core's rules: it accepts whitespace-only strings and a missing `billingPerson`, both
 * of which core still rejects.
 *
 * Optional response fields (`hostedInvoiceUrl`, `invoicePdfUrl`, ...) arrive as JSON `null`, not
 * as absent keys — check for both.
 */
export async function startCheckout(client: AdibilisClient, request: CheckoutStartRequest): Promise<CheckoutResponse> {
    // async so a validation failure is a rejection like every other failure, not a synchronous throw
    // a caller handling only the promise would miss
    const { expectedAmount, ...rest } = request;
    // preview is parsed for the api-types that require it and re-added for those that strip it as unknown
    const payload = {
        ...CheckoutRequestModel.parse({ ...rest, preview: false }),
        preview: false,
        ...(expectedAmount === undefined ? {} : { expectedAmount }),
    };
    return client.post<CheckoutResponse>('/api/payment/checkout', payload);
}

/**
 * Prices the cart exactly as `startCheckout` would invoice it and creates nothing: no order, no
 * contact, no Stripe customer or invoice. Show `amount` as the total, mount Elements in deferred
 * mode with `publishableKey`, `amount` (in minor units) and `currency`, and only on "Pay" call
 * `startCheckout` with `expectedAmount: preview.amount`.
 *
 * Validated and refused like `startCheckout` (same endpoint, same payload), so `returnUrl` is
 * required here too. With automatic tax on, the billing person's address decides the tax.
 */
export async function previewCheckout(client: AdibilisClient, request: Omit<CheckoutRequest, 'preview'>): Promise<CheckoutPreview> {
    const payload = { ...CheckoutRequestModel.parse({ ...request, preview: true }), preview: true };
    return client.post<CheckoutPreview>('/api/payment/checkout', payload);
}

/**
 * The new grand total when `error` is core's refusal of a checkout whose `expectedAmount` no longer
 * matches (409 `CHECKOUT_AMOUNT_CHANGED`), otherwise `null`. Core has already voided the invoice,
 * so refresh the preview, tell the buyer the price changed and let them pay again.
 */
export function amountChangedOf(error: unknown): number | null {
    if (!(error instanceof AdibilisApiError) || error.status !== 409) return null;
    const errorList = (error.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    const param = errorList?.['CHECKOUT_AMOUNT_CHANGED'];
    if (!Array.isArray(param) || param.length === 0) return null;
    const amount = Number(param[0]);
    return Number.isFinite(amount) ? amount : null;
}

/**
 * The order's state as core sees it — `orderStatus` flips to `PAID` when the Stripe webhook has
 * landed, which is the only thing that counts as paid. A success page polls this after the
 * redirect back from Stripe rather than trusting anything the browser saw.
 *
 * Both halves of the key travel as query parameters: a shop's reference is opaque text that may
 * contain a slash, so it cannot be a path segment.
 */
export function getOrderStatus(client: AdibilisClient, externalSource: string, externalRef: string): Promise<PaymentStatusResponse> {
    const query = new URLSearchParams({ externalSource, externalRef });
    return client.get<PaymentStatusResponse>(`/api/payment/order?${query}`);
}
