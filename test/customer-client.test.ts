import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { customerFromCookies } from '../src/customer/customer-client';
import { customerRefusalOf } from '../src/customer/refusal';

const TOKEN = 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc';
const visitor = { clientIp: '203.0.113.7' };
const callHeaders = { headers: { 'X-Shop-Client-Ip': '203.0.113.7', 'X-Customer-Session': TOKEN }, cache: 'no-store' };

const page = { content: [], number: 0, size: 20, totalPages: 0, totalElements: 0 };

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() });
const signedIn = (client = mockClient()) => ({ client, customer: customerFromCookies(client, `theme=dark; __Host-adbl_customer=${TOKEN}`, visitor)! });

describe('customerFromCookies', () => {
    it('reads the session from a cookie store such as Next’s cookies()', () => {
        const store = { get: (name: string) => (name === '__Host-adbl_customer' ? { name, value: TOKEN } : undefined) };
        expect(customerFromCookies(mockClient(), store, visitor)).not.toBeNull();
    });

    it('reads the session from a raw Cookie header', () => {
        expect(customerFromCookies(mockClient(), `a=1; __Host-adbl_customer=${TOKEN}; b=2`, visitor)).not.toBeNull();
    });

    it.each([
        ['no cookie', ''],
        ['an emptied cookie', '__Host-adbl_customer=; theme=dark'],
        ['a cookie over 128 characters', `__Host-adbl_customer=${'x'.repeat(129)}`],
        ['a similar name', `x__Host-adbl_customer=${TOKEN}`],
        ['the unprefixed name', `adbl_customer=${TOKEN}`],
        ['nothing at all', null],
    ])('is null with %s, and makes no request', (_name, cookies) => {
        const client = mockClient();
        expect(customerFromCookies(client, cookies, visitor)).toBeNull();
        expect(client.get).not.toHaveBeenCalled();
    });

    it.each([
        ['a newline', 'abc\ndef'],
        ['a character above 255', 'abc\u0100def'],
        ['a space inside', 'abc def'],
    ])('is null for a store value with %s', (_name, value) => {
        expect(customerFromCookies(mockClient(), { get: () => ({ value }) }, visitor)).toBeNull();
    });

    it('takes the last of two cookies of that name in a raw header, as Next’s cookie store does', async () => {
        const client = mockClient();
        client.get.mockResolvedValue({});
        const customer = customerFromCookies(client, `__Host-adbl_customer=first; __Host-adbl_customer=${TOKEN}`, visitor)!;

        await customer.getSubscription(1);

        expect(client.get.mock.calls[0][1].headers['X-Customer-Session']).toBe(TOKEN);
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
        const customer = customerFromCookies(client, `__Host-adbl_customer=${TOKEN}`, { clientIp: 'shop.example' })!;

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
        const customer = customerFromCookies(createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock }), `__Host-adbl_customer=${TOKEN}`, visitor)!;

        const error = await customer.getSubscription(77).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect((error as AdibilisApiError).status).toBe(404);
        expect(JSON.stringify({ message: (error as Error).message, body: (error as AdibilisApiError).body, path: (error as AdibilisApiError).path })).not.toContain(TOKEN);
        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['X-Customer-Session']).toBe(TOKEN);
        expect(headers['X-API-Secret-Key']).toBe('k');
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/customer/subscription/77');
    });

    it('never lets a cache answer for the customer', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
        const customer = customerFromCookies(createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock }), `__Host-adbl_customer=${TOKEN}`, visitor)!;

        await customer.getSubscription(77);
        await customer.cancel(77, { atPeriodEnd: true });

        for (const call of fetchMock.mock.calls) expect(call[1].cache).toBe('no-store');
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

