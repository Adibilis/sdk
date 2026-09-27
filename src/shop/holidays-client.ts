import type { HolidayRangeResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';

/** A closure range from core's shop module; both bounds are inclusive ISO `YYYY-MM-DD` strings. */
export type HolidayRange = HolidayRangeResponse;

export function fetchHolidays(client: AdibilisClient): Promise<HolidayRange[]> {
    return client.get<HolidayRange[]>('/api/shop/holidays');
}

// ISO YYYY-MM-DD strings order lexicographically, so no date library is needed.
export function isHoliday(date: string, ranges: HolidayRange[]): boolean {
    return ranges.some((range) => range.from <= date && date <= range.to);
}
