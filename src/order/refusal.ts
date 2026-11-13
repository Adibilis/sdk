import { OrderStatusModel } from '@adbls/api-types';
import type { OrderStatus } from '@adbls/api-types';
import { AdibilisApiError } from '../client/errors.js';

export type OrderRefusal =
    /** 409: the order was cancelled already. Show it as cancelled. */
    | { code: 'ORDER_ALREADY_CANCELLED' }
    /** 409: the order is past the point where a customer can cancel it (`status`). `status` is `null` for a status this SDK version does not know. */
    | { code: 'ORDER_NOT_CANCELLABLE'; status: OrderStatus | null }
    /** 409: the order was paid in a way core cannot refund. Ask the studio. */
    | { code: 'ORDER_NOT_REFUNDABLE' };

export type OrderCancellationRefusal =
    | OrderRefusal
    /** 401: the mailed link was used up, expired, replaced by a newer one or never existed. */
    | { code: 'ORDER_CANCELLATION_TOKEN_INVALID' }
    /** 404: core's shop module is off. */
    | { code: 'SHOP_MODULE_DISABLED' }
    /** 429: this visitor used up the budget of cancels (5 a minute). Wait; do not loop. */
    | { code: 'TOO_MANY_REQUESTS' };

/** Reads the order refusals core answers with on 409, or `null` for any other answer. */
export function orderRefusalIn(status: number, errorList: Record<string, unknown>): OrderRefusal | null {
    if (status !== 409) return null;
    if ('ORDER_ALREADY_CANCELLED' in errorList) return { code: 'ORDER_ALREADY_CANCELLED' };
    const notCancellable = errorList['ORDER_NOT_CANCELLABLE'];
    if (Array.isArray(notCancellable)) {
        return { code: 'ORDER_NOT_CANCELLABLE', status: OrderStatusModel.options.find((known) => known === notCancellable[0]) ?? null };
    }
    return 'ORDER_NOT_REFUNDABLE' in errorList ? { code: 'ORDER_NOT_REFUNDABLE' } : null;
}

/** Core's refusal of an order cancellation call in a form a shop can act on, or `null` for any other error. */
export function orderCancellationRefusalOf(error: unknown): OrderCancellationRefusal | null {
    if (!(error instanceof AdibilisApiError)) return null;
    const errorList = (error.body as { errorList?: Record<string, unknown> } | null)?.errorList;
    if (errorList == null || typeof errorList !== 'object') return null;
    if (error.status === 401) return 'ORDER_CANCELLATION_TOKEN_INVALID' in errorList ? { code: 'ORDER_CANCELLATION_TOKEN_INVALID' } : null;
    if (error.status === 404) return 'SHOP_MODULE_DISABLED' in errorList ? { code: 'SHOP_MODULE_DISABLED' } : null;
    if (error.status === 429) return 'TOO_MANY_REQUESTS' in errorList ? { code: 'TOO_MANY_REQUESTS' } : null;
    return orderRefusalIn(error.status, errorList);
}
