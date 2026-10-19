import { describe, expect, it } from 'vitest';
import { describeBilling, describeSchedule } from '../src/subscription/describe';
import type { SchedulePattern } from '../src/subscription/wire';

const friTue: SchedulePattern = { kind: 'WEEKLY', weekdays: ['FRI', 'TUE'], everyNWeeks: 1 };
const everySecondMonday: SchedulePattern = { kind: 'WEEKLY', weekdays: ['MON'], everyNWeeks: 2 };
const monthly15: SchedulePattern = { kind: 'MONTHLY', dayOfMonth: 15 };
const valentine: SchedulePattern = { kind: 'YEARLY', month: 2, day: 14 };

describe('describeSchedule', () => {
    it.each([
        ['en', ['Every week on Tuesday and Friday', 'Every 2 weeks on Monday', 'Monthly on day 15', 'Yearly on February 14']],
        ['de', ['Jede Woche am Dienstag und Freitag', 'Alle 2 Wochen am Montag', 'Monatlich am 15.', 'Jährlich am 14. Februar']],
        ['fr', ['Chaque semaine le mardi et vendredi', 'Toutes les 2 semaines le lundi', 'Chaque mois le 15', 'Chaque année le 14 février']],
        ['it', ['Ogni settimana il martedì e venerdì', 'Ogni 2 settimane il lunedì', 'Ogni mese il giorno 15', 'Ogni anno il 14 febbraio']],
    ] as const)('words the four kinds in %s, weekdays in week order', (locale, expected) => {
        expect([friTue, everySecondMonday, monthly15, valentine].map((pattern) => describeSchedule(pattern, locale))).toEqual(expected);
    });

    it('takes a regional tag', () => {
        expect(describeSchedule(friTue, 'de-CH')).toBe('Jede Woche am Dienstag und Freitag');
    });

    it('words a language it has no phrases for in English', () => {
        expect(describeSchedule(friTue, 'es')).toBe('Every week on Tuesday and Friday');
    });

    it('lists three weekdays the way the language does', () => {
        expect(describeSchedule({ kind: 'WEEKLY', weekdays: ['FRI', 'MON', 'WED'], everyNWeeks: 1 }, 'de')).toBe(
            'Jede Woche am Montag, Mittwoch und Freitag'
        );
    });

    it('writes the first of the month as 1er in French', () => {
        expect(describeSchedule({ kind: 'MONTHLY', dayOfMonth: 1 }, 'fr')).toBe('Chaque mois le 1er');
    });
});

describe('describeBilling', () => {
    it('words one and several intervals', () => {
        expect(describeBilling('WEEK', 1, 'de')).toBe('jede Woche');
        expect(describeBilling('WEEK', 2, 'fr')).toBe('toutes les 2 semaines');
        expect(describeBilling('MONTH', 1, 'it')).toBe('ogni mese');
        expect(describeBilling('YEAR', 3)).toBe('every 3 years');
    });
});
