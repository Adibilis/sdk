import type { PublishedReviewResponse, PublishedReviewsResponse } from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';

export type { PublishedReviewResponse, PublishedReviewsResponse };

/**
 * The tenant's Google Business Profile reviews: Google's overall `rating` and `reviewCount`, and
 * every review core stored at its last refresh, newest first. Gated on the WEBSITE role alone, with
 * no module row.
 *
 * Core never calls Google on this request — it answers from what its daily refresh stored. A tenant
 * that has not connected Google, or has not chosen a location, gets `reviews: []`, `reviewCount: 0`
 * and no `rating`, never an error. A failed refresh keeps the last stored reviews in place, so the
 * list can be days old but does not empty itself.
 *
 * `comment` is an empty string for a rating left without text; `replyComment` is the owner's answer.
 */
export function fetchGoogleReviews(client: AdibilisClient): Promise<PublishedReviewsResponse> {
    return client.get<PublishedReviewsResponse>('/api/review/published');
}
