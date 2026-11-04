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
    /** The browser's `Accept-Language` header; only its first language counts. */
    acceptLanguage?: string | null;
}

/**
 * The language for `billingPerson.language`: the site's language when it is German, French, Italian or English, else the
 * browser's first language when it is one of those, else English. Core stores it as a new customer's document language.
 */
export function customerLanguage({ locale, acceptLanguage }: CustomerLanguageSources): CorrespondenceLanguage {
    return languageOf(locale) ?? languageOf(acceptLanguage?.split(/[,;]/)[0]) ?? 'EN';
}
