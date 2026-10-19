import type { AdibilisClient } from '../client/api-client.js';
import type { ShopSubscriptionEntry, ShopSubscriptionPlan } from './types.js';

/**
 * What a satellite can sell as a subscription: core's dynamic "Subscribe this order" entry first (only while the owner enabled
 * dynamic subscriptions), then every listed, unarchived plan by title. Narrow with `isDynamicEntry`.
 *
 * **403** while core's "Enable satellites" payment setting is off; **404** `SHOP_MODULE_DISABLED` while the shop module is off.
 */
export function fetchSubscriptionPlans(client: AdibilisClient): Promise<ShopSubscriptionEntry[]> {
    return client.get<ShopSubscriptionEntry[]>('/api/shop/subscription-plan');
}

/** One listed plan — never the dynamic entry, which has no id. An unlisted, archived or unknown id is a **404**. */
export function fetchSubscriptionPlan(client: AdibilisClient, id: number): Promise<ShopSubscriptionPlan> {
    return client.get<ShopSubscriptionPlan>(`/api/shop/subscription-plan/${encodeURIComponent(String(id))}`);
}
