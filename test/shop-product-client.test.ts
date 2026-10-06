import type { ShopProductResponse } from '@adbls/api-types';
import { describe, expect, it, vi } from 'vitest';
import { AdibilisApiError } from '../src/client/errors';
import { createAdibilisClient } from '../src/client/api-client';
import { fetchShopProduct, fetchShopProducts } from '../src/shop/product-client';
import { priceIn, shopImageUrl } from '../src/shop/product-image';

const product = {
    id: 12,
    title: 'Example One',
    description: 'The essential myofunctional trainer',
    sku: 'one',
    gtin: '07649994254056',
    prices: [
        { currency: 'CHF', amount: 90 },
        { currency: 'EUR', amount: 95 },
    ],
    mainImagePath: '/api/public/media/product/12/one.webp',
    images: [{ path: '/api/public/media/product/12/one.webp' }],
} as const satisfies ShopProductResponse;

const clientRespondingWith = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    );
    return { client: createAdibilisClient({ baseUrl: 'https://core.test/', apiKey: 'k', fetch: fetchMock }), fetchMock };
};

describe('fetchShopProducts', () => {
    it('reads the listed catalog with the website key', async () => {
        const { client, fetchMock } = clientRespondingWith(200, [product]);

        await expect(fetchShopProducts(client)).resolves.toEqual([product]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://core.test/api/shop/product');
        expect((init.headers as Record<string, string>)['X-API-Secret-Key']).toBe('k');
    });

    it('surfaces satellites being switched off in core as a 403, not an empty shop', async () => {
        const { client } = clientRespondingWith(403, { error: 'SATELLITES_DISABLED' });

        await expect(fetchShopProducts(client)).rejects.toMatchObject({ status: 403 });
        await expect(fetchShopProducts(client)).rejects.toBeInstanceOf(AdibilisApiError);
    });
});

describe('fetchShopProduct', () => {
    it('reads one listed product by id', async () => {
        const { client, fetchMock } = clientRespondingWith(200, product);

        await expect(fetchShopProduct(client, 12)).resolves.toEqual(product);
        expect(fetchMock.mock.calls[0][0]).toBe('https://core.test/api/shop/product/12');
    });

    it('answers 404 for a product that is not listed', async () => {
        const { client } = clientRespondingWith(404, { error: 'SHOP_PRODUCT_NOT_FOUND' });

        await expect(fetchShopProduct(client, 99)).rejects.toMatchObject({ status: 404 });
    });
});

describe('shopImageUrl', () => {
    it('joins core base url and image path with exactly one slash', () => {
        expect(shopImageUrl('https://core.test/', product.mainImagePath)).toBe(
            'https://core.test/api/public/media/product/12/one.webp'
        );
        expect(shopImageUrl('https://core.test', 'api/public/media/product/12/one.webp')).toBe(
            'https://core.test/api/public/media/product/12/one.webp'
        );
    });
});

describe('priceIn', () => {
    it('finds the price for a currency whatever its case', () => {
        expect(priceIn(product.prices, 'eur')).toEqual({ currency: 'EUR', amount: 95 });
        expect(priceIn(product.prices, 'USD')).toBeUndefined();
    });
});
