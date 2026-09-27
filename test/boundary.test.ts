import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

/**
 * Walks the BUILT output rather than the sources. That distinction is the whole point: a
 * `import type` statement is erased by tsc, so it never reaches a bundle — a source-level scan
 * flags it as a violation when it is not one. dist/*.js is what a bundler actually follows.
 */
function reachableFrom(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
            const spec = match[1]!;
            if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec.endsWith('.js') ? spec : `${spec}.js`));
        }
    }
    return seen;
}

const rel = (files: Set<string>) => [...files].map((f) => relative(DIST, f));

describe('entry point boundary', () => {
    beforeAll(() => {
        expect(existsSync(resolve(DIST, 'client-entry.js')), 'dist/ missing — run `pnpm build` first').toBe(true);
    });

    /**
     * The whole reason this package has two entry points: dist/client/ holds the WEBSITE api key.
     * If anything reachable from the browser entry imports it — directly or through a chain of
     * re-exports — the key lands in a client bundle. The export map cannot prevent that: it names
     * the entry files, not what they pull in.
     */
    it('browser entry cannot reach the api client', () => {
        expect(rel(reachableFrom(resolve(DIST, 'client-entry.js'))).filter((f) => f.startsWith('client/'))).toEqual([]);
    });

    it('server entry does reach the api client (guards against a vacuous test above)', () => {
        expect(rel(reachableFrom(resolve(DIST, 'server.js')))).toContain('client/api-client.js');
    });

    /**
     * The checkout client is the second thing that must never ship to a browser: it takes the
     * api client (and with it the key) as its first argument, and the request it sends carries the
     * buyer's full order. The React checkout entry shares the `checkout/` directory with it, so this
     * pins that sharing a folder never became sharing a bundle.
     */
    it('neither browser entry can reach the checkout client', () => {
        for (const entry of ['client-entry.js', 'checkout-entry.js']) {
            expect(rel(reachableFrom(resolve(DIST, entry))), entry).not.toContain('checkout/checkout-client.js');
        }
        expect(rel(reachableFrom(resolve(DIST, 'server.js')))).toContain('checkout/checkout-client.js');
    });

    /**
     * The property client is the second key-holder. Its listing and detail calls look harmless
     * enough to be tempting to run from a client component -- which would put the WEBSITE key in
     * every visitor's bundle to render a page that is public anyway. Property IMAGES genuinely are
     * public (`/api/public/media/property/...`, no key), and that asymmetry is exactly why this
     * needs pinning rather than trusting.
     */
    it('the browser entry cannot reach the property client', () => {
        expect(rel(reachableFrom(resolve(DIST, 'client-entry.js')))).not.toContain('property/property-client.js');
        expect(rel(reachableFrom(resolve(DIST, 'server.js')))).toContain('property/property-client.js');
    });
});
