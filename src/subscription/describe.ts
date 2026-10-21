import { normalizePattern, WEEKDAYS } from './schedule.js';
import type { BillingInterval, SchedulePattern, Weekday } from './wire.js';

type Language = 'en' | 'de' | 'fr' | 'it';

interface Phrases {
    weekly(days: string): string;
    everyNWeeks(n: number, days: string): string;
    monthly(day: number): string;
    /** `week` is 1–4 or -1 (last); Sunday is passed so a language can inflect the ordinal for its gender. */
    monthlyWeekday(week: number, day: string, sunday: boolean): string;
    yearly(date: string): string;
    billing: Record<BillingInterval, { one: string; many(n: number): string }>;
}

/** `words` is first…fourth, then last; `week` is 1–4 or -1. */
function ordinal(week: number, words: readonly [string, string, string, string, string]): string {
    return (week === -1 ? words[4] : words[week - 1]) ?? words[0];
}

const PHRASES: Record<Language, Phrases> = {
    en: {
        weekly: (days) => `Every week on ${days}`,
        everyNWeeks: (n, days) => `Every ${n} weeks on ${days}`,
        monthly: (day) => `Monthly on day ${day}`,
        monthlyWeekday: (week, day) => `Every ${ordinal(week, ['first', 'second', 'third', 'fourth', 'last'])} ${day} of the month`,
        yearly: (date) => `Yearly on ${date}`,
        billing: {
            WEEK: { one: 'every week', many: (n) => `every ${n} weeks` },
            MONTH: { one: 'every month', many: (n) => `every ${n} months` },
            YEAR: { one: 'every year', many: (n) => `every ${n} years` },
        },
    },
    de: {
        weekly: (days) => `Jede Woche am ${days}`,
        everyNWeeks: (n, days) => `Alle ${n} Wochen am ${days}`,
        monthly: (day) => `Monatlich am ${day}.`,
        monthlyWeekday: (week, day) => `Jeden ${ordinal(week, ['ersten', 'zweiten', 'dritten', 'vierten', 'letzten'])} ${day} im Monat`,
        yearly: (date) => `Jährlich am ${date}`,
        billing: {
            WEEK: { one: 'jede Woche', many: (n) => `alle ${n} Wochen` },
            MONTH: { one: 'jeden Monat', many: (n) => `alle ${n} Monate` },
            YEAR: { one: 'jedes Jahr', many: (n) => `alle ${n} Jahre` },
        },
    },
    fr: {
        weekly: (days) => `Chaque semaine le ${days}`,
        everyNWeeks: (n, days) => `Toutes les ${n} semaines le ${days}`,
        monthly: (day) => `Chaque mois le ${day === 1 ? '1er' : day}`,
        monthlyWeekday: (week, day) => `Chaque ${ordinal(week, ['premier', 'deuxième', 'troisième', 'quatrième', 'dernier'])} ${day} du mois`,
        yearly: (date) => `Chaque année le ${date}`,
        billing: {
            WEEK: { one: 'chaque semaine', many: (n) => `toutes les ${n} semaines` },
            MONTH: { one: 'chaque mois', many: (n) => `tous les ${n} mois` },
            YEAR: { one: 'chaque année', many: (n) => `tous les ${n} ans` },
        },
    },
    it: {
        weekly: (days) => `Ogni settimana il ${days}`,
        everyNWeeks: (n, days) => `Ogni ${n} settimane il ${days}`,
        monthly: (day) => `Ogni mese il giorno ${day}`,
        monthlyWeekday: (week, day, sunday) =>
            `Ogni ${ordinal(week, sunday ? ['prima', 'seconda', 'terza', 'quarta', 'ultima'] : ['primo', 'secondo', 'terzo', 'quarto', 'ultimo'])} ${day} del mese`,
        yearly: (date) => `Ogni anno il ${date}`,
        billing: {
            WEEK: { one: 'ogni settimana', many: (n) => `ogni ${n} settimane` },
            MONTH: { one: 'ogni mese', many: (n) => `ogni ${n} mesi` },
            YEAR: { one: 'ogni anno', many: (n) => `ogni ${n} anni` },
        },
    },
};

/** The phrase table and the Intl locale for a BCP 47 tag; a language other than de/fr/it/en is worded entirely in English. */
function wording(locale: string): { phrases: Phrases; intlLocale: string } {
    const language = locale.toLowerCase().split('-')[0] ?? '';
    return Object.hasOwn(PHRASES, language) ? { phrases: PHRASES[language as Language], intlLocale: locale } : { phrases: PHRASES.en, intlLocale: 'en' };
}

function weekdayName(day: Weekday, locale: string): string {
    // 2024-01-01 was a Monday
    return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(day)));
}

/** The delivery rhythm in words for the shop's customer, e.g. "Jede Woche am Dienstag und Freitag". Weekday and month names come from Intl. */
export function describeSchedule(pattern: SchedulePattern, locale = 'en'): string {
    const { phrases, intlLocale } = wording(locale);
    const p = normalizePattern(pattern);
    switch (p.kind) {
        case 'WEEKLY': {
            const days = new Intl.ListFormat(intlLocale, { type: 'conjunction' }).format((p.weekdays ?? []).map((day) => weekdayName(day, intlLocale)));
            const n = p.everyNWeeks ?? 1;
            return n === 1 ? phrases.weekly(days) : phrases.everyNWeeks(n, days);
        }
        case 'MONTHLY':
            return phrases.monthly(p.dayOfMonth ?? 1);
        case 'MONTHLY_WEEKDAY': {
            const weekday = p.weekday ?? 'MON';
            return phrases.monthlyWeekday(p.weekOfMonth ?? 1, weekdayName(weekday, intlLocale), weekday === 'SUN');
        }
        case 'YEARLY':
            return phrases.yearly(
                new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2000, (p.month ?? 1) - 1, p.day ?? 1))
            );
    }
}

/** The billing cadence in words, lower-case to follow an amount: "50.00 CHF " + describeBilling('WEEK', 2, 'de') → "alle 2 Wochen". */
export function describeBilling(interval: BillingInterval, count: number, locale = 'en'): string {
    const phrase = wording(locale).phrases.billing[interval];
    return count === 1 ? phrase.one : phrase.many(count);
}
