// Server-only entry point. This side holds the API client and, with it, the WEBSITE key.
// It must never be reachable from src/client-entry.ts — that separation is the whole reason
// the package has two entry points rather than one.
export { createAdibilisClient } from './client/api-client.js';
export type { AdibilisClient, AdibilisClientConfig } from './client/api-client.js';
export { AdibilisApiError } from './client/errors.js';
export { fetchHolidays } from './shop/holidays-client.js';
export { fetchCancelledBookings } from './shop/booking-client.js';
export { isBookingCancelled } from './shop/booking-rules.js';
export type { CancelledBooking } from './shop/booking-rules.js';
export { fetchPickupSites } from './shop/pickup-site-client.js';
export { checkCore } from './status/core-check.js';
export type { CoreCheck, CoreCheckOptions } from './status/core-check.js';
export {
    startCheckout,
    previewCheckout,
    amountChangedOf,
    productUnavailableOf,
    checkoutExpiredOf,
    checkoutPaymentInProgressOf,
    getOrderStatus,
} from './checkout/checkout-client.js';
export type { DiscountCodeRefusal, DiscountDuration } from '@adbls/api-types';
export { SalutationModel } from '@adbls/api-types';
export type { Salutation } from '@adbls/api-types';
export { checkoutRefusalOf } from './checkout/checkout-refusal.js';
export type { CheckoutRefusal } from './checkout/checkout-refusal.js';
export { checkoutStatusOutcome } from './checkout/checkout-status.js';
export type { CheckoutOutcome } from './checkout/checkout-status.js';
export type {
    CheckoutCallOptions,
    CheckoutPreview,
    CheckoutRequest,
    CheckoutResponse,
    CheckoutStartRequest,
    PaymentStatusResponse,
    ProductUnavailable,
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
export { fetchGoogleReviews } from './review/review-client.js';
export type { PublishedReviewResponse, PublishedReviewsResponse } from './review/review-client.js';
export { subscribeNewsletter } from './shop/newsletter-client.js';
export type { NewsletterLanguage, NewsletterSignupRequest } from './shop/newsletter-client.js';
export { fetchShopProduct, fetchShopProducts } from './shop/product-client.js';
export type {
    ProductPriceResponse,
    ShopProductImageResponse,
    ShopProductPriceResponse,
    ShopProductReadOptions,
    ShopProductResponse,
} from './shop/product-client.js';

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
    SubscriptionCheckoutCallOptions,
    SubscriptionCheckoutRequest,
    SubscriptionCheckoutStartRequest,
} from './subscription/checkout-client.js';

export { MAX_CART_REF_LENGTH, subscriptionCheckoutRef } from './subscription/checkout-ref.js';
export { subscriptionCheckoutRefusalOf } from './subscription/checkout-refusal.js';
export type { SubscriptionCheckoutRefusal } from './subscription/checkout-refusal.js';

export type {
    CancellationCause,
    CustomerInvoicePdf,
    CustomerOrder,
    CustomerOrderLine,
    OrderRefund,
    RefundStatus,
    CustomerPage,
    CustomerPaymentMethodSetup,
    CustomerPaymentMethodUpdate,
    CustomerProfile,
    CustomerSubscription,
    CustomerSubscriptionDetail,
    CustomerSubscriptionDiscount,
    CustomerTransaction,
} from './customer/types.js';
export {
    CUSTOMER_EMAIL_COOKIE,
    CUSTOMER_SESSION_COOKIE,
    customerEmailFromCookies,
    customerSessionFromCookies,
    exchangeLoginToken,
    expiredCustomerSessionCookie,
    expiredSignInCookies,
    MAX_SESSION_TOKEN_LENGTH,
    requestLoginLink,
} from './customer/session.js';
export type { CustomerLoginLinkRequest, CustomerSessionCookie, CustomerSignIn, SignInCookie } from './customer/session.js';
export { signInRoutes } from './customer/sign-in-routes.js';
export type { SignInPaths, SignInRoutes, SignInRoutesOptions } from './customer/sign-in-routes.js';
export { clientIpOf, publicOrigin } from './request/request.js';
export type { CustomerLoginPurpose } from './subscription/wire.js';
export { customerLanguage } from './customer/language.js';
export type { CustomerLanguageSources } from './customer/language.js';
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
export { cancelOrderByToken, getOrderCancellation } from './order/cancellation.js';
export { orderCancellationRefusalOf } from './order/refusal.js';
export type { OrderCancellationRefusal, OrderRefusal } from './order/refusal.js';
export { getResource, listResourceProducts, listResources, listResourceTopics, resourceFile } from './resource/resource-client.js';
export type {
    ResourceCallOptions,
    ResourceFile,
    ResourceFileOptions,
    ResourceFormat,
    WebsiteResourceDetailResponse,
    WebsiteResourceFileResponse,
    WebsiteResourceFilterRequest,
    WebsiteResourceGroupResponse,
    WebsiteResourceProductResponse,
    WebsiteResourceResponse,
    WebsiteResourceTopicResponse,
} from './resource/resource-client.js';
export { resourceRefusalOf } from './resource/refusal.js';
export type { ResourceRefusal } from './resource/refusal.js';
