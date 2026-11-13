import type {
    WebsiteResourceDetailResponse,
    WebsiteResourceProductResponse,
    WebsiteResourceResponse,
    WebsiteResourceTopicResponse,
} from '@adbls/api-types';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAdibilisClient } from '../src/client/api-client';
import { getResource, listResourceProducts, listResources, listResourceTopics } from '../src/resource/resource-client';

const card = {
    id: 7,
    title: 'Tongue posture',
    format: 'VIDEO',
    language: 'DE',
    topicId: 3,
    topicName: 'Basics',
    publicAccess: false,
    groups: [{ slug: 'members', memberLabel: 'Members' }],
    unlocked: true,
} as const satisfies WebsiteResourceResponse;

const locked = {
    card: { ...card, unlocked: false, accessHint: 'Members only' },
    files: [],
} as const satisfies WebsiteResourceDetailResponse;

const topic = { id: 3, name: 'Basics', sortOrder: 0, publishedCount: 2 } as const satisfies WebsiteResourceTopicResponse;
const product = { id: 12, title: 'Example One' } as const satisfies WebsiteResourceProductResponse;

const OPTIONS = { clientIp: '203.0.113.7' };

const clientRespondingWith = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    );
    return { client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

const headersOf = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls[0][1].headers as Record<string, string>;

describe('listResources', () => {
    it('reads the cards with the key, the visitor and no cache', async () => {
        const { client, fetchMock } = clientRespondingWith(200, [card]);

        await expect(listResources(client, {}, OPTIONS)).resolves.toEqual([card]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/website/resource');
        expect(headersOf(fetchMock)['X-API-Secret-Key']).toBe('k');
        expect(headersOf(fetchMock)['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(headersOf(fetchMock)['X-Customer-Session']).toBeUndefined();
        expect(init.cache).toBe('no-store');
    });

    it('sends the filters as query parameters', async () => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await listResources(
            client,
            { search: ' tongue ', topicId: 3, format: 'VIDEO', language: 'DE', productId: 12, categoryId: 4, groupSlug: 'members' },
            OPTIONS
        );

        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://core.test/api/website/resource?search=tongue&topicId=3&format=VIDEO&language=DE&productId=12&categoryId=4&groupSlug=members'
        );
    });

    it('omits blank and null filters', async () => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await listResources(client, { search: '  ', topicId: null, groupSlug: '' }, OPTIONS);
        await listResources(client, { groupSlug: '  ' }, OPTIONS);

        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/resource');
        expect(fetchMock.mock.calls[1][0]).toBe('https://core.test/api/website/resource');
    });

    it('encodes the group slug', async () => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await listResources(client, { groupSlug: 'a b&c' }, OPTIONS);

        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/resource?groupSlug=a+b%26c');
    });

    it('rejects a filter core would refuse', async () => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await expect(listResources(client, { format: 'AUDIO' as never }, OPTIONS)).rejects.toBeInstanceOf(ZodError);
        await expect(listResources(client, { search: 'x'.repeat(201) }, OPTIONS)).rejects.toBeInstanceOf(ZodError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the session when one is given', async () => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await listResources(client, {}, { ...OPTIONS, customerSession: 'tok-1' });

        expect(headersOf(fetchMock)['X-Customer-Session']).toBe('tok-1');
        expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    });

    it.each([['an empty string', ''], ['null', null]])('sends no session for %s', async (_name, customerSession) => {
        const { client, fetchMock } = clientRespondingWith(200, []);

        await listResources(client, {}, { ...OPTIONS, customerSession });

        expect(headersOf(fetchMock)['X-Customer-Session']).toBeUndefined();
    });
});

describe('getResource', () => {
    it('reads one detail, locked ones included', async () => {
        const { client, fetchMock } = clientRespondingWith(200, locked);

        await expect(getResource(client, 7, OPTIONS)).resolves.toEqual(locked);

        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/resource/7');
        expect(headersOf(fetchMock)['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    });

    it.each([0, -1, 1.5])('rejects the id %s, which is not a positive integer', async (id) => {
        const { client, fetchMock } = clientRespondingWith(200, locked);

        await expect(getResource(client, id, OPTIONS)).rejects.toBeInstanceOf(ZodError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('listResourceTopics and listResourceProducts', () => {
    it('read their lists', async () => {
        const topics = clientRespondingWith(200, [topic]);
        await expect(listResourceTopics(topics.client, OPTIONS)).resolves.toEqual([topic]);
        expect(topics.fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/resource-topic');
        expect(headersOf(topics.fetchMock)['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(topics.fetchMock.mock.calls[0][1].cache).toBe('no-store');

        const products = clientRespondingWith(200, [product]);
        await expect(listResourceProducts(products.client, OPTIONS)).resolves.toEqual([product]);
        expect(products.fetchMock.mock.calls[0][0]).toBe('https://core.test/api/website/resource-product');
        expect(headersOf(products.fetchMock)['X-Shop-Client-Ip']).toBe('203.0.113.7');
        expect(products.fetchMock.mock.calls[0][1].cache).toBe('no-store');
    });
});

describe('a refused call', () => {
    it('rejects with AdibilisApiError', async () => {
        const { client } = clientRespondingWith(404, { errorList: { RESOURCES_MODULE_DISABLED: ['Resources module disabled'] } });

        await expect(listResources(client, {}, OPTIONS)).rejects.toMatchObject({ status: 404 });
    });
});
