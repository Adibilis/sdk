import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdibilisApiError } from '../src/client/errors';
import {
    amountChangedOf,
    checkoutExpiredOf,
    checkoutPaymentInProgressOf,
    getOrderStatus,
    previewCheckout,
    productUnavailableOf,
    startCheckout,
} from '../src/checkout/checkout-client';

const order = {
    externalRef: 'cart-7f3a',
    externalSource: 'example-shop',
    currency: 'CHF',
    priceMode: 'BRUTTO',
    vatTotal: 0.75,
    grandTotal: 10,
    billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' },
    lineItems: [{ kind: 'SERVICE', textHtml: '<p>Bouquet</p>', quantity: 1, unitType: 'PIECES', unitPrice: 10, vatRate: 8.1 }],
} as const;

const checkoutResponse = {
    orderId: 1,
    orderNumber: 'OR-2026-0001',
    orderStatus: 'PENDING_PAYMENT',
    clientSecret: 'pi_123_secret_456',
    publishableKey: 'pk_test_abc',
    invoiceId: 'in_123',
    amount: 10,
    currency: 'chf',
};

describe('startCheckout', () => {
    it('posts the validated request to the checkout endpoint', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue(checkoutResponse) };

        await expect(startCheckout(client, { order, returnUrl: 'https://shop.example/checkout/return' })).resolves.toEqual(
            checkoutResponse
        );

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', {
            order,
            returnUrl: 'https://shop.example/checkout/return',
            preview: false,
        });
    });

    it('sends preview false even when a caller slips preview true in', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue(checkoutResponse) };
        const sneaky = { order, returnUrl: 'https://shop.example/r', preview: true } as Parameters<typeof startCheckout>[1];

        await startCheckout(client, sneaky);

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', expect.objectContaining({ preview: false }));
    });

    it('rejects an invalid payload before any request is made', async () => {
        const client = { get: vi.fn(), post: vi.fn() };
        const { lineItems: _dropped, ...withoutLines } = order;

        await expect(
            startCheckout(client, { order: withoutLines as unknown as typeof order, returnUrl: 'https://shop.example' })
        ).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('requires a return url, which is what forces every checkout through the origin allow-list', async () => {
        const client = { get: vi.fn(), post: vi.fn() };

        await expect(startCheckout(client, { order, returnUrl: '' })).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });
});

describe('startCheckout expectedAmount', () => {
    it('sends the amount the shop showed, which a plain request does not carry', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue(checkoutResponse) };

        await startCheckout(client, { order, returnUrl: 'https://shop.example/r', expectedAmount: 10.5 });

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', {
            order,
            returnUrl: 'https://shop.example/r',
            preview: false,
            expectedAmount: 10.5,
        });
    });
});

describe('previewCheckout', () => {
    const preview = {
        orderId: null,
        orderNumber: null,
        orderStatus: null,
        clientSecret: null,
        invoiceId: null,
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
        publishableKey: 'pk_test_abc',
        amount: 10,
        taxAmount: 0.75,
        vatRate: 8.1,
        currency: 'chf',
        preview: true,
    };

    it('posts the same body with preview set and returns the totals', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue(preview) };

        await expect(previewCheckout(client, { order, returnUrl: 'https://shop.example/r' })).resolves.toEqual(preview);

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', {
            order,
            returnUrl: 'https://shop.example/r',
            preview: true,
        });
    });

    it('validates the payload before any request is made', async () => {
        const client = { get: vi.fn(), post: vi.fn() };

        await expect(previewCheckout(client, { order, returnUrl: '' })).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });
});

describe('amountChangedOf', () => {
    const refusal = (status: number, errorList: unknown) =>
        new AdibilisApiError(status, { error: 'x', errorList, url: '/api/payment/checkout' }, '/api/payment/checkout');

    it('returns the new amount of a 409 CHECKOUT_AMOUNT_CHANGED', () => {
        expect(amountChangedOf(refusal(409, { CHECKOUT_AMOUNT_CHANGED: ['10.80'] }))).toBe(10.8);
    });

    it.each([
        ['another status', refusal(400, { CHECKOUT_AMOUNT_CHANGED: ['10.80'] })],
        ['another key', refusal(409, { SOMETHING_ELSE: ['10.80'] })],
        ['no param', refusal(409, { CHECKOUT_AMOUNT_CHANGED: [] })],
        ['a non-number param', refusal(409, { CHECKOUT_AMOUNT_CHANGED: ['soon'] })],
        ['a body without errorList', new AdibilisApiError(409, 'conflict', '/p')],
        ['a foreign error', new Error('boom')],
        ['a non-error', null],
    ])('returns null for %s', (_name, error) => {
        expect(amountChangedOf(error)).toBeNull();
    });
});

