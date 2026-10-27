import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import {
    getSubscriptionStatus,
    ipLiteralOf,
    previewSubscriptionCheckout,
    startSubscriptionCheckout,
} from '../src/subscription/checkout-client';
import type { SubscriptionStatus } from '../src/subscription/types';
import type { SubscriptionCheckoutRequest } from '../src/subscription/checkout-client';

const visitor = { clientIp: '203.0.113.7' };
const visitorHeader = { headers: { 'X-Shop-Client-Ip': '203.0.113.7' } };

const request: SubscriptionCheckoutRequest = {
    dynamic: {
        unitAmount: 24.9,
        vatRate: 2.6,
        priceMode: 'BRUTTO',
        lineItems: [
            { kind: 'EXTERNAL_PRODUCT', textHtml: 'Bouquet, red', quantity: 1, unitPrice: 19.9, vatRate: 2.6 },
            { kind: 'EXTERNAL_PRODUCT', textHtml: 'Card', quantity: 2, unitPrice: 2.5, vatRate: 2.6 },
        ],
    },
    currency: 'CHF',
    schedule: { kind: 'WEEKLY', weekdays: ['TUE', 'FRI'], everyNWeeks: 1 },
    configuration: { colours: ['red'] },
    configurationText: 'Red bouquet with a card',
    billingPerson: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe', address: { country: 'CH' } },
    externalSource: 'flora',
    externalRef: 'cart-7f3a-0123456789abcdef',
    returnUrl: 'https://shop.example/subscribe/return',
};
const wireRequest = { ...request, configuration: '{"colours":["red"]}' };

const preview = {
    subscriptionId: null,
    number: null,
    status: null,
    clientSecret: null,
    secretKind: null,
    publishableKey: 'pk_test_abc',
    amount: 49.8,
    taxAmount: 1.26,
    vatRate: 2.6,
    currency: 'CHF',
    billingInterval: 'WEEK',
    billingIntervalCount: 1,
    firstDeliveryAt: '2026-10-23',
    nextBillingAt: '2026-10-26',
    preview: true,
};
const started = { ...preview, subscriptionId: 9, number: 'SU-2026-0009', status: 'INCOMPLETE', clientSecret: 'pi_1_secret_2', secretKind: 'PAYMENT', preview: false };

const mockClient = () => ({ get: vi.fn(), post: vi.fn() });
const refusal = (status: number, code: string, params: string[] = []) =>
    new AdibilisApiError(status, { error: 'x', errorList: { [code]: params }, url: '/api/subscription/checkout' }, '/api/subscription/checkout');

afterEach(() => {
    vi.useRealTimers();
});

describe('previewSubscriptionCheckout', () => {
    it('posts the request with preview true, the serialized configuration and the visitor address', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(preview);

        await expect(previewSubscriptionCheckout(client, request, visitor)).resolves.toEqual(preview);

        expect(client.post).toHaveBeenCalledWith('/api/subscription/checkout', { ...wireRequest, preview: true }, visitorHeader);
    });

    it('never sends an expected amount', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(preview);

        await previewSubscriptionCheckout(client, { ...request, expectedAmount: 1 } as SubscriptionCheckoutRequest, visitor);

        expect(client.post.mock.calls[0][1]).not.toHaveProperty('expectedAmount');
    });
});

describe('startSubscriptionCheckout', () => {
    it('posts preview false with the amount the shop showed', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(started);

        await expect(startSubscriptionCheckout(client, { ...request, expectedAmount: 49.8 }, visitor)).resolves.toEqual(started);

        expect(client.post).toHaveBeenCalledWith(
            '/api/subscription/checkout',
            { ...wireRequest, preview: false, expectedAmount: 49.8 },
            visitorHeader
        );
    });

    it('sends preview false even when a caller slips preview true in', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(started);
        const sneaky = { ...request, expectedAmount: 49.8, preview: true } as Parameters<typeof startSubscriptionCheckout>[1];

        await startSubscriptionCheckout(client, sneaky, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ preview: false });
    });

    it('refuses to start without an expected amount', async () => {
        const client = mockClient();

        await expect(
            startSubscriptionCheckout(client, request as Parameters<typeof startSubscriptionCheckout>[1], visitor)
        ).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('passes a configuration string through when it holds a JSON object', async () => {
        const client = mockClient();
        client.post.mockResolvedValue(started);

        await startSubscriptionCheckout(client, { ...request, configuration: '{"colours":["white"]}', expectedAmount: 49.8 }, visitor);

        expect(client.post.mock.calls[0][1]).toMatchObject({ configuration: '{"colours":["white"]}' });
    });
});

