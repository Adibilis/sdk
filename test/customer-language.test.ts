import { describe, expect, it } from 'vitest';
import { browserCustomerLanguage, customerLanguage } from '../src/customer/language.js';

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
        ['ja,fr;q=0.8', 'FR'],
        ['en;q=0.5,fr;q=0.9', 'FR'],
        ['fr;q=0,it', 'IT'],
        ['fr;q=abc', 'FR'],
        ['fr;q=-1,it', 'IT'],
        ['de;q=0.8,fr;q=0.8', 'DE'],
        [' fr ; q = 0.9 , en;q=0.2', 'FR'],
    ])('falls back to the browser header %s as %s without a site language', (acceptLanguage, language) => {
        expect(customerLanguage({ acceptLanguage })).toBe(language);
        expect(customerLanguage({ locale: null, acceptLanguage })).toBe(language);
    });

    it('falls back to the browser when the site language is none of the four', () => {
        expect(customerLanguage({ locale: 'es', acceptLanguage: 'fr' })).toBe('FR');
    });

    it.each(['ja', '*', '', 'deutsch', ';;,q=', 'fr;q=0'])('is undefined for the browser header %s', (acceptLanguage) => {
        expect(customerLanguage({ acceptLanguage })).toBeUndefined();
    });

    it('is undefined with nothing to go on', () => {
        expect(customerLanguage({})).toBeUndefined();
        expect(customerLanguage({ locale: 'es', acceptLanguage: null })).toBeUndefined();
    });
});

describe('browserCustomerLanguage', () => {
    it('takes the first supported language of the list', () => {
        expect(browserCustomerLanguage({ languages: ['ja', 'it-CH', 'fr'] })).toBe('IT');
    });

    it('prefers the site language', () => {
        expect(browserCustomerLanguage({ locale: 'fr', languages: ['de'] })).toBe('FR');
    });

    it.each([[[]], [null], [undefined], [['ja']]])('is undefined for the list %j', (languages) => {
        expect(browserCustomerLanguage({ languages })).toBeUndefined();
    });
});
