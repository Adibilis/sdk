import type { OrderIngestLineItemRequest } from '@adbls/api-types';
import { add, formatDecimal, multiply, parseDecimal, roundHalfUp } from './decimal.js';
import { normalizePattern } from './schedule.js';
import type { BillingInterval, SchedulePattern } from './wire.js';

export interface DynamicPrice {
    interval: BillingInterval;
    intervalCount: number;
    /** What one billing period costs, as a decimal string with two places ("50.00"), in the cart's price mode. */
    periodAmount: string;
}

/**
 * Twin of core's `DynamicSubscriptionPricer`: billing follows the cadence. Weekly bills every `everyNWeeks` weeks at
 * `unitAmount × chosen weekdays`; monthly and yearly bill `unitAmount` once per month or year. `unitAmount` is rounded
 * half-up to cents first. This is the price before VAT is added on a NETTO cart and before Stripe Tax — the charge itself is
 * what `previewSubscriptionCheckout` answers.
 */
export function dynamicPeriodAmount(unitAmount: number | string, pattern: SchedulePattern): DynamicPrice {
    const p = normalizePattern(pattern);
    const unit = roundHalfUp(parseDecimal(unitAmount), 2);
    switch (p.kind) {
        case 'WEEKLY': {
            if (p.weekdays == null || p.everyNWeeks == null) throw new TypeError('A weekly pattern needs weekdays and everyNWeeks');
            return { interval: 'WEEK', intervalCount: p.everyNWeeks, periodAmount: formatDecimal(multiply(unit, parseDecimal(p.weekdays.length))) };
        }
        case 'MONTHLY':
            return { interval: 'MONTH', intervalCount: 1, periodAmount: formatDecimal(unit) };
        case 'YEARLY':
            return { interval: 'YEAR', intervalCount: 1, periodAmount: formatDecimal(unit) };
    }
}

/**
 * The cart total core checks a dynamic checkout's `unitAmount` against: every line's `unitPrice × quantity` rounded half-up to
 * cents, then summed (a missing quantity counts 1, a missing price 0). Send this as `dynamic.unitAmount`, or core refuses with
 * `SUBSCRIPTION_DYNAMIC_AMOUNT_MISMATCH`. Decimal string with two places.
 */
export function dynamicUnitAmount(lineItems: readonly Pick<OrderIngestLineItemRequest, 'quantity' | 'unitPrice'>[]): string {
    let total = parseDecimal('0.00');
    for (const line of lineItems) {
        const quantity = parseDecimal(line.quantity ?? 1);
        const unitPrice = parseDecimal(line.unitPrice ?? 0);
        total = add(total, roundHalfUp(multiply(unitPrice, quantity), 2));
    }
    return formatDecimal(roundHalfUp(total, 2));
}
