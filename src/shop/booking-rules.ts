import type { BookingDateResponse } from '@adbls/api-types';
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

// Compile-time check that `BookingDate` keeps core's keys.
type MatchesCore = [Holds<SameKeys<BookingDate, BookingDateResponse>>];
