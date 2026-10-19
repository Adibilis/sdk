import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { customerFromCookies } from '../src/customer/customer-client';

const TOKEN = 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc';
const visitor = { clientIp: '203.0.113.7' };
const callHeaders = { headers: { 'X-Shop-Client-Ip': '203.0.113.7', 'X-Customer-Session': TOKEN } };

const page = { content: [], number: 0, size: 20, totalPages: 0, totalElements: 0 };

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() });
const signedIn = (client = mockClient()) => ({ client, customer: customerFromCookies(client, `theme=dark; adbl_customer=${TOKEN}`, visitor)! });

describe('customerFromCookies', () => {
    it('reads the session from a cookie store such as Next’s cookies()', () => {
        const store = { get: (name: string) => (name === 'adbl_customer' ? { name, value: TOKEN } : undefined) };
        expect(customerFromCookies(mockClient(), store, visitor)).not.toBeNull();
    });

    it('reads the session from a raw Cookie header', () => {
        expect(customerFromCookies(mockClient(), `a=1; adbl_customer=${TOKEN}; b=2`, visitor)).not.toBeNull();
    });

    it.each([
        ['no cookie', ''],
        ['an emptied cookie', 'adbl_customer=; theme=dark'],
        ['a cookie over 128 characters', `adbl_customer=${'x'.repeat(129)}`],
        ['a similar name', `xadbl_customer=${TOKEN}`],
        ['nothing at all', null],
    ])('is null with %s, and makes no request', (_name, cookies) => {
        const client = mockClient();
        expect(customerFromCookies(client, cookies, visitor)).toBeNull();
        expect(client.get).not.toHaveBeenCalled();
    });

    it('never exposes the session token on the client object', () => {
        const { customer } = signedIn();
        expect(JSON.stringify(customer)).not.toContain(TOKEN);
        expect(Object.values(customer)).not.toContain(TOKEN);
        expect(Object.keys(customer)).toEqual([]);
    });
});

describe('reads', () => {
    it('lists the subscriptions with the session and the visitor address in headers, not in the URL', async () => {
        const { client, customer } = signedIn();
        client.get.mockResolvedValue(page);

        await expect(customer.listSubscriptions()).resolves.toEqual(page);

        expect(client.get).toHaveBeenCalledWith('/api/customer/subscription', callHeaders);
    });

    it('pages the list', async () => {
        const { client, customer } = signedIn();
        client.get.mockResolvedValue(page);

        await customer.listSubscriptions({ page: 2, pageSize: 50 });

        expect(client.get.mock.calls[0][0]).toBe('/api/customer/subscription?page=2&pageSize=50');
    });

    it('reads one subscription', async () => {
        const { client, customer } = signedIn();
        client.get.mockResolvedValue({ id: 9 });

        await customer.getSubscription(9);

        expect(client.get).toHaveBeenCalledWith('/api/customer/subscription/9', callHeaders);
    });

    it('lists the transactions, optionally of one subscription', async () => {
        const { client, customer } = signedIn();
        client.get.mockResolvedValue(page);

        await customer.listTransactions();
        await customer.listTransactions({ subscriptionId: 9, page: 1 });

        expect(client.get.mock.calls[0]).toEqual(['/api/customer/transaction', callHeaders]);
        expect(client.get.mock.calls[1][0]).toBe('/api/customer/transaction?page=1&subscriptionId=9');
    });

    it.each([
        ['a subscription id that is not a positive integer', (c: ReturnType<typeof signedIn>['customer']) => c.getSubscription(0)],
        ['a fractional id', (c: ReturnType<typeof signedIn>['customer']) => c.getSubscription(1.5)],
        ['a negative page', (c: ReturnType<typeof signedIn>['customer']) => c.listSubscriptions({ page: -1 })],
        ['a page size over 200', (c: ReturnType<typeof signedIn>['customer']) => c.listTransactions({ pageSize: 201 })],
    ])('refuses %s before any request', async (_name, call) => {
        const { client, customer } = signedIn();

        await expect(call(customer)).rejects.toBeInstanceOf(ZodError);
        expect(client.get).not.toHaveBeenCalled();
    });

    it('refuses a visitor address core would ignore before any request', async () => {
        const client = mockClient();
        const customer = customerFromCookies(client, `adbl_customer=${TOKEN}`, { clientIp: 'shop.example' })!;

        await expect(customer.listSubscriptions()).rejects.toBeInstanceOf(ZodError);
        expect(client.get).not.toHaveBeenCalled();
    });

    it("surfaces another customer's id as core's 404, without the session in the error", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'Not Found', errorList: { SUBSCRIPTION_NOT_FOUND: [] } }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            })
        );
        const customer = customerFromCookies(createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock }), `adbl_customer=${TOKEN}`, visitor)!;

        const error = await customer.getSubscription(77).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect((error as AdibilisApiError).status).toBe(404);
        expect(JSON.stringify({ message: (error as Error).message, body: (error as AdibilisApiError).body, path: (error as AdibilisApiError).path })).not.toContain(TOKEN);
        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['X-Customer-Session']).toBe(TOKEN);
        expect(headers['X-API-Secret-Key']).toBe('k');
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/customer/subscription/77');
    });
});

describe('logout', () => {
    it('revokes the session in core', async () => {
        const { client, customer } = signedIn();
        client.delete.mockResolvedValue(null);

        await expect(customer.logout()).resolves.toBeUndefined();

        expect(client.delete).toHaveBeenCalledWith('/api/customer/session', callHeaders);
    });
});
