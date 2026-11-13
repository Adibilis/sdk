import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdibilisApiError } from '../src/client/errors';
import { cancelOrderByToken, getOrderCancellation } from '../src/order/cancellation';
import { orderCancellationRefusalOf } from '../src/order/refusal';

const visitor = { clientIp: '203.0.113.7' };
const callInit = { headers: { 'X-Shop-Client-Ip': '203.0.113.7' }, cache: 'no-store' };

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() });

const order = {
    orderId: 7,
    orderNumber: 'ORD-7',
    orderStatus: 'CANCELLED',
    orderedAt: '2026-11-01T10:00:00Z',
    cancelledAt: '2026-11-02T10:00:00Z',
    cancellationCause: 'CUSTOMER',
    grandTotal: 25,
    currency: 'CHF',
    lines: [],
    paymentStatus: 'PAID',
    refund: { status: 'SUCCEEDED', amount: 25, currency: 'CHF', refundedAt: '2026-11-02T10:01:00Z' },
    invoiceId: null,
    invoiceNumber: null,
};

describe('order cancellation calls', () => {
    it('getOrderCancellation sends the token in the query, encoded', async () => {
        const client = mockClient();
        client.get.mockResolvedValue(order);
        await expect(getOrderCancellation(client, 'abc.d+f/=', visitor)).resolves.toBe(order);
        expect(client.get).toHaveBeenCalledWith('/api/payment/order/cancellation?token=abc.d%2Bf%2F%3D', callInit);
    });

    it('cancelOrderByToken posts the token', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(order);
        await expect(cancelOrderByToken(client, 'abc.def', visitor)).resolves.toBe(order);
        expect(client.post).toHaveBeenCalledWith('/api/payment/order/cancel', { token: 'abc.def' }, callInit);
    });

    it('a cancel answered with refund FAILED resolves', async () => {
        const client = mockClient();
        const failed = { ...order, refund: { status: 'FAILED', amount: 25, currency: 'CHF', refundedAt: null } };
        client.post.mockResolvedValue(failed);
        await expect(cancelOrderByToken(client, 'abc.def', visitor)).resolves.toBe(failed);
    });

    it.each([['an empty token', ''], ['a blank token', '   '], ['an over-long token', 'x'.repeat(201)]])(
        'rejects %s before any request',
        (_name, token) => {
            const client = mockClient();
            expect(() => getOrderCancellation(client, token, visitor)).toThrow(ZodError);
            expect(() => cancelOrderByToken(client, token, visitor)).toThrow(ZodError);
            expect(client.get).not.toHaveBeenCalled();
            expect(client.post).not.toHaveBeenCalled();
        }
    );
});

describe('orderCancellationRefusalOf', () => {
    it.each([
        [401, { ORDER_CANCELLATION_TOKEN_INVALID: [] }, { code: 'ORDER_CANCELLATION_TOKEN_INVALID' }],
        [401, {}, null],
        [404, { SHOP_MODULE_DISABLED: [] }, { code: 'SHOP_MODULE_DISABLED' }],
        [429, { TOO_MANY_REQUESTS: [] }, { code: 'TOO_MANY_REQUESTS' }],
        [409, { ORDER_ALREADY_CANCELLED: [] }, { code: 'ORDER_ALREADY_CANCELLED' }],
        [409, { ORDER_NOT_CANCELLABLE: ['IN_FULFILLMENT'] }, { code: 'ORDER_NOT_CANCELLABLE', status: 'IN_FULFILLMENT' }],
        [409, { ORDER_NOT_CANCELLABLE: ['NOPE'] }, { code: 'ORDER_NOT_CANCELLABLE', status: null }],
        [409, { ORDER_NOT_CANCELLABLE: [] }, { code: 'ORDER_NOT_CANCELLABLE', status: null }],
        [409, { ORDER_NOT_REFUNDABLE: [] }, { code: 'ORDER_NOT_REFUNDABLE' }],
        [400, { ORDER_ALREADY_CANCELLED: [] }, null],
    ])('%i %j gives %j', (status, errorList, expected) => {
        const error = new AdibilisApiError(status, { errorList }, '/api/payment/order/cancel');
        expect(orderCancellationRefusalOf(error)).toEqual(expected);
    });

    it('is null for a plain Error', () => {
        expect(orderCancellationRefusalOf(new Error('boom'))).toBeNull();
    });
});
