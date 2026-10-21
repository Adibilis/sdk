import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWellFormedPattern, nextOccurrence, occurrences, validateScheduleChoice } from '../src/subscription/schedule';
import type { ScheduleDefinition, SchedulePattern } from '../src/subscription/wire';

interface OccurrenceCase {
    name: string;
    pattern: SchedulePattern;
    anchor: string;
    from: string;
    to: string;
    expected: string[];
}

// A verbatim copy of core's backend/src/test/resources/schedule/occurrences.json, which SchedulePatternsTest runs.
const cases = JSON.parse(readFileSync(new URL('./fixtures/core/schedule/occurrences.json', import.meta.url), 'utf8')) as OccurrenceCase[];

const weekly = (weekdays: SchedulePattern['weekdays'], everyNWeeks: number): SchedulePattern => ({ kind: 'WEEKLY', weekdays, everyNWeeks });
const monthly = (dayOfMonth: number): SchedulePattern => ({ kind: 'MONTHLY', dayOfMonth });
const yearly = (month: number, day: number): SchedulePattern => ({ kind: 'YEARLY', month, day });
const monthlyWeekday = (weekOfMonth: number, weekday: SchedulePattern['weekday']): SchedulePattern => ({ kind: 'MONTHLY_WEEKDAY', weekOfMonth, weekday });
const free = (freeKind: ScheduleDefinition['freeKind'], everyNWeeks?: number, min?: number, max?: number): ScheduleDefinition => ({
    mode: 'CUSTOMER_FREE',
    freeKind,
    everyNWeeks,
    min,
    max,
});

describe('occurrences (core fixture)', () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
        expect(occurrences(c.pattern, c.anchor, c.from, c.to)).toEqual(c.expected);
    });

    it('runs every core case', () => {
        expect(cases.length).toBeGreaterThanOrEqual(8);
        expect(cases.some((c) => c.pattern.kind === 'MONTHLY_WEEKDAY')).toBe(true);
    });
});

describe('nextOccurrence', () => {
    it('is the first date on or after from', () => {
        expect(nextOccurrence(weekly(['TUE', 'FRI'], 1), '2026-10-14', '2026-10-14')).toBe('2026-10-16');
        expect(nextOccurrence(weekly(['TUE', 'FRI'], 1), '2026-10-14', '2026-10-16')).toBe('2026-10-16');
    });

    it('finds the last weekday of the month', () => {
        expect(nextOccurrence(monthlyWeekday(-1, 'FRI'), '2026-10-31', '2026-10-31')).toBe('2026-11-27');
    });

    it('looks into next year for a yearly date', () => {
        expect(nextOccurrence(yearly(2, 14), '2026-10-14', '2026-10-14')).toBe('2027-02-14');
    });

    it('does not shift across a daylight-saving change', () => {
        expect(occurrences(weekly(['SUN', 'MON'], 1), '2026-03-27', '2026-03-27', '2026-04-01')).toEqual(['2026-03-29', '2026-03-30']);
        expect(occurrences(weekly(['SUN', 'MON'], 1), '2026-10-23', '2026-10-23', '2026-10-27')).toEqual(['2026-10-25', '2026-10-26']);
    });
});

describe('weekday and kind checks at runtime', () => {
    const fixedTueFri: ScheduleDefinition = { mode: 'FIXED', pattern: weekly(['TUE', 'FRI'], 1) };
    const bad = (weekdays: unknown): SchedulePattern => weekly(weekdays as SchedulePattern['weekdays'], 1);

    it.each([
        ['a null entry', [null]],
        ['an unknown value', ['TUE', 'XYZ']],
        ['a lower-case value', ['tue']],
        ['a duplicate', ['TUE', 'TUE']],
        ['a duplicate in different case', ['TUE', 'tue']],
    ])('refuses %s', (_name, weekdays) => {
        expect(isWellFormedPattern(bad(weekdays))).toBe(false);
        expect(validateScheduleChoice(fixedTueFri, bad(weekdays))).toBe(false);
    });

    it('refuses an unknown kind', () => {
        expect(isWellFormedPattern({ kind: 'DAILY' } as unknown as SchedulePattern)).toBe(false);
    });
});