describe('invoicePdf', () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
    const pdfAnswer = (disposition: string | null, contentType = 'application/pdf') =>
        new Response(pdfBytes, {
            status: 200,
            headers: { 'content-type': contentType, ...(disposition === null ? {} : { 'content-disposition': disposition }) },
        });
    const coreCustomer = (answer: Response) => {
        const fetchMock = vi.fn().mockResolvedValue(answer);
        const client = createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock });
        return { fetchMock, customer: customerFromCookies(client, `__Host-adbl_customer=${TOKEN}`, visitor)! };
    };

    it('streams the PDF with the headers to answer the browser with', async () => {
        const { fetchMock, customer } = coreCustomer(pdfAnswer('inline; filename="RE-2026-0042.pdf"'));

        const pdf = await customer.invoicePdf(42);

        expect(pdf.contentType).toBe('application/pdf');
        expect(pdf.filename).toBe('RE-2026-0042.pdf');
        expect(pdf.headers).toEqual({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="RE-2026-0042.pdf"',
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': "default-src 'none'",
            'X-Content-Type-Options': 'nosniff',
        });
        expect(new Uint8Array(await new Response(pdf.body).arrayBuffer())).toEqual(pdfBytes);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/customer/invoice/42/pdf');
        expect(init.method).toBe('GET');
        expect(init.cache).toBe('no-store');
        expect(init.headers['X-Customer-Session']).toBe(TOKEN);
        expect(init.headers['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(init.headers['X-API-Secret-Key']).toBe('k');
        expect(init.headers['Accept']).toBe('application/pdf, application/json');
    });

    it('sends the session in a header, never in the URL', async () => {
        const { client, customer } = signedIn();
        client.download.mockResolvedValue(pdfAnswer('inline; filename="RE-1.pdf"'));

        await customer.invoicePdf(7);

        expect(client.download).toHaveBeenCalledWith('/api/customer/invoice/7/pdf', {
            headers: { ...callHeaders.headers, Accept: 'application/pdf, application/json' },
            cache: 'no-store',
        });
    });

    it.each([
        ['a non-ASCII number, from filename*', `inline; filename="=?UTF-8?Q?R=C3=A9-1.pdf?="; filename*=UTF-8''R%C3%A9-1.pdf`, 'Ré-1.pdf'],
        ['an escaped quote', 'inline; filename="RE \\"1\\".pdf"', 'RE "1".pdf'],
        ['a token without quotes', 'inline; filename=RE-1.pdf', 'RE-1.pdf'],
        ['no Content-Disposition, from the id', null, '42.pdf'],
    ])('names the file for %s', async (_name, disposition, filename) => {
        const { customer } = coreCustomer(pdfAnswer(disposition));

        const pdf = await customer.invoicePdf(42);

        expect(pdf.filename).toBe(filename);
        expect(pdf.headers['Content-Disposition']).toBe(disposition ?? 'inline; filename="42.pdf"');
    });

    it('accepts a PDF content type with parameters', async () => {
        const { customer } = coreCustomer(pdfAnswer('inline; filename="RE-1.pdf"', 'application/PDF;charset=binary'));

        await expect(customer.invoicePdf(1)).resolves.toMatchObject({ contentType: 'application/pdf' });
    });

    it('refuses to pass on anything but a PDF', async () => {
        const { customer } = coreCustomer(pdfAnswer('inline; filename="x.html"', 'text/html'));

        await expect(customer.invoicePdf(1)).rejects.toThrow(/text\/html.*not a PDF/);
    });

    it.each([0, -3, 1.5])('refuses the invoice id %s before any request', async (id) => {
        const { client, customer } = signedIn();

        await expect(customer.invoicePdf(id)).rejects.toBeInstanceOf(ZodError);
        expect(client.download).not.toHaveBeenCalled();
    });

    it.each([
        [404, 'INVOICE_NOT_FOUND'],
        [401, 'CUSTOMER_SESSION_INVALID'],
        [429, 'TOO_MANY_REQUESTS'],
    ] as const)('reads core\'s %s as the refusal %s, without the session in the error', async (status, code) => {
        const { customer } = coreCustomer(
            new Response(JSON.stringify({ error: 'x', errorList: { [code]: [] }, url: 'https://core.test/api/customer/invoice/9/pdf' }), {
                status,
                headers: { 'content-type': 'application/json' },
            })
        );

        const error = await customer.invoicePdf(9).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AdibilisApiError);
        expect(customerRefusalOf(error)).toEqual({ code });
        expect(JSON.stringify({ message: (error as Error).message, body: (error as AdibilisApiError).body })).not.toContain(TOKEN);
    });
});
