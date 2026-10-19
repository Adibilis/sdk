import { describe, expect, it } from 'vitest';
import { confirmMethodOf, isDynamicEntry } from '../src/subscription/types';
import type { ShopSubscriptionEntry } from '../src/subscription/types';
import { SubscriptionCheckoutRequestModel } from '../src/subscription/wire';

const tueFri = { kind: 'WEEKLY', weekdays: ['TUE', 'FRI'], everyNWeeks: 1 } as const;

const dynamicEntry = {
    id: null,
    dynamic: true,
    title: null,
    description: null,
    billingInterval: null,
    billingIntervalCount: null,
    priceMode: null,
    vatExempt: false,
    leadTimeDays: 2,
    allowStartDateChoice: true,
    scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'WEEKDAYS', everyNWeeks: 1, min: 1, max: 3 },
    prices: [],
} satisfies ShopSubscriptionEntry;

const plan = {
    id: 4,
    dynamic: false,
    title: 'Weekly bouquet',
    description: null,
    billingInterval: 'MONTH',
    billingIntervalCount: 1,
    priceMode: 'BRUTTO',
    vatExempt: false,
    leadTimeDays: 3,
    allowStartDateChoice: false,
    scheduleDefinition: { mode: 'FIXED', pattern: tueFri },
    prices: [{ currency: 'CHF', amount: 89, vatRate: 2.6 }],
} satisfies ShopSubscriptionEntry;

describe('isDynamicEntry', () => {
    it('tells the dynamic entry from a plan', () => {
        expect(isDynamicEntry(dynamicEntry)).toBe(true);
        expect(isDynamicEntry(plan)).toBe(false);
    });

    it('reads an entry from a core without dynamic subscriptions (no dynamic field) as a plan', () => {
        const { dynamic: _absent, ...older } = plan;
        expect(isDynamicEntry(older as unknown as ShopSubscriptionEntry)).toBe(false);
    });
});

describe('confirmMethodOf', () => {
    it('confirms a charge now as a payment and a chosen start date as a setup', () => {
        expect(confirmMethodOf('PAYMENT')).toBe('confirmPayment');
        expect(confirmMethodOf('SETUP')).toBe('confirmSetup');
    });

    it('refuses anything else rather than guessing', () => {
        expect(() => confirmMethodOf(null as unknown as 'PAYMENT')).toThrow(/secretKind/);
    });
});

describe('SubscriptionCheckoutRequestModel (copy of core generator output)', () => {
    it('accepts a dynamic checkout as the shop sends it', () => {
        const request = {
            dynamic: {
                unitAmount: 24.9,
                vatRate: 2.6,
                priceMode: 'BRUTTO',
                lineItems: [{ kind: 'EXTERNAL_PRODUCT', textHtml: 'Bouquet', quantity: 1, unitPrice: 24.9 }],
            },
            currency: 'CHF',
            schedule: tueFri,
            configuration: '{"colours":["red"]}',
            configurationText: 'Red bouquet',
            billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' },
            externalSource: 'flora',
            externalRef: 'cart-1',
            returnUrl: 'https://shop.example/r',
            preview: true,
        };
        expect(SubscriptionCheckoutRequestModel.parse(request)).toEqual(request);
    });

    it('requires preview, as core\'s primitive boolean does', () => {
        expect(
            SubscriptionCheckoutRequestModel.safeParse({
                planId: 4,
                currency: 'CHF',
                schedule: tueFri,
                configurationText: 'x',
                billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' },
                externalSource: 'flora',
                externalRef: 'cart-1',
                returnUrl: 'https://shop.example/r',
            }).success
        ).toBe(false);
    });
});
