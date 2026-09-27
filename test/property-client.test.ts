import type { PropertyLeadCreatedResponse, PropertyLeadRequest, PublishedPropertyResponse } from '@adbls/api-types';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import {
    fetchPropertyLead,
    fetchPublishedProperties,
    fetchPublishedProperty,
    requestPropertyValuation,
    submitPropertyLead,
} from '../src/property/property-client';

const property = {
    id: 42,
    number: 'PR-2026-0042',
    status: 'ACTIVE',
    category: 'HOUSE',
    type: 'VILLA',
    offerType: 'SALE',
    title: 'Villa am Hang',
    salePrice: 1_450_000,
    currency: 'CHF',
    availableFrom: '2026-11-01',
    createDate: '2026-09-01T08:00:00.000Z',
    modifyDate: '2026-09-02T08:00:00.000Z',
    media: [],
} as const satisfies PublishedPropertyResponse;

const page = { content: [property], number: 0, size: 20, totalPages: 1, totalElements: 1 };

const lead = {
    contact: { firstname: 'Jana', lastname: 'Meier', email: 'jana@example.ch', phone: '+41 79 000 00 00' },
    estate: { street: 'Bahnhofstrasse 1', city: 'Zug', zip: '6300' },
    category: 'HOUSE',
    type: 'VILLA',
    inputs: { livingArea: 180, numberOfRooms: 5.5 },
    result: { low: 1_200_000, high: 1_500_000 },
    calculatedAmount: 1_350_000,
    source: 'valuation-calculator',
} as const satisfies PropertyLeadRequest;

const mockClient = (impl: { get?: unknown; post?: unknown } = {}) => ({
    get: vi.fn().mockResolvedValue(impl.get ?? null),
    post: vi.fn().mockResolvedValue(impl.post ?? null),
});

