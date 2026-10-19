// Twins of core's portal rules (Plan 5's SubscriptionActionService), so a shop offers only what core will accept: a portal
// change costs one of the visitor's 10 a minute.
import { dynamicPeriodAmount } from '../subscription/pricing.js';
import { fromEpochDay, toEpochDay, validateScheduleChoice } from '../subscription/schedule.js';
import { isDynamicEntry } from '../subscription/types.js';
import type { ShopSubscriptionEntry, ShopSubscriptionPlan } from '../subscription/types.js';
import type { BillingInterval, SchedulePattern } from '../subscription/wire.js';
import type { CustomerSubscriptionDetail } from './types.js';

/** A customer's pause lasts at most this many days. */
export const PAUSE_HORIZON_DAYS = 365;

/** The resume dates core takes for a customer's pause, both inclusive: tomorrow to 365 days ahead. Pass `todayIn()`. */
export function resumeDateRange(today: string): { earliest: string; latest: string } {
    const day = toEpochDay(today);
    return { earliest: fromEpochDay(day + 1), latest: fromEpochDay(day + PAUSE_HORIZON_DAYS) };
}

export type ScheduleChangeCheck =
    /** `periodAmount` is a dynamic subscription's new price per period ("50.00"); `null` on a plan-based one, whose price stays. */
    | { allowed: true; billingInterval: BillingInterval; billingIntervalCount: number; periodAmount: string | null }
    | { allowed: false; refusal: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' | 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' };

type ScheduleTerms = Pick<CustomerSubscriptionDetail, 'dynamic' | 'scheduleDefinition' | 'unitAmount' | 'billingInterval' | 'billingIntervalCount'>;

/**
 * Whether core takes `schedule` as this subscription's new rhythm, in core's order: it must fit `scheduleDefinition`
 * (`SUBSCRIPTION_SCHEDULE_NOT_ALLOWED`), and on a dynamic subscription keep the billing interval
 * (`SUBSCRIPTION_BILLING_INTERVAL_CHANGE` — from weekly to monthly, or every week to every two weeks). More or fewer weekdays
 * on a dynamic subscription change its price, which this answers.
 */
export function scheduleChangeOf(subscription: ScheduleTerms, schedule: SchedulePattern): ScheduleChangeCheck {
    if (subscription.scheduleDefinition == null || !validateScheduleChoice(subscription.scheduleDefinition, schedule)) {
        return { allowed: false, refusal: 'SUBSCRIPTION_SCHEDULE_NOT_ALLOWED' };
    }
    const { billingInterval, billingIntervalCount } = subscription;
    if (!subscription.dynamic) {
        return { allowed: true, billingInterval, billingIntervalCount, periodAmount: null };
    }
    if (subscription.unitAmount == null) throw new TypeError('A dynamic subscription carries its unitAmount');
    const price = dynamicPeriodAmount(subscription.unitAmount, schedule);
    if (price.interval !== billingInterval || price.intervalCount !== billingIntervalCount) {
        return { allowed: false, refusal: 'SUBSCRIPTION_BILLING_INTERVAL_CHANGE' };
    }
    return { allowed: true, billingInterval, billingIntervalCount, periodAmount: price.periodAmount };
}

type PlanTerms = Pick<CustomerSubscriptionDetail, 'dynamic' | 'plan' | 'schedule' | 'currency' | 'billingInterval' | 'billingIntervalCount'>;

/**
 * The plans of the catalog (`fetchSubscriptionPlans`) this subscription can move to: another plan, priced in its currency, with
 * the same billing interval, whose schedule definition takes the current rhythm (or brings a fixed one). None for a dynamic
 * subscription.
 */
export function plansForChange(entries: readonly ShopSubscriptionEntry[], subscription: PlanTerms): ShopSubscriptionPlan[] {
    if (subscription.dynamic) return [];
    return entries.filter((entry): entry is ShopSubscriptionPlan => {
        if (isDynamicEntry(entry) || entry.id === subscription.plan?.id) return false;
        const definition = entry.scheduleDefinition;
        const schedule = definition.mode === 'FIXED' ? definition.pattern : subscription.schedule;
        return (
            entry.billingInterval === subscription.billingInterval &&
            entry.billingIntervalCount === subscription.billingIntervalCount &&
            entry.prices.some((price) => price.currency === subscription.currency) &&
            validateScheduleChoice(definition, schedule)
        );
    });
}

/** The configuration object your checkout sent, parsed from the detail's `configuration`; `null` when there is none or it is not an object. */
export function configurationObjectOf(configuration: string | null): Record<string, unknown> | null {
    if (configuration == null) return null;
    try {
        const value: unknown = JSON.parse(configuration);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}
