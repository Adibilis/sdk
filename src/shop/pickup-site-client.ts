import type { AdibilisClient } from '../client/api-client.js';
import { AdibilisApiError } from '../client/errors.js';

/**
 * A storage site a PICKUP order is collected from: core's `ShopPickupSiteResponse`, with the address fields
 * nullable — a site's address may lack any of them, which the generated type does not say.
 */
export interface ShopPickupSiteResponse {
    id: number;
    name: string;
    address: {
        street: string | null;
        city: string | null;
        zip: string | null;
        country: string | null;
        canton: string | null;
    };
}

export type PickupSite = ShopPickupSiteResponse;

export async function fetchPickupSites(client: AdibilisClient): Promise<PickupSite[]> {
    try {
        return await client.get<PickupSite[]>('/api/shop/pickup-site');
    } catch (error) {
        if (error instanceof AdibilisApiError && error.status === 404) return [];
        throw error;
    }
}
