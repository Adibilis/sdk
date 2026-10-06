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
