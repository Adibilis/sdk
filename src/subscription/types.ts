import type {
    BillingInterval,
    PaymentStatus,
    PriceMode,
    ScheduleDefinition,
    SubscriptionSecretKind,
    SubscriptionStatus,
} from './wire.js';

export type {
    BillingInterval,
    PaymentStatus,
    PriceMode,
    ScheduleDefinition,
    SchedulePattern,
    SubscriptionSecretKind,
    SubscriptionStatus,
    Weekday,
} from './wire.js';

export interface SubscriptionPlanPrice {
    currency: string;
    /** Per billing period, in the plan's `priceMode`. */
    amount: number;
    /** Percent; `null` on a VAT-exempt plan. */
    vatRate: number | null;
}

interface ShopSubscriptionEntryBase {
    vatExempt: boolean;
    leadTimeDays: number;
    allowStartDateChoice: boolean;
    scheduleDefinition: ScheduleDefinition;
}

/** A plan the owner listed on satellites. */
export interface ShopSubscriptionPlan extends ShopSubscriptionEntryBase {
    dynamic: false;
    id: number;
    title: string;
    description: string | null;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    priceMode: PriceMode;
    prices: SubscriptionPlanPrice[];
}

/**
 * Core's "Subscribe this order" entry: present, first in the list, while the owner enabled dynamic subscriptions. It has no
 * plan, no price and no interval — the cart is the price and the chosen pattern decides the interval (`dynamicPeriodAmount`).
 */
export interface DynamicSubscriptionEntry extends ShopSubscriptionEntryBase {
    dynamic: true;
    id: null;
    title: null;
    description: null;
    billingInterval: null;
    billingIntervalCount: null;
    priceMode: null;
    vatExempt: false;
    prices: [];
}

export type ShopSubscriptionEntry = ShopSubscriptionPlan | DynamicSubscriptionEntry;

/** `true` for the dynamic entry. A core without dynamic subscriptions sends no `dynamic` field at all, which reads as a plan. */
export function isDynamicEntry(entry: ShopSubscriptionEntry): entry is DynamicSubscriptionEntry {
    return entry.dynamic === true;
}

interface SubscriptionCheckoutAmounts {
    publishableKey: string;
    /** What the first charge totals, major units. */
    amount: number;
    taxAmount: number;
    vatRate: number | null;
    /** Upper-case ISO code as core stores it (`CHF`); Stripe Elements wants it lower-case. */
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    firstDeliveryAt: string;
    nextBillingAt: string | null;
}

export interface SubscriptionCheckoutPreview extends SubscriptionCheckoutAmounts {
    subscriptionId: null;
    number: null;
    status: null;
    clientSecret: null;
    secretKind: null;
    preview: true;
}

export interface SubscriptionCheckoutStarted extends SubscriptionCheckoutAmounts {
    subscriptionId: number;
    number: string;
    status: SubscriptionStatus;
    clientSecret: string;
    secretKind: SubscriptionSecretKind;
    preview: false;
}

export interface SubscriptionCheckoutStatus {
    subscriptionId: number;
    number: string;
    status: SubscriptionStatus;
    /** Stripe's own status while core still says `INCOMPLETE`, otherwise `null`. */
    stripeStatus: string | null;
    firstPaymentStatus: PaymentStatus | null;
    firstDeliveryAt: string | null;
    nextBillingAt: string | null;
}

/**
 * Which Stripe.js call takes the checkout's `clientSecret`: a charge now (`PAYMENT`, an invoice's PaymentIntent) or a card saved
 * for a chosen start date (`SETUP`, a SetupIntent). Calling the other one fails at Stripe.
 */
export function confirmMethodOf(secretKind: SubscriptionSecretKind): 'confirmPayment' | 'confirmSetup' {
    switch (secretKind) {
        case 'PAYMENT':
            return 'confirmPayment';
        case 'SETUP':
            return 'confirmSetup';
    }
    throw new Error(`Unknown secretKind ${String(secretKind)}`);
}
