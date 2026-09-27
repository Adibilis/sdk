import { describe, expect, it, vi } from 'vitest';
import { fetchHolidays, isHoliday, type HolidayRange } from '../src/shop/holidays-client';

const ranges = [
    { from: '2026-05-14', to: '2026-05-16' },
    { from: '2026-12-24', to: '2026-12-26' },
];

describe('fetchHolidays', () => {
    it('calls the holidays endpoint', async () => {
        const client = { get: vi.fn().mockResolvedValue(ranges), post: vi.fn() };
        await expect(fetchHolidays(client)).resolves.toEqual(ranges);
        expect(client.get).toHaveBeenCalledWith('/api/shop/holidays');
    });

    it('passes an empty list straight through', async () => {
        const client = { get: vi.fn().mockResolvedValue([]), post: vi.fn() };
        await expect(fetchHolidays(client)).resolves.toEqual([]);
    });
});

describe('isHoliday', () => {
    it('matches the first day of a range', () => expect(isHoliday('2026-05-14', ranges)).toBe(true));
    it('matches the last day of a range', () => expect(isHoliday('2026-05-16', ranges)).toBe(true));
    it('matches a day inside a range', () => expect(isHoliday('2026-05-15', ranges)).toBe(true));
    it('rejects the day before', () => expect(isHoliday('2026-05-13', ranges)).toBe(false));
    it('rejects the day after', () => expect(isHoliday('2026-05-17', ranges)).toBe(false));
    it('checks every range, not just the first', () => expect(isHoliday('2026-12-25', ranges)).toBe(true));
    it('is false with no ranges', () => expect(isHoliday('2026-05-15', [])).toBe(false));
});

// HolidayRange is the generated HolidayRangeResponse. Pins that the generated type keeps string
// dates: an earlier generator build typed them as Date, which JSON.parse never produces.
describe('wire format', () => {
    it('treats holiday dates as strings, matching what the API really sends', () => {
        const parsed: HolidayRange[] = JSON.parse('[{"from":"2026-05-14","to":"2026-05-16"}]');
        const from: string = parsed[0]!.from;
        expect(typeof from).toBe('string');
        expect(isHoliday('2026-05-15', parsed)).toBe(true);
    });
});