describe('validateScheduleChoice (twin of ScheduleChoiceValidator)', () => {
    it('FIXED accepts only its own pattern, ignoring weekday order', () => {
        const fixed: ScheduleDefinition = { mode: 'FIXED', pattern: weekly(['TUE', 'FRI'], 1) };
        expect(validateScheduleChoice(fixed, weekly(['FRI', 'TUE'], 1))).toBe(true);
        expect(validateScheduleChoice(fixed, weekly(['TUE'], 1))).toBe(false);
        expect(validateScheduleChoice(fixed, weekly(['TUE', 'FRI'], 2))).toBe(false);
    });

    it('CUSTOMER_CHOICE accepts any listed option', () => {
        const choice: ScheduleDefinition = { mode: 'CUSTOMER_CHOICE', options: [weekly(['MON'], 1), monthly(1)] };
        expect(validateScheduleChoice(choice, monthly(1))).toBe(true);
        expect(validateScheduleChoice(choice, weekly(['MON'], 1))).toBe(true);
        expect(validateScheduleChoice(choice, monthly(2))).toBe(false);
    });

    it('CUSTOMER_CHOICE tells two monthly-weekday options apart', () => {
        const choice: ScheduleDefinition = { mode: 'CUSTOMER_CHOICE', options: [monthlyWeekday(1, 'TUE')] };
        expect(validateScheduleChoice(choice, monthlyWeekday(1, 'TUE'))).toBe(true);
        expect(validateScheduleChoice(choice, monthlyWeekday(2, 'TUE'))).toBe(false);
        expect(validateScheduleChoice(choice, monthlyWeekday(-1, 'TUE'))).toBe(false);
        expect(validateScheduleChoice(choice, monthlyWeekday(1, 'WED'))).toBe(false);
        expect(validateScheduleChoice({ mode: 'FIXED', pattern: monthlyWeekday(-1, 'FRI') }, monthlyWeekday(-1, 'FRI'))).toBe(true);
        expect(validateScheduleChoice({ mode: 'FIXED', pattern: monthlyWeekday(-1, 'FRI') }, monthlyWeekday(4, 'FRI'))).toBe(false);
    });

    it('no CUSTOMER_FREE kind takes a monthly-weekday choice', () => {
        expect(validateScheduleChoice(free('DAY_OF_MONTH'), monthlyWeekday(1, 'TUE'))).toBe(false);
        expect(validateScheduleChoice(free('DATE'), monthlyWeekday(1, 'TUE'))).toBe(false);
        expect(validateScheduleChoice(free('WEEKDAYS', 1, 1, 7), monthlyWeekday(1, 'TUE'))).toBe(false);
    });

    it('CUSTOMER_FREE WEEKDAYS checks the count and the interval', () => {
        const definition = free('WEEKDAYS', 1, 1, 2);
        expect(validateScheduleChoice(definition, weekly(['TUE', 'FRI'], 1))).toBe(true);
        expect(validateScheduleChoice(definition, weekly(['MON', 'TUE', 'FRI'], 1))).toBe(false);
        expect(validateScheduleChoice(definition, weekly(['TUE'], 2))).toBe(false);
        expect(validateScheduleChoice(definition, monthly(1))).toBe(false);
        expect(validateScheduleChoice(definition, weekly(null, 1))).toBe(false);
    });

    it('CUSTOMER_FREE DAY_OF_MONTH and DATE accept their kind only', () => {
        expect(validateScheduleChoice(free('DAY_OF_MONTH'), monthly(28))).toBe(true);
        expect(validateScheduleChoice(free('DAY_OF_MONTH'), yearly(2, 14))).toBe(false);
        expect(validateScheduleChoice(free('DATE'), yearly(2, 14))).toBe(true);
        expect(validateScheduleChoice(free('DATE'), monthly(14))).toBe(false);
    });

    it('a missing choice never fits', () => {
        expect(validateScheduleChoice(free('DATE'), null)).toBe(false);
    });

    it('a malformed choice never fits, even where its kind would', () => {
        expect(validateScheduleChoice(free('DAY_OF_MONTH'), { kind: 'MONTHLY', dayOfMonth: 1, weekdays: ['MON'] })).toBe(false);
        expect(validateScheduleChoice(free('WEEKDAYS', 1, 1, 3), weekly(['TUE', 'TUE'], 1))).toBe(false);
    });
});

describe('isWellFormedPattern (twin of @ValidSchedulePattern)', () => {
    it('accepts well-formed patterns, 29 February included', () => {
        expect(isWellFormedPattern(weekly(['TUE', 'FRI'], 1))).toBe(true);
        expect(isWellFormedPattern(monthly(31))).toBe(true);
        expect(isWellFormedPattern(yearly(2, 29))).toBe(true);
        expect(isWellFormedPattern(monthlyWeekday(1, 'TUE'))).toBe(true);
        expect(isWellFormedPattern(monthlyWeekday(4, 'SUN'))).toBe(true);
        expect(isWellFormedPattern(monthlyWeekday(-1, 'FRI'))).toBe(true);
    });

    it.each([
        ['no weekdays', weekly([], 1)],
        ['a weekday twice', weekly(['TUE', 'TUE'], 1)],
        ['no interval', { kind: 'WEEKLY', weekdays: ['TUE'] }],
        ['an interval over 52', weekly(['TUE'], 53)],
        ['a weekly day of month', { kind: 'WEEKLY', weekdays: ['TUE'], everyNWeeks: 1, dayOfMonth: 3 }],
        ['no day of month', { kind: 'MONTHLY' }],
        ['day of month 32', monthly(32)],
        ['30 February', yearly(2, 30)],
        ['no month', { kind: 'YEARLY', day: 1 }],
        ['week of month 0', monthlyWeekday(0, 'TUE')],
        ['week of month 5', monthlyWeekday(5, 'TUE')],
        ['week of month -2', monthlyWeekday(-2, 'TUE')],
        ['a fractional week of month', monthlyWeekday(1.5, 'TUE')],
        ['no week of month', { kind: 'MONTHLY_WEEKDAY', weekday: 'TUE' }],
        ['no weekday', { kind: 'MONTHLY_WEEKDAY', weekOfMonth: 1 }],
        ['an unknown weekday', { kind: 'MONTHLY_WEEKDAY', weekOfMonth: 1, weekday: 'tue' }],
        ['a monthly-weekday day of month', { kind: 'MONTHLY_WEEKDAY', weekOfMonth: 1, weekday: 'TUE', dayOfMonth: 3 }],
        ['a monthly-weekday weekday list', { kind: 'MONTHLY_WEEKDAY', weekOfMonth: 1, weekday: 'TUE', weekdays: ['TUE'] }],
        ['a weekly week of month', { kind: 'WEEKLY', weekdays: ['TUE'], everyNWeeks: 1, weekOfMonth: 1 }],
        ['a monthly weekday', { kind: 'MONTHLY', dayOfMonth: 1, weekday: 'TUE' }],
        ['a yearly week of month', { kind: 'YEARLY', month: 2, day: 14, weekOfMonth: -1 }],
        ['no kind', null],
    ] as const)('refuses %s', (_name, pattern) => {
        expect(isWellFormedPattern(pattern as SchedulePattern | null)).toBe(false);
    });
});
