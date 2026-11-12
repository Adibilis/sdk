import { describe, expect, it } from 'vitest';
import { isValidOpenPrice, openPriceDiscount, openPriceSteps, shopPriceView } from '../src/shop/price-view';

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

    it('has no discount on a zero amount, however the discounted amount looks', () => {
        expect(shopPriceView({ amount: 0, discountedAmount: -1 }, false, now)).toMatchObject({ amount: '0.00', discountedAmount: null, savingPercent: null });
        expect(shopPriceView({ amount: 0, discountedAmount: 0 }, false, now)).toMatchObject({ discountedAmount: null, savingPercent: null });
    });

    it('has no discount on a negative discounted amount', () => {
        expect(shopPriceView({ amount: 40, discountedAmount: -5 }, false, now)).toMatchObject({ discountedAmount: null, savingPercent: null });
    });

    it('counts a discount ending exactly now as ended', () => {
        const view = shopPriceView({ amount: 40, discountedAmount: 32, discountEndsAt: '2026-11-11T12:00:00Z' }, false, now);
        expect(view).toMatchObject({ discountedAmount: null, discountEndsAt: null });
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

describe('openPriceDiscount', () => {
    const base = { amount: 40 };

    it('applies a percent discount to the chosen price', () => {
        expect(openPriceDiscount({ ...base, discounts: [{ percent: 10 }] }, 100, now)).toEqual({
            amount: '100.00',
            discountedAmount: '90.00',
            saving: '10.00',
            percent: '10',
            amountOff: null,
            endsAt: null,
        });
    });

    it('applies an amount discount', () => {
        expect(openPriceDiscount({ ...base, discounts: [{ amountOff: 5 }] }, 100, now)).toMatchObject({
            discountedAmount: '95.00',
            saving: '5.00',
            percent: null,
            amountOff: '5.00',
        });
    });

    it('caps an amount discount at the chosen price', () => {
        expect(openPriceDiscount({ ...base, discounts: [{ amountOff: 50 }] }, 40, now)).toMatchObject({
            discountedAmount: '0.00',
            saving: '40.00',
            amountOff: '50.00',
        });
    });

    it('lets the larger discount win, which flips with the chosen price', () => {
        const price = { ...base, discounts: [{ percent: 10 }, { amountOff: 5 }] };
        expect(openPriceDiscount(price, 40, now)).toMatchObject({ discountedAmount: '35.00', amountOff: '5.00', percent: null });
        expect(openPriceDiscount(price, 100, now)).toMatchObject({ discountedAmount: '90.00', percent: '10', amountOff: null });
    });

    it('keeps the first discount on a tie', () => {
        const percentFirst = { ...base, discounts: [{ percent: 10 }, { amountOff: 10 }] };
        expect(openPriceDiscount(percentFirst, 100, now)).toMatchObject({ percent: '10', amountOff: null });
        const amountFirst = { ...base, discounts: [{ amountOff: 10 }, { percent: 10 }] };
        expect(openPriceDiscount(amountFirst, 100, now)).toMatchObject({ percent: null, amountOff: '10.00' });
    });

    it('ignores a discount that ended and one with neither field', () => {
        const price = {
            ...base,
            discounts: [{ percent: 50, endsAt: '2026-11-11T12:00:00Z' }, {}, { percent: null, amountOff: null }, { percent: 10, endsAt: '2026-12-01T00:00:00Z' }],
        };
        const result = openPriceDiscount(price, 100, now);
        expect(result).toMatchObject({ percent: '10', discountedAmount: '90.00' });
        expect(result?.endsAt).toEqual(new Date('2026-12-01T00:00:00Z'));
    });

    it('is null without a usable discount', () => {
        expect(openPriceDiscount(base, 100, now)).toBeNull();
        expect(openPriceDiscount({ ...base, discounts: null }, 100, now)).toBeNull();
        expect(openPriceDiscount({ ...base, discounts: [] }, 100, now)).toBeNull();
        expect(openPriceDiscount({ ...base, discounts: [{ percent: 0 }] }, 100, now)).toBeNull();
        expect(openPriceDiscount({ ...base, discounts: [{ percent: 10 }] }, 0, now)).toBeNull();
    });

    it('rounds the percent saving half up', () => {
        expect(openPriceDiscount({ ...base, discounts: [{ percent: 12.5 }] }, 45, now)).toMatchObject({
            saving: '5.63',
            discountedAmount: '39.37',
            percent: '12.5',
        });
    });

    it('reads strings and numbers and formats the percent as core stores it', () => {
        const result = openPriceDiscount({ ...base, discounts: [{ percent: '12.50' }] }, '80.00', now);
        expect(result).toMatchObject({ amount: '80.00', saving: '10.00', percent: '12.5' });
        expect(openPriceDiscount({ ...base, discounts: [{ percent: '10.00' }] }, 50, now)?.percent).toBe('10');
        expect(openPriceDiscount({ ...base, discounts: [{ amountOff: '5' }] }, 50, now)?.amountOff).toBe('5.00');
    });
});
