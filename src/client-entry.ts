// Browser-safe entry point. Everything re-exported here must be importable into a client
// component: no `server-only`, no WEBSITE key, nothing that transitively reaches src/client/.
// test/boundary.test.ts enforces that.
export { makeAddressSchema, makeBillingAddressSchema } from './forms/address-schema.js';
export type { AddressFormData, BillingAddressFormData } from './forms/address-schema.js';
export type { AddressValidationMessages } from './forms/messages.js';
export { availableFulfilments, isDelivery, isPickup } from './order/order-details.js';
export type {
    Address,
    DeliveryFulfilment,
    Fulfilment,
    FulfilmentOptions,
    PickupFulfilment,
} from './order/order-details.js';
export { isHoliday } from './shop/holidays-client.js';
export type { HolidayRange } from './shop/holidays-client.js';
export { priceIn, shopImageUrl, vatNoteOf } from './shop/product-image.js';
export type { VatNote } from './shop/product-image.js';
export type { ProductPriceResponse, ShopProductImageResponse, ShopProductResponse } from '@adbls/api-types';

export { confirmMethodOf, isDynamicEntry } from './subscription/types.js';
export type {
    BillingInterval,
    DynamicSubscriptionEntry,
    ScheduleDefinition,
    SchedulePattern,
    ShopSubscriptionEntry,
    ShopSubscriptionPlan,
    SubscriptionCheckoutPreview,
    SubscriptionCheckoutStarted,
    SubscriptionCheckoutStatus,
    SubscriptionPlanPrice,
    SubscriptionSecretKind,
    SubscriptionStatus,
    Weekday,
} from './subscription/types.js';
export { isWellFormedPattern, nextOccurrence, occurrences, validateScheduleChoice } from './subscription/schedule.js';
export { firstDeliveryDate, START_DATE_HORIZON_DAYS, todayIn, validFirstDeliveryDates } from './subscription/delivery-dates.js';
export type { DeliveryTerms } from './subscription/delivery-dates.js';
export { dynamicPeriodAmount, dynamicUnitAmount } from './subscription/pricing.js';
export type { DynamicPrice } from './subscription/pricing.js';
export { describeBilling, describeSchedule } from './subscription/describe.js';

export type {
    CustomerAddress,
    CustomerDelivery,
    CustomerPage,
    CustomerPaymentMethod,
    CustomerPaymentRetry,
    CustomerPlan,
    CustomerProfile,
    CustomerSubscription,
    CustomerSubscriptionDetail,
    CustomerTransaction,
    CustomerTransactionKind,
    FulfillmentType,
    SubscriptionDeliverySkipReason,
    SubscriptionDeliveryStatus,
} from './customer/types.js';
export { configurationObjectOf, PAUSE_HORIZON_DAYS, plansForChange, resumeDateRange, scheduleChangeOf } from './customer/rules.js';
export type { ScheduleChangeCheck } from './customer/rules.js';
