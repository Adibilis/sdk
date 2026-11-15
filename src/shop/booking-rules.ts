import type { BookingDateResponse, CancelledBookingResponse } from '@adbls/api-types';
import type { Holds, SameKeys } from '../customer/types.js';

/**
 * A date of a listed class or appointment. `startAt`, `endAt`, `bookableUntil` (the booking deadline) and `cancellableUntil`
 * (the customer's cancelling deadline) are ISO-8601 instants. `bookable` is core's verdict at the time of the call: before the
 * booking deadline, not `cancelled` and with `placesLeft` above zero.
 */
export interface BookingDate {
    productId: number;
    startAt: string;
    endAt: string;
    bookableUntil: string;
    cancellableUntil: string;
    cancelled: boolean;
    placesLeft: number;
    bookable: boolean;
}

/** Which dates `fetchBookingDates` lists: one product's (or every listed one's), from and to a day (`YYYY-MM-DD`), inclusive. */
export interface BookingDateQuery {
    productId?: number;
    from?: string;
    to?: string;
}

/**
 * A class date the studio cancelled: the booked product and the start instant, an ISO-8601 timestamp.
 *
 * @deprecated Read `cancelled` on a `BookingDate` (`fetchBookingDates`). This type goes away with core's endpoint.
 */
export interface CancelledBooking {
    productId: number;
    startAt: string;
}

// Compile-time check that `BookingDate` and `CancelledBooking` keep core's keys.
type MatchesCore = [Holds<SameKeys<BookingDate, BookingDateResponse>>, Holds<SameKeys<CancelledBooking, CancelledBookingResponse>>];

/**
 * True when the studio cancelled this product's class at that instant; an unparsable `startAt` never matches.
 *
 * @deprecated Read `cancelled` on a `BookingDate` (`fetchBookingDates`). This helper goes away with core's endpoint.
 */
export function isBookingCancelled(productId: number, startAt: string, cancelled: readonly CancelledBooking[]): boolean {
    const instant = Date.parse(startAt);
    if (Number.isNaN(instant)) {
        return false;
    }
    return cancelled.some((entry) => entry.productId === productId && Date.parse(entry.startAt) === instant);
}
