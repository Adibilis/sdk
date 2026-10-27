import type { ShopProductImageResponse, ShopProductPriceResponse, ShopProductResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';

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
export function fetchShopProducts(client: AdibilisClient): Promise<ShopProductResponse[]> {
    return client.get<ShopProductResponse[]>('/api/shop/product');
}

/**
 * One listed product. An unlisted, archived or unknown id is a **404** — core does not tell a
 * satellite which products exist behind the listing.
 */
export function fetchShopProduct(client: AdibilisClient, id: number): Promise<ShopProductResponse> {
    return client.get<ShopProductResponse>(`/api/shop/product/${id}`);
}
