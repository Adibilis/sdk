import type { CorrespondenceLanguage } from '../subscription/wire.js';

const LANGUAGES: readonly CorrespondenceLanguage[] = ['DE', 'FR', 'IT', 'EN'];
const LOCALE = /^([a-z]{2})(?:[-_][a-z0-9_-]*)?$/i;

export function languageOf(locale: string | null | undefined): CorrespondenceLanguage | null {
    const code = LOCALE.exec(locale?.trim() ?? '')?.[1]?.toUpperCase();
    return LANGUAGES.find((language) => language === code) ?? null;
}

export interface CustomerLanguageSources {
    /** The language the visitor sees the site in (`de`, `de-CH`), from its language picker or its one fixed language. */
    locale?: string | null;
    /** The browser's `Accept-Language` header; its supported languages count in order of weight. */
    acceptLanguage?: string | null;
}

export interface BrowserCustomerLanguageSources {
    /** The language the visitor sees the site in (`de`, `de-CH`), from its language picker or its one fixed language. */
    locale?: string | null;
    /** `navigator.languages`, already ordered by preference. */
    languages?: readonly string[] | null;
}

function firstSupported(tags: readonly string[]): CorrespondenceLanguage | undefined {
    for (const tag of tags) {
        const language = languageOf(tag);
        if (language) return language;
    }
    return undefined;
}

function weightOf(parameters: readonly string[]): number {
    const value = parameters.map((parameter) => /^\s*q\s*=(.*)$/i.exec(parameter)?.[1]).find((found) => found !== undefined);
    const weight = Number(value?.trim() || 1);
    return Number.isNaN(weight) ? 1 : weight;
}

function tagsByWeight(acceptLanguage: string | null | undefined): string[] {
    return (acceptLanguage ?? '')
        .split(',')
        .map((entry, order) => {
            const [tag = '', ...parameters] = entry.split(';');
            return { tag: tag.trim(), weight: weightOf(parameters), order };
        })
        .filter(({ tag, weight }) => tag !== '' && weight > 0)
        .sort((a, b) => b.weight - a.weight || a.order - b.order)
        .map(({ tag }) => tag);
}

/**
 * The language for `billingPerson.language`: the site's language when it is German, French, Italian or English, else the
 * browser's most preferred of those, else `undefined` so core picks. Core stores it as a new customer's document language.
 */
export function customerLanguage({ locale, acceptLanguage }: CustomerLanguageSources): CorrespondenceLanguage | undefined {
    return languageOf(locale) ?? firstSupported(tagsByWeight(acceptLanguage));
}

/** The browser-side twin of `customerLanguage`, reading `navigator.languages` instead of the header. */
export function browserCustomerLanguage({ locale, languages }: BrowserCustomerLanguageSources): CorrespondenceLanguage | undefined {
    return languageOf(locale) ?? firstSupported(languages ?? []);
}
