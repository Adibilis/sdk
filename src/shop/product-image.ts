/**
 * The absolute URL of a product image. `mainImagePath` and `images[].path` are paths on core
 * (`/api/public/media/product/{id}/{file}`), served without a key so a browser can load them.
 *
 * Browser-safe on purpose: compose it wherever the base URL is known — on the server, then hand the
 * result to the page as a prop, so the base URL is never inlined into a bundle.
 */
export function shopImageUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The price in one currency, matched case-insensitively (core stores `CHF`, Stripe speaks `chf`). */
export function priceIn<T extends { currency: string }>(prices: readonly T[], currency: string): T | undefined {
    const code = currency.toUpperCase();
    return prices.find((price) => price.currency.toUpperCase() === code);
}

/** How a product's price relates to VAT: `'included'` (BRUTTO), `'excluded'` (NETTO, added at checkout). */
export type VatNote = 'included' | 'excluded';

/**
 * What to say about VAT next to a product's price: `'included'` ("incl. VAT"), `'excluded'`
 * ("excl. VAT, added at checkout") or `null` for a VAT-exempt product, which says nothing. The SDK
 * bundles no language — the site words the result.
 *
 * Takes only the two fields it reads, so it works on a core that predates product VAT: with neither
 * field sent, prices always included VAT, hence `'included'`.
 */
export function vatNoteOf(product: {
    priceMode?: 'BRUTTO' | 'NETTO' | null;
    vatExempt?: boolean | null;
}): VatNote | null {
    if (product.vatExempt) return null;
    return product.priceMode === 'NETTO' ? 'excluded' : 'included';
}
