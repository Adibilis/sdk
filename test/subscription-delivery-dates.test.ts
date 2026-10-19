import { describe, expect, it } from 'vitest';
import { firstDeliveryDate, todayIn, validFirstDeliveryDates } from '../src/subscription/delivery-dates';
import type { SchedulePattern } from '../src/subscription/wire';

const tueFri: SchedulePattern = { kind: 'WEEKLY', weekdays: ['TUE', 'FRI'], everyNWeeks: 1 };
const chooser = (leadTimeDays: number) => ({ leadTimeDays, allowStartDateChoice: true });

describe('firstDeliveryDate (a checkout without a start date)', () => {
    it('is the first scheduled day after the lead time', () => {
        expect(firstDeliveryDate({ leadTimeDays: 0 }, tueFri, '2026-10-14')).toBe('2026-10-16');
        expect(firstDeliveryDate({ leadTimeDays: 3 }, tueFri, '2026-10-14')).toBe('2026-10-20');
        expect(firstDeliveryDate({ leadTimeDays: 0 }, { kind: 'MONTHLY', dayOfMonth: 1 }, '2026-10-14')).toBe('2026-11-01');
    });

    it('can be today when the lead time is zero', () => {
        expect(firstDeliveryDate({ leadTimeDays: 0 }, tueFri, '2026-10-13')).toBe('2026-10-13');
    });
});

describe('validFirstDeliveryDates (a chosen start date)', () => {
    it('is empty when the entry does not offer a start date', () => {
        expect(validFirstDeliveryDates({ leadTimeDays: 0, allowStartDateChoice: false }, tueFri, '2026-10-14')).toEqual([]);
    });

    it('never offers today, even with no lead time: starting today is a checkout without a start date', () => {
        expect(validFirstDeliveryDates(chooser(0), tueFri, '2026-10-13').slice(0, 3)).toEqual(['2026-10-16', '2026-10-20', '2026-10-23']);
    });

    it('starts after the lead time', () => {
        expect(validFirstDeliveryDates(chooser(3), tueFri, '2026-10-14')[0]).toBe('2026-10-20');
    });

    it('offers every matching weekday of an N-week pattern, because a start date restarts the cycle', () => {
        expect(validFirstDeliveryDates(chooser(0), { ...tueFri, everyNWeeks: 2 }, '2026-10-14').slice(0, 3)).toEqual([
            '2026-10-16',
            '2026-10-20',
            '2026-10-23',
        ]);
    });

    it('clamps a monthly day to the month end', () => {
        expect(validFirstDeliveryDates(chooser(0), { kind: 'MONTHLY', dayOfMonth: 31 }, '2026-01-15').slice(0, 3)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
        ]);
    });

    it('ends 365 days out', () => {
        expect(validFirstDeliveryDates(chooser(0), { kind: 'YEARLY', month: 2, day: 14 }, '2026-10-14')).toEqual(['2027-02-14']);
        const weekly = validFirstDeliveryDates(chooser(0), tueFri, '2026-10-14');
        expect(weekly.at(-1)! <= '2027-10-14').toBe(true);
        expect(weekly).toHaveLength(104);
    });
});

describe('todayIn', () => {
    it("is core's date, not the server's, around midnight", () => {
        const lateEvening = new Date('2026-10-19T22:30:00Z');
        expect(todayIn('Europe/Zurich', lateEvening)).toBe('2026-10-20');
        expect(todayIn('UTC', lateEvening)).toBe('2026-10-19');
    });
});
