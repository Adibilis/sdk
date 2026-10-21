import type { PublishedReviewsResponse } from '@adbls/api-types';
import { describe, expect, it, vi } from 'vitest';
import { createAdibilisClient } from '../src/client/api-client';
import { AdibilisApiError } from '../src/client/errors';
import { fetchGoogleReviews } from '../src/review/review-client';

const reviews = {
    rating: 4.8,
    reviewCount: 37,
    reviews: [
        {
            authorName: 'Jana Meier',
            authorPhotoUrl: 'https://lh3.googleusercontent.com/a/photo',
            starRating: 5,
            comment: 'Schnell verkauft, top betreut.',
            createTime: '2026-10-01T09:00:00Z',
            updateTime: '2026-10-01T09:00:00Z',
            replyComment: 'Herzlichen Dank!',
            replyUpdateTime: '2026-10-02T08:00:00Z',
        },
        {
            authorName: 'Marco Rossi',
            starRating: 4,
            comment: '',
            createTime: '2026-09-12T15:30:00Z',
            updateTime: '2026-09-12T15:30:00Z',
        },
    ],
} as const satisfies PublishedReviewsResponse;

const clientRespondingWith = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockImplementation(
        async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    );
    return { client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

describe('fetchGoogleReviews', () => {
    it('reads the published reviews with the website key', async () => {
        const { client, fetchMock } = clientRespondingWith(200, reviews);

        await expect(fetchGoogleReviews(client)).resolves.toEqual(reviews);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/review/published');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
    });

    it('returns the empty answer of a tenant without Google as it is, not as an error', async () => {
        const { client } = clientRespondingWith(200, { reviewCount: 0, reviews: [] });

        await expect(fetchGoogleReviews(client)).resolves.toEqual({ reviewCount: 0, reviews: [] });
    });

    it('surfaces a refused key as an AdibilisApiError', async () => {
        const { client } = clientRespondingWith(403, { error: 'Forbidden' });

        await expect(fetchGoogleReviews(client)).rejects.toBeInstanceOf(AdibilisApiError);
        await expect(fetchGoogleReviews(client)).rejects.toMatchObject({ status: 403 });
    });
});
