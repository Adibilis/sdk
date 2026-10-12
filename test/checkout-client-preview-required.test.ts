import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { previewCheckout, startCheckout } from '../src/checkout/checkout-client';

// The next @adbls/api-types makes `preview` a required boolean (the Java field is a primitive).
vi.mock('@adbls/api-types', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@adbls/api-types')>();
    return { ...actual, CheckoutRequestModel: actual.CheckoutRequestModel.extend({ preview: z.boolean() }) };
});

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

describe('against a schema that requires preview', () => {
    it('a real checkout still parses and sends preview false', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue({}) };

        await startCheckout(client, { order, returnUrl: 'https://shop.example/r', expectedAmount: 10 });

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', {
            order,
            returnUrl: 'https://shop.example/r',
            preview: false,
            expectedAmount: 10,
        });
    });

    it('a preview still parses and sends preview true', async () => {
        const client = { get: vi.fn(), post: vi.fn().mockResolvedValue({}) };

        await previewCheckout(client, { order, returnUrl: 'https://shop.example/r' });

        expect(client.post).toHaveBeenCalledWith('/api/payment/checkout', {
            order,
            returnUrl: 'https://shop.example/r',
            preview: true,
        });
    });
});
