import { fromEpochDay, nextOccurrence, occurrences, toEpochDay } from './schedule.js';
import type { SchedulePattern } from './wire.js';

/** Core refuses a start date further out than this (`SubscriptionCheckoutTerms.START_DATE_HORIZON_DAYS`). */
export const START_DATE_HORIZON_DAYS = 365;

export interface DeliveryTerms {
    leadTimeDays: number;
    allowStartDateChoice: boolean;
}

/**
 * The first delivery of a subscription started now (no start date): the first scheduled day on or after `today + leadTimeDays`.
 * This is the `firstDeliveryAt` core answers. `null` when the pattern yields nothing within two years.
 *
 * `today` is core's date, not the server's: pass `todayIn()` unless core runs with another `app.time-zone`.
 */
export function firstDeliveryDate(terms: Pick<DeliveryTerms, 'leadTimeDays'>, pattern: SchedulePattern, today: string): string | null {
    return nextOccurrence(pattern, today, fromEpochDay(toEpochDay(today) + terms.leadTimeDays));
}

/**
 * Every start date core accepts for `pattern`, in order: scheduled days from `max(today + leadTimeDays, tomorrow)` up to
 * `today + 365`. Never today — "start now" is a checkout without a start date. Empty when the plan (or the dynamic entry) does
 * not let the customer choose. A chosen date restarts a weekly N-week cycle, so every matching weekday qualifies.
 */
export function validFirstDeliveryDates(terms: DeliveryTerms, pattern: SchedulePattern, today: string): string[] {
    if (!terms.allowStartDateChoice) return [];
    const todayDay = toEpochDay(today);
    const result: string[] = [];
    for (let day = Math.max(todayDay + terms.leadTimeDays, todayDay + 1); day <= todayDay + START_DATE_HORIZON_DAYS; day++) {
        const date = fromEpochDay(day);
        if (occurrences(pattern, date, date, fromEpochDay(day + 1)).length === 1) result.push(date);
    }
    return result;
}

/**
 * Today's ISO date in `timeZone`. The zone defaults to `Europe/Zurich`: pass core's zone when the instance sets
 * `app.time-zone` to anything else, or the date is wrong for a few hours every day.
 */
export function todayIn(timeZone = 'Europe/Zurich', now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
