import { AdibilisApiError } from '../client/errors.js';

export type SubscriptionCheckoutRefusal =
    /**
     * The first charge is not the `expectedAmount`; nothing was created. Preview again and show the new amount. Core's post-create
     * check stays as a backstop: when it catches a mismatch it cancels the row, and the same reference then gets
     * `SUBSCRIPTION_CHECKOUT_EXPIRED` — start over with a new `cartRef`.
     */
    | { code: 'SUBSCRIPTION_AMOUNT_CHANGED'; amount: number }
    /**
     * The reference was used with other terms. With `subscriptionCheckoutRef` the reference already follows the terms, so this
     * means the plan changed in core and deriving again gives the same reference: start over with a NEW `cartRef`.
     */
    | { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' }
    /** The unpaid checkout behind this reference was dropped (by Stripe, or cancelled by core) and can never be paid. Start over with a NEW `cartRef`. */
    | { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' }
    /**
     * 409: the plan's first delivery cannot be served to this delivery country (a product core sells "stop at 0" is out of stock
     * there); nothing was created, the preview refuses the same way. `country` is null when core had no country to route by.
     */
    | { code: 'SUBSCRIPTION_PLAN_NOT_AVAILABLE'; planId: number; country: string | null }
    /** This reference became a subscription, so it went through: show the success page, do not charge again. */
    | { code: 'SUBSCRIPTION_ALREADY_ACTIVE' }
    /** The chosen start date is not accepted; `earliest` is the first date core would take. */
    | { code: 'SUBSCRIPTION_START_DATE_INVALID'; earliest: string }
    /** 400: core has no dynamic "Subscribe this order" entry enabled. Re-read the catalog; the shop has none to offer. */
    | { code: 'SUBSCRIPTION_DYNAMIC_DISABLED' }
    /** 404: the plan is not listed any more (unlisted or archived since the catalog was read). Re-read the catalog. */
    | { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' }
    /** 400: the start date is not one of the plan's or the dynamic entry's offered start dates; offer `validFirstDeliveryDates` again. */
    | { code: 'SUBSCRIPTION_START_DATE_NOT_ALLOWED' }
    /**
     * 429: this visitor (or the whole shop server) used up its minute. Checkouts allow 10 per visitor a minute, previews included,
     * status reads 60. Wait and retry; do not retry in a loop.
     */
    | { code: 'TOO_MANY_REQUESTS' };

type Violation = { code?: unknown; params?: { earliest?: unknown } };

/** Reads core's `SUBSCRIPTION_PLAN_NOT_AVAILABLE` `[planId, country or ""]`, or `null` when it is absent or malformed. */
export function planUnavailableOf(errorList: Record<string, unknown>): { planId: number; country: string | null } | null {
    const params = errorList['SUBSCRIPTION_PLAN_NOT_AVAILABLE'];
    if (!Array.isArray(params) || typeof params[0] !== 'string' || !/^\d+$/.test(params[0])) return null;
    const country = typeof params[1] === 'string' && params[1] !== '' ? params[1] : null;
    return { planId: Number(params[0]), country };
}

/** Core's refusal of a subscription checkout in a form a shop can act on, or `null` for any other error. */
export function subscriptionCheckoutRefusalOf(error: unknown): SubscriptionCheckoutRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const body = error.body as { errorList?: Record<string, unknown>; violations?: unknown } | null;
    const errorList = body?.errorList ?? {};
    if (error.status === 429) return 'TOO_MANY_REQUESTS' in errorList ? { code: 'TOO_MANY_REQUESTS' } : null;
    if (error.status === 404) return 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' in errorList ? { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' } : null;
    if (error.status === 409) {
        const amount = errorList['SUBSCRIPTION_AMOUNT_CHANGED'];
        if (Array.isArray(amount) && typeof amount[0] === 'string' && amount[0] !== '' && Number.isFinite(Number(amount[0]))) {
            return { code: 'SUBSCRIPTION_AMOUNT_CHANGED', amount: Number(amount[0]) };
        }
        if ('SUBSCRIPTION_CHECKOUT_CHANGED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' };
        if ('SUBSCRIPTION_CHECKOUT_EXPIRED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' };
        const unavailable = planUnavailableOf(errorList);
        if (unavailable !== null) return { code: 'SUBSCRIPTION_PLAN_NOT_AVAILABLE', ...unavailable };
    }
    if (error.status !== 400) return null;
    if ('SUBSCRIPTION_ALREADY_ACTIVE' in errorList) return { code: 'SUBSCRIPTION_ALREADY_ACTIVE' };
    if ('SUBSCRIPTION_DYNAMIC_DISABLED' in errorList) return { code: 'SUBSCRIPTION_DYNAMIC_DISABLED' };
    const violations = Array.isArray(body?.violations) ? (body.violations as Violation[]) : [];
    if (violations.some((violation) => violation.code === 'SUBSCRIPTION_START_DATE_NOT_ALLOWED')) return { code: 'SUBSCRIPTION_START_DATE_NOT_ALLOWED' };
    const earliest = violations.find((violation) => violation.code === 'SUBSCRIPTION_START_DATE_INVALID')?.params?.earliest;
    return typeof earliest === 'string' ? { code: 'SUBSCRIPTION_START_DATE_INVALID', earliest } : null;
}
