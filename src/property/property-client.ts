import { PropertyEnquiryRequestModel, PropertyLeadRequestModel } from '@adbls/api-types';
import type {
    PageResponse,
    PropertyEnquiryRequest,
    PropertyLeadCreatedResponse,
    PropertyLeadRequest,
    PropertyLeadResponse,
    PublishedPropertyResponse,
} from '@adbls/api-types';
import type { AdibilisClient } from '../client/api-client.js';

export type {
    PropertyEnquiryRequest,
    PropertyLeadCreatedResponse,
    PropertyLeadRequest,
    PropertyLeadResponse,
    PublishedPropertyResponse,
};

export interface PublishedPropertyPageOptions {
    /** Zero-based page index. Omitted means core's default, 0. */
    page?: number;
    /** Rows per page. Omitted means core's default, 20. */
    size?: number;
}

/**
 * One page of the properties published on the satellite's own website — core filters to those
 * carrying a live `OWN_WEBSITE` listing, newest first, and that ordering is not configurable.
 *
 * Every endpoint in this file is gated on the WEBSITE role *and* on the `properties` module row.
 * A tenant that has not enabled the module answers **403, not 404** — so a satellite pointed at a
 * misconfigured install fails loudly rather than rendering an empty listing page.
 */
export function fetchPublishedProperties(
    client: AdibilisClient,
    options: PublishedPropertyPageOptions = {}
): Promise<PageResponse<PublishedPropertyResponse>> {
    const query = new URLSearchParams();
    if (options.page !== undefined) query.set('page', String(options.page));
    // Core binds ch.adibilis.dto.PageRequest as a command object, whose field is `pageSize`. A
    // `size=` parameter is silently ignored and every page comes back at the default 20.
    if (options.size !== undefined) query.set('pageSize', String(options.size));

    const suffix = query.toString();
    return client.get<PageResponse<PublishedPropertyResponse>>(`/api/property/published${suffix ? `?${suffix}` : ''}`);
}

/**
 * A single published property. A property that exists but has no live `OWN_WEBSITE` listing is a
 * **404**, identical to an id that never existed — core deliberately refuses to tell an
 * unauthenticated site which drafts are in the pipeline.
 *
 * Images are not fetched through this client: `media[].filePath` and `avatarFilePath` are served
 * unauthenticated at `{baseUrl}/api/public/media/property/{id}/{filePath}`, so an `<img src>` (and
 * a portal crawler) can reach them without the WEBSITE key. See the README.
 */
export function fetchPublishedProperty(client: AdibilisClient, id: number): Promise<PublishedPropertyResponse> {
    return client.get<PublishedPropertyResponse>(`/api/property/published/${id}`);
}

/**
 * Files a valuation lead: core creates the seller contact, a `LEAD`-status property and the lead
 * row, and hands back the `publicToken` the result page is addressed by. Keep that token — it is
 * the only handle on the lead, and core never returns it again.
 *
 * The payload is checked against the generated schema before it leaves the process, so a missing
 * `contact`, an incomplete `estate` or a missing `source` surfaces as a `ZodError` here rather than
 * a 400 round-trip. The schema is a subset of core's rules — it accepts whitespace-only strings and
 * any string as an email, both of which core still rejects.
 */
export async function submitPropertyLead(
    client: AdibilisClient,
    request: PropertyLeadRequest
): Promise<PropertyLeadCreatedResponse> {
    // async so a validation failure is a rejection like every other failure, not a synchronous throw
    // a caller handling only the promise would miss
    const payload = PropertyLeadRequestModel.parse(request);
    return client.post<PropertyLeadCreatedResponse>('/api/property/lead', payload);
}

/**
 * The lead behind a public token — what a result page renders. Reading it is a write on core's
 * side: the first read stamps `viewedAt`, which is how the ERP knows the seller opened the result.
 * An unknown or revoked token is a 404.
 */
export function fetchPropertyLead(client: AdibilisClient, token: string): Promise<PropertyLeadResponse> {
    return client.get<PropertyLeadResponse>(`/api/property/lead/${encodeURIComponent(token)}`);
}

/**
 * The seller asks for a real valuation. Core stamps `valuationRequestedAt` and mails the team.
 *
 * Idempotent on core's side — a second call on an already-requested lead succeeds and sends no
 * second mail — so a double-clicked button needs no guard here.
 */
export async function requestPropertyValuation(client: AdibilisClient, token: string): Promise<void> {
    await client.post<void>(`/api/property/lead/${encodeURIComponent(token)}/valuation-request`, undefined);
}

/**
 * A visitor asks about a published property. Core stores the enquiry and answers **202** — stored,
 * nothing more: what happens next (a mail, a follow-up) is core's business, not the site's.
 *
 * A property that is not published is a **404**, the module being off a **403**, and a **503**
 * means core did not store the enquiry — the site may retry that one.
 *
 * Forward the visitor's IP as `clientIp`. Core rate-limits per IP; a request without it falls into
 * one bucket shared by every visitor of the site.
 *
 * The payload is checked against the generated schema before it leaves the process, so a missing
 * `email`, a non-boolean `consent` or a missing `source` surfaces as a `ZodError` here rather than a
 * 400 round-trip. The schema is a subset of core's rules — its patterns are unanchored, so a
 * `source` or `language` that merely *contains* an allowed sequence passes here and core still
 * rejects it.
 */
export async function submitPropertyEnquiry(client: AdibilisClient, propertyId: number, request: PropertyEnquiryRequest): Promise<void> {
    // async so a validation failure is a rejection like every other failure, not a synchronous throw
    const payload = PropertyEnquiryRequestModel.parse(request);
    await client.post<void>(`/api/property/${encodeURIComponent(String(propertyId))}/enquiry`, payload);
}
