import { describe, expect, it, vi } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { fetchPickupSites } from '../src/shop/pickup-site-client';
import { SubscriptionCheckoutRequestModel } from '../src/subscription/wire';

const sites = [
    { id: 3, name: 'Werkstatt', address: { street: 'Hauptstrasse 1', city: 'Zug', zip: '6300', country: 'ch', canton: 'ZG' } },
    { id: 4, name: 'Lager', address: { street: null, city: 'Bern', zip: null, country: 'ch', canton: null } },
];

describe('fetchPickupSites', () => {
    it('lists the pickup sites', async () => {
        const client = { get: vi.fn().mockResolvedValue(sites), post: vi.fn() };
        await expect(fetchPickupSites(client)).resolves.toEqual(sites);
        expect(client.get).toHaveBeenCalledWith('/api/shop/pickup-site');
    });

    it('answers an empty list when the install has no inventory module', async () => {
        const client = { get: vi.fn().mockRejectedValue(new AdibilisApiError(404, null, '/api/shop/pickup-site')), post: vi.fn() };
        await expect(fetchPickupSites(client)).resolves.toEqual([]);
    });

    it('rethrows any other API error', async () => {
        const error = new AdibilisApiError(500, null, '/api/shop/pickup-site');
        const client = { get: vi.fn().mockRejectedValue(error), post: vi.fn() };
        await expect(fetchPickupSites(client)).rejects.toBe(error);
    });

    it('rethrows an error that is not an API error', async () => {
        const error = new Error('network');
        const client = { get: vi.fn().mockRejectedValue(error), post: vi.fn() };
        await expect(fetchPickupSites(client)).rejects.toBe(error);
    });
});

describe('subscription checkout pickupSiteId', () => {
    const base = {
        currency: 'chf',
        schedule: { kind: 'WEEKLY', weekdays: ['TUE'], everyNWeeks: 1 },
        configurationText: 'x',
        billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe', address: { country: 'CH' } },
        externalSource: 'shop',
        externalRef: 'ref',
        returnUrl: 'https://example.com',
        preview: true,
    };
    const parsed = (extra: object) => SubscriptionCheckoutRequestModel.safeParse({ ...base, ...extra });

    it('accepts a number, null and absent', () => {
        const fields = (r: ReturnType<typeof parsed>) => (r.success ? r.data.pickupSiteId : 'invalid');
        expect(fields(parsed({ pickupSiteId: 7 }))).toBe(7);
        expect(fields(parsed({ pickupSiteId: null }))).toBeNull();
        expect(fields(parsed({}))).toBeUndefined();
    });

    it('rejects a non-integer', () => {
        expect(parsed({ pickupSiteId: 1.5 }).success).toBe(false);
    });
});
