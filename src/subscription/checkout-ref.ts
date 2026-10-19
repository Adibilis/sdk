import { configurationString } from './checkout-client.js';
import type { SubscriptionCheckoutRequest } from './checkout-client.js';
import { normalizePattern } from './schedule.js';

const FINGERPRINT_LENGTH = 16;
const MAX_EXTERNAL_REF_LENGTH = 120;
export const MAX_CART_REF_LENGTH = MAX_EXTERNAL_REF_LENGTH - FINGERPRINT_LENGTH - 1;

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, entry]) => entry !== undefined && entry !== null)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * The `externalRef` for a subscription checkout of this cart: `cartRef` plus a fingerprint of everything the checkout asks for.
 * The same cart gives the same reference, so a retry with another card resumes the open checkout instead of opening a second
 * one; any change — lines, amounts, schedule, start date, configuration, people — gives a new one, because core refuses the old
 * reference with changed terms (409 `SUBSCRIPTION_CHECKOUT_CHANGED`). `returnUrl`, `externalSource` and `expectedAmount` are
 * not part of it. `configuration` counts as the exact string core stores, so build it the same way every time.
 *
 * After a 409 `SUBSCRIPTION_CHECKOUT_EXPIRED` (Stripe dropped an unpaid checkout after 23 hours) the same cart needs a new
 * `cartRef`. Uses Web Crypto (`crypto.subtle`), available in Node 20+ and edge runtimes.
 */
export async function subscriptionCheckoutRef(cartRef: string, request: Omit<SubscriptionCheckoutRequest, 'externalRef'>): Promise<string> {
    const ref = cartRef.trim();
    if (ref.length === 0 || ref.length > MAX_CART_REF_LENGTH) {
        throw new RangeError(`cartRef must be 1 to ${MAX_CART_REF_LENGTH} characters`);
    }
    const {
        externalSource: _source,
        returnUrl: _returnUrl,
        externalRef: _ref,
        preview: _preview,
        expectedAmount: _expected,
        ...terms
    } = request as Omit<SubscriptionCheckoutRequest, 'externalRef'> & { externalRef?: unknown; preview?: unknown; expectedAmount?: unknown };
    const fingerprint = canonicalJson({ ...terms, schedule: normalizePattern(terms.schedule), configuration: configurationString(terms.configuration) });
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${ref}-${hex.slice(0, FINGERPRINT_LENGTH)}`;
}
