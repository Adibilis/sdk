import { CheckoutRequestModel } from '@adbls/api-types';
import type { CheckoutRequest, CheckoutResponse, PaymentStatusResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';

export type { CheckoutRequest, CheckoutResponse, PaymentStatusResponse };

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
export async function startCheckout(client: AdibilisClient, request: CheckoutRequest): Promise<CheckoutResponse> {
    // async so a validation failure is a rejection like every other failure, not a synchronous throw
    // a caller handling only the promise would miss
    const payload = CheckoutRequestModel.parse(request);
    return client.post<CheckoutResponse>('/api/payment/checkout', payload);
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
