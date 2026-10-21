import { AdibilisApiError } from '../client/errors.js';
import { planUnavailableOf } from '../subscription/checkout-refusal.js';
import { SubscriptionUpdateError } from './customer-client.js';

/** Why core refused a subscription action: its state (`CANCELLING` = cancelled at period end, `DYNAMIC` = no plan to change). */
export type SubscriptionActionRefusalReason =
    | 'INCOMPLETE'
    | 'CANCELLED'
    | 'PAST_DUE'
    | 'CANCELLING'
    | 'NOT_PAUSED'
    | 'NOT_CANCELLING'
    | 'DYNAMIC';

const ACTION_REASONS: readonly SubscriptionActionRefusalReason[] = [
    'INCOMPLETE',
    'CANCELLED',
    'PAST_DUE',
    'CANCELLING',
    'NOT_PAUSED',
    'NOT_CANCELLING',
    'DYNAMIC',
];

export type CustomerRefusal =
    /** 401: the session expired, was revoked, or its person is no longer a customer. Clear the cookie and sign in again. */
    | { code: 'CUSTOMER_SESSION_INVALID' }
    /** 401: the mailed link was used, expired, replaced by a newer one or never existed. Offer a new link. */
    | { code: 'CUSTOMER_LOGIN_TOKEN_INVALID' }
    /** 404: core's shop module is off — the portal is closed. */
    | { code: 'SHOP_MODULE_DISABLED' }
    /** 404: no such subscription among the customer's (another customer's id answers the same). */
    | { code: 'SUBSCRIPTION_NOT_FOUND' }
    /** 404: no such delivery on this subscription. */
    | { code: 'SUBSCRIPTION_DELIVERY_NOT_FOUND' }
    /** 404: no such invoice among the customer's transactions (another customer's id answers the same). */
    | { code: 'INVOICE_NOT_FOUND' }
    /** 404: the plan is not listed for this subscription's currency (any more). Re-read the catalog. */
    | { code: 'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND' }
    /** 409: not in this state; `reason` says which (`null` for a reason this SDK does not know yet). Re-read the subscription. */
    | { code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED'; reason: SubscriptionActionRefusalReason | null }
    /** 409: the delivery is too close (or no longer planned) to skip. */
    | { code: 'SUBSCRIPTION_DELIVERY_NOT_SKIPPABLE' }
    /** 409: this subscription has no card to change (cancelled, or never started at Stripe). */
    | { code: 'SUBSCRIPTION_PAYMENT_METHOD_UNAVAILABLE' }
    /** 409: Stripe has the change, core is still writing it: re-read the subscription in a moment. Never repeat the change. */
    | { code: 'CONCURRENT_UPDATE_CONFLICT' }
    /** 409: the new plan adds products the delivery country's distributor has run out of ("stop at 0"); nothing changed. */
    | { code: 'SUBSCRIPTION_PLAN_NOT_AVAILABLE'; planId: number; country: string | null }
    /** 400: the change would alter how often the subscription is billed; cancel and subscribe anew instead. */
    | { code: 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' }
    /** 400: the schedule is not one the plan (or the dynamic settings) offers. */
    | { code: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' }
    /** 400: `field` is the configuration, its text or the unit amount. */
    | { code: 'SUBSCRIPTION_CONFIGURATION_INVALID'; field: string | null }
    /** 400: the resume date is not after today or later than `latest`. */
    | { code: 'SUBSCRIPTION_PAUSE_DATE_INVALID'; latest: string | null }
    /** 400: a delivered subscription needs a delivery address with a country. */
    | { code: 'SUBSCRIPTION_DELIVERY_ADDRESS_REQUIRED' }
    /** 400: the SetupIntent is not confirmed, or not this subscription's. Start the card change again. */
    | { code: 'SUBSCRIPTION_SETUP_INTENT_INVALID' }
    /** 400: the Stripe call failed (a refusal, a timeout or a connection error). The outcome is unknown: re-read the subscription. */
    | { code: 'PAYMENT_PROVIDER_ERROR' }
    /** 400: the login link's `returnUrl` is not on one of core's allowed shop origins — a setup error, not the customer's. */
    | { code: 'SHOP_ORIGIN_NOT_ALLOWED' }
    /** 400: the list's `sortBy` is not a field it can sort by. */
    | { code: 'SORT_FIELD_INVALID' }
    /** 400: the requested page lies outside the list. */
    | { code: 'PAGE_OUT_OF_BOUNDS' }
    /** 429: this visitor, this shop server, or (for card changes) this customer used up its budget. Wait; do not loop. */
    | { code: 'TOO_MANY_REQUESTS' };

type ListedCode = Exclude<
    CustomerRefusal['code'],
    | 'SUBSCRIPTION_ACTION_NOT_ALLOWED'
    | 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED'
    | 'SUBSCRIPTION_CONFIGURATION_INVALID'
    | 'SUBSCRIPTION_PAUSE_DATE_INVALID'
    | 'SUBSCRIPTION_PLAN_NOT_AVAILABLE'
>;

const LISTED: Record<number, readonly ListedCode[]> = {
    400: [
        'SUBSCRIPTION_BILLING_INTERVAL_CHANGE',
        'SUBSCRIPTION_DELIVERY_ADDRESS_REQUIRED',
        'SUBSCRIPTION_SETUP_INTENT_INVALID',
        'PAYMENT_PROVIDER_ERROR',
        'SHOP_ORIGIN_NOT_ALLOWED',
        'SORT_FIELD_INVALID',
        'PAGE_OUT_OF_BOUNDS',
    ],
    401: ['CUSTOMER_SESSION_INVALID', 'CUSTOMER_LOGIN_TOKEN_INVALID'],
    404: [
        'SHOP_MODULE_DISABLED',
        'SUBSCRIPTION_NOT_FOUND',
        'SUBSCRIPTION_DELIVERY_NOT_FOUND',
        'INVOICE_NOT_FOUND',
        'SHOP_SUBSCRIPTION_PLAN_NOT_FOUND',
    ],
    409: ['SUBSCRIPTION_DELIVERY_NOT_SKIPPABLE', 'SUBSCRIPTION_PAYMENT_METHOD_UNAVAILABLE', 'CONCURRENT_UPDATE_CONFLICT'],
    429: ['TOO_MANY_REQUESTS'],
};

type Violation = { field?: unknown; code?: unknown; params?: { latest?: unknown } };

/**
 * Core's refusal of a sign-in or portal call in a form a shop can act on, or `null` for anything else — rethrow that. Reads a
 * `SubscriptionUpdateError` by its cause. Only a 401 that names `CUSTOMER_SESSION_INVALID` means "sign in again": a 401 without
 * it is a wrong WEBSITE key, which no sign-in fixes.
 */
export function customerRefusalOf(error: unknown): CustomerRefusal | null {
    const cause = error instanceof SubscriptionUpdateError ? error.cause : error;
    if (!(cause instanceof AdibilisApiError)) return null;
    const body = cause.body as { errorList?: Record<string, unknown>; violations?: unknown } | null;
    const errorList = body?.errorList ?? {};
    const listed = LISTED[cause.status]?.find((code) => code in errorList);
    if (listed !== undefined) return { code: listed } as CustomerRefusal;
    if (cause.status === 409 && 'SUBSCRIPTION_ACTION_NOT_ALLOWED' in errorList) {
        const argument = (errorList['SUBSCRIPTION_ACTION_NOT_ALLOWED'] as unknown[] | undefined)?.[0];
        return { code: 'SUBSCRIPTION_ACTION_NOT_ALLOWED', reason: ACTION_REASONS.find((reason) => reason === argument) ?? null };
    }
    if (cause.status === 409) {
        const unavailable = planUnavailableOf(errorList);
        if (unavailable !== null) return { code: 'SUBSCRIPTION_PLAN_NOT_AVAILABLE', ...unavailable };
    }
    if (cause.status !== 400) return null;
    const violations = Array.isArray(body?.violations) ? (body.violations as Violation[]) : [];
    const violation = violations.find((v) =>
        v.code === 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' || v.code === 'SUBSCRIPTION_CONFIGURATION_INVALID' || v.code === 'SUBSCRIPTION_PAUSE_DATE_INVALID'
    );
    switch (violation?.code) {
        case 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED':
            return { code: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' };
        case 'SUBSCRIPTION_CONFIGURATION_INVALID':
            return { code: 'SUBSCRIPTION_CONFIGURATION_INVALID', field: typeof violation.field === 'string' ? violation.field : null };
        case 'SUBSCRIPTION_PAUSE_DATE_INVALID': {
            const latest = violation.params?.latest;
            return { code: 'SUBSCRIPTION_PAUSE_DATE_INVALID', latest: typeof latest === 'string' ? latest : null };
        }
        default:
            return null;
    }
}
