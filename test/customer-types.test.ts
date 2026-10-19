import { describe, expect, it } from 'vitest';
import {
    CustomerConfigurationRequestModel,
    CustomerDeliveryPersonChangeRequestModel,
    CustomerLoginLinkRequestModel,
    CustomerPaymentMethodRequestModel,
} from '../src/subscription/wire';

const person = {
    firstname: 'Clara',
    lastname: 'Gift',
    address: { street: 'Seestrasse 1', postalCode: '8002', city: 'Zürich', country: 'CH' },
};

describe('portal request models (copies of core generator output)', () => {
    it('accept a delivery person as core caps it', () => {
        expect(CustomerDeliveryPersonChangeRequestModel.safeParse({ deliveryPerson: person }).success).toBe(true);
    });

    it.each([
        ['a three-letter country', { ...person, address: { ...person.address, country: 'CHE' } }],
        ['a first name over 100 characters', { ...person, firstname: 'x'.repeat(101) }],
        ['no address', { ...person, address: undefined }],
    ])('refuse %s', (_name, deliveryPerson) => {
        expect(CustomerDeliveryPersonChangeRequestModel.safeParse({ deliveryPerson }).success).toBe(false);
    });

    it("take only Stripe's SetupIntent id", () => {
        expect(CustomerPaymentMethodRequestModel.safeParse({ setupIntentId: 'seti_1QabcDEF' }).success).toBe(true);
        for (const bad of ['pm_123', 'seti_', 'seti_1_secret_abc', 'seti_../../v1/customers', `seti_${'a'.repeat(251)}`]) {
            expect(CustomerPaymentMethodRequestModel.safeParse({ setupIntentId: bad }).success, bad).toBe(false);
        }
    });

    it('require the configuration text and cap the configuration', () => {
        expect(CustomerConfigurationRequestModel.safeParse({ configurationText: ' ' }).success).toBe(false);
        expect(CustomerConfigurationRequestModel.safeParse({ configuration: 'x'.repeat(8193), configurationText: 'Red' }).success).toBe(false);
        expect(CustomerConfigurationRequestModel.safeParse({ configurationText: 'Red' }).success).toBe(true);
    });

    it('know only the four mail languages', () => {
        const link = { email: 'jane@example.com', returnUrl: 'https://shop.example/account/callback' };
        expect(CustomerLoginLinkRequestModel.safeParse({ ...link, language: 'DE' }).success).toBe(true);
        expect(CustomerLoginLinkRequestModel.safeParse({ ...link, language: 'de' }).success).toBe(false);
        expect(CustomerLoginLinkRequestModel.safeParse({ ...link, language: 'ES' }).success).toBe(false);
    });
});
