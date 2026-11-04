import { describe, expect, it } from 'vitest';
import { customerLanguage } from '../src/customer/language.js';

describe('customerLanguage', () => {
    it.each([
        ['de', 'DE'],
        ['de-CH', 'DE'],
        ['fr', 'FR'],
        ['IT', 'IT'],
        ['en_GB', 'EN'],
    ])('takes the site language %s as %s, whatever the browser says', (locale, language) => {
        expect(customerLanguage({ locale, acceptLanguage: 'ja' })).toBe(language);
    });

    it.each([
        ['fr-CH,fr;q=0.9,en;q=0.8', 'FR'],
        ['it', 'IT'],
        [' de-DE ; q=0.9', 'DE'],
        ['en-US,en;q=0.5', 'EN'],
    ])('falls back to the browser header %s as %s without a site language', (acceptLanguage, language) => {
        expect(customerLanguage({ acceptLanguage })).toBe(language);
        expect(customerLanguage({ locale: null, acceptLanguage })).toBe(language);
    });

    it('falls back to the browser when the site language is none of the four', () => {
        expect(customerLanguage({ locale: 'es', acceptLanguage: 'fr' })).toBe('FR');
    });

    it.each(['ja', 'ja,de;q=0.9', '*', '', 'deutsch'])('is English for the browser header %s', (acceptLanguage) => {
        expect(customerLanguage({ acceptLanguage })).toBe('EN');
    });

    it('is English with nothing to go on', () => {
        expect(customerLanguage({})).toBe('EN');
        expect(customerLanguage({ locale: 'es', acceptLanguage: null })).toBe('EN');
    });
});
