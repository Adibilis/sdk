import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { getOrderStatus, startCheckout } from '../src/checkout/checkout-client';

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
        });
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
