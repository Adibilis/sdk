import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { fetchCancelledBookings } from '../src/shop/booking-client';
import { isBookingCancelled, type CancelledBooking } from '../src/shop/booking-rules';

const cancelled: CancelledBooking[] = [{ productId: 3, startAt: '2026-11-05T16:00:00Z' }];

describe('fetchCancelledBookings', () => {
    it('calls the endpoint', async () => {
        const client = { get: vi.fn().mockResolvedValue(cancelled), post: vi.fn() };
        await expect(fetchCancelledBookings(client)).resolves.toEqual(cancelled);
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/cancelled');
    });

    it('sends the client address when given', async () => {
        const client = { get: vi.fn().mockResolvedValue([]), post: vi.fn() };
        await fetchCancelledBookings(client, { clientIp: '203.0.113.7' });
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/cancelled', {
            headers: { 'X-Shop-Client-Ip': '203.0.113.7' },
        });
    });

    it('rejects, and does not call, for an invalid client address', async () => {
        const client = { get: vi.fn(), post: vi.fn() };
        await expect(fetchCancelledBookings(client, { clientIp: 'not an ip' })).rejects.toBeInstanceOf(ZodError);
        expect(client.get).not.toHaveBeenCalled();
    });
});

describe('isBookingCancelled', () => {
    it.each([
        [3, '2026-11-05T16:00:00Z', true],
        [3, '2026-11-05T16:00:00.000Z', true],
        [3, '2026-11-05T17:00:00+01:00', true],
        [4, '2026-11-05T16:00:00Z', false],
        [3, '2026-11-05T17:00:00Z', false],
        [3, 'not a date', false],
    ])('product %i at %s is %s', (productId, startAt, expected) => {
        expect(isBookingCancelled(productId, startAt, cancelled)).toBe(expected);
    });

    it('is false for an unparsable entry date', () => {
        expect(isBookingCancelled(3, '2026-11-05T16:00:00Z', [{ productId: 3, startAt: 'not a date' }])).toBe(false);
    });

    it('is false for an empty list', () => {
        expect(isBookingCancelled(3, '2026-11-05T16:00:00Z', [])).toBe(false);
    });
});
