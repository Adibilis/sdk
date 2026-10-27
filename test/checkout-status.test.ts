import { describe, expect, it } from 'vitest';
import { checkoutStatusOutcome } from '../src/checkout/checkout-status';

describe('checkoutStatusOutcome', () => {
    it.each([
        ['PAID', 'paid'],
        ['IN_FULFILLMENT', 'paid'],
        ['FULFILLED', 'paid'],
        ['EXPIRED', 'expired'],
        ['CANCELLED', 'expired'],
        ['PENDING_PAYMENT', 'pending'],
        ['SOMETHING_NEW', 'pending'],
        [null, 'pending'],
        [undefined, 'pending'],
    ] as const)('%s → %s', (status, outcome) => {
        expect(checkoutStatusOutcome(status)).toBe(outcome);
    });
});
