// Server-only entry point. This side holds the API client and, with it, the WEBSITE key.
// It must never be reachable from src/client-entry.ts — that separation is the whole reason
// the package has two entry points rather than one.
export { createAdibilisClient } from './client/api-client.js';
export type { AdibilisClient, AdibilisClientConfig } from './client/api-client.js';
export { AdibilisApiError } from './client/errors.js';
export { fetchHolidays } from './shop/holidays-client.js';
export { checkCore } from './status/core-check.js';
export type { CoreCheck, CoreCheckOptions } from './status/core-check.js';
export { startCheckout, previewCheckout, amountChangedOf, getOrderStatus } from './checkout/checkout-client.js';
export type {
    CheckoutPreview,
    CheckoutRequest,
    CheckoutResponse,
    CheckoutStartRequest,
    PaymentStatusResponse,
} from './checkout/checkout-client.js';
export {
    fetchPropertyLead,
    fetchPublishedProperties,
    fetchPublishedProperty,
    requestPropertyValuation,
    submitPropertyEnquiry,
    submitPropertyLead,
} from './property/property-client.js';
export type {
    PropertyEnquiryRequest,
    PropertyLeadCreatedResponse,
    PropertyLeadRequest,
    PropertyLeadResponse,
    PublishedPropertyPageOptions,
    PublishedPropertyResponse,
} from './property/property-client.js';
export { fetchShopProduct, fetchShopProducts } from './shop/product-client.js';
export type { ProductPriceResponse, ShopProductImageResponse, ShopProductResponse } from './shop/product-client.js';

export type {
    DynamicSubscriptionEntry,
    ShopSubscriptionEntry,
    ShopSubscriptionPlan,
    SubscriptionCheckoutPreview,
    SubscriptionCheckoutStarted,
    SubscriptionCheckoutStatus,
    SubscriptionPlanPrice,
} from './subscription/types.js';
export { fetchSubscriptionPlan, fetchSubscriptionPlans } from './subscription/plan-client.js';
export {
    getSubscriptionStatus,
    previewSubscriptionCheckout,
    SHOP_CLIENT_IP_HEADER,
    startSubscriptionCheckout,
} from './subscription/checkout-client.js';
export type {
    ShopCallOptions,
    SubscriptionCheckoutRequest,
    SubscriptionCheckoutStartRequest,
} from './subscription/checkout-client.js';

export { MAX_CART_REF_LENGTH, subscriptionCheckoutRef } from './subscription/checkout-ref.js';
export { subscriptionCheckoutRefusalOf } from './subscription/checkout-refusal.js';
export type { SubscriptionCheckoutRefusal } from './subscription/checkout-refusal.js';

export type {
    CustomerPage,
    CustomerPaymentMethodSetup,
    CustomerPaymentMethodUpdate,
    CustomerProfile,
    CustomerSubscription,
    CustomerSubscriptionDetail,
    CustomerTransaction,
} from './customer/types.js';
export {
    CUSTOMER_SESSION_COOKIE,
    exchangeLoginToken,
    expiredCustomerSessionCookie,
    MAX_SESSION_TOKEN_LENGTH,
    requestLoginLink,
} from './customer/session.js';
export type { CustomerLoginLinkRequest, CustomerSessionCookie, CustomerSignIn } from './customer/session.js';
export { customerFromCookies } from './customer/customer-client.js';
export type { CookieReader, CustomerClient, CustomerPageOptions, CustomerTransactionQuery } from './customer/customer-client.js';
export { SubscriptionUpdateError } from './customer/customer-client.js';
export type {
    CustomerConfigurationChange,
    CustomerDeliveryPerson,
    CustomerSubscriptionChangePart,
    CustomerSubscriptionChanges,
} from './customer/customer-client.js';
export { customerRefusalOf } from './customer/refusal.js';
export type { CustomerRefusal, SubscriptionActionRefusalReason } from './customer/refusal.js';
