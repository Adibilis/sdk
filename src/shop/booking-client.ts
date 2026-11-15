import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders, type ShopCallOptions } from '../subscription/checkout-client.js';
import type { BookingDate, BookingDateQuery, CancelledBooking } from './booking-rules.js';

const BookingDateQueryModel = z.object({
    productId: z.number().int().positive().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
});

/**
 * The dates of one listed class or appointment (`productId`), or of every listed one, ordered by start, then product id.
 * `from` and `to` are days (`YYYY-MM-DD`, core's time zone), inclusive. Core lists only dates starting after now and clamps
 * the range to today through 365 days ahead and to each product's booking window, so without them it answers the whole window;
 * a range wholly outside, or with `from` after `to`, answers `[]`, not an error. A class lists at most its first
 * `maxDatesShown` dates of the range, whatever their state. A listed date can be `bookable: false` (past its booking deadline,
 * cancelled or full): show it greyed out, not as a choice. With `options` the call carries `X-Shop-Client-Ip`.
 * An invalid query or address rejects the promise with a ZodError before any request is made.
 */
export async function fetchBookingDates(client: AdibilisClient, query: BookingDateQuery = {}, options?: ShopCallOptions): Promise<BookingDate[]> {
    const checked = BookingDateQueryModel.parse(query);
    const params = new URLSearchParams();
    if (checked.productId !== undefined) params.set('productId', String(checked.productId));
    if (checked.from !== undefined) params.set('from', checked.from);
    if (checked.to !== undefined) params.set('to', checked.to);
    const search = params.toString();
    const path = search === '' ? '/api/shop/booking/dates' : `/api/shop/booking/dates?${search}`;
    if (options === undefined) {
        return client.get<BookingDate[]>(path);
    }
    return client.get<BookingDate[]>(path, { headers: shopCallHeaders(options) });
}

/**
 * The class dates the studio cancelled. With `options` the call carries `X-Shop-Client-Ip`;
 * an invalid address rejects the promise with a ZodError before any request is made.
 *
 * @deprecated Use `fetchBookingDates`: every date carries `cancelled`. This call goes away with core's endpoint.
 */
export async function fetchCancelledBookings(client: AdibilisClient, options?: ShopCallOptions): Promise<CancelledBooking[]> {
    const path = '/api/shop/booking/cancelled';
    if (options === undefined) {
        return client.get<CancelledBooking[]>(path);
    }
    return client.get<CancelledBooking[]>(path, { headers: shopCallHeaders(options) });
}
