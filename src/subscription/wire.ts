// Core's generated subscription, customer-session and portal shapes, copied from its ajtg zod output (checkout: core
// feat/subscriptions-checkout 3b3ce4e7c; session and portal: core feat/subscriptions-portal 0ae1fadea) because no
// @adbls/api-types release carries them yet. The commit that raises that dependency to the core release with Plans 3–8
// replaces this file with re-exports from @adbls/api-types; keep it a verbatim copy until then.
import { OrderIngestLineItemRequestModel, OrderIngestPersonRequestModel } from '@adbls/api-types';
import type { CorrespondenceLanguage, FulfillmentType, PageResponse, PaymentStatus, PriceMode } from '@adbls/api-types';
import { z } from 'zod';

export type { CorrespondenceLanguage, FulfillmentType, PageResponse, PaymentStatus, PriceMode };

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

// Core's customer session (Plan 6) and portal (Plan 7) shapes, copied the same way from the same generator.

export type SubscriptionDeliveryStatus = 'PLANNED' | 'ORDERED' | 'SKIPPED' | 'CANCELLED';
export type SubscriptionDeliverySkipReason = 'CUSTOMER' | 'OWNER' | 'PAUSE';
export type CustomerPaymentRetry = 'NOT_NEEDED' | 'PAID' | 'PROCESSING' | 'DECLINED' | 'UNCONFIRMED';
export type CustomerTransactionKind = 'SUBSCRIPTION_PERIOD' | 'ORDER';

export const CustomerLoginLinkRequestModel = z.object({
    email: z.string().regex(/\S/).email().min(0).max(254),
    returnUrl: z.string().regex(/\S/).min(0).max(2048),
    language: z.enum(['DE', 'FR', 'IT', 'EN']).optional().nullable(),
    shopName: z.string().min(0).max(80).optional().nullable(),
});
export type CustomerLoginLinkRequest = z.infer<typeof CustomerLoginLinkRequestModel>;

export const CustomerSessionRequestModel = z.object({
    token: z.string().regex(/\S/).min(0).max(128),
});
export type CustomerSessionRequest = z.infer<typeof CustomerSessionRequestModel>;

export const CustomerScheduleRequestModel = z.object({
    schedule: SchedulePatternModel,
});
export type CustomerScheduleRequest = z.infer<typeof CustomerScheduleRequestModel>;

export const CustomerPlanChangeRequestModel = z.object({
    planId: z.number().int(),
});
export type CustomerPlanChangeRequest = z.infer<typeof CustomerPlanChangeRequestModel>;

export const CustomerConfigurationRequestModel = z.object({
    configuration: z.string().min(0).max(8192).optional().nullable(),
    configurationText: z.string().regex(/\S/).min(0).max(500),
    unitAmount: z.number().optional().nullable(),
});
export type CustomerConfigurationRequest = z.infer<typeof CustomerConfigurationRequestModel>;

export const CustomerAddressRequestModel = z.object({
    street: z.string().regex(/\S/).min(0).max(200),
    postalCode: z.string().regex(/\S/).min(0).max(20),
    city: z.string().regex(/\S/).min(0).max(100),
    country: z.string().regex(/\S/).regex(/^(?:[A-Za-z]{2})$/),
});
export type CustomerAddressRequest = z.infer<typeof CustomerAddressRequestModel>;

export const CustomerDeliveryPersonRequestModel = z.object({
    firstname: z.string().regex(/\S/).min(0).max(100),
    lastname: z.string().regex(/\S/).min(0).max(100),
    phone: z.string().min(0).max(40).optional().nullable(),
    address: CustomerAddressRequestModel,
});
export type CustomerDeliveryPersonRequest = z.infer<typeof CustomerDeliveryPersonRequestModel>;

export const CustomerDeliveryPersonChangeRequestModel = z.object({
    deliveryPerson: CustomerDeliveryPersonRequestModel,
});
export type CustomerDeliveryPersonChangeRequest = z.infer<typeof CustomerDeliveryPersonChangeRequestModel>;

export const CustomerCancelRequestModel = z.object({
    atPeriodEnd: z.boolean(),
});
export type CustomerCancelRequest = z.infer<typeof CustomerCancelRequestModel>;

export const CustomerPauseRequestModel = z.object({
    resumesAt: z.string(),
});
export type CustomerPauseRequest = z.infer<typeof CustomerPauseRequestModel>;

export const CustomerPaymentMethodRequestModel = z.object({
    setupIntentId: z.string().regex(/\S/).regex(/^(?:seti_[A-Za-z0-9]{1,250})$/),
});
export type CustomerPaymentMethodRequest = z.infer<typeof CustomerPaymentMethodRequestModel>;

export interface CustomerProfileResponse {
    firstname?: string;
    lastname?: string;
    email: string;
}

export interface CustomerSessionResponse {
    sessionToken: string;
    expiresAt: string;
    customer: CustomerProfileResponse;
}

export interface CustomerPlanResponse {
    id: number;
    title: string;
    description?: string;
}

export interface CustomerAddressResponse {
    firstname?: string;
    lastname?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
}

export interface CustomerDeliveryResponse {
    id: number;
    dueDate: string;
    status: SubscriptionDeliveryStatus;
    skipReason?: SubscriptionDeliverySkipReason;
    skippable: boolean;
}

export interface CustomerPaymentMethodResponse {
    type: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
}

export interface CustomerPaymentMethodSetupResponse {
    clientSecret: string;
    publishableKey: string;
}

export interface CustomerPaymentMethodUpdateResponse {
    paymentMethod: CustomerPaymentMethodResponse;
    retry: CustomerPaymentRetry;
    hostedInvoiceUrl?: string;
}

export interface CustomerTransactionResponse {
    kind: CustomerTransactionKind;
    date: string;
    reference: string;
    subscriptionId?: number;
    periodStart?: string;
    periodEnd?: string;
    amount: number;
    currency: string;
    hostedInvoiceUrl?: string;
    invoicePdfUrl?: string;
}

export interface CustomerSubscriptionResponse {
    id: number;
    number: string;
    status: SubscriptionStatus;
    dynamic: boolean;
    planTitle?: string;
    configurationText: string;
    amount: number;
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    nextDeliveryAt?: string;
    nextBillingAt?: string;
    cancelAtPeriodEnd: boolean;
    pausedUntil?: string;
    startDate?: string;
}

export interface CustomerSubscriptionDetailResponse {
    id: number;
    number: string;
    status: SubscriptionStatus;
    dynamic: boolean;
    plan?: CustomerPlanResponse;
    scheduleDefinition?: ScheduleDefinition;
    schedule: SchedulePattern;
    configuration?: string;
    configurationText: string;
    unitAmount?: number;
    amount: number;
    currency: string;
    billingInterval: BillingInterval;
    billingIntervalCount: number;
    fulfillmentType?: FulfillmentType;
    leadTimeDays: number;
    deliveryPerson?: CustomerAddressResponse;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    nextBillingAt?: string;
    nextDeliveryAt?: string;
    cancelAtPeriodEnd: boolean;
    pausedUntil?: string;
    startDate?: string;
    cancelledAt?: string;
    upcomingDeliveries: CustomerDeliveryResponse[];
    paymentMethod?: CustomerPaymentMethodResponse;
}
