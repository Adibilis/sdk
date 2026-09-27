import { describe, expect, it } from 'vitest';
import { availableFulfilments, isDelivery, isPickup, type Fulfilment } from '../src/order/order-details';

const pickup: Fulfilment = { type: 'pickup', date: '2026-09-01' };
const delivery: Fulfilment = {
    type: 'delivery', date: '2026-09-01',
    address: { firstname: 'Ada', lastname: 'Lovelace', address: 'Main 1', city: 'Bern', postalCode: '3000' },
};

describe('fulfilment discrimination', () => {
    it('narrows a delivery to its address', () => {
        expect(isDelivery(delivery)).toBe(true);
        if (isDelivery(delivery)) expect(delivery.address.city).toBe('Bern');
    });

    it('narrows a pickup', () => {
        expect(isPickup(pickup)).toBe(true);
        expect(isDelivery(pickup)).toBe(false);
    });
});

describe('availableFulfilments', () => {
    it('lists both when both are enabled', () => {
        expect(availableFulfilments({ pickup: true, delivery: true })).toEqual(['pickup', 'delivery']);
    });

    it('lists only pickup', () => {
        expect(availableFulfilments({ pickup: true, delivery: false })).toEqual(['pickup']);
    });

    it('lists only delivery', () => {
        expect(availableFulfilments({ pickup: false, delivery: true })).toEqual(['delivery']);
    });

    it('returns an empty list when neither is enabled', () => {
        expect(availableFulfilments({ pickup: false, delivery: false })).toEqual([]);
    });
});
