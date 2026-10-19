import { describe, expect, it } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import type { SubscriptionCheckoutRequest } from '../src/subscription/checkout-client';
import { MAX_CART_REF_LENGTH, subscriptionCheckoutRef } from '../src/subscription/checkout-ref';
import { subscriptionCheckoutRefusalOf } from '../src/subscription/checkout-refusal';

const terms: Omit<SubscriptionCheckoutRequest, 'externalRef'> = {
    dynamic: {
        unitAmount: 24.9,
        vatRate: 2.6,
        priceMode: 'BRUTTO',
        lineItems: [{ kind: 'EXTERNAL_PRODUCT', textHtml: 'Bouquet, red', quantity: 1, unitPrice: 24.9 }],
    },
    currency: 'CHF',
    schedule: { kind: 'WEEKLY', weekdays: ['TUE', 'FRI'], everyNWeeks: 1 },
    configuration: { colours: ['red'] },
    configurationText: 'Red bouquet',
    billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe', address: { country: 'CH' } },
    externalSource: 'flora',
    returnUrl: 'https://shop.example/subscribe/return',
};

describe('subscriptionCheckoutRef', () => {
    it('appends a 16-digit fingerprint of the terms to the cart reference', async () => {
        await expect(subscriptionCheckoutRef('cart-7f3a', terms)).resolves.toMatch(/^cart-7f3a-[0-9a-f]{16}$/);
    });

    it('is the same for the same cart, so a retry with another card resumes the open checkout', async () => {
        const again = { ...terms, schedule: { kind: 'WEEKLY', weekdays: ['FRI', 'TUE'], everyNWeeks: 1 } } as const;
        expect(await subscriptionCheckoutRef('cart-7f3a', again)).toBe(await subscriptionCheckoutRef('cart-7f3a', terms));
    });

    it('ignores what core does not compare', async () => {
        const elsewhere = { ...terms, returnUrl: 'https://shop.example/other', externalSource: 'flora-2', expectedAmount: 99 };
        expect(await subscriptionCheckoutRef('cart-7f3a', elsewhere)).toBe(await subscriptionCheckoutRef('cart-7f3a', terms));
    });

    it.each([
        ['another line price', { dynamic: { ...terms.dynamic!, unitAmount: 25.9, lineItems: [{ kind: 'EXTERNAL_PRODUCT', unitPrice: 25.9 }] } }],
        ['another schedule', { schedule: { kind: 'MONTHLY', dayOfMonth: 1 } }],
        ['a start date', { startDate: '2026-11-03' }],
        ['another configuration', { configuration: { colours: ['white'] } }],
        ['another configuration text', { configurationText: 'White bouquet' }],
        ['another delivery address', { deliveryPerson: { email: 'jo@example.com', firstname: 'Jo', lastname: 'Doe' } }],
    ] as const)('changes with %s, so core never sees the old reference with new terms', async (_name, change) => {
        expect(await subscriptionCheckoutRef('cart-7f3a', { ...terms, ...change })).not.toBe(await subscriptionCheckoutRef('cart-7f3a', terms));
    });

    it('treats the configuration as the exact string core compares', async () => {
        const reordered = { ...terms, configuration: { size: 'L', colours: ['red'] } };
        const ordered = { ...terms, configuration: { colours: ['red'], size: 'L' } };
        expect(await subscriptionCheckoutRef('cart-7f3a', reordered)).not.toBe(await subscriptionCheckoutRef('cart-7f3a', ordered));
    });

    it('keeps the reference within core\'s 120 characters', async () => {
        const longest = 'c'.repeat(MAX_CART_REF_LENGTH);
        expect((await subscriptionCheckoutRef(longest, terms)).length).toBe(120);
        await expect(subscriptionCheckoutRef(`${longest}c`, terms)).rejects.toBeInstanceOf(RangeError);
        await expect(subscriptionCheckoutRef('  ', terms)).rejects.toBeInstanceOf(RangeError);
    });
});

describe('subscriptionCheckoutRefusalOf', () => {
    const apiError = (status: number, body: unknown) => new AdibilisApiError(status, body, '/api/subscription/checkout');
    const listed = (status: number, code: string, params: string[] = []) =>
        apiError(status, { error: 'x', errorList: { [code]: params }, url: 'https://core.test/api/subscription/checkout' });

    it.each([
        ['the new amount', listed(409, 'SUBSCRIPTION_AMOUNT_CHANGED', ['51.30']), { code: 'SUBSCRIPTION_AMOUNT_CHANGED', amount: 51.3 }],
        ['changed terms', listed(409, 'SUBSCRIPTION_CHECKOUT_CHANGED'), { code: 'SUBSCRIPTION_CHECKOUT_CHANGED' }],
        ['an expired checkout', listed(409, 'SUBSCRIPTION_CHECKOUT_EXPIRED'), { code: 'SUBSCRIPTION_CHECKOUT_EXPIRED' }],
        ['an already active subscription', listed(400, 'SUBSCRIPTION_ALREADY_ACTIVE'), { code: 'SUBSCRIPTION_ALREADY_ACTIVE' }],
        ['the rate limit', listed(429, 'TOO_MANY_REQUESTS'), { code: 'TOO_MANY_REQUESTS' }],
        ['a plan that is not listed', listed(404, 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND'), { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' }],
        ['a disabled dynamic entry', listed(400, 'SUBSCRIPTION_DYNAMIC_DISABLED'), { code: 'SUBSCRIPTION_DYNAMIC_DISABLED' }],
        [
            'a start date that is not offered',
            apiError(400, { violations: [{ field: 'startDate', code: 'SUBSCRIPTION_START_DATE_NOT_ALLOWED', params: {} }] }),
            { code: 'SUBSCRIPTION_START_DATE_NOT_ALLOWED' },
        ],
        [
            'the earliest start date',
            apiError(400, { violations: [{ field: 'startDate', code: 'SUBSCRIPTION_START_DATE_INVALID', params: { earliest: '2026-10-21' } }] }),
            { code: 'SUBSCRIPTION_START_DATE_INVALID', earliest: '2026-10-21' },
        ],
    ] as const)('reads %s', (_name, error, expected) => {
        expect(subscriptionCheckoutRefusalOf(error)).toEqual(expected);
    });

    it.each([
        ['a lock conflict', listed(409, 'CONCURRENT_UPDATE_CONFLICT')],
        ['an amount change without its amount', listed(409, 'SUBSCRIPTION_AMOUNT_CHANGED')],
        ['an amount change on another status', listed(400, 'SUBSCRIPTION_AMOUNT_CHANGED', ['51.30'])],
        ['another violation', apiError(400, { violations: [{ field: 'schedule', code: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED', params: {} }] })],
        ['a 429 without its code', listed(429, 'SOMETHING_ELSE')],
        ['a 404 for another code', listed(404, 'NOT_FOUND')],
        ['a text body', apiError(409, 'Conflict')],
        ['a foreign error', new Error('boom')],
        ['nothing', null],
    ])('returns null for %s', (_name, error) => {
        expect(subscriptionCheckoutRefusalOf(error)).toBeNull();
    });
});
