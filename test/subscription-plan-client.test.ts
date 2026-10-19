import { describe, expect, it, vi } from 'vitest';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { fetchSubscriptionPlan, fetchSubscriptionPlans } from '../src/subscription/plan-client';
import { isDynamicEntry } from '../src/subscription/types';

const dynamicEntry = {
    id: null,
    dynamic: true,
    title: null,
    description: null,
    billingInterval: null,
    billingIntervalCount: null,
    priceMode: null,
    vatExempt: false,
    leadTimeDays: 2,
    allowStartDateChoice: true,
    scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'WEEKDAYS', everyNWeeks: 1, min: 1, max: 3 },
    prices: [],
};

const plan = {
    id: 4,
    dynamic: false,
    title: 'Weekly bouquet',
    description: null,
    billingInterval: 'MONTH',
    billingIntervalCount: 1,
    priceMode: 'BRUTTO',
    vatExempt: false,
    leadTimeDays: 3,
    allowStartDateChoice: false,
    scheduleDefinition: { mode: 'FIXED', pattern: { kind: 'WEEKLY', weekdays: ['TUE'], everyNWeeks: 1 } },
    prices: [{ currency: 'CHF', amount: 89, vatRate: 2.6 }],
};

const clientRespondingWith = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockImplementation(
        async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    );
    return { client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

describe('fetchSubscriptionPlans', () => {
    it('reads the dynamic entry and the listed plans with the website key', async () => {
        const { client, fetchMock } = clientRespondingWith(200, [dynamicEntry, plan]);

        const entries = await fetchSubscriptionPlans(client);

        expect(entries.map(isDynamicEntry)).toEqual([true, false]);
        expect(entries[0]).toEqual(dynamicEntry);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/shop/subscription-plan');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
    });

    it('surfaces satellites being switched off as a 403, not an empty list', async () => {
        const { client } = clientRespondingWith(403, { error: 'Forbidden', errorList: { SATELLITES_DISABLED: ['Satellites disabled'] } });

        await expect(fetchSubscriptionPlans(client)).rejects.toBeInstanceOf(AdibilisApiError);
        await expect(fetchSubscriptionPlans(client)).rejects.toMatchObject({ status: 403 });
    });
});

describe('fetchSubscriptionPlan', () => {
    it('reads one listed plan by id', async () => {
        const { client, fetchMock } = clientRespondingWith(200, plan);

        await expect(fetchSubscriptionPlan(client, 4)).resolves.toEqual(plan);
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/shop/subscription-plan/4');
    });

    it('answers 404 for a plan that is not listed', async () => {
        const { client } = clientRespondingWith(404, { error: 'Not Found', errorList: { SHOP_SUBSCRIPTION_PLAN_NOT_FOUND: [] } });

        await expect(fetchSubscriptionPlan(client, 99)).rejects.toMatchObject({ status: 404 });
    });
});
