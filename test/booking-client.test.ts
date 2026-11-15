import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { fetchBookingDates, fetchCancelledBookings } from '../src/shop/booking-client';
import { isBookingCancelled, type BookingDate, type CancelledBooking } from '../src/shop/booking-rules';

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

const date: BookingDate = {
    productId: 3,
    startAt: '2026-12-02T18:00:00Z',
    endAt: '2026-12-02T19:00:00Z',
    bookableUntil: '2026-12-02T16:00:00Z',
    cancellableUntil: '2026-12-01T18:00:00Z',
    cancelled: false,
    placesLeft: 4,
    bookable: true,
};

describe('fetchBookingDates', () => {
    it('lists every listed date without a query', async () => {
        const client = { get: vi.fn().mockResolvedValue([date]), post: vi.fn() };
        await expect(fetchBookingDates(client)).resolves.toEqual([date]);
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/dates');
    });

    it('sends the product and the days it is given', async () => {
        const client = { get: vi.fn().mockResolvedValue([]), post: vi.fn() };
        await fetchBookingDates(client, { productId: 3, from: '2026-12-01', to: '2026-12-31' });
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/dates?productId=3&from=2026-12-01&to=2026-12-31');
    });

    it('sends only the parts it is given', async () => {
        const client = { get: vi.fn().mockResolvedValue([]), post: vi.fn() };
        await fetchBookingDates(client, { from: '2026-12-01' });
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/dates?from=2026-12-01');
    });

    it('sends the client address when given', async () => {
        const client = { get: vi.fn().mockResolvedValue([]), post: vi.fn() };
        await fetchBookingDates(client, { productId: 3 }, { clientIp: '203.0.113.7' });
        expect(client.get).toHaveBeenCalledWith('/api/shop/booking/dates?productId=3', {
            headers: { 'X-Shop-Client-Ip': '203.0.113.7' },
        });
    });

    it.each([
        ['a fractional product id', { productId: 1.5 }],
        ['a zero product id', { productId: 0 }],
        ['a day with a time', { from: '2026-12-01T00:00:00Z' }],
        ['a day in another format', { to: '01.12.2026' }],
        ['an impossible day', { from: '2026-02-30' }],
    ])('rejects, and does not call, for %s', async (_name, query) => {
        const client = { get: vi.fn(), post: vi.fn() };
        await expect(fetchBookingDates(client, query)).rejects.toBeInstanceOf(ZodError);
        expect(client.get).not.toHaveBeenCalled();
    });

    it('rejects, and does not call, for an invalid client address', async () => {
        const client = { get: vi.fn(), post: vi.fn() };
        await expect(fetchBookingDates(client, {}, { clientIp: 'not an ip' })).rejects.toBeInstanceOf(ZodError);
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
