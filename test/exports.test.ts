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
