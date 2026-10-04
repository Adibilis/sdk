// Server-only entry point. This side holds the API client and, with it, the WEBSITE key.
// It must never be reachable from src/client-entry.ts — that separation is the whole reason
// the package has two entry points rather than one.
export { createAdibilisClient } from './client/api-client.js';
export type { AdibilisClient, AdibilisClientConfig } from './client/api-client.js';
export { AdibilisApiError } from './client/errors.js';
export { fetchHolidays } from './shop/holidays-client.js';
export { checkCore } from './status/core-check.js';
export type { CoreCheck, CoreCheckOptions } from './status/core-check.js';
export { startCheckout, getOrderStatus } from './checkout/checkout-client.js';
export type { CheckoutRequest, CheckoutResponse, PaymentStatusResponse } from './checkout/checkout-client.js';
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
