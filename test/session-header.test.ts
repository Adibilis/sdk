import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customerSessionInit, SESSION_HEADER } from '../src/customer/session-header';

describe('session-header', () => {
    it('is a leaf module', () => {
        const source = readFileSync(new URL('../src/customer/session-header.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/^import /m);
    });

    it('sends the session without caching', () => {
        expect(SESSION_HEADER).toBe('X-Customer-Session');
        expect(customerSessionInit('tok')).toEqual({ headers: { 'X-Customer-Session': 'tok' }, cache: 'no-store' });
        expect(customerSessionInit(null)).toEqual({});
    });
});
