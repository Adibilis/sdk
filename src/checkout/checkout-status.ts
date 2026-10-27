import type { OrderStatus } from '@adbls/api-types';

/**
 * What a success page does with the order's status: `paid` — done; `expired` — the order can never
 * be paid (core expired the untouched checkout after thirty minutes, or an operator cancelled it),
 * so stop polling and send the buyer back to the cart; `pending` — keep polling.
 */
export type CheckoutOutcome = 'paid' | 'pending' | 'expired';

const PAID: ReadonlySet<string> = new Set(['PAID', 'IN_FULFILLMENT', 'FULFILLED']);
const DEAD: ReadonlySet<string> = new Set(['EXPIRED', 'CANCELLED']);

export function checkoutStatusOutcome(status: OrderStatus | string | null | undefined): CheckoutOutcome {
    if (status != null && PAID.has(status)) return 'paid';
    if (status != null && DEAD.has(status)) return 'expired';
    return 'pending';
}
