import { describe, expect, it } from 'vitest';
import { SIGN_IN_NOTICES, signInNoticeOf } from '../src/customer/sign-in-notice';

describe('signInNoticeOf', () => {
    it('answers a known code', () => {
        expect(signInNoticeOf('TOO_MANY_REQUESTS')).toBe('TOO_MANY_REQUESTS');
    });

    it.each([
        ['an unknown code', 'X'],
        ['nothing', undefined],
        ['a repeated query parameter', ['EMAIL_INVALID']],
    ])('answers null for %s', (_name, value) => {
        expect(signInNoticeOf(value)).toBeNull();
    });

    it('lists the five codes', () => {
        expect(SIGN_IN_NOTICES).toEqual([
            'EMAIL_INVALID',
            'TOO_MANY_REQUESTS',
            'CUSTOMER_LOGIN_TOKEN_INVALID',
            'CUSTOMER_SESSION_INVALID',
            'SIGN_IN_UNAVAILABLE',
        ]);
    });
});