describe('local checks, before any request', () => {
    const start = (changes: Record<string, unknown>) => {
        const client = mockClient();
        const promise = startSubscriptionCheckout(client, { ...request, expectedAmount: 49.8, ...changes } as never, visitor);
        return { client, promise };
    };

    it.each([
        ['both a plan and a dynamic cart', { planId: 4 }],
        ['neither a plan nor a dynamic cart', { dynamic: null }],
        ['a configuration that is an array', { configuration: '[1,2]' }],
        ['a configuration that is not JSON', { configuration: 'red please' }],
        ['a start date that is not ISO', { startDate: '23.10.2026' }],
        ['a weekday listed twice', { schedule: { kind: 'WEEKLY', weekdays: ['TUE', 'TUE'], everyNWeeks: 1 } }],
        ['a monthly schedule with weekdays', { schedule: { kind: 'MONTHLY', dayOfMonth: 1, weekdays: ['MON'] } }],
    ])('refuses %s', async (_name, changes) => {
        const { client, promise } = start(changes);

        await expect(promise).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it("refuses a unit amount that is not the lines' total, and names the total", async () => {
        const { client, promise } = start({ dynamic: { ...request.dynamic, unitAmount: 25 } });

        await expect(promise).rejects.toThrow(/24\.90/);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('refuses a line that is not an external product', async () => {
        const lines = [{ kind: 'SERVICE', textHtml: 'Delivery', quantity: 1, unitPrice: 24.9 }];
        const { promise } = start({ dynamic: { ...request.dynamic, lineItems: lines } });

        await expect(promise).rejects.toBeInstanceOf(ZodError);
    });

    it('refuses a line linked to a core product', async () => {
        const lines = [{ kind: 'EXTERNAL_PRODUCT', textHtml: 'Rose', quantity: 1, unitPrice: 24.9, productId: 12 }];
        const { promise } = start({ dynamic: { ...request.dynamic, lineItems: lines } });

        await expect(promise).rejects.toBeInstanceOf(ZodError);
    });

    it('sums lines exactly, so a total that floats get wrong still matches', async () => {
        const lines = [{ kind: 'EXTERNAL_PRODUCT', textHtml: 'Stem', quantity: 3, unitPrice: 0.1 }];
        const client = mockClient();
        client.post.mockResolvedValue(started);
        const dynamic = { ...request.dynamic!, unitAmount: 0.3, lineItems: lines };

        await expect(startSubscriptionCheckout(client, { ...request, dynamic, expectedAmount: 0.6 }, visitor)).resolves.toEqual(started);
    });
});

describe('the visitor address', () => {
    it.each([
        ['an IPv4 address', '203.0.113.7', '203.0.113.7'],
        ['surrounding whitespace', ' 203.0.113.7 ', '203.0.113.7'],
        ['an IPv6 address', '2001:db8::1', '2001:db8::1'],
        ['an IPv4-mapped IPv6 address from a dual-stack server', '::ffff:203.0.113.7', '203.0.113.7'],
        ['an IPv4-mapped address in hex', '::ffff:cb00:7107', '203.0.113.7'],
    ])('sends %s as core reads it', (_name, input, sent) => {
        expect(ipLiteralOf(input)).toBe(sent);
    });

    it.each([
        ['empty', ''],
        ['a forwarded-for list', '203.0.113.7, 10.0.0.1'],
        ['a host name', 'shop.example'],
        ['an address with a port', '203.0.113.7:443'],
        ['an IPv6 zone', 'fe80::1%eth0'],
        ['a broken IPv6 address', '1:2:3'],
    ])('refuses %s', async (_name, input) => {
        const client = mockClient();

        expect(ipLiteralOf(input)).toBeNull();
        await expect(previewSubscriptionCheckout(client, request, { clientIp: input })).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    it('reaches core as the X-Shop-Client-Ip header next to the key', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(preview), { status: 200, headers: { 'content-type': 'application/json' } })
        );
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });

        await previewSubscriptionCheckout(client, request, { clientIp: '::ffff:203.0.113.7' });

        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(headers['X-API-Secret-Key']).toBe('k');
    });
});

describe('a lost database lock', () => {
    it('is retried once after 250 ms', async () => {
        vi.useFakeTimers();
        const client = mockClient();
        client.post.mockRejectedValueOnce(refusal(409, 'CONCURRENT_UPDATE_CONFLICT')).mockResolvedValueOnce(started);

        const pending = startSubscriptionCheckout(client, { ...request, expectedAmount: 49.8 }, visitor);
        await vi.advanceTimersByTimeAsync(249);
        expect(client.post).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(pending).resolves.toEqual(started);
        expect(client.post).toHaveBeenCalledTimes(2);
        expect(client.post.mock.calls[1]).toEqual(client.post.mock.calls[0]);
    });

    it('surfaces a second conflict', async () => {
        vi.useFakeTimers();
        const client = mockClient();
        client.post.mockRejectedValue(refusal(409, 'CONCURRENT_UPDATE_CONFLICT'));

        const assertion = expect(startSubscriptionCheckout(client, { ...request, expectedAmount: 49.8 }, visitor)).rejects.toMatchObject({
            status: 409,
        });
        await vi.advanceTimersByTimeAsync(250);
        await assertion;
        expect(client.post).toHaveBeenCalledTimes(2);
    });

    it.each(['SUBSCRIPTION_AMOUNT_CHANGED', 'SUBSCRIPTION_CHECKOUT_CHANGED', 'SUBSCRIPTION_CHECKOUT_EXPIRED'])(
        'is not confused with %s, which is never retried',
        async (code) => {
            const client = mockClient();
            client.post.mockRejectedValue(refusal(409, code, ['51.00']));

            await expect(startSubscriptionCheckout(client, { ...request, expectedAmount: 49.8 }, visitor)).rejects.toMatchObject({ status: 409 });
            expect(client.post).toHaveBeenCalledTimes(1);
        }
    );
});

describe('getSubscriptionStatus', () => {
    it('queries by source and reference, both as query parameters, with the visitor address', async () => {
        const status = {
            subscriptionId: 9,
            number: 'SU-2026-0009',
            status: 'INCOMPLETE',
            stripeStatus: 'incomplete',
            firstPaymentStatus: 'PROCESSING',
            firstDeliveryAt: '2026-10-23',
            nextBillingAt: null,
        };
        const client = mockClient();
        client.get.mockResolvedValue(status);

        await expect(getSubscriptionStatus(client, 'flora', 'cart/7 #x', visitor)).resolves.toEqual(status);

        expect(client.get).toHaveBeenCalledWith('/api/subscription/status?externalSource=flora&externalRef=cart%2F7+%23x', visitorHeader);
    });

    it('carries EXPIRED, the status of a checkout core gave up on', async () => {
        const expired: SubscriptionStatus = 'EXPIRED';
        const client = mockClient();
        client.get.mockResolvedValue({ subscriptionId: 9, number: 'SU-2026-0009', status: expired, stripeStatus: null, firstPaymentStatus: null, firstDeliveryAt: null, nextBillingAt: null });

        await expect(getSubscriptionStatus(client, 'flora', 'cart-7', visitor)).resolves.toMatchObject({ status: 'EXPIRED' });
    });
});
