import { add, compareDecimal, formatDecimal, multiply, parseDecimal, roundHalfUp, type Decimal } from '../subscription/decimal.js';

type Amount = number | string;

/** The fields of core's `ShopProductPriceResponse` the view reads. */
export interface ShopPriceInput {
    amount: Amount;
    discountedAmount?: Amount | null;
    /** ISO instant; a discount that ended before `now` is not shown. */
    discountEndsAt?: string | null;
    maximumAmount?: Amount | null;
    step?: Amount | null;
    /** Every running automatic discount that reaches the product; `openPriceDiscount` picks the winner for a chosen price. */
    discounts?: ShopPriceDiscountInput[] | null;
}

/** One entry of core's `ShopProductPriceResponse.discounts`: a percent or an amount off, never both. */
export interface ShopPriceDiscountInput {
    percent?: Amount | null;
    amountOff?: Amount | null;
    /** ISO instant; a discount that ended at or before `now` is ignored. */
    endsAt?: string | null;
}

/** The bounds of an open-price product, as decimal strings with two places. */
export type OpenPriceRange = { minimum: string; maximum: string; step: string };

export type ShopPriceView = {
    /** The regular price (the minimum, for an open-price product), decimal string with two places. */
    amount: string;
    /** The price to charge while the discount runs, or `null` when there is none (or it has ended). */
    discountedAmount: string | null;
    /** Whole percent saved, rounded down (33.33 % shows 33); `null` when not discounted. */
    savingPercent: number | null;
    discountEndsAt: Date | null;
    openRange: OpenPriceRange | null;
};

const money = (value: Amount): Decimal => roundHalfUp(parseDecimal(value), 2);

/**
 * What to show for a product's price: the regular price, the discounted price with its saving and end date,
 * and the range of an open-price product. A discount whose end passed at `now` is dropped, so a cached page
 * never shows an offer that is over. The SDK bundles no language — the site words the result.
 */
export function shopPriceView(price: ShopPriceInput, openPrice: boolean, now: Date = new Date()): ShopPriceView {
    const amount = money(price.amount);
    const endsAt = price.discountEndsAt ? new Date(price.discountEndsAt) : null;
    const discounted = price.discountedAmount == null ? null : money(price.discountedAmount);
    const active =
        discounted !== null &&
        amount.units > 0n &&
        discounted.units >= 0n &&
        compareDecimal(discounted, amount) < 0 &&
        (endsAt === null || endsAt.getTime() > now.getTime());

    let savingPercent: number | null = null;
    if (active) {
        const saved = add(amount, { units: -discounted.units, scale: discounted.scale });
        savingPercent = Number((saved.units * 100n) / amount.units);
    }

    const { maximumAmount, step } = price;
    return {
        amount: formatDecimal(amount),
        discountedAmount: active ? formatDecimal(discounted) : null,
        savingPercent,
        discountEndsAt: active ? endsAt : null,
        openRange:
            openPrice && maximumAmount != null && step != null
                ? { minimum: formatDecimal(amount), maximum: formatDecimal(money(maximumAmount)), step: formatDecimal(money(step)) }
                : null,
    };
}

/**
 * Every price the buyer may choose, from the minimum in steps up to the maximum. Empty for a step that is not positive.
 * It lists every step: a wide range with a small step is a long list, so a shop with many steps should take a numeric
 * input and check it with `isValidOpenPrice` instead.
 */
export function openPriceSteps(range: OpenPriceRange): string[] {
    const minimum = money(range.minimum);
    const maximum = money(range.maximum);
    const step = money(range.step);
    if (step.units <= 0n) return [];
    const steps: string[] = [];
    for (let current = minimum; compareDecimal(current, maximum) <= 0; current = add(current, step)) {
        steps.push(formatDecimal(current));
    }
    return steps;
}

/** Whether `chosen` lies within the range and on its step grid. */
export function isValidOpenPrice(range: OpenPriceRange, chosen: Amount): boolean {
    let value: Decimal;
    try {
        value = parseDecimal(chosen);
    } catch {
        return false;
    }
    const minimum = money(range.minimum);
    const step = money(range.step);
    if (step.units <= 0n || compareDecimal(value, minimum) < 0 || compareDecimal(value, money(range.maximum)) > 0) return false;
    const scale = Math.max(value.scale, 2);
    const offset = add(roundHalfUp(value, scale), { units: -minimum.units, scale: 2 });
    return (offset.units % (step.units * 10n ** BigInt(scale - 2))) === 0n;
}

export type OpenPriceDiscount = {
    /** The chosen price, decimal string with two places. */
    amount: string;
    /** What core charges for it, for display; core still prices the charge. */
    discountedAmount: string;
    /** `amount` minus `discountedAmount`. */
    saving: string;
    /** The winning discount's percent as core stores it ("10.00" shows "10"); `null` for an amount discount. */
    percent: string | null;
    /** The winning amount discount, two places; `null` for a percent discount. */
    amountOff: string | null;
    endsAt: Date | null;
};

const trimmed = (value: Decimal): string => {
    const text = formatDecimal(value);
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
};

/**
 * The discount core applies to the price the buyer chose for an open-price product, from the price's `discounts`:
 * a percent saves `chosen × percent / 100` rounded half up, an amount saves at most the chosen price, the larger
 * saving wins and the first listed wins a tie. Discounts that ended at `now` are ignored. `null` when none saves
 * anything. Core decides the charged amount; this is what to show.
 */
export function openPriceDiscount(price: ShopPriceInput, chosen: Amount, now: Date = new Date()): OpenPriceDiscount | null {
    const amount = money(chosen);
    let best: { saving: Decimal; percent: Decimal | null; amountOff: Decimal | null; endsAt: Date | null } | null = null;
    for (const discount of price.discounts ?? []) {
        const endsAt = discount.endsAt ? new Date(discount.endsAt) : null;
        if (endsAt !== null && endsAt.getTime() <= now.getTime()) continue;
        let saving: Decimal;
        let percent: Decimal | null = null;
        let amountOff: Decimal | null = null;
        if (discount.percent != null) {
            percent = parseDecimal(discount.percent);
            const product = multiply(amount, percent);
            saving = roundHalfUp({ units: product.units, scale: product.scale + 2 }, 2);
        } else if (discount.amountOff != null) {
            amountOff = money(discount.amountOff);
            saving = compareDecimal(amountOff, amount) < 0 ? amountOff : amount;
        } else {
            continue;
        }
        if (saving.units > 0n && (best === null || compareDecimal(saving, best.saving) > 0)) {
            best = { saving, percent, amountOff, endsAt };
        }
    }
    if (best === null) return null;
    return {
        amount: formatDecimal(amount),
        discountedAmount: formatDecimal(add(amount, { units: -best.saving.units, scale: best.saving.scale })),
        saving: formatDecimal(best.saving),
        percent: best.percent === null ? null : trimmed(best.percent),
        amountOff: best.amountOff === null ? null : formatDecimal(best.amountOff),
        endsAt: best.endsAt,
    };
}
