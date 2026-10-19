import { describe, expect, it } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { SubscriptionUpdateError } from '../src/customer/customer-client';
import { customerRefusalOf } from '../src/customer/refusal';

const PATH = '/api/customer/subscription/9';
const apiError = (status: number, body: unknown) => new AdibilisApiError(status, body, PATH);
const listed = (status: number, code: string, params: string[] = []) =>
    apiError(status, { error: 'x', errorList: { [code]: params }, url: `https://core.test${PATH}` });
const violation = (field: string, code: string, params: Record<string, string> = {}) =>
    apiError(400, { violations: [{ field, code, params }] });

describe('customerRefusalOf', () => {
    it.each([
        ['an invalid session', listed(401, 'CUSTOMER_SESSION_INVALID'), { code: 'CUSTOMER_SESSION_INVALID' }],
        ['a spent sign-in link', listed(401, 'CUSTOMER_LOGIN_TOKEN_INVALID'), { code: 'CUSTOMER_LOGIN_TOKEN_INVALID' }],
        ['a closed shop', listed(404, 'SHOP_MODULE_DISABLED', ['Shop module disabled']), { code: 'SHOP_MODULE_DISABLED' }],
        ["another customer's subscription", listed(404, 'SUBSCRIPTION_NOT_FOUND'), { code: 'SUBSCRIPTION_NOT_FOUND' }],
        ['an unknown delivery', listed(404, 'SUBSCRIPTION_DELIVERY_NOT_FOUND'), { code: 'SUBSCRIPTION_DELIVERY_NOT_FOUND' }],
        ['an unlisted plan', listed(404, 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND'), { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' }],
        [
            'an action the state forbids, with its reason',
            listed(409, 'SUBSCRIPTION_ACTION_NOT_ALLOWED', ['CANCELLING']),
            { code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED', reason: 'CANCELLING' },
        ],
        [
            'an action refused for a reason this SDK does not know',
            listed(409, 'SUBSCRIPTION_ACTION_NOT_ALLOWED', ['SOMETHING_NEW']),
            { code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED', reason: null },
        ],
        ['a delivery too close to skip', listed(409, 'SUBSCRIPTION_DELIVERY_NOT_SKIPPABLE'), { code: 'SUBSCRIPTION_DELIVERY_NOT_SKIPPABLE' }],
        ['no card to change', listed(409, 'SUBSCRIPTION_PAYMENT_METHOD_UNAVAILABLE'), { code: 'SUBSCRIPTION_PAYMENT_METHOD_UNAVAILABLE' }],
        ['a lost write race', listed(409, 'CONCURRENT_UPDATE_CONFLICT'), { code: 'CONCURRENT_UPDATE_CONFLICT' }],
        ['another billing interval', listed(400, 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE'), { code: 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' }],
        ['a missing delivery address', listed(400, 'SUBSCRIPTION_DELIVERY_ADDRESS_REQUIRED'), { code: 'SUBSCRIPTION_DELIVERY_ADDRESS_REQUIRED' }],
        ['a foreign SetupIntent', listed(400, 'SUBSCRIPTION_SETUP_INTENT_INVALID'), { code: 'SUBSCRIPTION_SETUP_INTENT_INVALID' }],
        ['a Stripe refusal', listed(400, 'PAYMENT_PROVIDER_ERROR', ['resource_missing']), { code: 'PAYMENT_PROVIDER_ERROR' }],
        ['a callback outside the shop origins', listed(400, 'SHOP_ORIGIN_NOT_ALLOWED'), { code: 'SHOP_ORIGIN_NOT_ALLOWED' }],
        ['a sort field the list does not have', listed(400, 'SORT_FIELD_INVALID', ['nope']), { code: 'SORT_FIELD_INVALID' }],
        ['a page out of bounds', listed(400, 'PAGE_OUT_OF_BOUNDS', ['0']), { code: 'PAGE_OUT_OF_BOUNDS' }],
        ['a spent budget', listed(429, 'TOO_MANY_REQUESTS'), { code: 'TOO_MANY_REQUESTS' }],
        ['a schedule the plan does not offer', violation('schedule', 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED'), { code: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' }],
        [
            'an invalid configuration, with its field',
            violation('unitAmount', 'SUBSCRIPTION_CONFIGURATION_INVALID'),
            { code: 'SUBSCRIPTION_CONFIGURATION_INVALID', field: 'unitAmount' },
        ],
        [
            'a resume date out of range, with the latest one',
            violation('resumesAt', 'SUBSCRIPTION_PAUSE_DATE_INVALID', { latest: '2027-10-19' }),
            { code: 'SUBSCRIPTION_PAUSE_DATE_INVALID', latest: '2027-10-19' },
        ],
    ] as const)('reads %s', (_name, error, expected) => {
        expect(customerRefusalOf(error)).toEqual(expected);
    });

    it('reads the refusal behind a stopped updateSubscription', () => {
        const stopped = new SubscriptionUpdateError('schedule', ['plan'], null, listed(400, 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE'));
        expect(customerRefusalOf(stopped)).toEqual({ code: 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' });
    });

    it.each([
        ['a 401 without the session code, as a wrong WEBSITE key answers', apiError(401, { error: 'Unauthorized', errorList: {} })],
        ['a 401 with a text body', apiError(401, 'Unauthorized')],
        ['a session code on another status', listed(403, 'CUSTOMER_SESSION_INVALID')],
        ['an unrelated violation', violation('configurationText', 'SIZE')],
        ['an unrelated 409', listed(409, 'SUBSCRIPTION_AMOUNT_CHANGED', ['51.00'])],
        ['a foreign error', new Error('boom')],
        ['nothing', null],
    ])('returns null for %s', (_name, error) => {
        expect(customerRefusalOf(error)).toBeNull();
    });
});
