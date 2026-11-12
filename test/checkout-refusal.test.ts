import { describe, expect, it } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { checkoutRefusalOf } from '../src/checkout/checkout-refusal';

const refusal = (status: number, errorList: unknown) =>
    new AdibilisApiError(status, { error: 'x', errorList, url: '/api/payment/checkout' }, '/api/payment/checkout');

describe('checkoutRefusalOf', () => {
    it.each([
        ['an amount change', refusal(409, { CHECKOUT_AMOUNT_CHANGED: ['10.80'] }), { code: 'CHECKOUT_AMOUNT_CHANGED', amount: 10.8 }],
        ['an expired checkout', refusal(409, { CHECKOUT_EXPIRED: [] }), { code: 'CHECKOUT_EXPIRED' }],
        ['a payment in progress', refusal(409, { CHECKOUT_PAYMENT_IN_PROGRESS: [] }), { code: 'CHECKOUT_PAYMENT_IN_PROGRESS' }],
        ['an unavailable product', refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['7', 'CH'] }), { code: 'SHOP_PRODUCT_NOT_AVAILABLE', productId: 7, country: 'CH' }],
        ['an unavailable product without a country', refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['7', ''] }), { code: 'SHOP_PRODUCT_NOT_AVAILABLE', productId: 7, country: null }],
        ['a refused code', refusal(409, { DISCOUNT_CODE_REFUSED: ['EXPIRED'] }), { code: 'DISCOUNT_CODE_REFUSED', reason: 'EXPIRED' }],
        ['a refused code without delivery', refusal(409, { DISCOUNT_CODE_REFUSED: ['NO_DELIVERY'] }), { code: 'DISCOUNT_CODE_REFUSED', reason: 'NO_DELIVERY' }],
        ['a refused code with an unknown reason', refusal(409, { DISCOUNT_CODE_REFUSED: ['FROM_THE_FUTURE'] }), { code: 'DISCOUNT_CODE_REFUSED', reason: null }],
        ['an open price out of range', refusal(400, { SHOP_PRODUCT_PRICE_OUT_OF_RANGE: ['12', 'CHF'] }), { code: 'SHOP_PRODUCT_PRICE_OUT_OF_RANGE', productId: 12 }],
        ['a product that is not listed', refusal(404, { SHOP_PRODUCT_NOT_FOUND: [] }), { code: 'SHOP_PRODUCT_NOT_FOUND' }],
        ['a product without a price', refusal(400, { SHOP_PRODUCT_NOT_PRICED: ['12', 'EUR'] }), { code: 'SHOP_PRODUCT_NOT_PRICED', productId: 12, currency: 'EUR' }],
        ['a throttled call', refusal(429, { TOO_MANY_REQUESTS: [] }), { code: 'TOO_MANY_REQUESTS' }],
        ['a delivery line with a product', refusal(400, { ORDER_DELIVERY_LINE_WITH_PRODUCT: [] }), { code: 'ORDER_DELIVERY_LINE_WITH_PRODUCT' }],
    ])('reads %s', (_name, error, expected) => {
        expect(checkoutRefusalOf(error)).toEqual(expected);
    });

    it.each([
        ['a refused code on another status', refusal(400, { DISCOUNT_CODE_REFUSED: ['EXPIRED'] })],
        ['a refused code without a reason', refusal(409, { DISCOUNT_CODE_REFUSED: [] })],
        ['an out of range price without a product', refusal(400, { SHOP_PRODUCT_PRICE_OUT_OF_RANGE: [] })],
        ['a product without a price without a currency', refusal(400, { SHOP_PRODUCT_NOT_PRICED: ['12'] })],
        ['a not found on another key', refusal(404, { SOMETHING_ELSE: [] })],
        ['an unknown key', refusal(409, { SOMETHING_ELSE: [] })],
        ['a 429 without the key', refusal(429, { SOMETHING_ELSE: [] })],
        ['another status', refusal(500, { CHECKOUT_EXPIRED: [] })],
        ['a body without errorList', new AdibilisApiError(409, 'conflict', '/p')],
        ['a foreign error', new Error('boom')],
        ['a non-error', null],
    ])('returns null for %s', (_name, error) => {
        expect(checkoutRefusalOf(error)).toBeNull();
    });
});
