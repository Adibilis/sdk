import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDecimal, parseDecimal, roundHalfUp } from '../src/subscription/decimal';
import { dynamicPeriodAmount, dynamicUnitAmount } from '../src/subscription/pricing';
import type { SchedulePattern } from '../src/subscription/wire';

interface PricingCase {
    name: string;
    unitAmount: string;
    pattern: SchedulePattern;
    interval: string;
    intervalCount: number;
    periodAmount: string;
}

// A verbatim copy of core's backend/src/test/resources/schedule/dynamic-pricing.json, which DynamicSubscriptionPricerTest runs.
const cases = JSON.parse(readFileSync(new URL('./fixtures/core/schedule/dynamic-pricing.json', import.meta.url), 'utf8')) as PricingCase[];

const halfUp = (value: number | string) => formatDecimal(roundHalfUp(parseDecimal(value), 2));

describe('dynamicPeriodAmount (core fixture)', () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
        expect(dynamicPeriodAmount(c.unitAmount, c.pattern)).toEqual({
            interval: c.interval,
            intervalCount: c.intervalCount,
            periodAmount: c.periodAmount,
        });
    });

    it('runs every core case', () => {
        expect(cases.length).toBeGreaterThanOrEqual(7);
        expect(cases.some((c) => c.pattern.kind === 'MONTHLY_WEEKDAY')).toBe(true);
    });

    it('rounds a number the way core rounds the same JSON number, where floats would not', () => {
        expect(dynamicPeriodAmount(12.345, { kind: 'MONTHLY', dayOfMonth: 1 }).periodAmount).toBe('12.35');
        expect(dynamicPeriodAmount(1.005, { kind: 'MONTHLY', dayOfMonth: 1 }).periodAmount).toBe('1.01');
        expect((1.005).toFixed(2)).toBe('1.00');
    });
});

describe('dynamicUnitAmount', () => {
    it('rounds each line half-up to cents, then sums', () => {
        expect(dynamicUnitAmount([{ quantity: 3, unitPrice: 4.115 }])).toBe('12.35');
        expect(dynamicUnitAmount([{ quantity: 1, unitPrice: 0.005 }, { quantity: 1, unitPrice: 0.005 }])).toBe('0.02');
        expect(dynamicUnitAmount([{ quantity: 1, unitPrice: 19.9 }, { quantity: 2, unitPrice: 2.5 }])).toBe('24.90');
    });

    it('is exact where float sums are not', () => {
        expect(0.1 * 3).not.toBe(0.3);
        expect(dynamicUnitAmount([{ quantity: 3, unitPrice: 0.1 }])).toBe('0.30');
    });

    it('counts a missing quantity as 1 and a missing price as 0', () => {
        expect(dynamicUnitAmount([{ unitPrice: 12 }, { quantity: 2 }, { quantity: null, unitPrice: null }])).toBe('12.00');
    });

    it('rounds a negative line away from zero, like BigDecimal HALF_UP', () => {
        expect(dynamicUnitAmount([{ unitPrice: 10 }, { unitPrice: -0.005 }])).toBe('9.99');
    });
});

describe('decimal parsing', () => {
    it('reads what String() gives for a number, exponent included', () => {
        expect(halfUp(1e-7)).toBe('0.00');
        expect(halfUp('2.5e1')).toBe('25.00');
        expect(halfUp(-1.005)).toBe('-1.01');
    });

    it.each(['', 'abc', '1,5', '.'])('refuses %j', (text) => {
        expect(() => parseDecimal(text)).toThrow(RangeError);
    });

    it('refuses a non-finite number', () => {
        expect(() => parseDecimal(Number.NaN)).toThrow(RangeError);
    });
});
