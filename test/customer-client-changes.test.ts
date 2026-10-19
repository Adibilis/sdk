import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdibilisApiError } from '../src/client/errors';
import { customerFromCookies, SubscriptionUpdateError } from '../src/customer/customer-client';
import type { CustomerClient, CustomerDeliveryPerson } from '../src/customer/customer-client';

const TOKEN = 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc';
const callHeaders = { headers: { 'X-Shop-Client-Ip': '203.0.113.7', 'X-Customer-Session': TOKEN }, cache: 'no-store' };
const BASE = '/api/customer/subscription/9';
const detail = { id: 9, number: 'SU-2026-0009' };
const tueFri = { kind: 'WEEKLY', weekdays: ['TUE', 'FRI'], everyNWeeks: 1 } as const;
const person: CustomerDeliveryPerson = {
    firstname: 'Clara',
    lastname: 'Gift',
    address: { street: 'Seestrasse 1', postalCode: '8002', city: 'Zürich', country: 'CH' },
};

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() });
const signedIn = () => {
    const client = mockClient();
    return { client, customer: customerFromCookies(client, `adbl_customer=${TOKEN}`, { clientIp: '203.0.113.7' }) as CustomerClient };
};
const refusal = (status: number, code: string, params: string[] = []) =>
    new AdibilisApiError(status, { error: 'x', errorList: { [code]: params }, url: BASE }, BASE);

describe('one property per call', () => {
    it.each([
        ['changePlan', (c: CustomerClient) => c.changePlan(9, 4), `${BASE}/plan`, { planId: 4 }],
        ['changeSchedule', (c: CustomerClient) => c.changeSchedule(9, tueFri), `${BASE}/schedule`, { schedule: tueFri }],
        [
            'changeConfiguration',
            (c: CustomerClient) => c.changeConfiguration(9, { configuration: { colours: ['white'] }, configurationText: 'White', unitAmount: 26.5 }),
            `${BASE}/configuration`,
            { configuration: '{"colours":["white"]}', configurationText: 'White', unitAmount: 26.5 },
        ],
        ['changeDeliveryPerson', (c: CustomerClient) => c.changeDeliveryPerson(9, person), `${BASE}/delivery-person`, { deliveryPerson: person }],
    ])('%s patches its own path and answers the fresh detail', async (_name, call, path, body) => {
        const { client, customer } = signedIn();
        client.patch.mockResolvedValue(detail);

        await expect(call(customer)).resolves.toEqual(detail);

        expect(client.patch).toHaveBeenCalledWith(path, body, callHeaders);
    });

    it('keeps the stored configuration when only the text changes', async () => {
        const { client, customer } = signedIn();
        client.patch.mockResolvedValue(detail);

        await customer.changeConfiguration(9, { configurationText: 'Red, no card' });

        expect(client.patch.mock.calls[0][1]).toEqual({ configurationText: 'Red, no card' });
    });
});

describe('state changes', () => {
    it.each([
        ['cancel at period end', (c: CustomerClient) => c.cancel(9, { atPeriodEnd: true }), `${BASE}/cancel`, { atPeriodEnd: true }],
        ['cancel now', (c: CustomerClient) => c.cancel(9, { atPeriodEnd: false }), `${BASE}/cancel`, { atPeriodEnd: false }],
        ['reactivate', (c: CustomerClient) => c.reactivate(9), `${BASE}/reactivate`, undefined],
        ['pause', (c: CustomerClient) => c.pause(9, { resumesAt: '2026-12-01' }), `${BASE}/pause`, { resumesAt: '2026-12-01' }],
        ['resume', (c: CustomerClient) => c.resume(9), `${BASE}/resume`, undefined],
        ['skipDelivery', (c: CustomerClient) => c.skipDelivery(9, 31), `${BASE}/delivery/31/skip`, undefined],
    ])('%s posts its action', async (_name, call, path, body) => {
        const { client, customer } = signedIn();
        client.post.mockResolvedValue(detail);

        await expect(call(customer)).resolves.toEqual(detail);

        expect(client.post).toHaveBeenCalledWith(path, body, callHeaders);
    });

    it('passes a refusal through untouched and never retries it', async () => {
        const { client, customer } = signedIn();
        client.post.mockRejectedValue(refusal(409, 'CONCURRENT_UPDATE_CONFLICT'));

        await expect(customer.cancel(9, { atPeriodEnd: true })).rejects.toMatchObject({ status: 409 });
        expect(client.post).toHaveBeenCalledTimes(1);
    });
});

