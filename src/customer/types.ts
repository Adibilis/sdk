import type {
    BillingInterval,
    CustomerAddressResponse,
    CustomerDeliveryResponse,
    CustomerPaymentMethodResponse,
    CustomerPaymentMethodSetupResponse,
    CustomerPaymentMethodUpdateResponse,
    CustomerPaymentRetry,
    CustomerPlanResponse,
    CustomerProfileResponse,
    CustomerSubscriptionDetailResponse,
    CustomerSubscriptionResponse,
    CustomerTransactionKind,
    CustomerTransactionResponse,
    FulfillmentType,
    ScheduleDefinition,
    SchedulePattern,
    SubscriptionDeliverySkipReason,
    SubscriptionDeliveryStatus,
    SubscriptionStatus,
} from '../subscription/wire.js';

export type {
    CustomerPaymentRetry,
    CustomerTransactionKind,
    FulfillmentType,
    SubscriptionDeliverySkipReason,
    SubscriptionDeliveryStatus,
} from '../subscription/wire.js';

/** The signed-in customer as core knows them; never an id. */
export interface CustomerProfile {
    firstname: string | null;
    lastname: string | null;
    email: string;
}

/** One page of a portal list, as core pages it (`number` is zero-based). */
export interface CustomerPage<T> {
    content: T[];
    number: number;
    size: number;
    totalPages: number;
    totalElements: number;
}

/** A row of the customer's subscriptions: the ones they pay for, newest first. `amount` is per billing period. */
export interface CustomerSubscription {
    id: number;
    number: string;
    status: SubscriptionStatus;
    dynamic: boolean;
    /** `null` on a dynamic ("Subscribe this order") subscription. */
    planTitle: string | null;
    configurationText: string;
    amount: number;
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    nextDeliveryAt: string | null;
    nextBillingAt: string | null;
    cancelAtPeriodEnd: boolean;
    pausedUntil: string | null;
    startDate: string | null;
}

export interface CustomerPlan {
    id: number;
    title: string;
    description: string | null;
}

/** Who receives the deliveries, as entered. */
export interface CustomerAddress {
    firstname: string | null;
    lastname: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
}

export interface CustomerDelivery {
    id: number;
    dueDate: string;
    status: SubscriptionDeliveryStatus;
    /** Who skipped a `SKIPPED` delivery: the customer, the shop (`OWNER`) or a pause; `null` otherwise. */
    skipReason: SubscriptionDeliverySkipReason | null;
    /** Whether the customer may skip it now — show the skip button only where this is `true`. */
    skippable: boolean;
}

/** The card (or other method) on file; card fields are `null` for another method. */
export interface CustomerPaymentMethod {
    type: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
}

export interface CustomerSubscriptionDetail {
    id: number;
    number: string;
    status: SubscriptionStatus;
    dynamic: boolean;
    plan: CustomerPlan | null;
    /** What a schedule change must fit: the plan's definition, or the dynamic settings'. */
    scheduleDefinition: ScheduleDefinition | null;
    schedule: SchedulePattern;
    /** The JSON your checkout sent, as core stored it (`configurationObjectOf` parses it). */
    configuration: string | null;
    configurationText: string;
    /** Per delivery, on a dynamic subscription only. */
    unitAmount: number | null;
    /** Per billing period. */
    amount: number;
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    fulfillmentType: FulfillmentType | null;
    leadTimeDays: number;
    deliveryPerson: CustomerAddress | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextBillingAt: string | null;
    nextDeliveryAt: string | null;
    cancelAtPeriodEnd: boolean;
    pausedUntil: string | null;
    startDate: string | null;
    cancelledAt: string | null;
    upcomingDeliveries: CustomerDelivery[];
    /** Read live from Stripe, best effort: `null` when Stripe could not be read, and on a cancelled subscription. */
    paymentMethod: CustomerPaymentMethod | null;
}

/** The SetupIntent for the browser's Payment Element: confirm it with `stripe.confirmSetup`. */
export interface CustomerPaymentMethodSetup {
    clientSecret: string;
    publishableKey: string;
}

export interface CustomerPaymentMethodUpdate {
    paymentMethod: CustomerPaymentMethod;
    /**
     * `NOT_NEEDED`: nothing was owed. `PAID`: Stripe accepted the overdue charge (the status follows within moments).
     * `PROCESSING`: the charge is still being processed. `UNCONFIRMED`: core could not confirm the outcome.
     * `DECLINED`: the overdue charge failed; the new card stays on file and `hostedInvoiceUrl` lets the customer pay there.
     */
    retry: CustomerPaymentRetry;
    hostedInvoiceUrl: string | null;
}

/** One charge: a paid subscription period (`reference` = subscription number) or a paid one-time order (order number). */
export interface CustomerTransaction {
    kind: CustomerTransactionKind;
    date: string;
    reference: string;
    subscriptionId: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    amount: number;
    currency: string;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
}

type SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never] ? true : false;
type Holds<T extends true> = T;

// Each SDK type names exactly core's fields: a field core adds, drops or renames fails this build, not a shop at run time.
type MatchesCore = [
    Holds<SameKeys<CustomerProfile, CustomerProfileResponse>>,
    Holds<SameKeys<CustomerSubscription, CustomerSubscriptionResponse>>,
    Holds<SameKeys<CustomerPlan, CustomerPlanResponse>>,
    Holds<SameKeys<CustomerAddress, CustomerAddressResponse>>,
    Holds<SameKeys<CustomerDelivery, CustomerDeliveryResponse>>,
    Holds<SameKeys<CustomerPaymentMethod, CustomerPaymentMethodResponse>>,
    Holds<SameKeys<CustomerSubscriptionDetail, CustomerSubscriptionDetailResponse>>,
    Holds<SameKeys<CustomerPaymentMethodSetup, CustomerPaymentMethodSetupResponse>>,
    Holds<SameKeys<CustomerPaymentMethodUpdate, CustomerPaymentMethodUpdateResponse>>,
    Holds<SameKeys<CustomerTransaction, CustomerTransactionResponse>>,
];
