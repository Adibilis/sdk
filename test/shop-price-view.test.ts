import { describe, expect, it } from 'vitest';
import { isValidOpenPrice, openPriceSteps, shopPriceView } from '../src/shop/price-view';

const now = new Date('2026-11-11T12:00:00Z');

describe('shopPriceView', () => {
    it('shows the discounted price, the saving and the end date', () => {
        const view = shopPriceView({ amount: 40, discountedAmount: 32, discountEndsAt: '2026-12-01T22:59:59Z' }, false, now);
        expect(view).toEqual({
            amount: '40.00',
            discountedAmount: '32.00',
            savingPercent: 20,
            discountEndsAt: new Date('2026-12-01T22:59:59Z'),
            openRange: null,
        });
    });

    it('has no discount without a discounted amount', () => {
        const view = shopPriceView({ amount: 40 }, false, now);
        expect(view).toMatchObject({ amount: '40.00', discountedAmount: null, savingPercent: null, discountEndsAt: null });
    });

    it('keeps a discount with no end date', () => {
        expect(shopPriceView({ amount: '40.00', discountedAmount: '30.00' }, false, now)).toMatchObject({
            discountedAmount: '30.00',
            savingPercent: 25,
            discountEndsAt: null,
        });
    });

    it('anEndedDiscountShowsTheRegularPrice', () => {
        const view = shopPriceView({ amount: 40, discountedAmount: 32, discountEndsAt: '2026-11-11T11:59:59Z' }, false, now);
        expect(view).toMatchObject({ amount: '40.00', discountedAmount: null, savingPercent: null, discountEndsAt: null });
    });

    it('rounds the saving down', () => {
        expect(shopPriceView({ amount: 30, discountedAmount: 20 }, false, now).savingPercent).toBe(33);
        expect(shopPriceView({ amount: 30, discountedAmount: 10 }, false, now).savingPercent).toBe(66);
    });

    it('does not drift on decimals', () => {
        expect(shopPriceView({ amount: 19.9, discountedAmount: 15.92 }, false, now).savingPercent).toBe(20);
    });

    it('ignores a discounted amount that is not lower', () => {
        expect(shopPriceView({ amount: 40, discountedAmount: 40 }, false, now).discountedAmount).toBeNull();
        expect(shopPriceView({ amount: 40, discountedAmount: 45 }, false, now).discountedAmount).toBeNull();
    });

    it('exposes the range of an open-price product, with the discount on the minimum', () => {
        const view = shopPriceView({ amount: 40, discountedAmount: 32, maximumAmount: 2000, step: 5 }, true, now);
        expect(view.openRange).toEqual({ minimum: '40.00', maximum: '2000.00', step: '5.00' });
        expect(view.discountedAmount).toBe('32.00');
    });

    it('has no range when the product is not open-price or core sent no bounds', () => {
        expect(shopPriceView({ amount: 40, maximumAmount: 2000, step: 5 }, false, now).openRange).toBeNull();
        expect(shopPriceView({ amount: 40 }, true, now).openRange).toBeNull();
    });
});

describe('open price range', () => {
    const range = { minimum: '40.00', maximum: '2000.00', step: '5.00' };

    it('lists every step from the minimum to the maximum', () => {
        const steps = openPriceSteps(range);
        expect(steps).toHaveLength(393);
        expect(steps.slice(0, 3)).toEqual(['40.00', '45.00', '50.00']);
        expect(steps.at(-1)).toBe('2000.00');
    });

    it('stops at the last full step below a maximum that is not on the grid', () => {
        expect(openPriceSteps({ minimum: '10.00', maximum: '22.00', step: '5.00' })).toEqual(['10.00', '15.00', '20.00']);
    });

    it('steps exactly in decimals', () => {
        expect(openPriceSteps({ minimum: '0.10', maximum: '0.40', step: '0.10' })).toEqual(['0.10', '0.20', '0.30', '0.40']);
    });

    it('lists nothing for a step that is not positive', () => {
        expect(openPriceSteps({ minimum: '1.00', maximum: '2.00', step: '0.00' })).toEqual([]);
    });

    it('accepts the edges and the grid', () => {
        expect(isValidOpenPrice(range, '40')).toBe(true);
        expect(isValidOpenPrice(range, 45)).toBe(true);
        expect(isValidOpenPrice(range, '2000.00')).toBe(true);
    });

    it('refuses off-grid and out-of-range prices', () => {
        expect(isValidOpenPrice(range, 42.5)).toBe(false);
        expect(isValidOpenPrice(range, 2005)).toBe(false);
        expect(isValidOpenPrice(range, 35)).toBe(false);
    });

    it('refuses what is not an amount', () => {
        expect(isValidOpenPrice(range, '')).toBe(false);
        expect(isValidOpenPrice(range, 'abc')).toBe(false);
        expect(isValidOpenPrice(range, Number.NaN)).toBe(false);
    });
});