describe('checkoutExpiredOf', () => {
    const refusal = (status: number, errorList: unknown) =>
        new AdibilisApiError(status, { error: 'x', errorList, url: '/api/payment/checkout' }, '/api/payment/checkout');

    it('is true for a 409 CHECKOUT_EXPIRED', () => {
        expect(checkoutExpiredOf(refusal(409, { CHECKOUT_EXPIRED: [] }))).toBe(true);
    });

    it.each([
        ['another status', refusal(400, { CHECKOUT_EXPIRED: [] })],
        ['another key', refusal(409, { CHECKOUT_AMOUNT_CHANGED: ['1'] })],
        ['a body without errorList', new AdibilisApiError(409, 'conflict', '/p')],
        ['a foreign error', new Error('boom')],
        ['a non-error', null],
    ])('is false for %s', (_name, error) => {
        expect(checkoutExpiredOf(error)).toBe(false);
    });
});

describe('checkoutPaymentInProgressOf', () => {
    const refusal = (status: number, errorList: unknown) =>
        new AdibilisApiError(status, { error: 'x', errorList, url: '/api/payment/checkout' }, '/api/payment/checkout');

    it('is true for a 409 CHECKOUT_PAYMENT_IN_PROGRESS', () => {
        expect(checkoutPaymentInProgressOf(refusal(409, { CHECKOUT_PAYMENT_IN_PROGRESS: [] }))).toBe(true);
    });

    it('is false for CHECKOUT_EXPIRED', () => {
        expect(checkoutPaymentInProgressOf(refusal(409, { CHECKOUT_EXPIRED: [] }))).toBe(false);
    });
});

describe('productUnavailableOf', () => {
    const refusal = (status: number, errorList: unknown) =>
        new AdibilisApiError(status, { error: 'x', errorList, url: '/api/payment/checkout' }, '/api/payment/checkout');

    it('returns the product and country of a 409 SHOP_PRODUCT_NOT_AVAILABLE', () => {
        const error = new AdibilisApiError(409, { errorList: { SHOP_PRODUCT_NOT_AVAILABLE: ['12', 'DE'] } }, '/api/payment/checkout');
        expect(productUnavailableOf(error)).toEqual({ productId: 12, country: 'DE' });
    });

    it('reports no country when core had none to route by', () => {
        expect(productUnavailableOf(refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['12', ''] }))).toEqual({ productId: 12, country: null });
        expect(productUnavailableOf(refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['12'] }))).toEqual({ productId: 12, country: null });
    });

    it.each([
        ['the amount-changed refusal', refusal(409, { CHECKOUT_AMOUNT_CHANGED: ['10.80'] })],
        ['another status', refusal(400, { SHOP_PRODUCT_NOT_AVAILABLE: ['12', 'DE'] })],
        ['a non-numeric id', refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['x', 'DE'] })],
        ['a fractional id', refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: ['1.5', 'DE'] })],
        ['no param', refusal(409, { SHOP_PRODUCT_NOT_AVAILABLE: [] })],
        ['a body without errorList', new AdibilisApiError(409, 'conflict', '/p')],
        ['a foreign error', new Error('boom')],
        ['a non-error', null],
    ])('is null for %s', (_name, error) => {
        expect(productUnavailableOf(error)).toBeNull();
    });
});

describe('getOrderStatus', () => {
    it('queries by source and reference, both as query parameters', async () => {
        const status = { orderId: 1, orderNumber: 'OR-2026-0001', orderStatus: 'PAID', paymentStatus: 'SUCCEEDED' };
        const client = { get: vi.fn().mockResolvedValue(status), post: vi.fn() };

        await expect(getOrderStatus(client, 'example-shop', 'cart-7f3a')).resolves.toEqual(status);
        expect(client.get).toHaveBeenCalledWith('/api/payment/order?externalSource=example-shop&externalRef=cart-7f3a');
    });

    it('encodes a reference that would break a path segment', async () => {
        const client = { get: vi.fn().mockResolvedValue({}), post: vi.fn() };

        await getOrderStatus(client, 'example-shop', 'order/2026 #7&x=y');

        const [path] = client.get.mock.calls[0] as [string];
        expect(path).toBe('/api/payment/order?externalSource=example-shop&externalRef=order%2F2026+%237%26x%3Dy');
        expect(new URL(path, 'http://x').searchParams.get('externalRef')).toBe('order/2026 #7&x=y');
    });
});
