// Twin of core's schedule engine (SchedulePatterns, ScheduleChoiceValidator, @ValidSchedulePattern). Both run the shared fixtures
// in test/fixtures/core/schedule/; change one side only together with the other.
import type { ScheduleDefinition, SchedulePattern, Weekday } from './wire.js';

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DAY_MS = 86_400_000;
const LOOKAHEAD_YEARS = 2;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 of an ISO `YYYY-MM-DD` date, computed in UTC so no time zone or DST shift can move it. */
export function toEpochDay(date: string): number {
    const match = ISO_DATE.exec(date);
    if (!match) throw new RangeError(`Not an ISO date: ${date}`);
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (month < 1 || month > 12 || day < 1 || day > lengthOfMonth(year, month)) throw new RangeError(`Not a calendar date: ${date}`);
    return epochDayOf(year, month, day);
}

export function fromEpochDay(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
    try {
        toEpochDay(value);
        return true;
    } catch {
        return false;
    }
}

function epochDayOf(year: number, month: number, day: number): number {
    return Date.UTC(year, month - 1, day) / DAY_MS;
}

function lengthOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday 0 … Sunday 6; 1970-01-01 was a Thursday. */
function isoWeekday(day: number): number {
    return (((day + 3) % 7) + 7) % 7;
}

function yearOf(day: number): number {
    return new Date(day * DAY_MS).getUTCFullYear();
}

function plusYears(date: string, years: number): string {
    const day = toEpochDay(date);
    const year = yearOf(day) + years;
    const month = new Date(day * DAY_MS).getUTCMonth() + 1;
    return fromEpochDay(epochDayOf(year, month, Math.min(new Date(day * DAY_MS).getUTCDate(), lengthOfMonth(year, month))));
}

/** Weekdays deduplicated and sorted Monday-first, so two patterns meaning the same compare equal. */
export function normalizePattern(pattern: SchedulePattern): SchedulePattern {
    const weekdays = pattern.weekdays;
    if (pattern.kind !== 'WEEKLY' || weekdays == null) return pattern;
    return { kind: 'WEEKLY', weekdays: WEEKDAYS.filter((day) => weekdays.includes(day)), everyNWeeks: pattern.everyNWeeks };
}

function required<T>(value: T | null | undefined, field: string): T {
    if (value == null) throw new TypeError(`The schedule pattern has no ${field}`);
    return value;
}

/** Delivery dates of `pattern` in [from, to), never before `anchor`; WEEKLY counts its N-week cycle from the Monday of the anchor's week. */
export function occurrences(pattern: SchedulePattern, anchor: string, from: string, to: string): string[] {
    const p = normalizePattern(pattern);
    const anchorDay = toEpochDay(anchor);
    const start = Math.max(toEpochDay(from), anchorDay);
    const end = toEpochDay(to);
    if (start >= end) return [];
    switch (p.kind) {
        case 'WEEKLY':
            return weekly(required(p.weekdays, 'weekdays'), required(p.everyNWeeks, 'everyNWeeks'), anchorDay, start, end);
        case 'MONTHLY':
            return monthly(required(p.dayOfMonth, 'dayOfMonth'), start, end);
        case 'YEARLY':
            return yearly(required(p.month, 'month'), required(p.day, 'day'), start, end);
    }
}

/** The first occurrence on or after `from`; `null` if none within two years. */
export function nextOccurrence(pattern: SchedulePattern, anchor: string, from: string): string | null {
    return occurrences(pattern, anchor, from, plusYears(from, LOOKAHEAD_YEARS))[0] ?? null;
}

function weekly(weekdays: readonly Weekday[], everyNWeeks: number, anchor: number, start: number, end: number): string[] {
    const days = new Set(weekdays.map((day) => WEEKDAYS.indexOf(day)));
    const anchorWeek = anchor - isoWeekday(anchor);
    const result: string[] = [];
    for (let day = start; day < end; day++) {
        const weekday = isoWeekday(day);
        if (days.has(weekday) && ((day - weekday - anchorWeek) / 7) % everyNWeeks === 0) result.push(fromEpochDay(day));
    }
    return result;
}

