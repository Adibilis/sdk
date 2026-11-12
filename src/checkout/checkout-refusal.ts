import type { DiscountCodeRefusal } from '@adbls/api-types';
import { AdibilisApiError } from '../client/errors.js';
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
    /** 409: the code in the request cannot be redeemed (`reason`); nothing was created. A preview reports the same reason as `discountCodeRefusal` instead. */
    | { code: 'DISCOUNT_CODE_REFUSED'; reason: DiscountCodeRefusal }
    /** 400: a catalog line's open price is outside the product's range or step. Show the product's own limits and ask again. */
    | { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE'; productId: number }
    /** 400: a line marked `delivery` also names a product; a delivery line is a plain charge. */
    | { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' };

/** Core's refusal of a one-time checkout or preview in a form a shop can act on, or `null` for any other error. */
export function checkoutRefusalOf(error: unknown): CheckoutRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const errorList = (error.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    if (errorList == null || typeof errorList !== 'object') return null;
    if (error.status === 409) {
        const amount = amountChangedOf(error);
        if (amount !== null) return { code: 'CHECKOUT_AMOUNT_CHANGED', amount };
        if (checkoutExpiredOf(error)) return { code: 'CHECKOUT_EXPIRED' };
        if (checkoutPaymentInProgressOf(error)) return { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' };
        const unavailable = productUnavailableOf(error);
        if (unavailable !== null) return { code: 'SHOP_PRODUCT_NOT_AVAILABLE', ...unavailable };
        const reason = errorList['DISCOUNT_CODE_REFUSED'];
        if (Array.isArray(reason) && typeof reason[0] === 'string' && reason[0] !== '') {
            return { code: 'DISCOUNT_CODE_REFUSED', reason: reason[0] as DiscountCodeRefusal };
        }
        return null;
    }
    if (error.status !== 400) return null;
    const outOfRange = errorList['SHOP_PRODUCT_PRICE_OUT_OF_RANGE'];
    if (Array.isArray(outOfRange) && typeof outOfRange[0] === 'string' && /^\d+$/.test(outOfRange[0])) {
        return { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE', productId: Number(outOfRange[0]) };
    }
    return 'ORDER_DELIVERY_LINE_WITH_PRODUCT' in errorList ? { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' } : null;
}
