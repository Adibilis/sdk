import { DiscountCodeRefusalModel } from '@adbls/api-types';
import type { DiscountCodeRefusal } from '@adbls/api-types';
import { AdibilisApiError } from '../client/errors.js';
import { productAndCurrencyOf } from '../subscription/checkout-refusal.js';
import { amountChangedOf, checkoutExpiredOf, checkoutPaymentInProgressOf, productUnavailableOf } from './checkout-client.js';

export type CheckoutRefusal =
    /** 409: the invoice would total `amount`, not the `expectedAmount` sent. Core voided it; preview again and show the new price. */
    | { code: 'CHECKOUT_AMOUNT_CHANGED'; amount: number }
    /** 409: the reference names an order core expired or cancelled. Mint a new reference. */
    | { code: 'CHECKOUT_EXPIRED' }
    /** 409: a payment for this buyer email is still being processed. Let the buyer try again in a minute. */
    | { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' }
    /** 409: no distributor routed to `country` has the line's product in stock; `country` is null when core's catch-all decided. */
    | { code: 'SHOP_PRODUCT_NOT_AVAILABLE'; productId: number; country: string | null }
    /** 409: the code in the request cannot be redeemed (`reason`); nothing was created. A preview reports the same reason as `discountCodeRefusal` instead. `reason` is `null` for a reason this SDK version does not know. */
    | { code: 'DISCOUNT_CODE_REFUSED'; reason: DiscountCodeRefusal | null }
    /** 409: the line's class date was cancelled by the studio; drop it from the cart and re-read the cancelled dates. */
    | { code: 'BOOKING_DATE_CANCELLED'; productId: number | null; startAt: string | null }
    /** 400: a catalog line's open price is outside the product's range or step. Show the product's own limits and ask again. */
    | { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE'; productId: number }
    /** 404: a catalog line's product is not listed any more. Re-read the catalog. */
    | { code: 'SHOP_PRODUCT_NOT_FOUND' }
    /** 400: a catalog line's product has no price in `currency`. */
    | { code: 'SHOP_PRODUCT_NOT_PRICED'; productId: number; currency: string }
    /** 400: a line marked `delivery` also names a product; a delivery line is a plain charge. */
    | { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' }
    /** 429: this visitor (or, without `clientIp`, the whole shop server) used up its budget of checkout calls or wrong codes. Wait; do not loop. */
    | { code: 'TOO_MANY_REQUESTS' };

/** A product id core sent as a digit-only string, or `null` for anything else. */
function productIdOf(value: unknown): number | null {
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
}

/** Core's refusal of a one-time checkout or preview in a form a shop can act on, or `null` for any other error. */
export function checkoutRefusalOf(error: unknown): CheckoutRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const errorList = (error.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    if (errorList == null || typeof errorList !== 'object') return null;
    if (error.status === 429) return 'TOO_MANY_REQUESTS' in errorList ? { code: 'TOO_MANY_REQUESTS' } : null;
    if (error.status === 404) return 'SHOP_PRODUCT_NOT_FOUND' in errorList ? { code: 'SHOP_PRODUCT_NOT_FOUND' } : null;
    if (error.status === 409) {
        const amount = amountChangedOf(error);
        if (amount !== null) return { code: 'CHECKOUT_AMOUNT_CHANGED', amount };
        if (checkoutExpiredOf(error)) return { code: 'CHECKOUT_EXPIRED' };
        if (checkoutPaymentInProgressOf(error)) return { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' };
        const unavailable = productUnavailableOf(error);
        if (unavailable !== null) return { code: 'SHOP_PRODUCT_NOT_AVAILABLE', ...unavailable };
        const reason = errorList['DISCOUNT_CODE_REFUSED'];
        if (Array.isArray(reason) && typeof reason[0] === 'string' && reason[0] !== '') {
            return { code: 'DISCOUNT_CODE_REFUSED', reason: DiscountCodeRefusalModel.options.find((known) => known === reason[0]) ?? null };
        }
        const cancelled = errorList['BOOKING_DATE_CANCELLED'];
        if (Array.isArray(cancelled)) {
            return {
                code: 'BOOKING_DATE_CANCELLED',
                productId: productIdOf(cancelled[0]),
                startAt: typeof cancelled[1] === 'string' && cancelled[1] !== '' ? cancelled[1] : null,
            };
        }
        return null;
    }
    if (error.status !== 400) return null;
    const notPriced = productAndCurrencyOf(errorList['SHOP_PRODUCT_NOT_PRICED']);
    if (notPriced !== null) return { code: 'SHOP_PRODUCT_NOT_PRICED', ...notPriced };
    const outOfRange = errorList['SHOP_PRODUCT_PRICE_OUT_OF_RANGE'];
    const outOfRangeProductId = Array.isArray(outOfRange) ? productIdOf(outOfRange[0]) : null;
    if (outOfRangeProductId !== null) return { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE', productId: outOfRangeProductId };
    return 'ORDER_DELIVERY_LINE_WITH_PRODUCT' in errorList ? { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' } : null;
}
