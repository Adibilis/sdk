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
export { checkoutStatusOutcome } from './checkout/checkout-status.js';
export type { CheckoutOutcome } from './checkout/checkout-status.js';
export { isHoliday } from './shop/holidays-client.js';
export type { HolidayRange } from './shop/holidays-client.js';
export { isBookingCancelled } from './shop/booking-rules.js';
export type { CancelledBooking } from './shop/booking-rules.js';
export type { PickupSite } from './shop/pickup-site-client.js';
export { priceIn, shopImageUrl, vatNoteOf } from './shop/product-image.js';
export type { VatNote } from './shop/product-image.js';
export { isValidOpenPrice, openPriceDiscount, openPriceSteps, shopPriceView } from './shop/price-view.js';
export type { OpenPriceDiscount, OpenPriceRange, ShopPriceDiscountInput, ShopPriceInput, ShopPriceView } from './shop/price-view.js';
export type { ProductPriceResponse, ShopProductImageResponse, ShopProductPriceResponse, ShopProductResponse } from './shop/product-client.js';
export { resourceAssetUrl, rewriteResourceBody } from './resource/resource-paths.js';
export type { ResourceAssetOptions } from './resource/resource-paths.js';
export type {
    ResourceFormat,
    WebsiteResourceDetailResponse,
    WebsiteResourceFileResponse,
    WebsiteResourceFilterRequest,
    WebsiteResourceGroupResponse,
    WebsiteResourceProductResponse,
    WebsiteResourceResponse,
    WebsiteResourceTopicResponse,
} from '@adbls/api-types';

export type { DiscountCodeRefusal, DiscountDuration } from '@adbls/api-types';
export { SalutationModel } from '@adbls/api-types';
export type { Salutation } from '@adbls/api-types';
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
    CancellationCause,
    CustomerAddress,
    CustomerDelivery,
    CustomerPage,
    CustomerPaymentMethod,
    CustomerPaymentMethodSetup,
    CustomerPaymentMethodUpdate,
    CustomerOrder,
    CustomerOrderLine,
    CustomerPaymentRetry,
    CustomerPlan,
    CustomerProfile,
    CustomerSubscription,
    CustomerSubscriptionDetail,
    CustomerSubscriptionDiscount,
    CustomerTransaction,
    CustomerTransactionKind,
    FulfillmentType,
    OrderRefund,
    RefundStatus,
    SubscriptionDeliverySkipReason,
    SubscriptionDeliveryStatus,
} from './customer/types.js';
export { configurationObjectOf, PAUSE_HORIZON_DAYS, plansForChange, resumeDateRange, scheduleChangeOf } from './customer/rules.js';
export type { ScheduleChangeCheck } from './customer/rules.js';
export type { OrderCancellationRefusal, OrderRefusal } from './order/refusal.js';
export type { CustomerRefusal, SubscriptionActionRefusalReason } from './customer/refusal.js';
export { browserCustomerLanguage } from './customer/language.js';
export type { BrowserCustomerLanguageSources } from './customer/language.js';
export { SIGN_IN_NOTICES, signInNoticeOf } from './customer/sign-in-notice.js';
export type { SignInNotice } from './customer/sign-in-notice.js';
