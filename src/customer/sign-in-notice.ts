/** The `error` query parameter the sign-in routes redirect with; the login and continue pages render one message per code. */
export type SignInNotice =
    | 'EMAIL_INVALID'
    | 'TOO_MANY_REQUESTS'
    | 'CUSTOMER_LOGIN_TOKEN_INVALID'
    | 'CUSTOMER_SESSION_INVALID'
    | 'SIGN_IN_UNAVAILABLE';

export const SIGN_IN_NOTICES: readonly SignInNotice[] = [
    'EMAIL_INVALID',
    'TOO_MANY_REQUESTS',
    'CUSTOMER_LOGIN_TOKEN_INVALID',
    'CUSTOMER_SESSION_INVALID',
    'SIGN_IN_UNAVAILABLE',
];

/** The notice a page's `error` search parameter names, or `null` for anything else (a repeated parameter included). */
export function signInNoticeOf(value: unknown): SignInNotice | null {
    return SIGN_IN_NOTICES.find((notice) => notice === value) ?? null;
}
