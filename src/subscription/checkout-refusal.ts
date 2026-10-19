import { AdibilisApiError } from '../client/errors.js';

export type SubscriptionCheckoutRefusal =
    /** The first charge is not the `expectedAmount`; nothing was created. Preview again and show the new amount. */
    | { code: 'SUBSCRIPTION_AMOUNT_CHANGED'; amount: number }
    /** The reference was used with other terms. Derive a new one (`subscriptionCheckoutRef`) and start again. */
    | { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' }
    /** Stripe dropped the unpaid checkout behind this reference; it can never be paid. Start over with a new cart reference. */
    | { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' }
    /** This reference already became a subscription — show the success page, do not charge again. */
    | { code: 'SUBSCRIPTION_ALREADY_ACTIVE' }
    /** The chosen start date is not accepted; `earliest` is the first date core would take. */
    | { code: 'SUBSCRIPTION_START_DATE_INVALID'; earliest: string };

/** Core's refusal of a subscription checkout in a form a shop can act on, or `null` for any other error. */
export function subscriptionCheckoutRefusalOf(error: unknown): SubscriptionCheckoutRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const body = error.body as { errorList?: Record<string, unknown>; violations?: unknown } | null;
    const errorList = body?.errorList ?? {};
    if (error.status === 409) {
        const amount = errorList['SUBSCRIPTION_AMOUNT_CHANGED'];
        if (Array.isArray(amount) && typeof amount[0] === 'string' && amount[0] !== '' && Number.isFinite(Number(amount[0]))) {
            return { code: 'SUBSCRIPTION_AMOUNT_CHANGED', amount: Number(amount[0]) };
        }
        if ('SUBSCRIPTION_CHECKOUT_CHANGED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' };
        if ('SUBSCRIPTION_CHECKOUT_EXPIRED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' };
    }
    if (error.status !== 400) return null;
    if ('SUBSCRIPTION_ALREADY_ACTIVE' in errorList) return { code: 'SUBSCRIPTION_ALREADY_ACTIVE' };
    const violations = Array.isArray(body?.violations) ? (body.violations as Array<{ code?: unknown; params?: { earliest?: unknown } }>) : [];
    const earliest = violations.find((violation) => violation.code === 'SUBSCRIPTION_START_DATE_INVALID')?.params?.earliest;
    return typeof earliest === 'string' ? { code: 'SUBSCRIPTION_START_DATE_INVALID', earliest } : null;
}
