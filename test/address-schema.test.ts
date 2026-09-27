import { describe, expect, it } from 'vitest';
import { makeAddressSchema, makeBillingAddressSchema, type AddressValidationMessages } from '../src/forms/address-schema';

const messages: AddressValidationMessages = {
    firstNameRequired: 'FIRST', lastNameRequired: 'LAST', streetRequired: 'STREET',
    cityRequired: 'CITY', postalCodeRequired: 'POSTAL', countryRequired: 'COUNTRY',
};

const valid = { firstname: 'Ada', lastname: 'Lovelace', address: 'Main 1', city: 'Bern', postalCode: '3000' };

describe('makeAddressSchema', () => {
    it('accepts a complete address without a company', () => {
        expect(makeAddressSchema(messages).safeParse(valid).success).toBe(true);
    });

    it('accepts an optional company', () => {
        expect(makeAddressSchema(messages).safeParse({ ...valid, company: 'Analytical' }).success).toBe(true);
    });

    it('surfaces the injected message for each required field', () => {
        const result = makeAddressSchema(messages).safeParse({ firstname: '', lastname: '', address: '', city: '', postalCode: '' });
        const seen = result.success ? [] : result.error.issues.map((i) => i.message);
        expect(seen).toEqual(expect.arrayContaining(['FIRST', 'LAST', 'STREET', 'CITY', 'POSTAL']));
    });

    it('does not require a country', () => {
        expect(makeAddressSchema(messages).safeParse(valid).success).toBe(true);
    });
});

describe('makeBillingAddressSchema', () => {
    it('requires a country on top of the base fields', () => {
        expect(makeBillingAddressSchema(messages).safeParse(valid).success).toBe(false);
        expect(makeBillingAddressSchema(messages).safeParse({ ...valid, country: 'CH' }).success).toBe(true);
    });

    it('surfaces the injected country message', () => {
        const result = makeBillingAddressSchema(messages).safeParse(valid);
        const seen = result.success ? [] : result.error.issues.map((i) => i.message);
        expect(seen).toContain('COUNTRY');
    });

    it('carries no hardcoded language', () => {
        const result = makeBillingAddressSchema(messages).safeParse({});
        const joined = result.success ? '' : result.error.issues.map((i) => i.message).join(' ');
        expect(joined).not.toMatch(/erforderlich|required|requis|richiesto/i);
    });

    // Stronger than the regex above, which a real leak slipped past: zod's default for an absent
    // field is "Invalid input: expected string, received undefined", matching none of those words.
    // Assert positively instead — EVERY message must be one the caller injected.
    it('emits only injected messages, for absent and for empty fields alike', () => {
        const injected = Object.values(messages);

        for (const input of [{}, { firstname: '', lastname: '', address: '', city: '', postalCode: '', country: '' }]) {
            const result = makeBillingAddressSchema(messages).safeParse(input);
            const seen = result.success ? [] : result.error.issues.map((i) => i.message);

            expect(seen.length).toBeGreaterThan(0);
            expect(seen.filter((m) => !injected.includes(m))).toEqual([]);
        }
    });
});
