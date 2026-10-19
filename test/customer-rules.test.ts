import { describe, expect, it } from 'vitest';
import { configurationObjectOf, plansForChange, resumeDateRange, scheduleChangeOf } from '../src/customer/rules';
import type { ShopSubscriptionEntry, ShopSubscriptionPlan } from '../src/subscription/types';
import type { SchedulePattern } from '../src/subscription/wire';

const weekly = (weekdays: SchedulePattern['weekdays'], everyNWeeks = 1): SchedulePattern => ({ kind: 'WEEKLY', weekdays, everyNWeeks });

const dynamic = {
    dynamic: true,
    scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'WEEKDAYS', everyNWeeks: 1, min: 1, max: 3 },
    unitAmount: 24.9,
    billingInterval: 'WEEK',
    billingIntervalCount: 1,
} as const;

const planBased = {
    dynamic: false,
    plan: { id: 4, title: 'Weekly bouquet', description: null },
    scheduleDefinition: { mode: 'CUSTOMER_CHOICE', options: [weekly(['TUE']), weekly(['FRI'])] },
    schedule: weekly(['TUE']),
    unitAmount: null,
    currency: 'CHF',
    billingInterval: 'MONTH',
    billingIntervalCount: 1,
} as const;

const plan = (id: number, changes: Partial<ShopSubscriptionPlan> = {}): ShopSubscriptionPlan => ({
    id,
    dynamic: false,
    title: `Plan ${id}`,
    description: null,
    billingInterval: 'MONTH',
    billingIntervalCount: 1,
    priceMode: 'BRUTTO',
    vatExempt: false,
    leadTimeDays: 2,
    allowStartDateChoice: false,
    scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'WEEKDAYS', everyNWeeks: 1, min: 1, max: 2 },
    prices: [{ currency: 'CHF', amount: 89, vatRate: 2.6 }],
    ...changes,
});

describe('resumeDateRange', () => {
    it('runs from tomorrow to 365 days ahead', () => {
        expect(resumeDateRange('2026-10-19')).toEqual({ earliest: '2026-10-20', latest: '2027-10-19' });
    });

    it('crosses a leap day', () => {
        expect(resumeDateRange('2027-12-31')).toEqual({ earliest: '2028-01-01', latest: '2028-12-30' });
    });
});

describe('scheduleChangeOf', () => {
    it('prices a dynamic subscription by its new weekdays', () => {
        expect(scheduleChangeOf(dynamic, weekly(['TUE', 'FRI']))).toEqual({
            allowed: true,
            billingInterval: 'WEEK',
            billingIntervalCount: 1,
            periodAmount: '49.80',
        });
    });

    it('refuses a dynamic change of the billing interval, as core does', () => {
        const everySecondWeek = { ...dynamic, scheduleDefinition: { ...dynamic.scheduleDefinition, everyNWeeks: 2 } };
        expect(scheduleChangeOf(everySecondWeek, weekly(['TUE'], 2))).toEqual({ allowed: false, refusal: 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' });
    });

    it('refuses a schedule outside the definition before it looks at the interval', () => {
        expect(scheduleChangeOf(dynamic, weekly(['MON', 'TUE', 'WED', 'THU']))).toEqual({ allowed: false, refusal: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' });
        expect(scheduleChangeOf(dynamic, { kind: 'MONTHLY', dayOfMonth: 1 })).toEqual({ allowed: false, refusal: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' });
    });

    it('keeps a plan-based price', () => {
        expect(scheduleChangeOf(planBased, weekly(['FRI']))).toEqual({ allowed: true, billingInterval: 'MONTH', billingIntervalCount: 1, periodAmount: null });
        expect(scheduleChangeOf(planBased, weekly(['WED']))).toEqual({ allowed: false, refusal: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' });
    });

    it('refuses everything without a definition', () => {
        expect(scheduleChangeOf({ ...planBased, scheduleDefinition: null }, weekly(['TUE']))).toMatchObject({ allowed: false });
    });
});

describe('plansForChange', () => {
    const dynamicEntry = {
        id: null,
        dynamic: true,
        title: null,
        description: null,
        billingInterval: null,
        billingIntervalCount: null,
        priceMode: null,
        vatExempt: false,
        leadTimeDays: 2,
        allowStartDateChoice: false,
        scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'WEEKDAYS', everyNWeeks: 1, min: 1, max: 3 },
        prices: [],
    } satisfies ShopSubscriptionEntry;

    it('offers the plans core would accept', () => {
        const entries: ShopSubscriptionEntry[] = [
            dynamicEntry,
            plan(4),
            plan(5),
            plan(6, { billingInterval: 'YEAR' }),
            plan(7, { prices: [{ currency: 'EUR', amount: 79, vatRate: 19 }] }),
            plan(8, { scheduleDefinition: { mode: 'CUSTOMER_FREE', freeKind: 'DAY_OF_MONTH' } }),
            plan(9, { scheduleDefinition: { mode: 'FIXED', pattern: { kind: 'MONTHLY', dayOfMonth: 1 } } }),
        ];

        expect(plansForChange(entries, planBased).map((p) => p.id)).toEqual([5, 9]);
    });

    it('offers nothing to a dynamic subscription', () => {
        expect(plansForChange([plan(5)], { ...planBased, dynamic: true, plan: null })).toEqual([]);
    });
});

describe('configurationObjectOf', () => {
    it.each([
        ['{"colours":["red"]}', { colours: ['red'] }],
        [null, null],
        ['[1,2]', null],
        ['"red"', null],
        ['not json', null],
    ])('reads %s', (input, expected) => {
        expect(configurationObjectOf(input)).toEqual(expected);
    });
});
