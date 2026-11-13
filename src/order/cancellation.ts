import { OrderCancelByTokenRequestModel } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';
import type { CustomerOrder } from '../customer/types.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';

function initOf(options: ShopCallOptions): { headers: Record<string, string>; cache: 'no-store' } {
    return { headers: shopCallHeaders(options), cache: 'no-store' };
}

/**
 * The order behind the token from the cancellation mail, so a page can show what the customer is about to cancel.
 * A blank or over-long token throws a `ZodError` and sends nothing.
 */
export async function getOrderCancellation(client: AdibilisClient, token: string, options: ShopCallOptions): Promise<CustomerOrder> {
    const checked = OrderCancelByTokenRequestModel.shape.token.parse(token);
    const init = initOf(options);
    return await client.get<CustomerOrder>(`/api/payment/order/cancellation?token=${encodeURIComponent(checked)}`, init);
}

/**
 * Cancels the order behind the token from the cancellation mail and returns it as it stands afterwards.
 * Resolves also when the refund failed (`refund.status` is `FAILED`): the order is cancelled, the studio settles the money.
 * Core allows 5 cancels a minute per visitor. A blank or over-long token throws a `ZodError` and sends nothing.
 */
export async function cancelOrderByToken(client: AdibilisClient, token: string, options: ShopCallOptions): Promise<CustomerOrder> {
    const checked = OrderCancelByTokenRequestModel.shape.token.parse(token);
    const init = initOf(options);
    return await client.post<CustomerOrder>('/api/payment/order/cancel', { token: checked }, init);
}