/** A client whose transport is a mocked fetch, so the real status -> AdibilisApiError mapping runs. */
const clientRespondingWith = (status: number, body: unknown) => {
    const empty = body === null;
    const fetchMock = vi.fn().mockResolvedValue(
        new Response(empty ? null : JSON.stringify(body), {
            status,
            headers: empty ? {} : { 'content-type': 'application/json' },
        })
    );
    return { client: createAdibilisClient({ baseUrl: 'https://core.test', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

describe('fetchPublishedProperties', () => {
    it('hits the published endpoint with no query at all when nothing is asked for', async () => {
        const client = mockClient({ get: page });

        await expect(fetchPublishedProperties(client)).resolves.toEqual(page);
        expect(client.get).toHaveBeenCalledWith('/api/property/published');
    });

    /**
     * Core binds ch.adibilis.dto.PageRequest as a command object, and its field is `pageSize`.
     * A `size=` parameter is silently ignored and every page comes back at the default 20, so
     * this is the one mapping in the module that fails without any error to point at it.
     */
    it('sends the page size as pageSize, which is what core actually binds', async () => {
        const client = mockClient({ get: page });

        await fetchPublishedProperties(client, { page: 2, size: 24 });

        expect(client.get).toHaveBeenCalledWith('/api/property/published?page=2&pageSize=24');
    });

    it('sends page 0 and size 0 rather than dropping them as falsy', async () => {
        const client = mockClient({ get: page });

        await fetchPublishedProperties(client, { page: 0, size: 0 });

        expect(client.get).toHaveBeenCalledWith('/api/property/published?page=0&pageSize=0');
    });

    it('sends only the half of the page it was given', async () => {
        const client = mockClient({ get: page });

        await fetchPublishedProperties(client, { page: 3 });

        expect(client.get).toHaveBeenCalledWith('/api/property/published?page=3');
    });

    // The module row, not the key, decides this: a tenant with `properties` disabled answers 403
    // rather than 404, so a satellite pointed at the wrong install fails loudly instead of
    // rendering an empty listing page.
    it('surfaces the disabled-module 403 as an AdibilisApiError', async () => {
        const { client } = clientRespondingWith(403, {
            error: 'Forbidden',
            errorList: { PROPERTIES_MODULE_DISABLED: ['Properties module disabled'] },
            url: '/api/property/published',
        });

        await expect(fetchPublishedProperties(client)).rejects.toMatchObject({
            name: 'AdibilisApiError',
            status: 403,
            body: { errorList: { PROPERTIES_MODULE_DISABLED: ['Properties module disabled'] } },
        });
    });
});

describe('fetchPublishedProperty', () => {
    it('reads a single published property by id', async () => {
        const client = mockClient({ get: property });

        await expect(fetchPublishedProperty(client, 42)).resolves.toEqual(property);
        expect(client.get).toHaveBeenCalledWith('/api/property/published/42');
    });

    // A property that exists but has no live OWN_WEBSITE listing is a 404, not an empty 200 --
    // core refuses to distinguish "never existed" from "not published" for an unauthenticated site.
    it('surfaces the not-published 404 as an AdibilisApiError', async () => {
        const { client } = clientRespondingWith(404, {
            error: 'Not Found',
            errorList: { PROPERTY_NOT_FOUND: ['Property not found'] },
            url: '/api/property/published/7',
        });

        await expect(fetchPublishedProperty(client, 7)).rejects.toMatchObject({ name: 'AdibilisApiError', status: 404 });
    });

    it('surfaces the disabled-module 403 on the detail endpoint too', async () => {
        const { client } = clientRespondingWith(403, {
            error: 'Forbidden',
            errorList: { PROPERTIES_MODULE_DISABLED: ['Properties module disabled'] },
            url: '/api/property/published/42',
        });

        await expect(fetchPublishedProperty(client, 42)).rejects.toMatchObject({ status: 403 });
    });
});

describe('submitPropertyLead', () => {
    const created = { propertyId: 42, number: 'PR-2026-0042', publicToken: 'a'.repeat(64) };

    it('posts the validated lead and returns the token the result page needs', async () => {
        const client = mockClient({ post: created });

        await expect(submitPropertyLead(client, lead)).resolves.toEqual(created);
        expect(client.post).toHaveBeenCalledWith('/api/property/lead', lead);
    });

    it('rejects a lead with no contact before any request is made', async () => {
        const client = mockClient();
        const { contact: _dropped, ...withoutContact } = lead;

        await expect(submitPropertyLead(client, withoutContact as unknown as PropertyLeadRequest)).rejects.toBeInstanceOf(
            ZodError
        );
        expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a lead whose estate address is incomplete before any request is made', async () => {
        const client = mockClient();
        const { zip: _dropped, ...estateWithoutZip } = lead.estate;

        await expect(
            submitPropertyLead(client, { ...lead, estate: estateWithoutZip } as unknown as PropertyLeadRequest)
        ).rejects.toBeInstanceOf(ZodError);
        expect(client.post).not.toHaveBeenCalled();
    });

    // `source` is what tells the ERP which calculator produced the lead; core requires it, and a
    // satellite that forgets it would otherwise learn so only from a 400 in production.
    it('rejects a lead with no source before any request is made', async () => {
        const client = mockClient();
        const { source: _dropped, ...withoutSource } = lead;

        await expect(submitPropertyLead(client, withoutSource as unknown as PropertyLeadRequest)).rejects.toBeInstanceOf(
            ZodError
        );
        expect(client.post).not.toHaveBeenCalled();
    });

    it('is a rejection, not a synchronous throw, so a caller handling only the promise still sees it', async () => {
        const client = mockClient();
        let pending: Promise<PropertyLeadCreatedResponse> | undefined;

        expect(() => {
            pending = submitPropertyLead(client, {} as unknown as PropertyLeadRequest);
        }).not.toThrow();

        await expect(pending).rejects.toBeInstanceOf(ZodError);
    });
});

describe('fetchPropertyLead', () => {
    const leadResponse = {
        number: 'PR-2026-0042',
        status: 'LEAD',
        inputs: { livingArea: 180 },
        result: { low: 1_200_000, high: 1_500_000 },
        calculatedAmount: 1_350_000,
        receivedAt: '2026-09-16T09:00:00.000Z',
    };

    it('reads the lead by its public token', async () => {
        const client = mockClient({ get: leadResponse });

        await expect(fetchPropertyLead(client, 'ab12cd34')).resolves.toEqual(leadResponse);
        expect(client.get).toHaveBeenCalledWith('/api/property/lead/ab12cd34');
    });

    it('encodes a token that would break the path', async () => {
        const client = mockClient({ get: leadResponse });

        await fetchPropertyLead(client, 'tok/en?x=1');

        expect(client.get).toHaveBeenCalledWith('/api/property/lead/tok%2Fen%3Fx%3D1');
    });

    it('surfaces an unknown token as a 404', async () => {
        const { client } = clientRespondingWith(404, {
            error: 'Not Found',
            errorList: { PROPERTY_LEAD_NOT_FOUND: ['Property lead not found'] },
            url: '/api/property/lead/nope',
        });

        await expect(fetchPropertyLead(client, 'nope')).rejects.toMatchObject({ status: 404 });
    });
});

describe('requestPropertyValuation', () => {
    it('posts to the lead-scoped valuation endpoint and resolves nothing', async () => {
        const client = mockClient();

        await expect(requestPropertyValuation(client, 'ab12cd34')).resolves.toBeUndefined();
        expect(client.post).toHaveBeenCalledWith('/api/property/lead/ab12cd34/valuation-request', undefined);
    });

    it('encodes the token here too', async () => {
        const client = mockClient();

        await requestPropertyValuation(client, 'tok/en');

        expect(client.post).toHaveBeenCalledWith('/api/property/lead/tok%2Fen/valuation-request', undefined);
    });

    /**
     * Two statuses because the spec says 204 but the handler returns `void` with no
     * @ResponseStatus, which Spring answers as an empty 200 -- both must resolve, neither may be
     * read as a body.
     */
    it.each([200, 204])('resolves an empty %i and sends no request body, since the endpoint takes none', async (status) => {
        const { client, fetchMock } = clientRespondingWith(status, null);

        await expect(requestPropertyValuation(client, 'ab12cd34')).resolves.toBeUndefined();

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://core.test/api/property/lead/ab12cd34/valuation-request');
        expect(init.method).toBe('POST');
        expect(init.body).toBeUndefined();
    });

    // Core returns early when valuationRequestedAt is already set, so a double-clicked button is
    // two successful calls and one mail -- the SDK must not try to dedupe on its own.
    it('is safe to call twice, because core is idempotent', async () => {
        const client = mockClient();

        await requestPropertyValuation(client, 'ab12cd34');
        await requestPropertyValuation(client, 'ab12cd34');

        expect(client.post).toHaveBeenCalledTimes(2);
    });
});

// Mirrors test/holidays-client.test.ts: core's zod profile emits `dateAsString`, so every date on
// these DTOs is the wire format and never a Date the site would have to un-parse.
describe('wire format', () => {
    it('keeps property and lead dates as ISO strings', () => {
        const parsed: PublishedPropertyResponse = JSON.parse(JSON.stringify(property));
        const availableFrom: string | undefined = parsed.availableFrom;

        expect(typeof availableFrom).toBe('string');
        expect(typeof parsed.createDate).toBe('string');
    });
});
