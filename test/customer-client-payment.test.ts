import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdibilisApiError } from '../src/client/errors';
import { customerFromCookies } from '../src/customer/customer-client';
import type { CustomerClient } from '../src/customer/customer-client';

const TOKEN = 'k3Jx9QvUeR2m1sYtPz8aLwB4nC7dF0gH5iJ6oK_-abc';
const callHeaders = { headers: { 'X-Shop-Client-Ip': '203.0.113.7', 'X-Customer-Session': TOKEN }, cache: 'no-store' };
const PATH = '/api/customer/subscription/9/payment-method';

const mockClient = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() });
const signedIn = () => {
    const client = mockClient();
    return { client, customer: customerFromCookies(client, `__Host-adbl_customer=${TOKEN}`, { clientIp: '203.0.113.7' }) as CustomerClient };
};

describe('beginPaymentMethodUpdate', () => {
    it('opens a SetupIntent for the subscription', async () => {
        const { client, customer } = signedIn();
        const setup = { clientSecret: 'seti_1Q_secret_abc', publishableKey: 'pk_test_abc' };
        client.post.mockResolvedValue(setup);

        await expect(customer.beginPaymentMethodUpdate(9)).resolves.toEqual(setup);

        expect(client.post).toHaveBeenCalledWith(PATH, undefined, callHeaders);
    });

    it("surfaces the customer's hourly SetupIntent budget as core's 429, without retrying", async () => {
        const { client, customer } = signedIn();
        client.post.mockRejectedValue(new AdibilisApiError(429, { error: 'x', errorList: { TOO_MANY_REQUESTS: [] } }, PATH));

        await expect(customer.beginPaymentMethodUpdate(9)).rejects.toMatchObject({ status: 429 });
        expect(client.post).toHaveBeenCalledTimes(1);
    });
});

describe('confirmPaymentMethod', () => {
    it('confirms with the SetupIntent id and answers the card and the retry outcome', async () => {
        const { client, customer } = signedIn();
        const update = {
            paymentMethod: { type: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
            retry: 'DECLINED',
            hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_abc',
        };
        client.patch.mockResolvedValue(update);

        await expect(customer.confirmPaymentMethod(9, 'seti_1QabcDEF')).resolves.toEqual(update);

        expect(client.patch).toHaveBeenCalledWith(PATH, { setupIntentId: 'seti_1QabcDEF' }, callHeaders);
    });

    it.each([
        ['the client secret instead of the id', 'seti_1QabcDEF_secret_xyz'],
        ['a payment method id', 'pm_1QabcDEF'],
        ['a path', 'seti_../../v1/customers'],
    ])('refuses %s before any request', async (_name, setupIntentId) => {
        const { client, customer } = signedIn();

        await expect(customer.confirmPaymentMethod(9, setupIntentId)).rejects.toBeInstanceOf(ZodError);
        expect(client.patch).not.toHaveBeenCalled();
    });

    it('is never retried', async () => {
        const { client, customer } = signedIn();
        client.patch.mockRejectedValue(new AdibilisApiError(409, { error: 'x', errorList: { CONCURRENT_UPDATE_CONFLICT: [] } }, PATH));

        await expect(customer.confirmPaymentMethod(9, 'seti_1QabcDEF')).rejects.toMatchObject({ status: 409 });
        expect(client.patch).toHaveBeenCalledTimes(1);
    });
});
