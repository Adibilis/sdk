import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the architectural boundary declared in package.json: every subpath the export map
 * promises must actually exist in dist after a build. Renaming an entry point without updating
 * the map would otherwise ship a package that cannot be imported at all.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, string | { types: string; default: string }>;
};

describe('export map', () => {
    const targets = Object.entries(pkg.exports).flatMap(([subpath, entry]) =>
        typeof entry === 'string' ? [[subpath, entry] as const] : [
            [subpath, entry.types] as const,
            [subpath, entry.default] as const,
        ]
    );

    it.each(targets)('%s -> %s exists', (_subpath, target) => {
        expect(existsSync(new URL(`../${target}`, import.meta.url))).toBe(true);
    });

    it('keeps the server entry separate from the browser entry', () => {
        expect(pkg.exports['.']).not.toEqual(pkg.exports['./server']);
    });
});

describe('discount types', () => {
    it.each(['dist/client-entry.d.ts', 'dist/server.d.ts'])('%s exports the refusal and duration types', (file) => {
        const declarations = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        expect(declarations).toMatch(/DiscountCodeRefusal/);
        expect(declarations).toMatch(/DiscountDuration/);
    });
});

describe('order cancellation exports', () => {
    const declarations = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    it('the server entry exports the calls and the order types', () => {
        const server = declarations('dist/server.d.ts');
        expect(server).toMatch(/getOrderCancellation/);
        expect(server).toMatch(/cancelOrderByToken/);
        expect(server).toMatch(/orderCancellationRefusalOf/);
        expect(server).toMatch(/fetchCancelledBookings/);
        expect(server).toMatch(/isBookingCancelled/);
        expect(server).toMatch(/CustomerOrder\b/);
        expect(server).toMatch(/OrderCancellationRefusal/);
    });

    it('the browser entry exports the types and the date check, but not the key-holding call', () => {
        const browser = declarations('dist/client-entry.d.ts');
        expect(browser).toMatch(/CustomerOrder\b/);
        expect(browser).toMatch(/CancelledBooking/);
        expect(browser).toMatch(/isBookingCancelled/);
        expect(browser).not.toMatch(/cancelOrderByToken/);
        expect(browser).not.toMatch(/fetchCancelledBookings/);
    });
});
