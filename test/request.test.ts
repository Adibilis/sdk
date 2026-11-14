import { describe, expect, it } from 'vitest';
import { clientIpOf, publicOrigin } from '../src/request/request';

describe('clientIpOf', () => {
    it('takes the last forwarded-for entry, the one the ingress appended', () => {
        expect(clientIpOf(new Headers({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }))).toBe('203.0.113.7');
    });

    it('falls back to x-real-ip when the forwarded entry is no IP literal', () => {
        expect(clientIpOf(new Headers({ 'x-forwarded-for': 'evil.example', 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    });

    it('answers the loopback address without either header', () => {
        expect(clientIpOf(new Headers())).toBe('127.0.0.1');
    });

    it('sends an IPv4-mapped IPv6 address as the plain IPv4 address', () => {
        expect(clientIpOf(new Headers({ 'x-forwarded-for': '::ffff:203.0.113.7' }))).toBe('203.0.113.7');
    });
});

describe('publicOrigin', () => {
    it('builds the origin from the forwarded host and scheme', () => {
        const headers = new Headers({ 'x-forwarded-host': 'app.codonis.swiss', 'x-forwarded-proto': 'https' });

        expect(publicOrigin(headers, 'http://0.0.0.0:3000')).toBe('https://app.codonis.swiss');
    });

    it('answers the fallback without forwarded headers', () => {
        expect(publicOrigin(new Headers(), 'http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('takes the first forwarded entry and the fallback scheme without a forwarded scheme', () => {
        expect(publicOrigin(new Headers({ 'x-forwarded-host': 'shop.example, proxy.internal' }), 'http://localhost:3000')).toBe(
            'http://shop.example'
        );
        expect(publicOrigin(new Headers({ host: 'shop.example' }), 'https://0.0.0.0:3000')).toBe('https://shop.example');
    });
});
