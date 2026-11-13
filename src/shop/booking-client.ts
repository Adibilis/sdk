import type { AdibilisClient } from '../client/api-client.js';
import { shopCallHeaders, type ShopCallOptions } from '../subscription/checkout-client.js';
import type { CancelledBooking } from './booking-rules.js';

/**
 * The class dates the studio cancelled. With `options` the call carries `X-Shop-Client-Ip`;
 * an invalid address rejects the promise with a ZodError before any request is made.
 */
export async function fetchCancelledBookings(client: AdibilisClient, options?: ShopCallOptions): Promise<CancelledBooking[]> {
    const path = '/api/shop/booking/cancelled';
    if (options === undefined) {
        return client.get<CancelledBooking[]>(path);
    }
    return client.get<CancelledBooking[]>(path, { headers: shopCallHeaders(options) });
}
