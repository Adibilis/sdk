import type { CancelledBookingResponse } from '@adbls/api-types';
import type { Holds, SameKeys } from '../customer/types.js';

/** A class date the studio cancelled: the booked product and the start instant, an ISO-8601 timestamp. */
export interface CancelledBooking {
    productId: number;
    startAt: string;
}

/** Compile-time check that `CancelledBooking` keeps core's keys. */
export type CancelledBookingMatchesCore = Holds<SameKeys<CancelledBooking, CancelledBookingResponse>>;

/** True when the studio cancelled this product's class at that instant; an unparsable `startAt` never matches. */
export function isBookingCancelled(productId: number, startAt: string, cancelled: readonly CancelledBooking[]): boolean {
    const instant = Date.parse(startAt);
    if (Number.isNaN(instant)) {
        return false;
    }
    return cancelled.some((entry) => entry.productId === productId && Date.parse(entry.startAt) === instant);
}
