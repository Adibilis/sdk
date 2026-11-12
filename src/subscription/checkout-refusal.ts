import { DiscountCodeRefusalModel } from '@adbls/api-types';
import type { DiscountCodeRefusal } from '@adbls/api-types';
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
    /**
     * The unpaid checkout behind this reference was dropped (expired by core thirty minutes after the buyer last submitted it,
     * dropped by Stripe, or cancelled) and can never be paid. Start over with a NEW `cartRef`.
     */
    | { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' }
    /** 409: a payment for this buyer email is still being processed; nothing was created. Let the buyer try again in a minute. */
    | { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' }
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
    /**
     * 409: the code in the request cannot be redeemed; nothing was created. A preview reports the same reason as
     * `discountCodeRefusal` instead. `reason` is `null` for a reason this SDK version does not know — still a refused code.
     */
    | { code: 'DISCOUNT_CODE_REFUSED'; reason: DiscountCodeRefusal | null }
    /** 404: a catalog line's product is not listed any more. Re-read the catalog. */
    | { code: 'SHOP_PRODUCT_NOT_FOUND' }
    /** 400: a catalog line's product has no price in `currency`. */
    | { code: 'SHOP_PRODUCT_NOT_PRICED'; productId: number; currency: string }
    /** 400: a catalog line's price is not the product's price (or an open price outside its range or step). Show the product's own limits and ask again. */
    | { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE'; productId: number; currency: string }
    /** 400: a line marked `delivery` also names a product; a delivery line is a plain charge. */
    | { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' }
    /** 400: a catalog line's product is priced in the other price mode than the cart's `dynamic.priceMode`. */
    | { code: 'SUBSCRIPTION_DYNAMIC_PRICE_MODE_MISMATCH' }
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

export function productAndCurrencyOf(params: unknown): { productId: number; currency: string } | null {
    if (!Array.isArray(params) || typeof params[0] !== 'string' || !/^\d+$/.test(params[0]) || typeof params[1] !== 'string' || params[1] === '') return null;
    return { productId: Number(params[0]), currency: params[1] };
}

function discountReasonOf(params: unknown): DiscountCodeRefusal | null {
    const reason = Array.isArray(params) ? params[0] : undefined;
    return DiscountCodeRefusalModel.options.find((known) => known === reason) ?? null;
}

/** Core's refusal of a subscription checkout in a form a shop can act on, or `null` for any other error. */
export function subscriptionCheckoutRefusalOf(error: unknown): SubscriptionCheckoutRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const body = error.body as { errorList?: Record<string, unknown>; violations?: unknown } | null;
    const errorList = body?.errorList ?? {};
    if (error.status === 429) return 'TOO_MANY_REQUESTS' in errorList ? { code: 'TOO_MANY_REQUESTS' } : null;
    if (error.status === 404) {
        if ('SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' in errorList) return { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' };
        return 'SHOP_PRODUCT_NOT_FOUND' in errorList ? { code: 'SHOP_PRODUCT_NOT_FOUND' } : null;
    }
    if (error.status === 409) {
        const refused = errorList['DISCOUNT_CODE_REFUSED'];
        if (Array.isArray(refused) && typeof refused[0] === 'string' && refused[0] !== '') {
            return { code: 'DISCOUNT_CODE_REFUSED', reason: discountReasonOf(refused) };
        }
        const amount = errorList['SUBSCRIPTION_AMOUNT_CHANGED'];
        if (Array.isArray(amount) && typeof amount[0] === 'string' && amount[0] !== '' && Number.isFinite(Number(amount[0]))) {
            return { code: 'SUBSCRIPTION_AMOUNT_CHANGED', amount: Number(amount[0]) };
        }
        if ('SUBSCRIPTION_CHECKOUT_CHANGED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' };
        if ('SUBSCRIPTION_CHECKOUT_EXPIRED' in errorList) return { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' };
        if ('CHECKOUT_PAYMENT_IN_PROGRESS' in errorList) return { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' };
        const unavailable = planUnavailableOf(errorList);
        if (unavailable !== null) return { code: 'SUBSCRIPTION_PLAN_NOT_AVAILABLE', ...unavailable };
    }
    if (error.status !== 400) return null;
    if ('SUBSCRIPTION_ALREADY_ACTIVE' in errorList) return { code: 'SUBSCRIPTION_ALREADY_ACTIVE' };
    if ('SUBSCRIPTION_DYNAMIC_DISABLED' in errorList) return { code: 'SUBSCRIPTION_DYNAMIC_DISABLED' };
    if ('ORDER_DELIVERY_LINE_WITH_PRODUCT' in errorList) return { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' };
    if ('SUBSCRIPTION_DYNAMIC_PRICE_MODE_MISMATCH' in errorList) return { code: 'SUBSCRIPTION_DYNAMIC_PRICE_MODE_MISMATCH' };
    const notPriced = productAndCurrencyOf(errorList['SHOP_PRODUCT_NOT_PRICED']);
    if (notPriced !== null) return { code: 'SHOP_PRODUCT_NOT_PRICED', ...notPriced };
    const outOfRange = productAndCurrencyOf(errorList['SHOP_PRODUCT_PRICE_OUT_OF_RANGE']);
    if (outOfRange !== null) return { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE', ...outOfRange };
    const violations = Array.isArray(body?.violations) ? (body.violations as Violation[]) : [];
    if (violations.some((violation) => violation.code === 'SUBSCRIPTION_START_DATE_NOT_ALLOWED')) return { code: 'SUBSCRIPTION_START_DATE_NOT_ALLOWED' };
    const earliest = violations.find((violation) => violation.code === 'SUBSCRIPTION_START_DATE_INVALID')?.params?.earliest;
    return typeof earliest === 'string' ? { code: 'SUBSCRIPTION_START_DATE_INVALID', earliest } : null;
}
