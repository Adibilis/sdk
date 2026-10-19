// Core's generated subscription shapes, copied from its ajtg zod output (core branch feat/subscriptions-checkout, 3b3ce4e7c)
// because no @adbls/api-types release carries them yet. The commit that raises that dependency to the core release with the
// subscription checkout replaces this file with re-exports from @adbls/api-types; keep it a verbatim copy until then.
import { OrderIngestLineItemRequestModel, OrderIngestPersonRequestModel } from '@adbls/api-types';
import type { PaymentStatus, PriceMode } from '@adbls/api-types';
import { z } from 'zod';

export type { PaymentStatus, PriceMode };

export type BillingInterval = 'WEEK' | 'MONTH' | 'YEAR';
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type SubscriptionStatus = 'INCOMPLETE' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED';
export type SubscriptionSecretKind = 'PAYMENT' | 'SETUP';

export const SchedulePatternModel = z.object({
    kind: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']),
    weekdays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).optional().nullable(),
    everyNWeeks: z.number().int().min(1).max(52).optional().nullable(),
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    month: z.number().int().min(1).max(12).optional().nullable(),
    day: z.number().int().min(1).max(31).optional().nullable(),
});
export type SchedulePattern = z.infer<typeof SchedulePatternModel>;

export const ScheduleDefinitionModel = z.object({
    mode: z.enum(['FIXED', 'CUSTOMER_CHOICE', 'CUSTOMER_FREE']),
    pattern: SchedulePatternModel.optional().nullable(),
    options: z.array(SchedulePatternModel).optional().nullable(),
    freeKind: z.enum(['WEEKDAYS', 'DAY_OF_MONTH', 'DATE']).optional().nullable(),
    everyNWeeks: z.number().int().min(1).max(52).optional().nullable(),
    min: z.number().int().min(1).max(7).optional().nullable(),
    max: z.number().int().min(1).max(7).optional().nullable(),
});
export type ScheduleDefinition = z.infer<typeof ScheduleDefinitionModel>;

export const DynamicSubscriptionRequestModel = z.object({
    unitAmount: z.number(),
    vatRate: z.number(),
    priceMode: z.enum(['BRUTTO', 'NETTO']),
    lineItems: z.array(OrderIngestLineItemRequestModel).min(1).max(100),
});
export type DynamicSubscriptionRequest = z.infer<typeof DynamicSubscriptionRequestModel>;

export const SubscriptionCheckoutRequestModel = z.object({
    planId: z.number().int().optional().nullable(),
    dynamic: DynamicSubscriptionRequestModel.optional().nullable(),
    currency: z.string().regex(/\S/).min(0).max(3),
    schedule: SchedulePatternModel,
    configuration: z.string().min(0).max(8192).optional().nullable(),
    configurationText: z.string().regex(/\S/).min(0).max(500),
    billingPerson: OrderIngestPersonRequestModel,
    deliveryPerson: OrderIngestPersonRequestModel.optional().nullable(),
    fulfillmentType: z.enum(['DELIVERY', 'PICKUP', 'DIGITAL', 'ON_SITE']).optional().nullable(),
    customerNote: z.string().min(0).max(2000).optional().nullable(),
    startDate: z.string().optional().nullable(),
    externalSource: z.string().regex(/\S/).min(0).max(40),
    externalRef: z.string().regex(/\S/).min(0).max(120),
    returnUrl: z.string().regex(/\S/),
    preview: z.boolean(),
    expectedAmount: z.number().optional().nullable(),
});
export type SubscriptionCheckoutRequest = z.infer<typeof SubscriptionCheckoutRequestModel>;

export interface SubscriptionPlanPriceResponse {
    currency: string;
    amount: number;
    vatRate?: number;
}

export interface ShopSubscriptionPlanResponse {
    id?: number;
    dynamic: boolean;
    title?: string;
    description?: string;
    billingInterval?: BillingInterval;
    billingIntervalCount?: number;
    priceMode?: PriceMode;
    vatExempt: boolean;
    leadTimeDays: number;
    allowStartDateChoice: boolean;
    scheduleDefinition: ScheduleDefinition;
    prices: SubscriptionPlanPriceResponse[];
}

export interface SubscriptionCheckoutResponse {
    subscriptionId?: number;
    number?: string;
    status?: SubscriptionStatus;
    clientSecret?: string;
    secretKind?: SubscriptionSecretKind;
    publishableKey: string;
    amount: number;
    taxAmount: number;
    vatRate?: number;
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    firstDeliveryAt: string;
    nextBillingAt?: string;
    preview: boolean;
}

export interface SubscriptionStatusResponse {
    subscriptionId: number;
    number: string;
    status: SubscriptionStatus;
    stripeStatus?: string;
    firstPaymentStatus?: PaymentStatus;
    firstDeliveryAt?: string;
    nextBillingAt?: string;
}
