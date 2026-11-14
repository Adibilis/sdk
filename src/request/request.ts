import { ipLiteralOf } from '../subscription/checkout-client.js';

const LOOPBACK = '127.0.0.1';
const HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http', 'https']);

/**
 * The visitor's address for `clientIp`, as the ingress saw them. The last `X-Forwarded-For` entry is the one the ingress
 * appended; anything before it is the visitor's own claim. Then `X-Real-IP`, and the loopback address when neither is an IP
 * literal, so a call to core never fails on a missing header.
 */
export function clientIpOf(headers: Headers): string {
    for (const candidate of [headers.get('x-forwarded-for')?.split(',').at(-1), headers.get('x-real-ip')]) {
        const ip = candidate ? ipLiteralOf(candidate) : null;
        if (ip !== null) return ip;
    }
    return LOOPBACK;
}

/**
 * The origin the visitor sees, for an absolute URL core mails or checks against its allowed origins. Inside the container the
 * request URL carries the listen address; the ingress forwards the public host and scheme. Without a host name (with an
 * optional port), or with a forwarded scheme other than http(s), `fallback`.
 */
export function publicOrigin(headers: Headers, fallback: string): string {
    const host = firstEntry(headers.get('x-forwarded-host') ?? headers.get('host'));
    if (host === undefined || !HOST.test(host)) return fallback;
    const forwardedScheme = firstEntry(headers.get('x-forwarded-proto'))?.toLowerCase();
    if (forwardedScheme !== undefined && !WEB_SCHEMES.has(forwardedScheme)) return fallback;
    return `${forwardedScheme ?? new URL(fallback).protocol.slice(0, -1)}://${host}`;
}

function firstEntry(value: string | null): string | undefined {
    const entry = value?.split(',')[0]?.trim();
    return entry ? entry : undefined;
}
