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
    /**
     * 409: a line's class or appointment date cannot be booked; `productId` and `startAt` (an instant) name it, both `null` when
     * core's answer carried none. Re-read the dates (`fetchBookingDates`) and let the buyer pick again.
     * `BOOKING_DATE_UNKNOWN`: no such date (off the timetable or outside the booking window);
     * `BOOKING_CLOSED`: its booking deadline (`bookableUntil`) has passed;
     * `BOOKING_DATE_CANCELLED`: the studio cancelled it;
     * `BOOKING_FULL`: fewer places are left than the line asks for.
     */
    | { code: BookingRefusalCode; productId: number | null; startAt: string | null }
    /** 409: the checkout lost a race for the last places of a crowded date; nothing was created. Let the buyer try again. */
    | { code: 'CHECKOUT_CONFLICT' }
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

/** The checkout refusals that name a booked date: core sends the product id and the date's start instant. */
export type BookingRefusalCode = 'BOOKING_DATE_UNKNOWN' | 'BOOKING_CLOSED' | 'BOOKING_DATE_CANCELLED' | 'BOOKING_FULL';

const BOOKING_REFUSAL_CODES: readonly BookingRefusalCode[] = ['BOOKING_DATE_UNKNOWN', 'BOOKING_CLOSED', 'BOOKING_DATE_CANCELLED', 'BOOKING_FULL'];

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
        for (const code of BOOKING_REFUSAL_CODES) {
            const date = errorList[code];
            if (Array.isArray(date)) {
                return { code, productId: productIdOf(date[0]), startAt: typeof date[1] === 'string' && date[1] !== '' ? date[1] : null };
            }
        }
        return 'CHECKOUT_CONFLICT' in errorList ? { code: 'CHECKOUT_CONFLICT' } : null;
    }
    if (error.status !== 400) return null;
    const notPriced = productAndCurrencyOf(errorList['SHOP_PRODUCT_NOT_PRICED']);
    if (notPriced !== null) return { code: 'SHOP_PRODUCT_NOT_PRICED', ...notPriced };
    const outOfRange = errorList['SHOP_PRODUCT_PRICE_OUT_OF_RANGE'];
    const outOfRangeProductId = Array.isArray(outOfRange) ? productIdOf(outOfRange[0]) : null;
    if (outOfRangeProductId !== null) return { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE', productId: outOfRangeProductId };
    return 'ORDER_DELIVERY_LINE_WITH_PRODUCT' in errorList ? { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' } : null;
}
