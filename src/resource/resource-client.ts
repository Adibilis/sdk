import type {
    ResourceFormat,
    WebsiteResourceDetailResponse,
    WebsiteResourceFileResponse,
    WebsiteResourceFilterRequest,
    WebsiteResourceGroupResponse,
    WebsiteResourceProductResponse,
    WebsiteResourceResponse,
    WebsiteResourceTopicResponse,
} from '@adbls/api-types';
import { WebsiteResourceFilterRequestModel } from '@adbls/api-types';
import { z } from 'zod';
import type { AdibilisClient } from '../client/api-client.js';
import { customerSessionInit } from '../customer/session-header.js';
import { shopCallHeaders } from '../subscription/checkout-client.js';
import type { ShopCallOptions } from '../subscription/checkout-client.js';

export type {
    ResourceFormat,
    WebsiteResourceDetailResponse,
    WebsiteResourceFileResponse,
    WebsiteResourceFilterRequest,
    WebsiteResourceGroupResponse,
    WebsiteResourceProductResponse,
    WebsiteResourceResponse,
    WebsiteResourceTopicResponse,
};

export interface ResourceCallOptions extends ShopCallOptions {
    /**
     * The signed-in visitor's session (`customerSessionFromCookies`): core then unlocks the resources their groups grant. Without
     * one, or with an empty one, the call is anonymous. An expired or unknown session is refused with 401 `CUSTOMER_SESSION_INVALID`.
     */
    customerSession?: string | null;
}

const RESOURCE_PATH = '/api/website/resource';
const IdModel = z.number().int().positive();

function init(options: ResourceCallOptions): RequestInit {
    return { headers: { ...shopCallHeaders(options), ...customerSessionInit(options.customerSession).headers }, cache: 'no-store' };
}

function queryOf(filters: WebsiteResourceFilterRequest): string {
    const search = filters.search?.trim();
    const parsed = WebsiteResourceFilterRequestModel.parse({ ...filters, search: search ? search : undefined });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && value !== undefined) params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

/**
 * Every published resource as a card, locked or not, ordered by topic (its sort order, then name), then by the resource's sort order
 * and title. Unpaged and open: the list answers the visitor's own view of the whole library, so a satellite narrows it with the
 * filters rather than paging it. A card the visitor's groups do not unlock has
 * `unlocked === false`: show its teaser and the sign-in. Blank filters are left out; a filter core would refuse rejects with a
 * `ZodError` before any call.
 *
 * Refusals: 404 `RESOURCES_MODULE_DISABLED`, 401 `CUSTOMER_SESSION_INVALID` (a session core no longer knows), 429
 * `TOO_MANY_REQUESTS` (this visitor's read budget is used up).
 */
export async function listResources(
    client: AdibilisClient,
    filters: WebsiteResourceFilterRequest,
    options: ResourceCallOptions
): Promise<WebsiteResourceResponse[]> {
    return client.get<WebsiteResourceResponse[]>(`${RESOURCE_PATH}${queryOf(filters)}`, init(options));
}

/**
 * One published resource with its body and files. A locked resource is a 200 with `card.unlocked === false` and no files: show the
 * teaser and the sign-in, do not treat it as an error. Its files are read through the file call, which refuses a locked one.
 *
 * Refusals: 404 `RESOURCE_NOT_FOUND` (unknown or unpublished), 404 `RESOURCES_MODULE_DISABLED`, 401 `CUSTOMER_SESSION_INVALID`, 429
 * `TOO_MANY_REQUESTS`.
 */
export async function getResource(client: AdibilisClient, id: number, options: ResourceCallOptions): Promise<WebsiteResourceDetailResponse> {
    return client.get<WebsiteResourceDetailResponse>(`${RESOURCE_PATH}/${IdModel.parse(id)}`, init(options));
}

/**
 * Every topic that holds a published resource, with how many, for the list's topic filter. Unpaged and open to every visitor.
 *
 * Refusals: 404 `RESOURCES_MODULE_DISABLED`, 429 `TOO_MANY_REQUESTS`.
 */
export async function listResourceTopics(client: AdibilisClient, options: ShopCallOptions): Promise<WebsiteResourceTopicResponse[]> {
    return client.get<WebsiteResourceTopicResponse[]>('/api/website/resource-topic', init(options));
}

/**
 * Every product a published resource refers to, for the list's product filter. Unpaged and open to every visitor.
 *
 * Refusals: 404 `RESOURCES_MODULE_DISABLED`, 429 `TOO_MANY_REQUESTS`.
 */
export async function listResourceProducts(client: AdibilisClient, options: ShopCallOptions): Promise<WebsiteResourceProductResponse[]> {
    return client.get<WebsiteResourceProductResponse[]>('/api/website/resource-product', init(options));
}