describe('local checks, before any request', () => {
    it.each([
        ['a plan id that is not a positive integer', (c: CustomerClient) => c.changePlan(9, 0)],
        ['a weekday listed twice', (c: CustomerClient) => c.changeSchedule(9, { kind: 'WEEKLY', weekdays: ['TUE', 'TUE'], everyNWeeks: 1 })],
        ['a monthly schedule with weekdays', (c: CustomerClient) => c.changeSchedule(9, { kind: 'MONTHLY', dayOfMonth: 1, weekdays: ['MON'] })],
        ['a configuration that is an array', (c: CustomerClient) => c.changeConfiguration(9, { configuration: '[1]', configurationText: 'x' })],
        ['a blank configuration text', (c: CustomerClient) => c.changeConfiguration(9, { configurationText: ' ' })],
        ['a unit amount under a cent', (c: CustomerClient) => c.changeConfiguration(9, { configurationText: 'x', unitAmount: 0.001 })],
        ['a unit amount with three decimals', (c: CustomerClient) => c.changeConfiguration(9, { configurationText: 'x', unitAmount: 24.905 })],
        ['a delivery person without an address', (c: CustomerClient) => c.changeDeliveryPerson(9, { ...person, address: undefined as never })],
        ['a three-letter country', (c: CustomerClient) => c.changeDeliveryPerson(9, { ...person, address: { ...person.address, country: 'CHE' } })],
        ['a cancel without the choice', (c: CustomerClient) => c.cancel(9, {} as { atPeriodEnd: boolean })],
        ['a resume date that is not ISO', (c: CustomerClient) => c.pause(9, { resumesAt: '01.12.2026' })],
        ['a delivery id that is not a positive integer', (c: CustomerClient) => c.skipDelivery(9, -1)],
        ['a subscription id that is not a positive integer', (c: CustomerClient) => c.resume(Number.NaN)],
    ])('refuses %s', async (_name, call) => {
        const { client, customer } = signedIn();

        await expect(call(customer)).rejects.toBeInstanceOf(ZodError);
        expect(client.patch).not.toHaveBeenCalled();
        expect(client.post).not.toHaveBeenCalled();
    });
});

describe('updateSubscription', () => {
    it("sends the parts one by one in core's order and answers the last detail", async () => {
        const { client, customer } = signedIn();
        client.patch.mockResolvedValueOnce({ id: 9, step: 1 }).mockResolvedValueOnce({ id: 9, step: 2 }).mockResolvedValueOnce({ id: 9, step: 3 });

        const result = await customer.updateSubscription(9, {
            deliveryPerson: person,
            schedule: tueFri,
            planId: 4,
        });

        expect(result).toEqual({ id: 9, step: 3 });
        expect(client.patch.mock.calls.map((call) => call[0])).toEqual([`${BASE}/plan`, `${BASE}/schedule`, `${BASE}/delivery-person`]);
    });

    it('checks every part before it sends the first', async () => {
        const { client, customer } = signedIn();

        await expect(
            customer.updateSubscription(9, { planId: 4, deliveryPerson: { ...person, address: { ...person.address, country: 'CHE' } } })
        ).rejects.toBeInstanceOf(ZodError);
        expect(client.patch).not.toHaveBeenCalled();
    });

    it('stops at the first refusal and says what was applied before it', async () => {
        const { client, customer } = signedIn();
        const cause = refusal(400, 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE');
        client.patch.mockResolvedValueOnce({ id: 9, step: 1 }).mockRejectedValueOnce(cause);

        const error = await customer.updateSubscription(9, { planId: 4, schedule: tueFri, configuration: { configurationText: 'x' } }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SubscriptionUpdateError);
        expect(error).toMatchObject({ failed: 'schedule', applied: ['plan'], detail: { id: 9, step: 1 }, cause });
        expect(client.patch).toHaveBeenCalledTimes(2);
    });

    it('reports no detail when the first part is refused', async () => {
        const { client, customer } = signedIn();
        client.patch.mockRejectedValue(refusal(404, 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND'));

        await expect(customer.updateSubscription(9, { planId: 4 })).rejects.toMatchObject({ failed: 'plan', applied: [], detail: null });
    });

    it('refuses an empty change', async () => {
        const { customer } = signedIn();

        await expect(customer.updateSubscription(9, {})).rejects.toBeInstanceOf(RangeError);
    });
});

describe('SubscriptionUpdateError outcome', () => {
    const failing = (cause: unknown) => {
        const { client, customer } = signedIn();
        client.patch.mockResolvedValueOnce(detail).mockRejectedValueOnce(cause);
        return customer.updateSubscription(9, { planId: 4, schedule: tueFri }).catch((e: unknown) => e as SubscriptionUpdateError);
    };

    it.each([
        ['a 409 NOT_ALLOWED', refusal(409, 'SUBSCRIPTION_ACTION_NOT_ALLOWED', ['PAST_DUE']), 'refused'],
        ['a 400 violation', refusal(400, 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE'), 'refused'],
        ['a 404', refusal(404, 'SUBSCRIPTION_NOT_FOUND'), 'refused'],
        ['a 409 CONCURRENT_UPDATE_CONFLICT', refusal(409, 'CONCURRENT_UPDATE_CONFLICT'), 'unknown'],
        ['a 504 from a proxy', new AdibilisApiError(504, '<html>', BASE), 'unknown'],
        ['a 500', refusal(500, 'INTERNAL'), 'unknown'],
        ['a network TypeError', new TypeError('fetch failed'), 'unknown'],
    ])('is %s -> %s', async (_name, cause, outcome) => {
        const error = (await failing(cause)) as SubscriptionUpdateError;

        expect(error).toBeInstanceOf(SubscriptionUpdateError);
        expect(error.outcome).toBe(outcome);
        expect(error.failed).toBe('schedule');
    });
});
