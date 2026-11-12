import type { ShopProductImageResponse, ShopProductPriceResponse, ShopProductResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';
import { customerSessionInit } from '../customer/session-header.js';

export interface ShopProductReadOptions {
    /**
     * The signed-in customer's portal session (`customerSessionFromCookies`): core then prices the product with the customer's
     * group discounts. An expired or unknown session is priced as anonymous, not refused. Such a response is per customer —
     * the call is sent `no-store`, and you must not cache it for other visitors.
     */
    customerSession?: string | null;
}

export type { ShopProductImageResponse, ShopProductPriceResponse, ShopProductResponse };

/** The name this SDK exported the shop price under before core named it `ShopProductPriceResponse`. */
export type ProductPriceResponse = ShopProductPriceResponse;

/**
 * Every product an admin listed on satellites, archived ones excluded, ordered by title. Unpaged:
 * a satellite renders its whole catalog.
 *
 * Gated on core's "Enable satellites" payment setting, not on a module row: while it is off this
 * answers **403**, so a satellite pointed at a misconfigured install fails loudly rather than
 * rendering an empty shop.
 */
export function fetchShopProducts(client: AdibilisClient, options?: ShopProductReadOptions): Promise<ShopProductResponse[]> {
    return client.get<ShopProductResponse[]>('/api/shop/product', customerSessionInit(options?.customerSession));
}

/**
 * One listed product. An unlisted, archived or unknown id is a **404** — core does not tell a
 * satellite which products exist behind the listing.
 */
export function fetchShopProduct(client: AdibilisClient, id: number, options?: ShopProductReadOptions): Promise<ShopProductResponse> {
    return client.get<ShopProductResponse>(`/api/shop/product/${id}`, customerSessionInit(options?.customerSession));
}