function monthly(dayOfMonth: number, start: number, end: number): string[] {
    const result: string[] = [];
    const first = new Date(start * DAY_MS);
    for (let index = first.getUTCFullYear() * 12 + first.getUTCMonth(); ; index++) {
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        if (epochDayOf(year, month, 1) > end) break;
        const day = epochDayOf(year, month, Math.min(dayOfMonth, lengthOfMonth(year, month)));
        if (day >= start && day < end) result.push(fromEpochDay(day));
    }
    return result;
}

function yearly(month: number, dayOfMonth: number, start: number, end: number): string[] {
    const result: string[] = [];
    for (let year = yearOf(start); year <= yearOf(end); year++) {
        const day = epochDayOf(year, month, Math.min(dayOfMonth, lengthOfMonth(year, month)));
        if (day >= start && day < end) result.push(fromEpochDay(day));
    }
    return result;
}

function inRange(value: number | null | undefined, min: number, max: number): boolean {
    return value == null || (Number.isInteger(value) && value >= min && value <= max);
}

/** What core's `@Valid` accepts as a schedule: the fields of its kind, nothing else, each within range; 29 Feb is a valid yearly date. */
export function isWellFormedPattern(pattern: SchedulePattern | null | undefined): boolean {
    if (!pattern?.kind) return false;
    const { weekdays, everyNWeeks, dayOfMonth, month, day } = pattern;
    if (!inRange(everyNWeeks, 1, 52) || !inRange(dayOfMonth, 1, 31) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return false;
    switch (pattern.kind) {
        case 'WEEKLY':
            return (
                weekdays != null &&
                weekdays.length > 0 &&
                new Set(weekdays).size === weekdays.length &&
                everyNWeeks != null &&
                dayOfMonth == null &&
                month == null &&
                day == null
            );
        case 'MONTHLY':
            return dayOfMonth != null && weekdays == null && everyNWeeks == null && month == null && day == null;
        case 'YEARLY':
            return (
                month != null &&
                day != null &&
                day <= lengthOfMonth(2000, month) &&
                weekdays == null &&
                everyNWeeks == null &&
                dayOfMonth == null
            );
    }
}

function canonical(pattern: SchedulePattern): string {
    const p = normalizePattern(pattern);
    return JSON.stringify([p.kind, p.weekdays ?? null, p.everyNWeeks ?? null, p.dayOfMonth ?? null, p.month ?? null, p.day ?? null]);
}

/**
 * `true` when core's checkout accepts `choice` under `definition` (a plan's, or the dynamic entry's): the choice is well formed
 * and FIXED matches its pattern, CUSTOMER_CHOICE one of its options (weekday order is irrelevant), CUSTOMER_FREE its kind —
 * for WEEKDAYS also its week interval and min…max days.
 */
export function validateScheduleChoice(definition: ScheduleDefinition, choice: SchedulePattern | null | undefined): boolean {
    if (!choice || !isWellFormedPattern(choice)) return false;
    const wanted = normalizePattern(choice);
    switch (definition.mode) {
        case 'FIXED':
            return definition.pattern != null && canonical(definition.pattern) === canonical(wanted);
        case 'CUSTOMER_CHOICE':
            return (definition.options ?? []).some((option) => canonical(option) === canonical(wanted));
        case 'CUSTOMER_FREE':
            switch (definition.freeKind) {
                case 'WEEKDAYS':
                    return (
                        wanted.kind === 'WEEKLY' &&
                        wanted.everyNWeeks === definition.everyNWeeks &&
                        wanted.weekdays != null &&
                        definition.min != null &&
                        definition.max != null &&
                        wanted.weekdays.length >= definition.min &&
                        wanted.weekdays.length <= definition.max
                    );
                case 'DAY_OF_MONTH':
                    return wanted.kind === 'MONTHLY';
                case 'DATE':
                    return wanted.kind === 'YEARLY';
                default:
                    return false;
            }
    }
}
